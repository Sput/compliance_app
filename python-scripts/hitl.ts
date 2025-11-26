import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

export type Stage =
  | 'ingest_text'
  | 'date'
  | 'action_describer'
  | 'control_candidates'
  | 'finalize_classification';

export const STAGES: Stage[] = [
  'ingest_text',
  'date',
  'action_describer',
  'control_candidates',
  'finalize_classification',
];

export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  if (i < 0 || i === STAGES.length - 1) return null;
  return STAGES[i + 1];
}

export type SessionStatus = 'active' | 'completed' | 'error';

export interface SessionState {
  session_id: string;
  evidence_id: string | null;
  current_stage: Stage;
  status: SessionStatus;
  latest_result?: any;
}

function isMock() {
  const v = String(process.env.HITL_MOCK || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function pick<T>(arr: T[], i = 0): T | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.min(i, arr.length - 1)];
}

async function runMock<T = any>(subcommand: string, input: any): Promise<T> {
  if (subcommand === 'start') {
    const session_id = input?.session_id || randomUUID();
    return { session: { session_id, evidence_id: input?.evidence_id ?? null, current_stage: 'ingest_text', status: 'active' } } as T;
  }
  if (subcommand === 'run-stage') {
    const stage: Stage = input?.stage;
    const payload = input?.payload || {};
    if (stage === 'ingest_text') {
      const text: string = payload.text || '';
      const truncated = text.length > 1000;
      return { stage, model_output: { text: truncated ? text.slice(0, 1000) : text, source: payload.source || 'mock', truncated, length: Math.min(text.length, 1000) }, meta: { elapsed_ms: 1 } } as T;
    }
    if (stage === 'date') {
      const text: string = payload?.text || '';
      const ev = '2025-10-22';
      const st = payload?.window?.start || '2025-01-01';
      const en = payload?.window?.end || '2025-12-31';
      const ok = ev >= st && ev <= en;
      return { stage, model_output: { evidence_date: ev, candidates: [ev], confidence: 0.9, rationale: 'mock', status: ok ? 'pass' : 'fail', reason: 'mock' }, meta: { elapsed_ms: 1 } } as T;
    }
    if (stage === 'action_describer') {
      const text: string = payload?.text || '';
      const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 480);
      return { stage, model_output: { actions_summary: trimmed || 'mock actions summary' }, meta: { elapsed_ms: 1 } } as T;
    }
    if (stage === 'control_candidates') {
      return { stage, model_output: { candidates: [ { id: 'CTRL-PASS-001', label: 'Password Policy', confidence: 0.6, rationale: 'mock' }, { id: 'CTRL-AUTH-001', label: 'Multi-Factor Authentication', confidence: 0.4, rationale: 'mock' } ] }, meta: { elapsed_ms: 1 } } as T;
    }
    if (stage === 'finalize_classification') {
      const classification = { system: payload?.system || 'AWS', evidence_date: payload?.evidence_date || '2025-10-22', control: payload?.selection || { id: 'CTRL-PASS-001', label: 'Password Policy' } };
      return { stage, model_output: { classification, summary: 'mock summary' }, meta: { elapsed_ms: 1 } } as T;
    }
    throw new Error(`mock_invalid_stage_${stage}`);
  }
  if (subcommand === 'apply-edits') {
    const model_output = input?.model_output || {};
    const edits = input?.human_input?.edits || {};
    return { stage: input?.stage, decided_output: { ...model_output, ...edits } } as T;
  }
  if (subcommand === 'summarize') {
    return { summary: { note: 'mock' } } as T;
  }
  throw new Error(`mock_unknown_subcommand_${subcommand}`);
}

async function runPython<T = any>(subcommand: string, input: unknown, timeoutMs = 30_000): Promise<T> {
  if (isMock()) return runMock(subcommand, input);
  return new Promise<T>((resolve, reject) => {
    const child = spawn('python', ['python-scripts/hitl.py', subcommand], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`hitl_timeout_${subcommand}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : null;
        if (parsed?.error) {
          const e = parsed.error;
          return reject(new Error(`${e.code || 'hitl_error'}: ${e.message || 'unknown'}`));
        }
        if (parsed === null) return reject(new Error(`hitl_no_output_${subcommand}: ${stderr.slice(0, 200)}`));
        resolve(parsed as T);
      } catch (e) {
        if (code && code !== 0) {
          return reject(new Error(`hitl_exit_${code}_${subcommand}: ${stderr.slice(0, 200)}`));
        }
        reject(new Error(`hitl_non_json_${subcommand}: ${stdout.slice(0, 200)}`));
      }
    });

    try {
      child.stdin.write(JSON.stringify(input ?? {}));
      child.stdin.end();
    } catch (e) {
      // If writing to stdin fails, rely on 'error'/'close' handlers above
    }
  });
}

export async function startSession(evidenceId: string | null, sessionId?: string): Promise<{ session: SessionState }> {
  return runPython('start', { evidence_id: evidenceId, session_id: sessionId });
}

export async function runStage(sessionId: string, stage: Stage, payload: any): Promise<{ stage: Stage; model_output: any; meta?: any }> {
  return runPython('run-stage', { session_id: sessionId, stage, payload });
}

export async function applyEdits(sessionId: string, stage: Stage, modelOutput: any, humanInput: any): Promise<{ stage: Stage; decided_output: any }> {
  return runPython('apply-edits', { session_id: sessionId, stage, model_output: modelOutput, human_input: humanInput });
}

export async function summarize(sessionId: string): Promise<any> {
  return runPython('summarize', { session_id: sessionId });
}
