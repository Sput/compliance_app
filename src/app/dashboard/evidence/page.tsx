"use client";

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { FileUploader } from '@/components/file-uploader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';

export default function EvidenceUploadPage() {
  // Provide a default Audit ID value
  const [auditId, setAuditId] = useState('00000000-0000-0000-0000-000000000000');
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContentBase64, setFileContentBase64] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [auditWindow, setAuditWindow] = useState<{ start: string; end: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [textInput, setTextInput] = useState('October 22 2025\n\nWe have a formal, documented, and leadership-sponsored Enterprise Risk Management (ERM) program');
  const [dateStart, setDateStart] = useState('2025-10-01');
  const [dateEnd, setDateEnd] = useState('2025-10-31');
  const supabase = createClient();

  async function onUpload(files: File[]) {
    if (!auditId) {
      toast.error('Please provide an audit ID (UUID).');
      return;
    }
    if (!files?.length) return;
    setUploading(true);
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

      // Ensure audit exists; create a placeholder if missing
      const { data: auditRows, error: auditLookupErr } = await supabase
        .from('audits')
        .select('id')
        .eq('id', auditId)
        .limit(1);
      if (auditLookupErr) throw auditLookupErr;
      if (!auditRows || auditRows.length === 0) {
        const { error: createAuditErr } = await supabase
          .from('audits')
          .insert({ id: auditId, name: 'Untitled audit' });
        if (createAuditErr) throw createAuditErr;
      }

      // Persist raw upload into DB table `evidence_uploads`
      const { error: insertErr } = await supabase
        .from('evidence_uploads')
        .insert({
          audit_id: auditId,
          file_name: file.name,
          file_content_base64: fileContentBase64
        });
      if (insertErr) throw insertErr;

      // Kick off processing via Next API → Python using direct content
      const res = await fetch('/api/evidence/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId, fileName: file.name, fileContentBase64 })
      });
      if (!res.ok) throw new Error('Processing failed');
      const data = await res.json();
      if (data?.success === false) throw new Error(data.error || 'Processing error');
      setResult(data.result || null);
      setAuditWindow(data.auditWindow || null);
      setWarnings(data.warnings || []);
      toast.success('Evidence uploaded and processing complete.');
    } catch (e: any) {
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

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
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
      <FileUploader
        accept={{ 'text/plain': ['.txt'], 'application/pdf': ['.pdf'], 'image/*': [] }}
        maxSize={1024 * 1024 * 5}
        onUpload={onUpload}
      />
      <div>
        <Button type="button" disabled>{uploading ? 'Processing…' : 'Ready'}</Button>
      </div>
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
              <div className="font-medium">Date Check</div>
              <pre className="rounded bg-muted p-2 text-xs overflow-auto">
{JSON.stringify(result?.date_check ?? null, null, 2)}
              </pre>
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
      <div className="space-y-2">
        <Label>Debug Payload</Label>
        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
{`${JSON.stringify({ auditId, fileName, fileContentBase64 }, null, 2)}`}
        </pre>
      </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Direct Agent Run (Bypass Upload)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Audit Window</Label>
            <div className="flex gap-2">
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} placeholder="YYYY-MM-DD" />
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Evidence Text</Label>
            <Textarea value={textInput} onChange={(e) => setTextInput(e.target.value)} rows={8} placeholder="Paste document text here" />
          </div>
          <div>
            <Button type="button" onClick={runDirect} disabled={uploading}>{uploading ? 'Running…' : 'Run Agents'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
