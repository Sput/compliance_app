"use client";

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type EvidenceRow = {
  id: string;
  audit_id: string;
  file_name: string | null;
  created_at: string | null;
  uploaded_by: string | null;
  control: string | null;
};

export default function ProgressPage() {
  const supabase = createClient();
  const [auditId, setAuditId] = useState<string>('8b7f8a36-0a8a-4f82-9d3f-2f4e3b1a5c12');
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlMap, setControlMap] = useState<Record<string, { control_id: string; title: string | null }>>({});

  function fmtId(id: string | null | undefined): string {
    const s = String(id || '');
    if (!s) return '—';
    if (s.length <= 20) return s;
    return `${s.slice(0, 8)}…${s.slice(-6)}`;
  }

  async function fetchEvidence(aid: string) {
    if (!aid) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('evidence_uploads')
        .select('id,audit_id,file_name,created_at,uploaded_by,control')
        .eq('audit_id', aid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = (data as any[]) as EvidenceRow[];
      setRows(list);
      // Resolve control UUIDs to control codes
      const controlIds = Array.from(new Set(list.map((r) => r.control).filter(Boolean))) as string[];
      if (controlIds.length > 0) {
        try {
          const resp = await fetch('/api/controls/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: controlIds }),
          });
          if (resp.ok) {
            const j = await resp.json();
            if (j?.success && Array.isArray(j?.data)) {
              const map: Record<string, { control_id: string; title: string | null }> = {};
              for (const c of j.data) {
                if (c?.id && c?.control_id) {
                  map[String(c.id)] = { control_id: String(c.control_id), title: c?.title ? String(c.title) : null };
                }
              }
              setControlMap(map);
            }
          }
        } catch {}
      } else {
        setControlMap({});
      }
    } catch (e: any) {
      const msg = e?.message || 'Failed to load evidence';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvidence(auditId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce fetching when auditId changes
  useEffect(() => {
    const t = setTimeout(() => {
      if (auditId && auditId.length > 0) fetchEvidence(auditId);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Audit Evidence Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Audit ID</Label>
            <Input
              value={auditId}
              onChange={(e) => setAuditId(e.target.value)}
              placeholder="UUID of audit"
            />
          </div>

          <div className="rounded-md border">
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">File Name</th>
                    <th className="px-3 py-2">Created At</th>
                    <th className="px-3 py-2">Control (UUID)</th>
                    <th className="px-3 py-2">Uploaded By</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-3 py-3" colSpan={5}>Loading…</td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={5}>No evidence uploaded for this audit.</td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 font-mono">
                          <span title={r.id} className="inline-block max-w-[220px] whitespace-nowrap align-bottom">
                            {fmtId(r.id)}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.file_name ?? '—'}</td>
                        <td className="px-3 py-2">{r.created_at ?? '—'}</td>
                        <td className="px-3 py-2">
                          {r.control ? (
                            controlMap[r.control] ? (
                              <span title={`${controlMap[r.control].title ?? ''} (${r.control})`} className="font-mono">
                                {controlMap[r.control].control_id}
                              </span>
                            ) : (
                              <span title={r.control} className="font-mono">{fmtId(r.control)}</span>
                            )
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono break-all">{r.uploaded_by ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
