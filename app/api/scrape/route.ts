import { NextResponse } from 'next/server';
import { BasicCrawler, Configuration } from '@crawlee/basic';
import { load } from 'cheerio';

export const runtime = 'nodejs';

type ScrapeResult = {
  url: string;
  metaTitle: string;
  metaDescription: string;
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

const buildCrawler = (onResult: (result: ScrapeResult) => void) => {
  const config = new Configuration({ persistStorage: false, purgeOnStart: true });

  return new BasicCrawler(
    {
      maxRequestsPerCrawl: 1,
      maxRequestRetries: 1,
      requestHandlerTimeoutSecs: 30,
      async requestHandler({ request }) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
          const response = await fetch(request.url, {
            redirect: 'follow',
            headers: {
              'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
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

          const result: ScrapeResult = {
            url: response.url || request.url,
            metaTitle: title,
            metaDescription: description
          };

          onResult(result);
        } finally {
          clearTimeout(timeout);
        }
      }
    },
    config
  );
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

  let result: ScrapeResult | null = null;
  const crawler = buildCrawler((data) => {
    result = data;
  });

  try {
    await crawler.run([url]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scrape the URL.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json({ error: 'No data extracted from the URL.' }, { status: 500 });
  }

  return NextResponse.json(result);
}
