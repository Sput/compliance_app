import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

type Body = { ids: string[] };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!ids.length) return NextResponse.json({ success: true, data: [] });

    const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_KEY || '';

    // Prefer service-key REST to bypass potential RLS on client anon
    if (base && serviceKey) {
      const url = new URL(base.replace(/\/$/, '') + '/rest/v1/controls');
      url.searchParams.set('select', 'id,control_id,title');
      // Build id=in.(uuid,uuid,...) filter
      url.searchParams.set('id', `in.(${ids.join(',')})`);
      const resp = await fetch(url.toString(), {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: 'no-store',
      });
      if (!resp.ok) {
        const txt = await (async () => { try { return await resp.text(); } catch { return ''; } })();
        return NextResponse.json({ success: false, error: `rest_error_${resp.status}: ${txt.slice(0, 500)}` }, { status: 502 });
      }
      const data = await resp.json();
      return NextResponse.json({ success: true, data });
    }

    // Fallback to server supabase client
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from('controls')
      .select('id,control_id,title')
      .in('id', ids);
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'resolve_failed' }, { status: 500 });
  }
}

