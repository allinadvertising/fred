import { NextResponse } from 'next/server';
import OpenAI, { APIConnectionError, APIError, RateLimitError } from 'openai';
import { parse } from 'csv-parse/sync';
import { load } from 'cheerio';

export const runtime = 'nodejs';

type CsvRow = Record<string, string>;

type GeneratedFields = {
  title: string;
  description: string;
  h1: string;
};

type Options = {
  gen_title: boolean;
  gen_desc: boolean;
  gen_h1: boolean;
  clamp_title: boolean;
  clamp_desc: boolean;
};

type OutputRow = {
  Address: string;
  Keyword: string;
  'Current Title': string;
  'New Title': string;
  'Current Description': string;
  'New Description': string;
  'Current H1': string;
  'New H1': string;
};

const DEFAULT_OPTIONS: Options = {
  gen_title: true,
  gen_desc: true,
  gen_h1: false,
  clamp_title: true,
  clamp_desc: true
};

const OUTPUT_COLUMNS: Array<keyof OutputRow> = [
  'Address',
  'Keyword',
  'Current Title',
  'New Title',
  'Current Description',
  'New Description',
  'Current H1',
  'New H1'
];

const MODEL_NAME = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const TEST_MODE = isTruthy(process.env.META_TEST_MODE);

let client: OpenAI | null = null;

class InsufficientQuota extends Error {}
class InputError extends Error {}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return defaultValue;
}

function normalizeFormat(value: unknown): 'json' | 'csv' {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'csv') {
    return 'csv';
  }
  return 'json';
}

function normalizeBrand(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set and META_TEST_MODE is off.');
  }
  client = new OpenAI({ apiKey });
  return client;
}

function safeJsonParse(text: string): GeneratedFields {
  if (!text) {
    return { title: '', description: '', h1: '' };
  }

  const trimmed = text.trim();
  try {
    return normalizeFields(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return normalizeFields(JSON.parse(trimmed.slice(start, end + 1)));
      } catch {
        return { title: '', description: '', h1: '' };
      }
    }
    return { title: '', description: '', h1: '' };
  }
}

function normalizeFields(data: unknown): GeneratedFields {
  if (!data || typeof data !== 'object') {
    return { title: '', description: '', h1: '' };
  }

  const record = data as Partial<GeneratedFields>;
  return {
    title: typeof record.title === 'string' ? record.title : String(record.title ?? ''),
    description:
      typeof record.description === 'string'
        ? record.description
        : String(record.description ?? ''),
    h1: typeof record.h1 === 'string' ? record.h1 : String(record.h1 ?? '')
  };
}

function csvEscape(value: string): string {
  const raw = value ?? '';
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function rowsToCsv(rows: OutputRow[]): string {
  const lines = [OUTPUT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(OUTPUT_COLUMNS.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  return lines.join('\n');
}

function parseCsv(text: string): CsvRow[] {
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  }) as Record<string, unknown>[];

  return records.map((row) => {
    const normalized: CsvRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value === null || value === undefined ? '' : String(value);
    }
    return normalized;
  });
}

function extractOptions(payload: Record<string, unknown> | null, form: FormData | null): Options {
  const nested =
    payload && typeof payload.options === 'object' && payload.options !== null
      ? (payload.options as Record<string, unknown>)
      : {};

  const options: Options = { ...DEFAULT_OPTIONS };

  (Object.keys(DEFAULT_OPTIONS) as Array<keyof Options>).forEach((key) => {
    const value =
      (payload && key in payload ? payload[key] : undefined) ??
      (nested && key in nested ? nested[key] : undefined) ??
      (form ? form.get(key) : undefined);

    options[key] = parseBool(value, DEFAULT_OPTIONS[key]);
  });

  return options;
}

