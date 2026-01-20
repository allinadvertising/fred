import { NextResponse } from 'next/server';
import { load } from 'cheerio';

export const runtime = 'nodejs';

type ScrapeResult = {
  url: string;
  metaTitle: string;
  metaDescription: string;
  metaH1: string;
};

type ScrapeRequest = {
  url?: string;
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const scrapeUrl = async (url: string): Promise<ScrapeResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const title = $('title').first().text().trim();
    const description =
      $('meta[name="description"]').attr('content')?.trim() ??
      $('meta[property="og:description"]').attr('content')?.trim() ??
      '';
    const h1 = $('h1').first().text().trim();

    return {
      url: response.url || url,
      metaTitle: title,
      metaDescription: description,
      metaH1: h1
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out while fetching the URL.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export async function GET() {
  return NextResponse.json({
    message: 'POST JSON { "url": "https://example.com" } to extract meta title and description.'
  });
}

export async function POST(request: Request) {
  let payload: ScrapeRequest;
  try {
    payload = (await request.json()) as ScrapeRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const url = typeof payload.url === 'string' ? normalizeUrl(payload.url) : '';
  if (!url) {
    return NextResponse.json({ error: 'A valid http(s) URL is required.' }, { status: 400 });
  }

  try {
    const result = await scrapeUrl(url);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scrape the URL.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
