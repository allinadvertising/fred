import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type UrlStatusRequest = {
  url?: string;
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

export async function POST(request: Request) {
  let payload: UrlStatusRequest;
  try {
    payload = (await request.json()) as UrlStatusRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const url = typeof payload.url === 'string' ? normalizeUrl(payload.url) : '';
  if (!url) {
    return NextResponse.json({ error: 'A valid http(s) URL is required.' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml'
      }
    });

    return NextResponse.json({
      url,
      status: response.status,
      location: response.headers.get('location') ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.';
    return NextResponse.json({ url, status: 0, error: message });
  }
}
