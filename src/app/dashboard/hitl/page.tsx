"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { FileUploader } from '@/components/file-uploader';
import { createClient } from '@/lib/supabase';

type Stage =
  | 'ingest_text'
  | 'date'
  | 'action_describer'
  | 'control_candidates'
  | 'finalize_classification';

const STAGES: Stage[] = [
  'ingest_text',
  'date',
  'action_describer',
  'control_candidates',
  'finalize_classification'
];

function nextStage(s: Stage): Stage | null {
  const i = STAGES.indexOf(s);
  if (i < 0 || i === STAGES.length - 1) return null;
  return STAGES[i + 1];
}

function stageLabel(s: Stage): string {
  switch (s) {
    case 'ingest_text':
      return 'Ingest Text Agent';
    case 'date':
      return 'Date Control Agent';
    case 'action_describer':
      return 'Action Describer Agent';
    case 'control_candidates':
      return 'Control Candidates Agent';
    case 'finalize_classification':
      return 'Finalize Classification Agent';
    default:
      return s.replace('_', ' ') + ' Agent';
  }
}

export default function HitlPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string>('');
  const [evidenceId, setEvidenceId] = useState<string>('');
  const [currentStage, setCurrentStage] = useState<Stage>('ingest_text');
  const [loading, setLoading] = useState<boolean>(false);
  const [modelOutput, setModelOutput] = useState<any | null>(null);
  const [decided, setDecided] = useState<any>({});

  // Stage-local editable fields
  const [text, setText] = useState<string>('');
  const [evidenceDate, setEvidenceDate] = useState<string>('');
  const [windowStart, setWindowStart] = useState<string>('');
  const [windowEnd, setWindowEnd] = useState<string>('');
  const [dateGuardStatus, setDateGuardStatus] = useState<'pass'|'fail'|'unknown'>('unknown');
  const [selectionId, setSelectionId] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [actionsSummary, setActionsSummary] = useState<string>('');
  // Uncontrolled editing refs to avoid caret issues
  const textElRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryElRef = useRef<HTMLTextAreaElement | null>(null);
  const [isEditingEvidenceDate, setIsEditingEvidenceDate] = useState<boolean>(false);
  const hasSeededIngest = useRef<boolean>(false);
  const hasSeededSummary = useRef<boolean>(false);
  const [evidenceSummary, setEvidenceSummary] = useState<{
    id: string;
    audit_id: string | null;
    file_name: string | null;
    file_content_base64_len: number | null;
    control?: string | null;
    created_at?: string | null;
  } | null>(null);
  const [auditIdInput, setAuditIdInput] = useState<string>('8b7f8a36-0a8a-4f82-9d3f-2f4e3b1a5c12');
  const supabase = createClient();

  // Prefill Date Guard window from the audit of this evidence
  useEffect(() => {
    let cancelled = false;
    async function loadAuditWindow(auditId: string) {
      try {
        const { data, error } = await supabase
          .from('audits')
          .select('audit_start,audit_end')
          .eq('id', auditId)
          .maybeSingle();
        if (!error && data && !cancelled) {
          setWindowStart(data.audit_start ? String(data.audit_start) : '');
          setWindowEnd(data.audit_end ? String(data.audit_end) : '');
        }
      } catch {}
    }
    if (evidenceSummary?.audit_id) {
      loadAuditWindow(evidenceSummary.audit_id);
    }
    return () => { cancelled = true; };
  }, [evidenceSummary?.audit_id]);

  // Note: Avoid refocusing text inputs during typing to preserve user caret position.

  function isIsoDate(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  async function onUpload(files: File[]) {
    try {
      if (!files?.length) return;
      const file = files[0];
      console.log('[HITL] onUpload: file selected', { name: file.name, type: file.type, size: file.size });
      const arrayBuf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(arrayBuf);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      const fileContentBase64 = btoa(binary);

      console.log('[HITL] onUpload: calling /api/ocr');
      const ocrRes = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || undefined, fileContentBase64 })
      });
      if (!ocrRes.ok) {
        const txt = await (async () => { try { return await ocrRes.text(); } catch { return ''; } })();
        console.error('[HITL] onUpload: /api/ocr non-OK', ocrRes.status, txt);
        throw new Error(txt || 'OCR failed');
      }
      const data = await ocrRes.json();
      console.log('[HITL] onUpload: /api/ocr response', data);
      const extracted = String(data?.text || '').trim();
      if (!extracted) throw new Error('No text extracted from file');
      setText(extracted);
      setCurrentStage('ingest_text');
      setModelOutput(null);
      setErrors([]);
      toast.success('Text extracted. Click Propose to continue.');
      // Optionally auto-start session if not started
      if (!sessionId) {
        console.log('[HITL] onUpload: no session, auto-starting');
        await startSession(extracted, file.name, fileContentBase64, auditIdInput);
      }
    } catch (e: any) {
      console.error('[HITL] onUpload error', e);
      toast.error(e?.message || 'Upload failed');
    }
  }

  function validateCurrentStage(): string[] {
    const errs: string[] = [];
    if (currentStage === 'ingest_text') {
      if (!text.trim()) errs.push('Evidence text is required.');
    } else if (currentStage === 'date') {
      if (evidenceDate && !isIsoDate(evidenceDate)) errs.push('Evidence date must be YYYY-MM-DD.');
      const ws = windowStart.trim();
      const we = windowEnd.trim();
      if ((ws && !we) || (!ws && we)) errs.push('Both window start and end must be provided, or leave both empty.');
      if (ws && !isIsoDate(ws)) errs.push('Window start must be YYYY-MM-DD.');
      if (we && !isIsoDate(we)) errs.push('Window end must be YYYY-MM-DD.');
    } else if (currentStage === 'action_describer') {
      // no required fields
    } else if (currentStage === 'control_candidates') {
      if (!selectionId) errs.push('Please select a control candidate.');
    } else if (currentStage === 'finalize_classification') {
      if (!decided?.selection?.id) errs.push('Selected control is missing.');
    }
    return errs;
  }

  async function startSession(extractedText?: string, fileName?: string, fileContentBase64?: string, auditIdOverride?: string) {
    setLoading(true);
    try {
      console.log('[HITL] startSession request', { evidenceId, hasText: !!extractedText, fileName, hasB64: !!fileContentBase64 });
      const res = await fetch('/api/hitl/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidenceId: evidenceId || null, extractedText: extractedText ?? null, fileName: fileName ?? null, fileContentBase64: fileContentBase64 ?? null, auditId: (auditIdOverride || auditIdInput) ?? null })
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error('[HITL] startSession non-OK', res.status, txt);
        throw new Error(txt || 'start failed');
      }
      const data = await res.json();
      console.log('[HITL] startSession response', data);
      if (data?.evidenceUpload) {
        console.log('[HITL] evidenceUpload summary', data.evidenceUpload);
      }
      if (!data?.success) throw new Error(data?.error || 'start failed');
      setSessionId(data.sessionId);
      if (data?.evidenceId && !evidenceId) setEvidenceId(data.evidenceId);
      if (data?.evidenceUpload) setEvidenceSummary(data.evidenceUpload);
      setCurrentStage('ingest_text');
      setModelOutput(null);
      setDecided({});
      toast.success('HITL session created');
    } catch (e: any) {
      console.error('[HITL] startSession error', e);
      toast.error(e?.message || 'Failed to start session');
    } finally {
      setLoading(false);
    }
  }

  async function runStage() {
    if (!sessionId) return toast.error('Start a session first');
    setLoading(true);
    try {
      let payload: any = {};
      if (currentStage === 'ingest_text') {
        payload = { text, source: 'manual' };
      } else if (currentStage === 'date') {
        payload = { text: decided.text ?? text, window: (windowStart && windowEnd) ? { start: windowStart, end: windowEnd } : undefined };
      } else if (currentStage === 'action_describer') {
        payload = { text: decided.text ?? text };
      } else if (currentStage === 'control_candidates') {
        payload = { text: decided.text ?? text, actions_summary: decided.actions_summary ?? actionsSummary };
      } else if (currentStage === 'finalize_classification') {
        payload = { actions_summary: decided.actions_summary, evidence_date: decided.evidence_date, selection: decided.selection };
      }
      console.log('[HITL] runStage request', { sessionId, stage: currentStage, payload });
      const res = await fetch('/api/hitl/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, stage: currentStage, payload })
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error('[HITL] runStage non-OK', res.status, txt);
        throw new Error(txt || 'run failed');
      }
      const data = await res.json();
      console.log('[HITL] runStage response', data);
      if (!data?.success) throw new Error(data?.error || 'run failed');
      setModelOutput(data.model_output);
      // Seed editable fields from proposal when appropriate
      if (currentStage === 'ingest_text') {
        // Only seed once if empty
        const t = String(data.model_output?.text || '');
        if (!hasSeededIngest.current && (!text || text.trim() === '')) {
          setText(t);
          hasSeededIngest.current = true;
        }
      } else if (currentStage === 'date') {
        const d = String(data.model_output?.evidence_date || evidenceDate || '');
        setEvidenceDate(d);
        const st = String(data.model_output?.status || 'unknown') as any;
        setDateGuardStatus((st === 'pass' || st === 'fail') ? st : 'unknown');
      } else if (currentStage === 'action_describer') {
        const s = String(data.model_output?.actions_summary || '');
        if (!hasSeededSummary.current && (!actionsSummary || actionsSummary.trim() === '')) {
          setActionsSummary(s);
          hasSeededSummary.current = true;
        }
      } else if (currentStage === 'control_candidates') {
        // list shown below
      }
    } catch (e: any) {
      console.error('[HITL] runStage error', e);
      toast.error(e?.message || 'Failed to run stage');
    } finally {
      setLoading(false);
    }
  }

  async function approveAndContinue() {
    if (!sessionId) return toast.error('Start a session first');
    if (!modelOutput && currentStage !== 'ingest_text' && currentStage !== 'finalize_classification') return toast.error('Run the stage to get a proposal');
    const errs = validateCurrentStage();
    if (errs.length) {
      setErrors(errs);
      toast.error('Please fix the errors before continuing');
      return;
    }
    setLoading(true);
    try {
      let edits: any = {};
      if (currentStage === 'ingest_text') {
        const curText = textElRef.current ? textElRef.current.value : text;
        if (curText !== text) setText(curText);
        edits = { text: curText };
      } else if (currentStage === 'date') {
        edits = { evidence_date: evidenceDate || null, status: dateGuardStatus };
      } else if (currentStage === 'action_describer') {
        const curSummary = summaryElRef.current ? summaryElRef.current.value : actionsSummary;
        if (curSummary !== actionsSummary) setActionsSummary(curSummary);
        edits = { actions_summary: curSummary };
      } else if (currentStage === 'control_candidates') {
        const chosen = (modelOutput?.candidates || []).find((c: any) => String(c.id) === selectionId) || null;
        edits = { candidates: modelOutput?.candidates || [], selection: chosen };
      } else if (currentStage === 'finalize_classification') {
        edits = {}; // summarization-only stage
      }
      const appliedModelOutput = modelOutput ?? (
        currentStage === 'ingest_text'
          ? { text: (textElRef.current ? textElRef.current.value : text) }
          : currentStage === 'finalize_classification'
          ? { evidence_date: decided.evidence_date ?? evidenceDate ?? null, selection: decided.selection ?? null, actions_summary: decided.actions_summary ?? actionsSummary ?? '', text: (textElRef.current ? textElRef.current.value : text) }
          : {}
      );
      const reqBody = { sessionId, stage: currentStage, modelOutput: appliedModelOutput, humanInput: { edits, approved: true } };
      console.log('[HITL] approveAndContinue request', reqBody);
      const res = await fetch('/api/hitl/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error('[HITL] approveAndContinue non-OK', res.status, txt);
        throw new Error(txt || 'apply failed');
      }
      const data = await res.json();
      console.log('[HITL] approveAndContinue response', data);
      if (!data?.success) throw new Error(data?.error || 'apply failed');

      const decidedOut = data.decided_output || {};
      setDecided((prev: any) => ({ ...prev, ...decidedOut }));

      const wasFinal = currentStage === 'finalize_classification';
      const newStage = (data?.session?.current_stage as Stage) || nextStage(currentStage) || currentStage;
      setCurrentStage(newStage);
      setModelOutput(null);
      setErrors([]);
      toast.success(newStage === currentStage ? 'Updated' : 'Advanced to next stage');
      if (data?.evidence) {
        // Update debug evidence card with saved control/created_at
        setEvidenceSummary((prev) => ({
          id: (data.evidence.id ?? prev?.id) || '',
          audit_id: (data.evidence.audit_id ?? prev?.audit_id) || null,
          file_name: (data.evidence.file_name ?? prev?.file_name) || null,
          file_content_base64_len: prev?.file_content_base64_len ?? null,
          control: data.evidence.control ?? prev?.control ?? null,
          created_at: data.evidence.created_at ?? prev?.created_at ?? null,
        }));
      }
      // If we just finalized, reset to a blank Ingest Text Agent form for next upload
      if (wasFinal) {
        setSessionId(null);
        setEvidenceId('');
        setDecided({});
        setText('');
        setEvidenceDate('');
        setActionsSummary('');
        setSelectionId('');
        setEvidenceSummary(null);
        setCurrentStage('ingest_text');
        setModelOutput(null);
        setErrors([]);
      }
      // Auto-propose when entering Date step (extract + guard)
      if (newStage === 'date') {
        console.log('[HITL] auto-propose for date');
        try {
          const payload = { text: (decidedOut.text ?? decided.text ?? text) || '', window: (windowStart && windowEnd) ? { start: windowStart, end: windowEnd } : undefined };
          const res2 = await fetch('/api/hitl/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, stage: 'date', payload })
          });
          if (!res2.ok) {
            const t = await res2.text();
            console.error('[HITL] auto-propose date non-OK', res2.status, t);
          } else {
            const data2 = await res2.json();
            console.log('[HITL] auto-propose date response', data2);
            if (data2?.success) {
              setModelOutput(data2.model_output);
              const d = String(data2.model_output?.evidence_date || '');
              if (d) setEvidenceDate(d);
              const st = String(data2.model_output?.status || 'unknown') as any;
              setDateGuardStatus((st === 'pass' || st === 'fail') ? st : 'unknown');
            }
          }
        } catch (e) {
          console.error('[HITL] auto-propose date error', e);
        }
      }
      // Auto-propose when entering Action Describer to show suggested summary
      if (newStage === 'action_describer') {
        console.log('[HITL] auto-propose for action_describer');
        try {
          const payload = { text: (decidedOut.text ?? decided.text ?? text) || '' };
          const res3 = await fetch('/api/hitl/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, stage: 'action_describer', payload })
          });
          if (!res3.ok) {
            const t = await res3.text();
            console.error('[HITL] auto-propose action_describer non-OK', res3.status, t);
          } else {
            const data3 = await res3.json();
            console.log('[HITL] auto-propose action_describer response', data3);
            if (data3?.success) {
              setModelOutput(data3.model_output);
              const s = String(data3.model_output?.actions_summary || '');
              if (!hasSeededSummary.current && (!actionsSummary || actionsSummary.trim() === '')) {
                setActionsSummary(s);
                hasSeededSummary.current = true;
              }
            }
          }
        } catch (e) {
          console.error('[HITL] auto-propose action_describer error', e);
        }
      }
      // Auto-propose when entering Control Candidates to show list immediately
      if (newStage === 'control_candidates') {
        console.log('[HITL] auto-propose for control_candidates');
        try {
          const payload = {
            text: (decidedOut.text ?? decided.text ?? text) || '',
            actions_summary: (decidedOut.actions_summary ?? decided.actions_summary ?? actionsSummary) || ''
          };
          const res = await fetch('/api/hitl/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, stage: 'control_candidates', payload })
          });
          if (!res.ok) {
            const t = await res.text();
            console.error('[HITL] auto-propose control_candidates non-OK', res.status, t);
          } else {
            const data = await res.json();
            console.log('[HITL] auto-propose control_candidates response', data);
            if (data?.success) {
              setModelOutput(data.model_output);
              // Reset previous selection by default when entering candidates
              setSelectionId('');
            }
          }
        } catch (e) {
          console.error('[HITL] auto-propose control_candidates error', e);
        }
      }
    } catch (e: any) {
      console.error('[HITL] approveAndContinue error', e);
      toast.error(e?.message || 'Failed to approve/apply');
    } finally {
      setLoading(false);
    }
  }

  async function loadSession() {
    if (!resumeSessionId.trim()) return toast.error('Enter a session ID');
    try {
      const sid = resumeSessionId.trim();
      console.log('[HITL] loadSession request', sid);
      const res = await fetch(`/api/hitl/session?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) {
        const txt = await res.text();
        console.error('[HITL] loadSession non-OK', res.status, txt);
        throw new Error(txt || 'load failed');
      }
      const data = await res.json();
      console.log('[HITL] loadSession response', data);
      if (!data?.success) throw new Error(data?.error || 'load failed');
      const sess = data.session;
      setSessionId(sess.id);
      setCurrentStage(sess.current_stage as Stage);
      const latest = sess.latest_result || {};
      setDecided(latest);
      if (latest.text) setText(String(latest.text));
      if (latest.evidence_date) setEvidenceDate(String(latest.evidence_date));
      if (latest.selection?.id) setSelectionId(String(latest.selection.id));
      toast.success('Session loaded');
    } catch (e: any) {
      console.error('[HITL] loadSession error', e);
      toast.error(e?.message || 'Failed to load session');
    }
  }

  function Stepper() {
    const idx = STAGES.indexOf(currentStage);
    return (
      <div className="flex items-center gap-3 text-sm">
        {STAGES.map((s, i) => {
          const status = i < idx ? 'done' : i === idx ? 'active' : 'pending';
          const dot = status === 'done' ? 'bg-green-600' : status === 'active' ? 'bg-primary' : 'bg-muted-foreground/30';
          const color = status === 'done' ? 'text-green-700' : status === 'active' ? 'text-foreground' : 'text-muted-foreground';
          return (
            <div key={s} className={`flex items-center gap-2 ${color}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
              <span className="capitalize">{stageLabel(s)}</span>
              {i < STAGES.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          );
        })}
      </div>
    );
  }

  function StageForm() {
    if (currentStage === 'ingest_text') {
      return (
        <div className="space-y-3">
          <Label>Evidence Text</Label>
          <Textarea
            ref={textElRef}
            defaultValue={text}
            onKeyDown={(e)=> e.stopPropagation()}
            placeholder="Paste evidence text"
            rows={10}
          />
          <div className="text-xs text-muted-foreground">
            {`Length: ${text?.length ?? 0} characters`}
            {modelOutput?.truncated ? ' · truncated for processing' : ''}
          </div>
        </div>
      );
    }
    
    if (currentStage === 'date') {
      return (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Proposed Date: {modelOutput?.evidence_date ?? '—'} (candidates {modelOutput?.candidates?.length ?? 0})</div>
          <Label>Evidence Date</Label>
          <Input
            type="date"
            value={evidenceDate || ''}
            onChange={(e) => setEvidenceDate(e.target.value)}
            onFocus={() => setIsEditingEvidenceDate(true)}
            onBlur={() => setIsEditingEvidenceDate(false)}
            onKeyDown={(e)=> e.stopPropagation()}
            placeholder="YYYY-MM-DD"
          />
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <Label>Window Start</Label>
              <Input type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
            <div>
              <Label>Window End</Label>
              <Input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <div className="flex gap-2 mt-1">
              {["unknown","pass","fail"].map((s) => (
                <Button key={s} type="button" variant={dateGuardStatus===s as any? 'default':'outline'} onClick={()=>setDateGuardStatus(s as any)} className="capitalize">{s}</Button>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (currentStage === 'action_describer') {
      return (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Proposal:</div>
          <Textarea
            ref={summaryElRef}
            defaultValue={actionsSummary}
            onKeyDown={(e)=> e.stopPropagation()}
            placeholder="Concise summary of actions (<=120 words)"
            rows={6}
          />
        </div>
      );
    }
    if (currentStage === 'control_candidates') {
      const candidates = (modelOutput?.candidates ?? []) as any[];
      return (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Proposal: {candidates.length} candidate(s)</div>
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <label key={i} className="rounded border p-2 text-sm flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">{c.label} <span className="text-muted-foreground">({c.id})</span></div>
                  <div className="text-xs text-muted-foreground">conf {c.confidence ?? '—'} · {c.rationale ?? ''}</div>
                </div>
                <input type="radio" name="cand" value={String(c.id)} checked={selectionId === String(c.id)} onChange={(e)=>setSelectionId(e.target.value)} />
              </label>
            ))}
            {candidates.length === 0 && <div className="text-sm text-muted-foreground">No candidates</div>}
          </div>
        </div>
      );
    }
    if (currentStage === 'finalize_classification') {
      const finalText: string = String(decided?.text ?? text ?? '');
      const textPreview = finalText.length > 600 ? finalText.slice(0, 600) + '…' : finalText;
      const candidates = (decided?.candidates ?? []) as any[];
      return (
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Evidence</div>
            <div className="rounded border p-2">
              {evidenceSummary && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">ID:</span> <span className="font-mono break-all">{evidenceSummary.id}</span></div>
                  <div><span className="text-muted-foreground">Audit ID:</span> <span className="font-mono break-all">{evidenceSummary.audit_id ?? '—'}</span></div>
                  <div><span className="text-muted-foreground">File Name:</span> {evidenceSummary.file_name ?? '—'}</div>
                  <div><span className="text-muted-foreground">Base64 Size:</span> {evidenceSummary.file_content_base64_len ?? 0}</div>
                </div>
              )}
              {!evidenceSummary && <div className="text-muted-foreground">No evidence metadata</div>}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Evidence Text (preview)</div>
            <div className="rounded border p-2 whitespace-pre-wrap break-words max-h-56 overflow-auto">
              {textPreview || <span className="text-muted-foreground">(empty)</span>}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Extracted Date</div>
            <div className="rounded border p-2">
              <div><span className="text-muted-foreground">Evidence Date:</span> {String(decided?.evidence_date ?? '')}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Date Guard</div>
            <div className="rounded border p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Status:</span> <span className="uppercase">{String(dateGuardStatus)}</span></div>
              <div><span className="text-muted-foreground">Window:</span> {windowStart || '—'} → {windowEnd || '—'}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Actions Summary</div>
            <div className="rounded border p-2 whitespace-pre-wrap break-words">
              {actionsSummary || <span className="text-muted-foreground">(none)</span>}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Selected Control</div>
            <div className="rounded border p-2">
              <div><span className="text-muted-foreground">Control:</span> {String(decided?.selection?.id ?? '')} {String(decided?.selection?.label ?? '')}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Candidate Controls</div>
            <div className="rounded border p-2 space-y-2">
              {candidates.length > 0 ? candidates.map((c:any, i:number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="truncate"><span className="font-medium">{c.label}</span> <span className="text-muted-foreground">({c.id})</span></div>
                  <div className="text-muted-foreground">conf {c.confidence ?? '—'}</div>
                </div>
              )) : <div className="text-muted-foreground">(none)</div>}
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="text-2xl font-bold whitespace-pre-line">
        {`Upload a file with a date and text about a compliance security control. An example would be a jpg file with the following text in it: 

"October 22 2025 
We have a policy that requires passwords to be changed every 70 days."`}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Human-in-the-Loop</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Audit ID</Label>
            <Input value={auditIdInput} onChange={(e)=>setAuditIdInput(e.target.value)} placeholder="UUID of audit to associate with evidence" />
          </div>

          <div className="space-y-2">
            <Label>Upload Evidence (drag & drop)</Label>
            <FileUploader
              accept={{ 'text/plain': ['.txt'], 'application/pdf': ['.pdf'], 'image/*': [] }}
              maxSize={1024 * 1024 * 5}
              onUpload={onUpload}
            />
          </div>

          {evidenceSummary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Evidence (debug)</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono break-all">{evidenceSummary.id}</span></div>
                <div><span className="text-muted-foreground">Audit ID:</span> <span className="font-mono break-all">{evidenceSummary.audit_id ?? '—'}</span></div>
                <div><span className="text-muted-foreground">File Name:</span> {evidenceSummary.file_name ?? '—'}</div>
                <div><span className="text-muted-foreground">Base64 Size:</span> {evidenceSummary.file_content_base64_len ?? 0}</div>
                {typeof evidenceSummary.control !== 'undefined' && (
                  <div><span className="text-muted-foreground">Control (UUID):</span> <span className="font-mono break-all">{evidenceSummary.control ?? '—'}</span></div>
                )}
                {typeof evidenceSummary.created_at !== 'undefined' && (
                  <div><span className="text-muted-foreground">Created At:</span> <span className="font-mono break-all">{evidenceSummary.created_at ?? '—'}</span></div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Start/Load session UI removed per request; logic retained */}

          <div className="pt-2">
            <Stepper />
          </div>

          <div className="space-y-3">
            {!!errors.length && (
              <div className="rounded border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                <div className="font-medium mb-1">Fix the following:</div>
                <ul className="list-disc pl-5 space-y-1">
                  {errors.map((e, i) => (<li key={i}>{e}</li>))}
                </ul>
              </div>
            )}
            <StageForm />
            <div className="flex items-center gap-2">
              <Button type="button" onClick={approveAndContinue} disabled={loading || !sessionId || (!modelOutput && currentStage !== 'ingest_text' && currentStage !== 'finalize_classification')}>Approve & Continue</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
