import { NextRequest, NextResponse } from 'next/server';
import { runStage, STAGES, type Stage } from '../../../../../python-scripts/hitl';

type Body = { sessionId: string; stage: Stage; payload?: any };

function isUuid(x: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(x);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const { sessionId, stage, payload } = body || ({} as any);
    if (!sessionId || !isUuid(sessionId)) {
      return NextResponse.json({ success: false, error: 'invalid sessionId' }, { status: 400 });
    }
    if (!STAGES.includes(stage)) {
      return NextResponse.json({ success: false, error: 'invalid stage' }, { status: 400 });
    }
    const result = await runStage(sessionId, stage, payload ?? {});
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'run_failed' }, { status: 500 });
  }
}
