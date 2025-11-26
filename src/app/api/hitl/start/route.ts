import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { startSession } from '../../../../../python-scripts/hitl';
import type { Stage } from '../../../../../python-scripts/hitl';

type Body = { evidenceId?: string | null; extractedText?: string | null; fileName?: string | null; fileContentBase64?: string | null; auditId?: string | null };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    let evidenceId = body?.evidenceId ?? null;
    const supabase = await createServerClient();
    const defaultAuditId = '8b7f8a36-0a8a-4f82-9d3f-2f4e3b1a5c12';

    // If no evidenceId provided, create a placeholder upload row in evidence_uploads
    let evidenceUploadRow: any = null;
    if (!evidenceId) {
      const auditId = body?.auditId || defaultAuditId;
      const { data: uploadRow, error: upErr } = await supabase
        .from('evidence_uploads')
        .insert({
          audit_id: auditId,
          file_name: body?.fileName || 'evidence.txt',
          file_content_base64: body?.fileContentBase64 || Buffer.from(String(body?.extractedText || ''), 'utf8').toString('base64'),
        })
        .select('id,audit_id,file_name,file_content_base64,control,created_at')
        .single();
      if (upErr) throw upErr;
      evidenceId = uploadRow.id as string;
      evidenceUploadRow = uploadRow;
    }

    // Create DB session first to obtain canonical session_id
    const { data: row, error: insErr } = await supabase
      .from('hitl_sessions')
      .insert({ evidence_id: evidenceId, current_stage: 'ingest_text', status: 'active', latest_result: null })
      .select('*')
      .single();
    if (insErr) throw insErr;

    // Warm python session (optional, echoes provided id)
    const py = await startSession(evidenceId, row.id as string);

    // If evidenceId was provided up front, fetch a brief summary for verification
    if (!evidenceUploadRow && evidenceId) {
      const { data: existing, error: exErr } = await supabase
        .from('evidence_uploads')
        .select('id,audit_id,file_name,file_content_base64,control,created_at')
        .eq('id', evidenceId)
        .single();
      if (!exErr) evidenceUploadRow = existing;
    }

    const evidenceSummary = evidenceUploadRow
      ? {
          id: evidenceUploadRow.id,
          audit_id: evidenceUploadRow.audit_id || null,
          file_name: evidenceUploadRow.file_name || null,
          file_content_base64_len: typeof evidenceUploadRow.file_content_base64 === 'string' ? evidenceUploadRow.file_content_base64.length : null,
          control: evidenceUploadRow.control || null,
          created_at: evidenceUploadRow.created_at || null,
        }
      : null;

    return NextResponse.json({ success: true, sessionId: row.id, session: py.session, evidenceId, evidenceUpload: evidenceSummary });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'start_failed' }, { status: 500 });
  }
}