async function parseRequest(request: Request) {
  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = (await request.json()) as Record<string, unknown>;
    const sfCsv = payload?.sf_csv;
    const kwCsv = payload?.kw_csv;
    const brandValue = normalizeBrand(
      payload?.brand ?? payload?.brand_name ?? payload?.brandName ?? ''
    );

    if (typeof kwCsv !== 'string') {
      throw new InputError('JSON payload must include kw_csv as a string.');
    }
    if (!brandValue) {
      throw new InputError('Brand/Name is required.');
    }

    const options = extractOptions(payload, null);
    const responseFormat = normalizeFormat(payload?.format ?? formatParam ?? 'json');

    return {
      sfRows: typeof sfCsv === 'string' ? parseCsv(sfCsv) : null,
      kwRows: parseCsv(kwCsv),
      options,
      responseFormat,
      brand: brandValue
    };
  }

  const form = await request.formData();
  const kwFile = form.get('kw_csv');
  const brandValue = normalizeBrand(form.get('brand') ?? form.get('brand_name'));

  if (!(kwFile instanceof File)) {
    throw new InputError('Upload the kw_csv file.');
  }
  if (!brandValue) {
    throw new InputError('Brand/Name is required.');
  }

  const options = extractOptions(null, form);
  const responseFormat = normalizeFormat(form.get('format') ?? formatParam ?? 'json');
  const sfFile = form.get('sf_csv');
  const [sfText, kwText] = await Promise.all([
    sfFile instanceof File ? sfFile.text() : Promise.resolve(''),
    kwFile.text()
  ]);

  return {
    sfRows: sfText ? parseCsv(sfText) : null,
    kwRows: parseCsv(kwText),
    options,
    responseFormat,
    brand: brandValue
  };
}

function normUrl(value: string): string {
  if (!value || !value.trim()) return '';
  let text = value.trim();
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }

  const params = new URLSearchParams(parsed.search);
  for (const key of Array.from(params.keys())) {
    if (/^(utm_|gclid|fbclid)/i.test(key)) {
      params.delete(key);
    }
  }

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const search = params.toString();
  const normalized = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${
    search ? `?${search}` : ''
  }`;

  return normalized.replace(/^[a-z]+:\/\//i, '');
}

function ensureHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function clamp(text: string, maxChars: number): string {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[ .,!;:?\"-]+$/g, '');
}

function findColumn(rows: CsvRow[], candidates: string[]): string | null {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  const lookup = new Map(columns.map((col) => [col.toLowerCase(), col]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

function applyBrandSuffix(title: string, brand: string, maxChars: number, clampEnabled: boolean) {
  const cleanedBrand = brand.trim();
  if (!cleanedBrand) {
    return clampEnabled ? clamp(title, maxChars) : title;
  }

  const suffix = ` | ${cleanedBrand}`;
  let base = title.trim();

  if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
    base = base.slice(0, Math.max(0, base.length - suffix.length)).trimEnd();
  }

  if (clampEnabled) {
    const maxBaseLen = Math.max(0, maxChars - suffix.length);
    if (maxBaseLen === 0) {
      return cleanedBrand;
    }
    base = clamp(base, maxBaseLen);
  }

  if (!base) {
    return cleanedBrand;
  }

  return `${base}${suffix}`;
}

type ScrapedMeta = {
  title: string;
  description: string;
  h1: string;
};

async function scrapeMeta(url: string): Promise<ScrapedMeta> {
  if (!url) {
    return { title: '', description: '', h1: '' };
  }

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
      return { title: '', description: '', h1: '' };
    }

    const html = await response.text();
    const $ = load(html);
    const title = $('title').first().text().trim();
    const description =
      $('meta[name="description"]').attr('content')?.trim() ??
      $('meta[property="og:description"]').attr('content')?.trim() ??
      '';
    const h1 = $('h1').first().text().trim();

    return { title, description, h1 };
  } catch {
    return { title: '', description: '', h1: '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iterator: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await iterator(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

async function buildSfRowsFromKeywords(kwRows: CsvRow[]): Promise<CsvRow[]> {
  const urlCol = findColumn(kwRows, ['URL', 'Address', 'Url', 'url', 'address']);
  if (!urlCol) {
    throw new InputError('Keyword mapping must include a URL column.');
  }

  const cache = new Map<string, Promise<ScrapedMeta>>();
  const limit = 3;

  return mapWithConcurrency(kwRows, limit, async (row) => {
    const rawUrl = row[urlCol] ?? '';
    const fetchUrl = ensureHttpUrl(rawUrl);

    let metaPromise = cache.get(fetchUrl);
    if (!metaPromise) {
      metaPromise = scrapeMeta(fetchUrl);
      cache.set(fetchUrl, metaPromise);
    }

    const meta = await metaPromise;

    return {
      Address: rawUrl,
      'Title 1': meta.title,
      'Meta Description 1': meta.description,
      'H1-1': meta.h1
    };
  });
}

function buildPrompt(
  row: CsvRow,
  wantTitle: boolean,
  wantDesc: boolean,
  wantH1: boolean,
  brand: string
): string {
  const keyword = row.Keyword ?? '';
  const currentTitle = row['Title 1'] ?? '';
  const currentDesc = row['Meta Description 1'] ?? '';
  const currentH1 = row['H1-1'] ?? '';
  const url = row.Address ?? '';
  const brandName = brand.trim();

  const targets: string[] = [];
  if (wantTitle) targets.push('title');
  if (wantDesc) targets.push('description');
  if (wantH1) targets.push('h1');
  if (targets.length === 0) targets.push('title', 'description', 'h1');

  return `
