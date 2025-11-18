"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useSearchParams } from 'next/navigation';

type EvidenceRow = {
  id: string;
  audit_id: string | null;
  status: string;
  file_url: string;
  classification: any;
  created_at: string;
};

export default function EvidenceListPage() {
  const supabase = createClient();
  const search = useSearchParams();
  const auditId = search.get('audit');
  const [rows, setRows] = useState<EvidenceRow[]>([]);

  useEffect(() => {
    async function load() {
      const qb = supabase.from('evidence').select('*').order('created_at', { ascending: false });
      const { data } = await (auditId ? qb.eq('audit_id', auditId) : qb);
      setRows(data || []);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Evidence List {auditId ? `(audit ${auditId})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && <div>No evidence yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="rounded border p-3">
              <div className="text-sm opacity-70">{new Date(r.created_at).toLocaleString()}</div>
              <div className="font-medium">Status: {r.status}</div>
              <div className="text-sm break-all">File: {r.file_url}</div>
              {r.classification?.length ? (
                <div className="text-sm mt-1">
                  Top: {r.classification[0]?.control_code} ({Math.round((r.classification[0]?.confidence || 0) * 100)}%)
                </div>
              ) : (
                <div className="text-sm mt-1 opacity-70">No classification</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

