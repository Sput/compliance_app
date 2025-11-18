"use client";

import { useState } from 'react';
// import { createClient } from '@/lib/supabase';
// import { FileUploader } from '@/components/file-uploader';
// import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch'; // <-- IMPORT THE SWITCH COMPONENT

// --- FIX for build errors ---
// Mock implementations for missing components/libs
const createClient = (): any => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        limit: () => Promise.resolve({ data: [{ id: 'mock-audit-id' }], error: null })
      })
    }),
    insert: () => Promise.resolve({ data: [], error: null }),
  }),
});

const FileUploader = ({ onUpload, maxSize, accept }: { onUpload: (files: File[]) => void, maxSize: number, accept: any }) => (
  <div className="flex items-center justify-center w-full">
    <label
      htmlFor="dropzone-file"
      className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-600 border-dashed rounded-lg cursor-pointer bg-gray-900 hover:bg-gray-800"
    >
      <div className="flex flex-col items-center justify-center pt-5 pb-6">
        <p className="mb-2 text-sm text-gray-500">
          <span className="font-semibold">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-gray-500">Max {maxSize / 1024 / 1024}MB</p>
      </div>
      <input
        id="dropzone-file"
        type="file"
        className="hidden"
        onChange={(e) => e.target.files && onUpload(Array.from(e.target.files))}
        multiple={false}
      />
    </label>
  </div>
);

const toast = {
  error: (message: string) => console.error(`[Toast Error] ${message}`),
  success: (message: string) => console.log(`[Toast Success] ${message}`),
};
// --- END FIX ---


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
  const [showDebugPayload, setShowDebugPayload] = useState(false); // <-- Use state for toggle
  
  // --- **THIS IS THE CHANGE (1/4)** ---
  // Change progress message from a single string to an array of strings
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  // --- **END CHANGE** ---

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
  
  // --- **THIS IS THE CHANGE (2/4)** ---
  // Clear the *array* of messages at the start
  setProgressMessages([]); 
  // --- **END CHANGE** ---

  try {
    console.log('[DirectRun] Inputs', { dateStart, dateEnd, textLen: textInput.length });
    if (!textInput.trim()) throw new Error('Please paste some evidence text');
    if (!dateStart || !dateEnd) throw new Error('Please provide both start and end dates');

    // --- This is the new sequential logic ---

    // Step 1: Run Date Guard
    // --- **THIS IS THE CHANGE (3/4)** ---
    // *Add* to the array instead of replacing
    setProgressMessages(prev => [...prev, 'Calling @tool date_guard (1/2)...']);
    // --- **END CHANGE** ---
    const dateGuardRes = await fetch('/api/run-date-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textInput, dateStart, dateEnd })
    });
    if (!dateGuardRes.ok) {
        const err = await dateGuardRes.json();
        throw new Error(`Date Guard failed: ${err.reason || dateGuardRes.statusText}`);
    }
    const dateCheck = await dateGuardRes.json();


    // Stop if Date Guard fails
    if (dateCheck.status !== 'PASS') {
      setResult({
        date_check: dateCheck,
        assigned_control_id: null,
        rationale: 'Date check failed',
      });
      throw new Error(dateCheck.reason || 'Date check failed');
    }
    // Add success message to log
    setProgressMessages(prev => [...prev, 'Date Guard: PASS']);

    // Step 2: Run Control Assigner
    // *Add* to the array instead of replacing
    setProgressMessages(prev => [...prev, 'Calling @tool control_assigner (2/2)...']);
    const assignerRes = await fetch('/api/run-control-assigner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textInput })
    });
    if (!assignerRes.ok) {
        const err = await assignerRes.json();
        throw new Error(`Control Assigner failed: ${err.rationale || assignerRes.statusText}`);
    }
    
    // We get the JSON object directly now
    const controlResult = await assignerRes.json(); // Assumes { control_id, id, rationale }
    
    // Add success message to log
    setProgressMessages(prev => [...prev, `Control Assigner: Complete (ID: ${controlResult.control_id})`]);

    // --- End of new logic ---

    // *Add* to the array instead of replacing
    setProgressMessages(prev => [...prev, 'All agents complete!']);

    // Assemble final result
    const finalResult = {
      date_check: dateCheck,
      assigned_control_id: controlResult.control_id,
      rationale: controlResult.rationale
    };

    setResult(finalResult);
    setAuditWindow({ start: dateStart, end: dateEnd });
    setWarnings([]);
    toast.success('Agents ran successfully');
  } catch (e: any) {
    console.error('[DirectRun] Error', e);
    toast.error(e?.message || 'Run failed');
    // *Add* the error to the log!
    setProgressMessages(prev => [...prev, `Error: ${e?.message || 'Run failed'}`]);
  } finally {
    console.log('[DirectRun] Done');
    setUploading(false);
    // We *remove* the line that cleared the progress, so the log stays visible.
    // setProgressMessage(null); // <-- REMOVED
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
            <Button type="button" disabled={uploading}>{uploading ? 'Processing…' : 'Ready'}</Button>
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

          {/* --- ADD THE SWITCH COMPONENT --- */}
          <div className="flex items-center space-x-2 pt-4">
            <Switch 
              id="debug-mode" 
              checked={showDebugPayload} 
              onCheckedChange={setShowDebugPayload} 
            />
            <Label htmlFor="debug-mode" className="text-sm text-muted-foreground">Show Debug Payload</Label>
          </div>
          {/* --- END SWITCH COMPONENT --- */}

          {/* --- USE THE STATE VARIABLE --- */}
          {showDebugPayload && (
            <div className="space-y-2">
              <Label>Debug Payload</Label>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
{`${JSON.stringify({ auditId, fileName, fileContentBase64 }, null, 2)}`}
              </pre>
            </div>
          )}
          {/* --- END FIX --- */}
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
            
            {/* --- **THIS IS THE CHANGE (4/4)** --- */}
            {/* Remove the old single message span */}
            {/* {uploading && progressMessage && (
              <span className="text-sm text-muted-foreground ml-4">{progressMessage}</span>
            )} 
            */}
          </div>
          
          {/* Display the progress message waterfall */}
          {progressMessages.length > 0 && (
            <div className="mt-4 p-3 border border-gray-700 rounded-lg bg-gray-900/50 space-y-1">
              <Label className="text-xs font-medium text-muted-foreground">Run Log:</Label>
              {progressMessages.map((msg, index) => (
                <p key={index} className="text-sm text-gray-300 font-mono text-xs">
                  {msg}
                </p>
              ))}
            </div>
          )}
          {/* --- **END CHANGE** --- */}

        </CardContent>
      </Card>
    </div>
  );
}