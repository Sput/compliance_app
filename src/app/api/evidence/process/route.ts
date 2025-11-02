import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { spawn } from 'child_process';

type ApiBody = {
  auditId: string;
  fileName: string;
  fileContentBase64: string;
  // Direct mode (bypass upload/audit): provide text + dates
  text?: string;
  dateStart?: string;
  dateEnd?: string;
};

function isUuid(x: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(x);
}

async function getAuditWindow(auditId: string): Promise<{ start: string; end: string } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('audits')
    .select('audit_start, audit_end')
    .eq('id', auditId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.audit_start || !data.audit_end) return null;
  const start = data.audit_start as string; // Dates come as ISO yyyy-mm-dd
  const end = data.audit_end as string;
  return { start, end };
}

function base64ToUtf8(b64: string): string {
  // Node Buffer safely decodes base64 → UTF-8
  const buf = Buffer.from(b64, 'base64');
  return buf.toString('utf8');
}

import { tmpdir } from 'os';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';

function runSupervisorPy(text: string, dateStart: string, dateEnd: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    // Write text to a temp file to avoid command-line length limits
    const base = mkdtempSync(join(tmpdir(), 'evidence-'));
    const textPath = join(base, 'doc.txt');
    writeFileSync(textPath, text, { encoding: 'utf8' });

    const args = [
      'python-scripts/supervisor_cli.py',
      '--text_file', textPath,
      '--date_start', dateStart,
      '--date_end', dateEnd,
    ];
    const child = spawn('python', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error('supervisor_timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return; // Already rejected
      // Try to parse stdout if present (even on non-zero exit) to surface JSON errors
      const tryParse = () => {
        try {
          if (!stdout.trim()) return null;
          return JSON.parse(stdout);
        } catch {
          return null;
        }
      };
      const parsed = tryParse();
      if (parsed) {
        return resolve(parsed);
      }
      if (code !== 0 && code !== null) {
        return reject(new Error(`supervisor_exit_${code}: ${stderr.slice(0, 500)}`));
      }
      return reject(new Error(`non_json_output: ${stdout.slice(0, 500)}`));
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ApiBody;
    const { auditId, fileName, fileContentBase64, text: directText, dateStart, dateEnd } = body || {} as any;

    // Direct mode: if text + dates provided, bypass audit lookups and base64
    if (typeof directText === 'string' && typeof dateStart === 'string' && typeof dateEnd === 'string') {
      let text = directText;
      if (!text.trim()) {
        return NextResponse.json({ success: false, error: 'Empty text' }, { status: 400 });
      }
      const warnings: string[] = [];
      if (text.length > 200_000) {
        text = text.slice(0, 200_000);
        warnings.push('Text truncated to 200k characters for processing');
      }
      const result = await runSupervisorPy(text, dateStart, dateEnd);
      const normalized = typeof result === 'object' ? result : { raw: result };
      return NextResponse.json({ success: true, result: normalized, auditWindow: { start: dateStart, end: dateEnd }, warnings });
    }
    if (!auditId || !isUuid(auditId)) {
      return NextResponse.json({ success: false, error: 'Invalid auditId' }, { status: 400 });
    }
    if (!fileContentBase64 || typeof fileContentBase64 !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing fileContentBase64' }, { status: 400 });
    }

    // Fetch audit window from DB
    const window = await getAuditWindow(auditId);
    if (!window) {
      return NextResponse.json({ success: false, error: 'Audit has no audit_start/audit_end configured.' }, { status: 400 });
    }

    // Decode base64 → text
    let text = '';
    try {
      text = base64ToUtf8(fileContentBase64);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid base64 text payload' }, { status: 400 });
    }
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'Empty decoded text' }, { status: 400 });
    }
    // Bound size
    const warnings: string[] = [];
    if (text.length > 200_000) {
      text = text.slice(0, 200_000);
      warnings.push('Text truncated to 200k characters for processing');
    }

    // Call Python supervisor
    const result = await runSupervisorPy(text, window.start, window.end);
    // Expect result to already have final keys; normalize shape if needed
    const normalized = typeof result === 'object' ? result : { raw: result };
    return NextResponse.json({
      success: true,
      result: normalized,
      auditWindow: window,
      warnings,
    });
  } catch (e: any) {
    const msg = e?.message || 'Processing failed';
    const status = /timeout|supervisor_exit|non_json/i.test(msg) ? 502 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
