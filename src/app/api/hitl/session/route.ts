import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

function isUuid(x: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(x);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId') || '';
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ success: false, error: 'invalid sessionId' }, { status: 400 });
    }
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from('hitl_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, session: data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'session_fetch_failed' }, { status: 500 });
  }
}

