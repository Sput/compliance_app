import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';

type ApiBody = {
  text: string;
  dateStart: string;
  dateEnd: string;
  auditId?: string;
  fileName?: string;
  fileContentBase64?: string;
};

function jsonLine(obj: any): string {
  try {
    return JSON.stringify(obj) + "\n";
  } catch {
    return '{"type":"error","error":"json_stringify_failed"}\n';
  }
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ApiBody;

  // Resolve inputs: either direct text+dates, or auditId+base64 (upload mode)
  let text = body.text;
  let dateStart = body.dateStart;
  let dateEnd = body.dateEnd;
  const auditId = body.auditId;
  const fileContentBase64 = body.fileContentBase64;

  function isUuid(x: string): boolean {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(x);
  }
  function base64ToUtf8(b64: string): string {
    const buf = Buffer.from(b64, 'base64');
    return buf.toString('utf8');
  }

  // If audit mode, fetch audit window and decode text
  if ((!text || !dateStart || !dateEnd) && auditId && fileContentBase64) {
    if (!isUuid(auditId)) {
      return new Response(jsonLine({ type: 'error', error: 'invalid_audit_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
    try {
      const supabase = await createServerClient();
      const { data, error } = await supabase
        .from('audits')
        .select('audit_start, audit_end')
        .eq('id', auditId)
        .limit(1)
        .maybeSingle();
      if (error || !data || !data.audit_start || !data.audit_end) {
        return new Response(jsonLine({ type: 'error', error: 'missing_audit_window' }), {
          status: 400,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }
      dateStart = String(data.audit_start);
      dateEnd = String(data.audit_end);
      try {
        text = base64ToUtf8(fileContentBase64);
      } catch {
        return new Response(jsonLine({ type: 'error', error: 'invalid_base64' }), {
          status: 400,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }
    } catch (e) {
      return new Response(jsonLine({ type: 'error', error: 'audit_fetch_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
  }

  if (!text || !dateStart || !dateEnd) {
    return new Response(jsonLine({ type: 'error', error: 'missing_params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      // Write text to a temp file to avoid argv length limits
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
        env: { ...process.env, EVIDENCE_STREAM_MARKERS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdoutBuf = '';
      let signaled = false;

      const push = (obj: any) => controller.enqueue(enc.encode(jsonLine(obj)));

      child.stdout.on('data', (chunk: Buffer) => {
        const s = chunk.toString();
        // Strip marker lines from the buffered stdout so final JSON parses cleanly
        const withoutMarkers = s
          .replace(/(^|\r?\n)AGENT_TOOL_CALLED(\r?\n|$)/g, '\n')
          .replace(/(^|\r?\n)TOOL_CALLED:[A-Za-z0-9_\-]+(\r?\n|$)/g, '\n');
        stdoutBuf += withoutMarkers;
        // Scan original chunk for markers to notify the client asap
        const lines = s.split(/\r?\n/);
        for (const line of lines) {
          if (!signaled && line.trim() === 'AGENT_TOOL_CALLED') {
            signaled = true;
            push({ type: 'agent_called' });
          }
          const m = /^TOOL_CALLED:([A-Za-z0-9_\-]+)$/.exec(line.trim());
          if (m) {
            push({ type: 'tool_called', name: m[1] });
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        // Optionally forward stderr as debug events
        // push({ type: 'debug', stream: 'stderr', data: chunk.toString().slice(0, 500) });
      });
      child.on('error', (err) => {
        push({ type: 'error', error: `spawn_error: ${String(err)}` });
        controller.close();
      });
      child.on('close', (_code) => {
        // Attempt to parse final stdout as JSON result
        let result: any = null;
        try {
          // Clean again defensively in case a partial marker slipped across chunk boundaries
          const cleaned = stdoutBuf
            .replace(/(^|\r?\n)AGENT_TOOL_CALLED(\r?\n|$)/g, '\n')
            .replace(/(^|\r?\n)TOOL_CALLED:[A-Za-z0-9_\-]+(\r?\n|$)/g, '\n');
          const trimmed = cleaned.trim();
          if (trimmed) result = JSON.parse(trimmed);
        } catch {}
        if (result) {
          push({ type: 'result', data: result });
        } else {
          push({ type: 'error', error: 'non_json_output' });
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