You are an expert SEO copywriter. Based on the inputs, propose improved metadata.

URL: ${url}
Keyword: ${keyword}
Current Title: ${currentTitle}
Current Description: ${currentDesc}
Current H1: ${currentH1}

Rules:
- Natural tone. No clickbait. No HTML. No quotes.
- Put the keyword early in the title if natural.
- Title target ~50-60 characters. Description target ~150-160.
- Append " | ${brandName}" to the end of the title.

Only optimize these fields: ${targets.join(', ')}.
For any field not listed, return the original value unchanged.
Return strictly valid JSON with keys: "title", "description", "h1".
`.trim();
}

function localMock(row: CsvRow, wantTitle: boolean, wantDesc: boolean, wantH1: boolean): GeneratedFields {
  const keyword = (row.Keyword ?? '').trim();
  const h1 = (row['H1-1'] ?? '').trim();
  const currentTitle = (row['Title 1'] ?? '').trim();
  const currentDesc = (row['Meta Description 1'] ?? '').trim();

  const titleSrc = h1 || currentTitle || 'Quality Products';
  const descSrc = currentDesc || `Explore ${keyword} and related collections.`;

  const proposedTitle = keyword ? `${keyword}: ${titleSrc}` : titleSrc;
  const proposedDesc = keyword ? `${keyword} - ${descSrc}` : descSrc;
  const proposedH1 = h1 || (keyword ? keyword : titleSrc);

  return {
    title: wantTitle ? proposedTitle : currentTitle,
    description: wantDesc ? proposedDesc : currentDesc,
    h1: wantH1 ? proposedH1 : h1
  };
}

function isInsufficientQuota(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error ? String((error as { message?: string }).message ?? '') : '';
  return message.includes('insufficient_quota') || message.includes('billing_hard_limit');
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (error instanceof APIConnectionError) return true;
  if (error instanceof APIError) return (error.status ?? 0) >= 500;
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openaiStructured(prompt: string): Promise<GeneratedFields> {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      h1: { type: 'string' }
    },
    required: ['title', 'description', 'h1'],
    additionalProperties: false
  };

  const tries = 4;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await getClient().chat.completions.create({
        model: MODEL_NAME,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Return ONLY valid JSON that matches this schema: ${JSON.stringify(schema)}`
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6
      });

      const content = response.choices[0]?.message?.content ?? '';
      return safeJsonParse(content);
    } catch (error) {
      if (isInsufficientQuota(error)) {
        throw new InsufficientQuota('Your OpenAI plan has no remaining quota.');
      }

      if (!isRetryable(error) || attempt === tries) {
        throw error;
      }

      await sleep(2 ** (attempt - 1) * 1000 + Math.random() * 1000);
    }
  }

  return { title: '', description: '', h1: '' };
}

