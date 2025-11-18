"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { FileUploader } from '@/components/file-uploader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
// import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
// import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';

export default function EvidenceUploadPage() {
  // Provide a default Audit ID value
  // Default to a valid RFC-4122 UUID (version 4)
  const [auditId, setAuditId] = useState('8b7f8a36-0a8a-4f82-9d3f-2f4e3b1a5c12');
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContentBase64, setFileContentBase64] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [auditWindow, setAuditWindow] = useState<{ start: string; end: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [uploadDebug, setUploadDebug] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('October 22 2025\n\nWe have a formal, documented, and leadership-sponsored Enterprise Risk Management (ERM) program');
  const [interpretedText, setInterpretedText] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [uploadingStream, setUploadingStream] = useState(false);
  const [agentCalledStream, setAgentCalledStream] = useState(false);
  const [dateGuardCalled, setDateGuardCalled] = useState(false);
  const [actionDescriberCalled, setActionDescriberCalled] = useState(false);
  const [controlAssignerCalled, setControlAssignerCalled] = useState(false);
  const supabase = createClient();

  // Fetch the audit window from DB whenever auditId changes
  useEffect(() => {
    let cancelled = false;
    async function loadAuditWindow(aid: string) {
      if (!aid) return;
      try {
        const { data, error } = await supabase
          .from('audits')
          .select('audit_start,audit_end')
          .eq('id', aid)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          const s = (data?.audit_start ? String(data.audit_start) : '');
          const e = (data?.audit_end ? String(data.audit_end) : '');
          setDateStart(s);
          setDateEnd(e);
        }
      } catch (e) {
        if (!cancelled) {
          setDateStart('');
          setDateEnd('');
        }
      }
    }
    loadAuditWindow(auditId);
    return () => {
      cancelled = true;
    };
  }, [auditId, supabase]);

  async function onUpload(files: File[]) {
    const stamp = () => new Date().toISOString().split('T')[1]?.replace('Z','');
    const log = (msg: string) => setUploadDebug((prev) => [...prev, `[${stamp()}] ${msg}`]);
    if (!auditId) {
      toast.error('Please provide an audit ID (UUID).');
      return;
    }
    if (!files?.length) return;
    setUploading(true);
    setUploadDebug([]);
    setUploadError(null);
    try {
      const file = files[0];
      // Read file content in-browser and send to API directly (skip storage upload)
      const arrayBuf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(arrayBuf);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      const fileContentBase64 = btoa(binary);
      setFileName(file.name);
      setFileContentBase64(fileContentBase64);
      log(`Selected file: ${file.name} (${len} bytes); base64 length=${fileContentBase64.length}`);

      // Ensure audit exists; create a placeholder if missing
      const { data: auditRows, error: auditLookupErr } = await supabase
        .from('audits')
        .select('id')
        .eq('id', auditId)
        .limit(1);
      if (auditLookupErr) throw auditLookupErr;
      if (!auditRows || auditRows.length === 0) {
        log('Audit not found; creating placeholder audit');
        const { error: createAuditErr } = await supabase
          .from('audits')
          .insert({ id: auditId, name: 'Untitled audit' });
        if (createAuditErr) throw createAuditErr;
      }

      // Audit window is managed in the audits table; do not auto-update from UI fields

      // Persist raw upload into DB table `evidence_uploads`
      log('Inserting into evidence_uploads');
      const { error: insertErr } = await supabase
        .from('evidence_uploads')
        .insert({
          audit_id: auditId,
          file_name: file.name,
          file_content_base64: fileContentBase64
        });
      if (insertErr) throw insertErr;

      // Perform OCR via OpenAI Responses API, then run streaming analysis with extracted text
      log('Calling /api/ocr for text extraction');
      const ocrRes = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || undefined, fileContentBase64 })
      });
      if (!ocrRes.ok) {
        const errTxt = await (async () => { try { return await ocrRes.text(); } catch { return ''; } })();
        throw new Error(errTxt || 'OCR failed');
      }
      const ocrData = await ocrRes.json();
      const extracted = String(ocrData?.text || '').trim();
      if (!extracted) throw new Error('No text extracted from file');
      log(`OCR extracted ${extracted.length} characters`);

      // Populate the text input and expose for troubleshooting
      setTextInput(extracted);
      setInterpretedText(extracted);
      log('Auto-start streaming analysis with extracted text');
      await runDirectStream(extracted);
    } catch (e: any) {
      log(`Upload error: ${e?.message || String(e)}`);
      if (!uploadError) setUploadError(e?.message || 'Upload failed');
      toast.error(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function runDirect() {
    console.log('[DirectRun] Clicked Run Agents');
    setUploading(true);
    setResult(null);
    setAuditWindow(null);
    setWarnings([]);
    try {
      console.log('[DirectRun] Inputs', { dateStart, dateEnd, textLen: textInput.length });
      if (!textInput.trim()) throw new Error('Please paste some evidence text');
      if (!dateStart || !dateEnd) throw new Error('Please provide both start and end dates');
      const payload = { text: textInput, dateStart, dateEnd };
      console.log('[DirectRun] POST /api/evidence/process', payload);
      const res = await fetch('/api/evidence/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log('[DirectRun] Response status', res.status);
      if (!res.ok) {
        const text = await res.text();
        console.error('[DirectRun] Non-OK response body', text);
        throw new Error('Processing failed');
      }
      const data = await res.json();
      console.log('[DirectRun] Parsed JSON', data);
      if (data?.success === false) throw new Error(data.error || 'Processing error');
      setResult(data.result || null);
      setAuditWindow(data.auditWindow || null);
      setWarnings(data.warnings || []);
      toast.success('Agents ran successfully');
    } catch (e: any) {
      console.error('[DirectRun] Error', e);
      toast.error(e?.message || 'Run failed');
    } finally {
      console.log('[DirectRun] Done');
      setUploading(false);
    }
  }

  async function runDirectStream(overrideText?: string) {
    console.log('[DirectRunStream] Clicked Run (Streaming)');
    setUploadingStream(true);
    setAgentCalledStream(false);
    setDateGuardCalled(false);
    setActionDescriberCalled(false);
    setControlAssignerCalled(false);
    setResult(null);
    setAuditWindow(null);
    setWarnings([]);
    try {
      const textForAnalysis = (overrideText != null ? overrideText : textInput) || '';
      if (!textForAnalysis.trim()) throw new Error('Please paste some evidence text');
      if (!dateStart || !dateEnd) throw new Error('Please provide both start and end dates');
      const payload = { text: textForAnalysis, dateStart, dateEnd };
      const res = await fetch('/api/evidence/process/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok || !res.body) {
        const t = await (async () => { try { return await res.text(); } catch { return ''; } })();
        throw new Error(t || 'Stream failed to start');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) {
            try {
              const evt = JSON.parse(line);
              if (evt?.type === 'agent_called') {
                setAgentCalledStream(true);
              } else if (evt?.type === 'tool_called') {
                const name = String(evt.name || '').toLowerCase();
                if (name === 'date_guard') setDateGuardCalled(true);
                if (name === 'action_describer') setActionDescriberCalled(true);
                if (name === 'control_assigner') setControlAssignerCalled(true);
              } else if (evt?.type === 'result') {
                const data = evt.data;
                if (data?.success === false) throw new Error(data.error || 'Processing error');
                setResult(data.result || data || null);
                setAuditWindow(data.auditWindow || { start: dateStart, end: dateEnd });
                setWarnings(data.warnings || []);
                toast.success('Agents ran successfully');
              } else if (evt?.type === 'error') {
                throw new Error(evt.error || 'Stream error');
              }
            } catch (e) {
              console.warn('[DirectRunStream] Bad line', line);
            }
          }
          idx = buf.indexOf('\n');
        }
      }
    } catch (e: any) {
      console.error('[DirectRunStream] Error', e);
      toast.error(e?.message || 'Run failed');
    } finally {
      setUploadingStream(false);
    }
  }

  async function processUploadStream(opts?: { fileName?: string | null; fileContentBase64?: string | null; auditIdOverride?: string }) {
    console.log('[UploadStream] Start');
    const b64 = (opts && opts.fileContentBase64 != null) ? opts.fileContentBase64 : fileContentBase64;
    const fn = (opts && opts.fileName != null) ? opts.fileName : fileName;
    const aid = (opts && opts.auditIdOverride) ? opts.auditIdOverride : auditId;
    if (!b64) {
      toast.error('No uploaded file to process');
      return;
    }
    setUploadingStream(true);
    setAgentCalledStream(false);
    setDateGuardCalled(false);
    setActionDescriberCalled(false);
    setControlAssignerCalled(false);
    setResult(null);
    setAuditWindow(null);
    setWarnings([]);
    try {
      const payload = { auditId: aid, fileName: fn, fileContentBase64: b64 } as any;
      const res = await fetch('/api/evidence/process/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok || !res.body) {
        const t = await (async () => { try { return await res.text(); } catch { return ''; } })();
        throw new Error(t || 'Stream failed to start');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) {
            try {
              const evt = JSON.parse(line);
              if (evt?.type === 'agent_called') setAgentCalledStream(true);
              else if (evt?.type === 'tool_called') {
                const name = String(evt.name || '').toLowerCase();
                if (name === 'date_guard') setDateGuardCalled(true);
                if (name === 'action_describer') setActionDescriberCalled(true);
                if (name === 'control_assigner') setControlAssignerCalled(true);
              } else if (evt?.type === 'result') {
                const data = evt.data;
                if (data?.success === false) throw new Error(data.error || 'Processing error');
                setResult(data.result || data || null);
                setAuditWindow(data.auditWindow || auditWindow || null);
                setWarnings(data.warnings || []);
                toast.success('Upload processed successfully');
              } else if (evt?.type === 'error') {
                throw new Error(evt.error || 'Stream error');
              }
            } catch (e) {
              console.warn('[UploadStream] Bad line', line);
            }
          }
          idx = buf.indexOf('\n');
        }
      }
    } catch (e: any) {
      console.error('[UploadStream] Error', e);
      toast.error(e?.message || 'Upload stream failed');
    } finally {
      setUploadingStream(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="text-2xl font-bold whitespace-pre-line">
        {`Upload a file with a date and text about a compliance security control. An example would be a jpg file with the following text in it: 

"October 22 2025 
We have a policy that requires passwords to be changed every 70 days."`}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Evidence Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auditId">Audit ID (UUID)</Label>
            <Input
              id="auditId"
              placeholder="e.g., 00000000-0000-0000-0000-000000000000"
              value={auditId}
              onChange={(e) => setAuditId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Audit Window</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={dateStart || ''}
                readOnly
                disabled
                title="Audit window comes from the audit record"
                placeholder="YYYY-MM-DD"
              />
              <Input
                type="date"
                value={dateEnd || ''}
                readOnly
                disabled
                title="Audit window comes from the audit record"
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {(() => {
              const stepIcon = (status: 'pending' | 'active' | 'done') => {
                if (status === 'done') return <Icons.check className="h-4 w-4 text-green-600" />;
                if (status === 'active') return <Icons.spinner className="h-4 w-4 animate-spin text-primary" />;
                return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />;
              };
              const stepClass = (status: 'pending' | 'active' | 'done') => (
                status === 'done' ? 'text-green-700' : status === 'active' ? 'text-foreground' : 'text-muted-foreground'
              );
              const step1: 'pending' | 'active' | 'done' = uploadingStream ? (agentCalledStream ? 'done' : 'active') : (agentCalledStream ? 'done' : 'pending');
              const step2: 'pending' | 'active' | 'done' = agentCalledStream ? (dateGuardCalled ? ((actionDescriberCalled || controlAssignerCalled || !uploadingStream) ? 'done' : 'active') : 'pending') : 'pending';
              const step3: 'pending' | 'active' | 'done' = actionDescriberCalled ? ((controlAssignerCalled || !uploadingStream) ? 'done' : 'active') : 'pending';
              const step4: 'pending' | 'active' | 'done' = controlAssignerCalled ? (uploadingStream ? 'active' : 'done') : 'pending';
              return (
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-1 ${stepClass(step1)}`}>
                    {stepIcon(step1)}<span>Agents called</span>
                  </div>
                  <span className="text-muted-foreground"></span>
                  <div className={`flex items-center gap-1 ${stepClass(step2)}`}>
                    {stepIcon(step2)}<span>Date Guard Agent</span>
                  </div>
                  <span className="text-muted-foreground"></span>
                  <div className={`flex items-center gap-1 ${stepClass(step3)}`}>
                    {stepIcon(step3)}<span>Action Describer Agent</span>
                  </div>
                  <span className="text-muted-foreground"></span>
                  <div className={`flex items-center gap-1 ${stepClass(step4)}`}>
                    {stepIcon(step4)}<span>Control Assigner Agent</span>
                  </div>
                </div>
              );
            })()}
          </div>
      <FileUploader
        accept={{ 'text/plain': ['.txt'], 'application/pdf': ['.pdf'], 'image/*': [] }}
        maxSize={1024 * 1024 * 5}
        onUpload={onUpload}
      />
      {interpretedText != null && (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Interpreted Text (sent to analysis)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground mb-2">
              Length: {interpretedText.length} characters
            </div>
            <div className="rounded bg-muted p-2 text-sm font-mono whitespace-pre-wrap max-h-64 overflow-auto">
              {interpretedText}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        {uploadError && (
          <span className="text-xs text-amber-600">{uploadError}</span>
        )}
      </div>
      {/* Upload Debug area removed */}
      {auditWindow && (
        <div className="text-sm text-muted-foreground">Audit Window: {auditWindow.start} → {auditWindow.end}</div>
      )}
      {warnings?.length ? (
        <div className="text-xs text-amber-600">{warnings.join(' | ')}</div>
      ) : null}
      {result && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Supervisor Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <div className="font-medium mb-1">Date Check</div>
              <div className="rounded bg-muted p-2 text-sm">
                <div className="flex flex-wrap gap-4">
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <span className={(result?.date_check?.status === 'PASS') ? 'text-green-600 font-medium' : (result?.date_check?.status === 'FAIL') ? 'text-red-600 font-medium' : 'font-medium'}>
                      {result?.date_check?.status ?? '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Parsed Date: </span>
                    <span className="font-mono">{result?.date_check?.parsed_date ?? '—'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <div className="font-medium">Assigned Control</div>
              <div className="rounded bg-muted p-2 text-sm">
                {result?.assigned_control_id ?? '—'}
              </div>
            </div>
            <div>
              <div className="font-medium">Rationale</div>
              <div className="rounded bg-muted p-2 text-sm whitespace-pre-wrap">{result?.rationale ?? ''}</div>
            </div>
          </CardContent>
        </Card>
      )}
        </CardContent>
      </Card>

      {/* Lower Direct Agent Run card removed as requested */}
    </div>
  );
}
