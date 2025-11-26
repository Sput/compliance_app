import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { applyEdits, nextStage, STAGES, type Stage } from '../../../../../python-scripts/hitl';

type Body = { sessionId: string; stage: Stage; modelOutput: any; humanInput: any };

function isUuid(x: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(x);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const { sessionId, stage, modelOutput, humanInput } = body || ({} as any);
    console.log('[HITL-DB] apply: request', {
      sessionId,
      stage,
      modelOutput: typeof modelOutput === 'object' ? {
        evidence_date: modelOutput?.evidence_date ?? null,
        selection: modelOutput?.selection ?? null,
        actions_summary: modelOutput?.actions_summary ?? null,
      } : typeof modelOutput,
      humanInput: typeof humanInput === 'object' ? { approved: humanInput?.approved ?? undefined, edits: humanInput?.edits ?? undefined } : typeof humanInput,
    });
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ success: false, error: 'invalid sessionId' }, { status: 400 });
    }
    if (!STAGES.includes(stage)) {
      return NextResponse.json({ success: false, error: 'invalid stage' }, { status: 400 });
    }

    // Run python merge to get decided_output
    const decided = await applyEdits(sessionId, stage, modelOutput ?? {}, humanInput ?? {});
    console.log('[HITL-DB] apply: decided_output', decided?.decided_output ?? decided);

    const supabase = await createServerClient();
    const restBase = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_KEY || '';
    async function resolveControlIdViaService(code: string): Promise<string | null> {
      try {
        if (!restBase || !serviceKey) return null;
        const url = new URL(restBase.replace(/\/$/, '') + '/rest/v1/controls');
        url.searchParams.set('select', 'id');
        url.searchParams.set('control_id', `eq.${code}`);
        const resp = await fetch(url.toString(), {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        });
        if (!resp.ok) return null;
        const arr = await resp.json();
        if (Array.isArray(arr) && arr[0]?.id) return String(arr[0].id);
        return null;
      } catch {
        return null;
      }
    }

    // Persist step
    const { error: stepErr } = await supabase
      .from('hitl_steps')
      .insert({
        session_id: sessionId,
        stage,
        model_output: modelOutput ?? {},
        human_input: humanInput ?? {},
        decided_output: decided.decided_output ?? {},
        reviewer_id: null,
      });
    if (stepErr) throw stepErr;
    console.log('[HITL-DB] apply: inserted hitl_step');

    // Advance session stage or complete
    const next = nextStage(stage);
    const updates: any = {
      current_stage: next ?? stage,
      latest_result: decided.decided_output ?? {},
      updated_at: new Date().toISOString(),
    };
    if (!next) {
      updates.status = 'completed';
    }

    const { data: sess, error: upErr } = await supabase
      .from('hitl_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    console.log('[HITL-DB] apply: updated hitl_session', { id: sess?.id, current_stage: sess?.current_stage, status: sess?.status });

    // If we just finalized, write back to evidence_uploads (if linked)
    let evidenceWrite: any = null;
    if (!next && stage === 'finalize_classification') {
      const decidedOut = decided.decided_output ?? {};
      // Best-effort mapping: update the chosen control on the upload row
      const chosenUuidRaw = decidedOut?.selection?.uuid || decidedOut?.classification?.control?.uuid || null;
      let chosenRaw = decidedOut?.selection?.id || decidedOut?.classification?.control?.id || null;
      // Do NOT map evidence_date to created_at. created_at is the upload timestamp.
      if (!chosenRaw && modelOutput?.selection?.id) chosenRaw = modelOutput.selection.id;

      const updatePayload: Record<string, any> = {};
      // If client provided edited text in modelOutput, update evidence file content
      if (typeof modelOutput?.text === 'string') {
        try {
          updatePayload.file_content_base64 = Buffer.from(modelOutput.text, 'utf8').toString('base64');
        } catch {}
      }

      // Resolve control UUID if the column expects a UUID
      let controlToSet: string | null = null;
      if (typeof chosenUuidRaw === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(chosenUuidRaw)) {
        controlToSet = chosenUuidRaw;
      }
      if (!controlToSet && typeof chosenRaw === 'string' && chosenRaw) {
        if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(chosenRaw)) {
          controlToSet = chosenRaw; // already a UUID
        } else {
          // Lookup controls.id by controls.control_id (exact), then case-insensitive
          let ctrlId: string | null = null;
          let { data: ctrl, error: ctrlErr } = await supabase
            .from('controls')
            .select('id')
            .eq('control_id', chosenRaw)
            .maybeSingle();
          if (!ctrlErr && ctrl?.id) ctrlId = ctrl.id as string;
          if (!ctrlId) {
            const { data: ctrl2, error: ctrlErr2 } = await supabase
              .from('controls')
              .select('id')
              .ilike('control_id', chosenRaw)
              .maybeSingle();
            if (!ctrlErr2 && ctrl2?.id) ctrlId = ctrl2.id as string;
          }
          if (!ctrlId) {
            ctrlId = await resolveControlIdViaService(chosenRaw);
          }
          if (ctrlId) controlToSet = ctrlId;
        }
      }
      if (controlToSet) updatePayload.control = controlToSet;

      // Ensure an evidence_uploads row exists; create one if missing
      let evidenceId: string | null = sess?.evidence_id ?? null;
      if (!evidenceId) {
        const defaultAuditId = '8b7f8a36-0a8a-4f82-9d3f-2f4e3b1a5c12';
        const textSrc = (modelOutput?.text || decidedOut?.text || modelOutput?.actions_summary || decidedOut?.actions_summary || '') as string;
        const fileContentBase64 = Buffer.from(String(textSrc), 'utf8').toString('base64');
        const { data: newEv, error: newErr } = await supabase
          .from('evidence_uploads')
          .insert({ audit_id: defaultAuditId, file_name: modelOutput?.fileName || 'evidence.txt', file_content_base64: fileContentBase64 })
          .select('id,audit_id,file_name')
          .single();
        if (newErr) throw newErr;
        evidenceId = newEv.id as string;
        // Patch session with the new evidence_id so future reads are consistent
        const { error: sessPatchErr } = await supabase
          .from('hitl_sessions')
          .update({ evidence_id: evidenceId })
          .eq('id', sessionId);
        if (sessPatchErr) console.warn('[HITL-DB] apply: warning updating session evidence_id', sessPatchErr.message);
        console.log('[HITL-DB] apply: created evidence_uploads row', newEv);
      }

      console.log('[HITL-DB] apply: finalize payload', {
        evidence_id: evidenceId,
        chosenUuidRaw,
        chosenRaw,
        resolvedControlId: controlToSet,
        willUpdateControl: Boolean(controlToSet),
        hasEditedText: typeof modelOutput?.text === 'string',
      });

      if (Object.keys(updatePayload).length > 0) {
        const { data: evRow, error: evErr } = await supabase
          .from('evidence_uploads')
          .update(updatePayload)
          .eq('id', evidenceId as string)
          .select('*')
          .single();
        if (evErr) throw evErr;
        evidenceWrite = evRow;
        console.log('[HITL-DB] apply: updated evidence_uploads', { id: evRow?.id, control: evRow?.control });
      } else {
        console.log('[HITL-DB] apply: skipped evidence_uploads update (empty payload)');
      }
    }

    return NextResponse.json({ success: true, decided_output: decided.decided_output, session: sess, evidence: evidenceWrite });
  } catch (e: any) {
    try {
      console.error('[HITL-DB] apply: error', { message: e?.message, stack: e?.stack });
    } catch {}
    return NextResponse.json({ success: false, error: e?.message || 'apply_failed' }, { status: 500 });
  }
}
