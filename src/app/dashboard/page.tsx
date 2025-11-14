import { createServerClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type DailyCount = { day: string; count: number };
type KV = { name: string; value: number };

export default async function Dashboard() {
  const supabase = await createServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) {
    return redirect('/auth/sign-in');
  }

  // Fetch recent uploads (created_at + file_name) and evidence statuses
  const uploadsRes = await supabase
    .from('evidence_uploads')
    .select('id');
  const uploads = (uploadsRes.data || []) as { id: string }[];
  const uploadsTotal = uploads.length;

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-4">
      <div className="text-2xl font-bold">
        Click agentic evidence upload icon on the SideBar
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Total Evidence Uploads</CardTitle>
          <CardDescription>All-time count of uploaded evidence items</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-5xl font-semibold tabular-nums">{uploadsTotal.toLocaleString()}</div>
        </CardContent>
      </Card>
    </div>
  );
}
