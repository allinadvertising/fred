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

type TargetField = keyof GeneratedFields;
type BrandPolicy = 'always' | 'conditional' | 'never';

type MetadataRunContext = {
  url: string;
  keyword: string;
  currentTitle: string;
  currentDesc: string;
  currentH1: string;
  brandName: string;
  targets: TargetField[];
  brandPolicy: BrandPolicy;
  maxCoreTitleChars: number;
  bypassBrandSuffix: boolean;
};

type Options = {
  gen_title: boolean;
  gen_desc: boolean;
  gen_h1: boolean;
  clamp_title: boolean;
  clamp_desc: boolean;
  bypass_brand_suffix: boolean;
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
  clamp_desc: true,
  bypass_brand_suffix: false
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

const TITLE_SOFT_TARGET = 60;
const TITLE_HARD_MAX = 70;
const TITLE_CORE_MIN = 35;
const DESCRIPTION_HARD_MAX = 160;
const BAD_TITLE_STOP_WORDS = ['to', 'for', 'and', 'with', 'of', 'in'];

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
  const cut = text.slice(0, maxChars);
  const prevChar = text.charAt(maxChars - 1);
  const nextChar = text.charAt(maxChars);
  const brokeWord = /\S/.test(prevChar) && /\S/.test(nextChar);
  const trimmed = brokeWord ? cut.replace(/\s+\S*$/g, '') : cut;
  return trimmed.replace(/[ .,!;:?\"-]+$/g, '').trim();
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

function normalizeWhitespace(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(text: string): string {
  return normalizeWhitespace(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toPathname(value: string): string {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';

  if (raw.startsWith('/')) {
    return raw.toLowerCase();
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).pathname.toLowerCase() || '/';
  } catch {
    const slashIndex = raw.indexOf('/');
    if (slashIndex >= 0) {
      return raw.slice(slashIndex).toLowerCase();
    }
    return '/';
  }
}

function computeBrandPolicy({
  url,
  keyword,
  brandName
}: {
  url: string;
  keyword: string;
  brandName: string;
}): BrandPolicy {
  const pathname = toPathname(url);
  const k = normalizeWhitespace(keyword).toLowerCase();
  const brandCompact = normalizeToken(brandName);
  const keywordCompact = normalizeToken(keyword);

  const isHome = pathname === '/' || pathname === '';

  const commercialPaths = [
    '/product',
    '/products',
    '/shop',
    '/store',
    '/collections',
    '/category',
    '/service',
    '/services',
    '/solutions',
    '/pricing'
  ];

  const infoPaths = ['/blog', '/guide', '/guides', '/resources', '/learn', '/faq', '/how-to'];
  const transactionalTerms = ['buy', 'price', 'quote', 'order', 'custom', 'near me', 'shipping'];

  const isCommercial =
    commercialPaths.some((path) => pathname.includes(path)) ||
    transactionalTerms.some((term) => k.includes(term));
  const isInformational = infoPaths.some((path) => pathname.includes(path));
  const isBrandedKeyword = Boolean(brandCompact) && keywordCompact.includes(brandCompact);

  if (isHome) return 'never';
  if (isBrandedKeyword) return 'always';
  if (isCommercial) return 'always';
  if (isInformational) return 'conditional';
  return 'conditional';
}

function computeMaxCoreTitleChars({
  brandPolicy,
  brandName,
  bypassBrandSuffix
}: {
  brandPolicy: BrandPolicy;
  brandName: string;
  bypassBrandSuffix: boolean;
}): number {
  const suffix = ` | ${normalizeWhitespace(brandName)}`;
  const brandLen = brandPolicy === 'never' || bypassBrandSuffix ? 0 : suffix.length;
  return Math.max(TITLE_CORE_MIN, TITLE_HARD_MAX - brandLen);
}

function getTargetsFromOptions(options: Options): TargetField[] {
  const targets: TargetField[] = [];
  if (options.gen_title) targets.push('title');
  if (options.gen_desc) targets.push('description');
  if (options.gen_h1) targets.push('h1');
  return targets.length ? targets : ['title', 'description', 'h1'];
}

function enrichMetadataContext(
  row: CsvRow,
  targets: TargetField[],
  brandName: string,
  options: Options
): MetadataRunContext {
  const ctxBase = {
    url: row.Address ?? '',
    keyword: row.Keyword ?? '',
    currentTitle: row['Title 1'] ?? '',
    currentDesc: row['Meta Description 1'] ?? '',
    currentH1: row['H1-1'] ?? '',
    brandName: normalizeWhitespace(brandName),
    targets
  };

  const brandPolicy = computeBrandPolicy({
    url: ctxBase.url,
    keyword: ctxBase.keyword,
    brandName: ctxBase.brandName
  });

  const maxCoreTitleChars = computeMaxCoreTitleChars({
    brandPolicy,
    brandName: ctxBase.brandName,
    bypassBrandSuffix: options.bypass_brand_suffix
  });

  return {
    ...ctxBase,
    brandPolicy,
    maxCoreTitleChars,
    bypassBrandSuffix: options.bypass_brand_suffix
  };
}

function stripBrandVariants(title: string, brandName: string): string {
  const t = normalizeWhitespace(title);
  const b = normalizeWhitespace(brandName);
  if (!t || !b) return t;

  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spacedPattern = escaped.split('').join('\\s*');
  const spacedRe = new RegExp(spacedPattern, 'ig');
  const exactRe = new RegExp(`\\b${escaped}\\b`, 'ig');

  return t
    .replace(exactRe, '')
    .replace(spacedRe, '')
    .replace(/\s+\|\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function endsWithBadStopWord(core: string): boolean {
  const stopWords = BAD_TITLE_STOP_WORDS.join('|');
  return new RegExp(`\\b(${stopWords})\\s*$`, 'i').test(core);
}

function trimTrailingStopWords(text: string): string {
  let result = normalizeWhitespace(text);
  const stopWords = BAD_TITLE_STOP_WORDS.join('|');
  const stopWordPattern = new RegExp(`\\b(${stopWords})\\s*$`, 'i');

  while (endsWithBadStopWord(result)) {
    result = result.replace(stopWordPattern, '').trim();
  }

  return result;
}

function removeDanglingDelimiters(text: string): string {
  return normalizeWhitespace(text).replace(/\s*[\|\-–—:]\s*$/g, '').trim();
}

function trimToWordBoundary(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text.trim();

  let out = text.slice(0, maxChars).trim();
  const prevChar = text.charAt(maxChars - 1);
  const nextChar = text.charAt(maxChars);
  if (/\S/.test(prevChar) && /\S/.test(nextChar)) {
    const trimmed = out.replace(/\s+\S*$/g, '').trim();
    if (trimmed) out = trimmed;
  }

  return out;
}

function enforceTitle({
  title,
  brandName,
  brandPolicy,
  maxCoreTitleChars,
  clampEnabled,
  bypassBrandSuffix
}: {
  title: string;
  brandName: string;
  brandPolicy: BrandPolicy;
  maxCoreTitleChars: number;
  clampEnabled: boolean;
  bypassBrandSuffix: boolean;
}): string {
  const normalizedBrand = normalizeWhitespace(brandName);
  const suffix = normalizedBrand ? ` | ${normalizedBrand}` : '';
  const maxCore = Math.max(TITLE_CORE_MIN, Math.min(maxCoreTitleChars, TITLE_HARD_MAX));
  let core = normalizeWhitespace(title);

  // If the user bypasses the pipe-brand suffix, keep branded terms in the core title
  // except on pages where brandPolicy requires removing brand entirely.
  if (!bypassBrandSuffix || brandPolicy === 'never') {
    core = stripBrandVariants(core, normalizedBrand);
  }
  core = removeDanglingDelimiters(core);
  core = trimTrailingStopWords(core);

  if (clampEnabled) {
    core = trimToWordBoundary(core, maxCore);
    core = trimTrailingStopWords(core);
  }

  if (bypassBrandSuffix || brandPolicy === 'never' || !normalizedBrand) {
    const noBrand = clampEnabled ? trimToWordBoundary(core, TITLE_HARD_MAX) : core;
    return trimTrailingStopWords(removeDanglingDelimiters(noBrand));
  }

  const withBrand = normalizeWhitespace(`${core}${suffix}`);

  if (brandPolicy === 'conditional') {
    if (!clampEnabled) return withBrand;
    if (withBrand.length <= TITLE_HARD_MAX) return withBrand;
    return trimTrailingStopWords(removeDanglingDelimiters(trimToWordBoundary(core, TITLE_HARD_MAX)));
  }

  if (!clampEnabled) {
    return withBrand;
  }

  if (withBrand.length <= TITLE_HARD_MAX) {
    return withBrand;
  }

  if (suffix.length >= TITLE_HARD_MAX) {
    return trimTrailingStopWords(removeDanglingDelimiters(trimToWordBoundary(core, TITLE_HARD_MAX)));
  }

  const availableCore = Math.max(20, TITLE_HARD_MAX - suffix.length);
  core = trimToWordBoundary(core, availableCore);
  core = trimTrailingStopWords(removeDanglingDelimiters(core));

  const forced = normalizeWhitespace(`${core}${suffix}`);
  if (forced.length <= TITLE_HARD_MAX) {
    return forced;
  }

  return trimTrailingStopWords(removeDanglingDelimiters(trimToWordBoundary(core, TITLE_HARD_MAX)));
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

function buildPrompt(context: MetadataRunContext): string {
  return `
You are an expert SEO copywriter. Based on the inputs, propose improved metadata.

URL: ${context.url}
Keyword: ${context.keyword}
Current Title: ${context.currentTitle}
Current Description: ${context.currentDesc}
Current H1: ${context.currentH1}
Brand Name (exact spelling required): ${context.brandName}
Brand Policy: ${context.brandPolicy}  // "always" | "conditional" | "never"
Bypass Brand Suffix (" | Brand Name"): ${context.bypassBrandSuffix ? 'true' : 'false'}
Max Core Title Characters: ${context.maxCoreTitleChars}  // number, excludes the brand suffix

Rules:
- Natural, specific, compelling tone. No clickbait. No HTML. No quotes.
- Do not invent claims (pricing, awards, guarantees, "official") unless present in the inputs.
- Only optimize these fields: ${context.targets.join(', ')}.
- For any field not listed, return the original value unchanged.
- Return strictly valid JSON with keys: "title", "description", "h1".

Title rules (only if "title" is in targets):
1) Put the keyword early if natural. Do not force it.
   - Prioritize the most compelling complete wording over robotic exact-length matching.
2) Uniqueness requirement:
   - Title must be meaningfully unique for this URL.
   - Include at least one differentiator derived from the URL slug and/or H1 (audience, use case, product type, number, year, material, format, etc.).
   - Avoid generic templates that could apply to many pages.
3) Brand usage (single mention, consistent spelling):
   - Brand may appear at most once.
   - If Bypass Brand Suffix is false and the existing or proposed title contains the brand in any form, remove it from the core title and only use the final suffix when brand is included.
   - If Bypass Brand Suffix is false and brand is included, it must be appended exactly as: " | ${context.brandName}"
   - If Bypass Brand Suffix is true, do not append the pipe suffix. Brand may still appear naturally in the title if required by the keyword/page intent.
4) Length and no truncation:
   - Core title length must be <= Max Core Title Characters.
   - The full title should target about ${TITLE_SOFT_TARGET} characters.
   - It may reach up to ${TITLE_HARD_MAX} characters when needed to preserve the keyword and a complete compelling phrase.
   - Do not cut wording just to force an exact character limit.
   - Do not end with incomplete phrases or trailing stop-words like: "to", "for", "and", "with", "of", "in".
   - Must be a complete thought and not cut mid-word.
5) Apply Brand Policy:
   - "always": append brand suffix only when Bypass Brand Suffix is false; shorten core title if needed.
   - "conditional": append brand suffix only if Bypass Brand Suffix is false and it fits without losing the differentiator or keyword placement.
   - "never": do not include brand anywhere in the title.

Description rules (only if "description" is in targets):
- Target 150 to 160 characters.
- Use the keyword or a close variant once if natural.
- Add specific context from URL/H1. Avoid fluff. No incomplete sentences.

H1 rules (only if "h1" is in targets):
- Clear, human, aligned with page intent. Do not force the brand into H1.
`.trim();
}

function getSlugHint(url: string): string {
  const path = toPathname(url);
  const parts = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const slug = parts[parts.length - 1] ?? '';
  return slug.replace(/[-_]+/g, ' ').trim();
}

function localMock(context: MetadataRunContext): GeneratedFields {
  const keyword = normalizeWhitespace(context.keyword);
  const currentTitle = normalizeWhitespace(context.currentTitle);
  const currentDesc = normalizeWhitespace(context.currentDesc);
  const currentH1 = normalizeWhitespace(context.currentH1);
  const slugHint = getSlugHint(context.url);

  const titleParts = [keyword, currentH1 || slugHint].filter(Boolean);
  const mockTitle = titleParts.length ? titleParts.join(' - ') : currentTitle || 'Updated Metadata';
  const mockDesc =
    currentDesc || `Explore ${keyword || slugHint || 'this page'} with practical details and next steps.`;
  const mockH1 = currentH1 || keyword || slugHint || 'Updated H1';

  return {
    title: context.targets.includes('title') ? mockTitle : context.currentTitle,
    description: context.targets.includes('description') ? mockDesc : context.currentDesc,
    h1: context.targets.includes('h1') ? mockH1 : context.currentH1
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

async function callOpenAI(context: MetadataRunContext): Promise<GeneratedFields> {
  if (TEST_MODE) {
    return localMock(context);
  }
  const prompt = buildPrompt(context);
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
  const targets = getTargetsFromOptions(options);

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

    const context = enrichMetadataContext(workingRow, targets, brand, options);
    const data = await callOpenAI(context);

    const currentTitle = workingRow['Title 1'] ?? '';
    const currentDesc = workingRow['Meta Description 1'] ?? '';
    const currentH1 = workingRow['H1-1'] ?? '';

    const proposedTitle = (data.title ?? '').trim();
    const proposedDesc = (data.description ?? '').trim();
    const proposedH1 = (data.h1 ?? '').trim();

    let finalTitle = options.gen_title ? proposedTitle || currentTitle : currentTitle;
    let finalDesc = options.gen_desc ? proposedDesc || currentDesc : currentDesc;
    const finalH1 = options.gen_h1 ? proposedH1 || currentH1 : currentH1;

    if (options.gen_title) {
      finalTitle = enforceTitle({
        title: finalTitle,
        brandName: context.brandName,
        brandPolicy: context.brandPolicy,
        maxCoreTitleChars: context.maxCoreTitleChars,
        clampEnabled: options.clamp_title,
        bypassBrandSuffix: options.bypass_brand_suffix
      });
    } else if (options.clamp_title) {
      finalTitle = clamp(finalTitle, TITLE_HARD_MAX);
    }
    if (options.clamp_desc) {
      finalDesc = clamp(finalDesc, DESCRIPTION_HARD_MAX);
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