async function callOpenAI(
  row: CsvRow,
  wantTitle: boolean,
  wantDesc: boolean,
  wantH1: boolean,
  brand: string
): Promise<GeneratedFields> {
  if (TEST_MODE) {
    return localMock(row, wantTitle, wantDesc, wantH1);
  }
  const prompt = buildPrompt(row, wantTitle, wantDesc, wantH1, brand);
  return openaiStructured(prompt);
}

async function generateRows(
  sfRows: CsvRow[],
  kwRows: CsvRow[],
  options: Options,
  brand: string
): Promise<OutputRow[]> {
  const urlCol = findColumn(kwRows, ['URL', 'Address', 'Url', 'url', 'address']);
  const kwCol = findColumn(kwRows, ['Keyword', 'keyword', 'KW', 'Primary Keyword']);

  if (!urlCol || !kwCol) {
    throw new InputError('Keyword mapping must include URL (or Address) and Keyword columns.');
  }

  const kwNormalized = kwRows.map((row) => ({
    Address: row[urlCol] ?? '',
    Keyword: row[kwCol] ?? ''
  }));

  const keywordMap = new Map<string, string>();
  for (const row of kwNormalized) {
    const key = normUrl(row.Address ?? '');
    if (!key) continue;
    keywordMap.set(key, row.Keyword ?? '');
  }

  const output: OutputRow[] = [];
  const sfData = sfRows.length ? sfRows : await buildSfRowsFromKeywords(kwNormalized);

  for (const row of sfData) {
    const address = row.Address ?? '';
    const key = normUrl(address);
    const keyword = keywordMap.get(key) ?? '';

    const workingRow: CsvRow = {
      ...row,
      Address: address,
      Keyword: keyword,
      'Title 1': row['Title 1'] ?? '',
      'Meta Description 1': row['Meta Description 1'] ?? '',
      'H1-1': row['H1-1'] ?? ''
    };

    const data = await callOpenAI(
      workingRow,
      options.gen_title,
      options.gen_desc,
      options.gen_h1,
      brand
    );

    const currentTitle = workingRow['Title 1'] ?? '';
    const currentDesc = workingRow['Meta Description 1'] ?? '';
    const currentH1 = workingRow['H1-1'] ?? '';

    const proposedTitle = (data.title ?? '').trim();
    const proposedDesc = (data.description ?? '').trim();
    const proposedH1 = (data.h1 ?? '').trim();

    let finalTitle = options.gen_title ? proposedTitle : currentTitle;
    let finalDesc = options.gen_desc ? proposedDesc : currentDesc;
    const finalH1 = options.gen_h1 ? proposedH1 : currentH1;

    if (options.gen_title) {
      finalTitle = applyBrandSuffix(finalTitle, brand, 60, options.clamp_title);
    } else if (options.clamp_title) {
      finalTitle = clamp(finalTitle, 60);
    }
    if (options.clamp_desc) {
      finalDesc = clamp(finalDesc, 160);
    }

    output.push({
      Address: address,
      Keyword: keyword,
      'Current Title': currentTitle,
      'New Title': finalTitle,
      'Current Description': currentDesc,
      'New Description': finalDesc,
      'Current H1': currentH1,
      'New H1': finalH1
    });
  }

  return output;
}

export async function GET() {
  return NextResponse.json({
    message: 'POST kw_csv and brand (optional sf_csv) as multipart/form-data or JSON.',
    options: DEFAULT_OPTIONS,
    response_format: 'json or csv'
  });
}

export async function POST(request: Request) {
  if (!TEST_MODE && !process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not set and META_TEST_MODE is off.' },
      { status: 500 }
    );
  }

  let parsed;
  try {
    parsed = await parseRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const rows = await generateRows(parsed.sfRows ?? [], parsed.kwRows, parsed.options, parsed.brand);

    if (parsed.responseFormat === 'csv') {
      const csvText = rowsToCsv(rows);
      return new Response(csvText, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="meta_suggestions.csv"'
        }
      });
    }

    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof InsufficientQuota) {
      return NextResponse.json(
        {
          error:
            "OpenAI returned 'insufficient_quota'. Check billing or enable META_TEST_MODE=true."
        },
        { status: 402 }
      );
    }

    if (error instanceof InputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Unexpected error while generating.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
