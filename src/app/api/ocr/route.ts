import { NextRequest, NextResponse } from 'next/server';

type OcrBody = {
  fileName?: string;
  mimeType?: string;
  fileContentBase64: string;
};

export const runtime = 'nodejs';

function b64ToUtf8(b64: string): string {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function dedupeRepeat(s: string): string {
  try {
    if (!s) return s;
    const len = s.length;
    if (len % 2 === 0) {
      const half = len / 2;
      const a = s.slice(0, half);
      const b = s.slice(half);
      if (a === b) return a;
    }
    return s;
  } catch {
    return s;
  }
}

function extractOutputText(resp: any): string | null {
  if (!resp || typeof resp !== 'object') return null;
  if (typeof resp.output_text === 'string' && resp.output_text.trim()) return resp.output_text;
  // Fallbacks for different response shapes
  const content = resp.output?.[0]?.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part.text === 'string') {
        texts.push(part.text);
      } else if (typeof part?.content === 'string') {
        texts.push(part.content);
      }
    }
    const joined = texts.join('\n').trim();
    if (joined) return dedupeRepeat(joined);
  }
  // Some implementations use choices[0].message/content
  const t = resp.choices?.[0]?.message?.content || resp.choices?.[0]?.content;
  if (typeof t === 'string' && t.trim()) return dedupeRepeat(t);
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OcrBody;
    const { mimeType, fileContentBase64 } = body || {} as any;

    if (!fileContentBase64 || typeof fileContentBase64 !== 'string') {
      return NextResponse.json({ error: 'missing_base64' }, { status: 400 });
    }

    // Short-circuit for text files: just decode
    if (mimeType && mimeType.startsWith('text/')) {
      const t = b64ToUtf8(fileContentBase64);
      if (!t.trim()) return NextResponse.json({ error: 'empty_text' }, { status: 400 });
      return NextResponse.json({ text: t });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
    }

    const model = process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini';

    // Use OpenAI Responses API with an image/document input
    const imageUrl = `data:${mimeType || 'image/jpeg'};base64,${fileContentBase64}`;

    const payload: any = {
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Extract all readable text from this image or document. Return plain text only with preserved reading order.'
            },
            {
              type: 'input_image',
              // Responses API expects an image_url for visual inputs
              image_url: imageUrl,
            },
          ],
        },
      ],
    };

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errTxt = await (async () => { try { return await resp.text(); } catch { return ''; } })();
      return NextResponse.json({ error: 'openai_error', details: errTxt.slice(0, 1000) }, { status: 502 });
    }

    const data = await resp.json();
    const text = extractOutputText(data);
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'no_text_extracted' }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'ocr_failed' }, { status: 500 });
  }
}
