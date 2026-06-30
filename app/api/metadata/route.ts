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
  preferredCoreTitleChars: number;
  fallbackCoreTitleChars: number;
  bypassBrandSuffix: boolean;
};

type TitleLengthBand = 'preferred' | 'fallback' | 'rejected';
type TitleValidationCode =
  | 'too_short'
  | 'too_long'
  | 'thin_intent'
  | 'missing_keyword'
  | 'incomplete_ending'
  | 'dangling_separator'
  | 'unmatched_punctuation'
  | 'brand_mismatch';

type TitleValidationResult = {
  accepted: boolean;
  band: TitleLengthBand;
  title: string;
  codes: TitleValidationCode[];
  messages: string[];
  keywordCoverage: number;
  hasDifferentiator: boolean;
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
const TITLE_PREFERRED_MIN = 55;
const TITLE_PREFERRED_MAX = 65;
const TITLE_FALLBACK_MAX = 70;
const TITLE_CORE_MIN = 35;
const DESCRIPTION_HARD_MAX = 160;
const BAD_TITLE_ENDINGS = [
  'to',
  'for',
  'and',
  'with',
  'of',
  'in',
  'on',
  'at',
  'from',
  'by',
  'after',
  'before',
  'into',
  'near',
  'vs',
  'versus',
  'without',
  'the',
  'a',
  'an'
];
const TITLE_REWRITE_ATTEMPTS = 2;

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

function endsWithTerminalPunctuation(text: string): boolean {
  return /[.!?]['"’”)]?$/.test(normalizeWhitespace(text));
}

function clampDescription(text: string, maxChars: number): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return normalized;

  const withinLimit = normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);

  const sentenceMatches = Array.from(withinLimit.matchAll(/[.!?](?=\s|$)/g));
  const lastSentenceEnd = sentenceMatches.length
    ? (sentenceMatches[sentenceMatches.length - 1].index ?? -1) + 1
    : -1;

  let trimmed: string;
  if (lastSentenceEnd >= Math.floor(maxChars * 0.55)) {
    trimmed = withinLimit.slice(0, lastSentenceEnd);
  } else {
    const lastComma = withinLimit.lastIndexOf(',');
    if (lastComma >= Math.floor(maxChars * 0.55)) {
      trimmed = withinLimit.slice(0, lastComma);
    } else {
      trimmed = /\s\S*$/.test(withinLimit) ? withinLimit.replace(/\s+\S*$/, '') : withinLimit;
    }
    trimmed = cleanDetailPhrase(trimmed);
  }

  trimmed = trimmed.trim();
  if (!trimmed) return trimmed;
  return endsWithTerminalPunctuation(trimmed) ? trimmed : `${trimmed}.`;
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

function computeCoreTitleChars({
  brandPolicy,
  brandName,
  bypassBrandSuffix
}: {
  brandPolicy: BrandPolicy;
  brandName: string;
  bypassBrandSuffix: boolean;
}): { preferredCoreTitleChars: number; fallbackCoreTitleChars: number } {
  const suffix = ` | ${normalizeWhitespace(brandName)}`;
  const reservedBrandLen =
    brandPolicy === 'always' && !bypassBrandSuffix && normalizeWhitespace(brandName)
      ? suffix.length
      : 0;

  return {
    preferredCoreTitleChars: Math.max(TITLE_CORE_MIN, TITLE_PREFERRED_MAX - reservedBrandLen),
    fallbackCoreTitleChars: Math.max(TITLE_CORE_MIN, TITLE_FALLBACK_MAX - reservedBrandLen)
  };
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

  const { preferredCoreTitleChars, fallbackCoreTitleChars } = computeCoreTitleChars({
    brandPolicy,
    brandName: ctxBase.brandName,
    bypassBrandSuffix: options.bypass_brand_suffix
  });

  return {
    ...ctxBase,
    brandPolicy,
    preferredCoreTitleChars,
    fallbackCoreTitleChars,
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

function getSeoTokens(text: string): string[] {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function getSignificantKeywordTokens(text: string): string[] {
  return getSeoTokens(text).filter((token) => !['a', 'an', 'the'].includes(token));
}

function countOrderedMatches(candidateTokens: string[], keywordTokens: string[]): number {
  if (!keywordTokens.length) return 0;
  let keywordIndex = 0;
  let matches = 0;

  for (const token of candidateTokens) {
    if (token === keywordTokens[keywordIndex]) {
      matches += 1;
      keywordIndex += 1;
      if (keywordIndex >= keywordTokens.length) break;
    }
  }

  return matches;
}

function getKeywordCoverage(title: string, keyword: string): number {
  const keywordTokens = getSignificantKeywordTokens(keyword);
  if (!keywordTokens.length) return 1;

  const candidateTokens = getSignificantKeywordTokens(title);
  const matched = countOrderedMatches(candidateTokens, keywordTokens);
  return matched / keywordTokens.length;
}

function hasStrongKeywordFidelity(title: string, keyword: string): boolean {
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  const normalizedKeyword = normalizeWhitespace(keyword).toLowerCase();
  if (!normalizedKeyword) return true;
  if (normalizedTitle.includes(normalizedKeyword)) return true;

  const keywordTokens = getSignificantKeywordTokens(keyword);
  if (!keywordTokens.length) return true;

  const coverage = getKeywordCoverage(title, keyword);
  const minimumCoverage = keywordTokens.length <= 4 ? 1 : 0.85;
  return coverage >= minimumCoverage;
}

function hasDanglingSeparator(title: string): boolean {
  return /\s*[\|\-–—:\/&]\s*$/.test(normalizeWhitespace(title));
}

function endsWithBadTitleEnding(title: string): boolean {
  const endings = BAD_TITLE_ENDINGS.join('|');
  return new RegExp(`\\b(${endings})\\s*$`, 'i').test(normalizeWhitespace(title));
}

function hasUnmatchedPunctuation(title: string): boolean {
  const text = normalizeWhitespace(title);
  const doubleQuotes = (text.match(/"/g) ?? []).length;
  const singleQuotes = (text.match(/'/g) ?? []).length;
  const openParens = (text.match(/\(/g) ?? []).length;
  const closeParens = (text.match(/\)/g) ?? []).length;
  const openBrackets = (text.match(/\[/g) ?? []).length;
  const closeBrackets = (text.match(/\]/g) ?? []).length;

  return (
    doubleQuotes % 2 !== 0 ||
    singleQuotes % 2 !== 0 ||
    openParens !== closeParens ||
    openBrackets !== closeBrackets
  );
}

function countBrandMentions(title: string, brandName: string): number {
  const normalizedBrand = normalizeWhitespace(brandName);
  if (!normalizedBrand) return 0;

  const escaped = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRe = new RegExp(`\\b${escaped}\\b`, 'ig');
  return normalizeWhitespace(title).match(exactRe)?.length ?? 0;
}

function hasDifferentiator(title: string, context: MetadataRunContext): boolean {
  const titleTokens = new Set(getSeoTokens(title));
  const keywordTokens = new Set(getSeoTokens(context.keyword));
  const hintSources = [normalizeWhitespace(context.currentH1), getSlugHint(context.url)];

  for (const source of hintSources) {
    for (const token of getSeoTokens(source)) {
      if (token.length > 2 && !keywordTokens.has(token) && titleTokens.has(token)) {
        return true;
      }
    }
  }

  return false;
}

function buildValidationMessages(codes: TitleValidationCode[]): string[] {
  return codes.map((code) => {
    switch (code) {
      case 'too_short':
        return `Keep the final title at least ${TITLE_PREFERRED_MIN} characters unless you can add a real differentiator.`;
      case 'too_long':
        return `Keep the final title at ${TITLE_FALLBACK_MAX} characters or fewer without clipping wording.`;
      case 'thin_intent':
        return 'Expand the title with a page-specific differentiator from the slug or H1 so the keyword intent stays specific.';
      case 'missing_keyword':
        return 'Stay tightly aligned to the primary keyword and preserve its full intent.';
      case 'incomplete_ending':
        return 'Do not end with a clipped phrase, trailing preposition, conjunction, or article.';
      case 'dangling_separator':
        return 'Do not end with a dangling separator such as "|", "-", ":", "/", or "&".';
      case 'unmatched_punctuation':
        return 'Close any open punctuation and keep the title as one complete thought.';
      case 'brand_mismatch':
        return 'Apply the brand policy exactly once and use the exact suffix format only when required.';
    }
  });
}

function validateTitleCandidate(title: string, context: MetadataRunContext): TitleValidationResult {
  const normalizedTitle = normalizeWhitespace(title);
  const codes: TitleValidationCode[] = [];
  const keywordCoverage = getKeywordCoverage(normalizedTitle, context.keyword);
  const titleHasDifferentiator = hasDifferentiator(normalizedTitle, context);
  const normalizedBrand = normalizeWhitespace(context.brandName);
  const brandSuffix = normalizedBrand ? ` | ${normalizedBrand}` : '';
  const brandMentions = countBrandMentions(normalizedTitle, normalizedBrand);
  const coreTitleForEndingChecks =
    brandSuffix && normalizedTitle.endsWith(brandSuffix)
      ? normalizedTitle.slice(0, Math.max(0, normalizedTitle.length - brandSuffix.length)).trim()
      : normalizedTitle;

  if (!normalizedTitle || normalizedTitle.length < TITLE_PREFERRED_MIN) {
    codes.push('too_short');
  }
  if (normalizedTitle.length > TITLE_FALLBACK_MAX) {
    codes.push('too_long');
  }
  if (normalizedTitle.length < TITLE_PREFERRED_MIN && !titleHasDifferentiator) {
    codes.push('thin_intent');
  }
  if (!hasStrongKeywordFidelity(normalizedTitle, context.keyword)) {
    codes.push('missing_keyword');
  }
  if (endsWithBadTitleEnding(coreTitleForEndingChecks)) {
    codes.push('incomplete_ending');
  }
  if (hasDanglingSeparator(coreTitleForEndingChecks) || hasDanglingSeparator(normalizedTitle)) {
    codes.push('dangling_separator');
  }
  if (hasUnmatchedPunctuation(normalizedTitle)) {
    codes.push('unmatched_punctuation');
  }

  if (context.brandPolicy === 'never' && brandMentions > 0) {
    codes.push('brand_mismatch');
  }
  if (!context.bypassBrandSuffix && normalizedBrand) {
    if (context.brandPolicy === 'always') {
      if (!normalizedTitle.endsWith(brandSuffix) || brandMentions !== 1) {
        codes.push('brand_mismatch');
      }
    } else if (context.brandPolicy === 'conditional') {
      if (brandMentions > 1 || (brandMentions === 1 && !normalizedTitle.endsWith(brandSuffix))) {
        codes.push('brand_mismatch');
      }
    }
  }

  const uniqueCodes = Array.from(new Set(codes));
  const accepted = uniqueCodes.length === 0;
  const band: TitleLengthBand =
    accepted && normalizedTitle.length <= TITLE_PREFERRED_MAX
      ? 'preferred'
      : accepted && normalizedTitle.length <= TITLE_FALLBACK_MAX
        ? 'fallback'
        : 'rejected';

  return {
    accepted,
    band,
    title: normalizedTitle,
    codes: uniqueCodes,
    messages: buildValidationMessages(uniqueCodes),
    keywordCoverage,
    hasDifferentiator: titleHasDifferentiator
  };
}

function buildTitlePolicyCandidates(title: string, context: MetadataRunContext): string[] {
  const normalizedTitle = normalizeWhitespace(title);
  if (!normalizedTitle) return [''];

  const normalizedBrand = normalizeWhitespace(context.brandName);
  const core =
    !context.bypassBrandSuffix || context.brandPolicy === 'never'
      ? stripBrandVariants(normalizedTitle, normalizedBrand)
      : normalizedTitle;

  if (!normalizedBrand || context.brandPolicy === 'never') {
    return [core || normalizedTitle];
  }
  if (context.bypassBrandSuffix) {
    return [normalizedTitle];
  }

  const withBrand = normalizeWhitespace(`${core} | ${normalizedBrand}`);
  if (context.brandPolicy === 'always') {
    return [withBrand];
  }

  return Array.from(new Set([withBrand, core].filter(Boolean)));
}

function scoreTitleValidation(result: TitleValidationResult): number {
  const bandScore =
    result.band === 'preferred' ? 100 : result.band === 'fallback' ? 90 : 0;
  const distanceScore = Math.max(0, 20 - Math.abs(result.title.length - TITLE_SOFT_TARGET));
  const keywordScore = Math.round(result.keywordCoverage * 10);
  const differentiatorScore = result.hasDifferentiator ? 5 : 0;
  const penalty = result.codes.length * 15;
  return bandScore + distanceScore + keywordScore + differentiatorScore - penalty;
}

function resolveTitleCandidate(title: string, context: MetadataRunContext): TitleValidationResult {
  const validations = buildTitlePolicyCandidates(title, context).map((candidate) =>
    validateTitleCandidate(candidate, context)
  );

  return validations.sort((left, right) => scoreTitleValidation(right) - scoreTitleValidation(left))[0];
}

function cleanDetailPhrase(text: string): string {
  let result = normalizeWhitespace(text).replace(/\s*[\|\-–—:\/&]\s*$/g, '').trim();
  const endingPattern = new RegExp(`\\b(${BAD_TITLE_ENDINGS.join('|')})\\s*$`, 'i');

  while (result && endingPattern.test(result)) {
    result = result.replace(endingPattern, '').trim();
  }

  return result;
}

function combineKeywordAndDetail(keyword: string, detail: string): string {
  if (!keyword) return detail;
  if (!detail) return keyword;

  return /^(for|after|before|with|without|in|on|near|around|vs|versus)\b/i.test(detail)
    ? `${keyword} ${detail}`
    : `${keyword} for ${detail}`;
}

const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via', 'with'
]);

function toTitleCase(text: string): string {
  const words = normalizeWhitespace(text).split(' ');
  return words
    .map((word, index) => {
      if (!word) return word;
      // Leave words that already carry a capital (e.g. from an H1) untouched;
      // only fix fully lowercase fragments pulled from a URL slug.
      if (/[A-Z]/.test(word)) return word;
      const isEdge = index === 0 || index === words.length - 1;
      if (!isEdge && TITLE_CASE_MINOR_WORDS.has(word.toLowerCase())) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function buildDeterministicTitleCandidates(context: MetadataRunContext, seedTitle: string): string[] {
  const keyword = normalizeWhitespace(context.keyword);
  const detailPhrases = Array.from(
    new Set(
      [context.currentH1, getSlugHint(context.url)]
        .map((value) => toTitleCase(cleanDetailPhrase(value)))
        .filter(Boolean)
        .filter((value) => !keyword.toLowerCase().includes(value.toLowerCase()))
    )
  );

  const candidates = [
    normalizeWhitespace(seedTitle),
    ...detailPhrases.map((detail) => normalizeWhitespace(combineKeywordAndDetail(keyword, detail))),
    ...detailPhrases.map((detail) => normalizeWhitespace(`${detail}: ${keyword}`)),
    ...detailPhrases.map((detail) => normalizeWhitespace(`${keyword} - ${detail}`)),
    keyword
  ].filter(Boolean);

  return Array.from(new Set(candidates));
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
Preferred Core Title Characters: ${context.preferredCoreTitleChars}  // excludes any required brand suffix
Fallback Core Title Characters: ${context.fallbackCoreTitleChars}  // excludes any required brand suffix

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
4) Length and completeness:
   - The full title should land in the preferred ${TITLE_PREFERRED_MIN} to ${TITLE_PREFERRED_MAX} character range whenever possible.
   - A complete title may use the fallback ${TITLE_PREFERRED_MAX + 1} to ${TITLE_FALLBACK_MAX} character range only when shortening it would weaken the keyword intent or create an incomplete phrase.
   - If a draft falls below ${TITLE_PREFERRED_MIN} characters, expand it with a real differentiator from the URL slug or H1 instead of filler.
   - Do not cut wording just to force a limit. Rewrite and compress low-value modifiers instead.
   - Do not end with incomplete phrases, dangling separators, or unfinished brand/product/service wording.
   - The title must read as a complete thought.
5) Apply Brand Policy:
   - "always": append brand suffix only when Bypass Brand Suffix is false; rewrite the core cleanly if needed.
   - "conditional": append brand suffix only if Bypass Brand Suffix is false and it does not weaken the title.
   - "never": do not include brand anywhere in the title.

Description rules (only if "description" is in targets):
- Target 150 to 160 characters.
- Use the keyword or a close variant once if natural.
- Add specific context from URL/H1. Avoid fluff. No incomplete sentences.

H1 rules (only if "h1" is in targets):
- Clear, human, aligned with page intent. Do not force the brand into H1.
`.trim();
}

function buildTitleEditorPrompt(
  context: MetadataRunContext,
  rejectedTitle: string,
  validation: TitleValidationResult
): string {
  return `
You are an SEO title editor. Rewrite the rejected title so it passes QA.

URL: ${context.url}
Primary Keyword: ${context.keyword}
Current H1: ${context.currentH1}
Slug Hint: ${getSlugHint(context.url)}
Brand Name (exact spelling required): ${context.brandName}
Brand Policy: ${context.brandPolicy}
Bypass Brand Suffix (" | Brand Name"): ${context.bypassBrandSuffix ? 'true' : 'false'}
Rejected Title: ${rejectedTitle}
QA Failures:
${validation.messages.map((message) => `- ${message}`).join('\n')}

Rewrite rules:
- Return one complete meta title in JSON as { "title": "...", "description": "", "h1": "" }.
- Keep the title tightly aligned to the primary keyword.
- Prefer ${TITLE_PREFERRED_MIN} to ${TITLE_PREFERRED_MAX} characters.
- Allow ${TITLE_PREFERRED_MAX + 1} to ${TITLE_FALLBACK_MAX} only if needed to preserve a complete phrase.
- Do not clip, trim, or cut off the ending.
- Expand short titles with a real differentiator from the H1 or slug when needed.
- Preserve brand policy exactly.
`.trim();
}

type DescriptionValidationCode =
  | 'too_long'
  | 'incomplete_ending'
  | 'dangling_separator'
  | 'missing_terminal_punctuation';

type DescriptionValidationResult = {
  accepted: boolean;
  text: string;
  codes: DescriptionValidationCode[];
};

function validateDescriptionCandidate(text: string, enforceLength: boolean): DescriptionValidationResult {
  const normalized = normalizeWhitespace(text);
  const codes: DescriptionValidationCode[] = [];

  if (!normalized) {
    return { accepted: false, text: normalized, codes };
  }

  if (enforceLength && normalized.length > DESCRIPTION_HARD_MAX) {
    codes.push('too_long');
  }
  if (endsWithBadTitleEnding(normalized)) {
    codes.push('incomplete_ending');
  }
  if (hasDanglingSeparator(normalized)) {
    codes.push('dangling_separator');
  }
  if (!endsWithTerminalPunctuation(normalized)) {
    codes.push('missing_terminal_punctuation');
  }

  return { accepted: codes.length === 0, text: normalized, codes };
}

function buildDescriptionEditorPrompt(
  context: MetadataRunContext,
  rejectedDescription: string,
  validation: DescriptionValidationResult
): string {
  return `
You are an SEO meta description editor. Rewrite the rejected description so it passes QA.

URL: ${context.url}
Primary Keyword: ${context.keyword}
Current H1: ${context.currentH1}
Rejected Description: ${rejectedDescription}
QA Failures: ${validation.codes.join(', ') || 'none'}

Rewrite rules:
- Return the result as JSON: { "title": "", "description": "...", "h1": "" }.
- The description must read as one or more complete sentences ending in proper punctuation. Never stop mid-thought, mid-clause, or on a dangling word.
- Target 150 to 160 characters, but a shorter complete description beats a longer incomplete one.
- Use the primary keyword naturally if it fits without forcing it.
- No HTML, no surrounding quotes.
`.trim();
}

function localMockDescriptionEditor(rejectedDescription: string): string {
  return clampDescription(rejectedDescription, DESCRIPTION_HARD_MAX);
}

async function callDescriptionEditor(
  context: MetadataRunContext,
  rejectedDescription: string,
  validation: DescriptionValidationResult
): Promise<string> {
  if (TEST_MODE) {
    return localMockDescriptionEditor(rejectedDescription);
  }

  const prompt = buildDescriptionEditorPrompt(context, rejectedDescription, validation);
  const edited = await openaiStructured(prompt);
  return normalizeWhitespace(edited.description);
}

async function finalizeDescription(
  seedDesc: string,
  context: MetadataRunContext,
  enforceLength: boolean
): Promise<string> {
  const normalizedSeed = normalizeWhitespace(seedDesc) || normalizeWhitespace(context.currentDesc);
  if (!normalizedSeed) return normalizedSeed;

  let candidateText = normalizedSeed;
  let validation = validateDescriptionCandidate(candidateText, enforceLength);

  if (!validation.accepted) {
    const rewritten = await callDescriptionEditor(context, candidateText, validation);
    if (rewritten) {
      const rewrittenValidation = validateDescriptionCandidate(rewritten, enforceLength);
      if (rewrittenValidation.accepted || rewrittenValidation.codes.length < validation.codes.length) {
        candidateText = rewritten;
        validation = rewrittenValidation;
      }
    }
  }

  // Last resort: guarantee a complete, properly bounded sentence rather
  // than ship text that stops mid-thought.
  if (!validation.accepted) {
    candidateText = clampDescription(candidateText, DESCRIPTION_HARD_MAX);
  }

  return candidateText;
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

function localMockTitleEditor(
  context: MetadataRunContext,
  rejectedTitle: string,
  attempt: number
): string {
  if (context.currentTitle.includes('[force-second-rewrite]') && attempt === 1) {
    return `${normalizeWhitespace(context.keyword)} and`;
  }

  const bestDeterministic = buildDeterministicTitleCandidates(context, rejectedTitle)
    .map((candidate) => resolveTitleCandidate(candidate, context))
    .sort((left, right) => scoreTitleValidation(right) - scoreTitleValidation(left))[0];

  return bestDeterministic?.title ?? rejectedTitle;
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

async function callTitleEditor(
  context: MetadataRunContext,
  rejectedTitle: string,
  validation: TitleValidationResult,
  attempt: number
): Promise<string> {
  if (TEST_MODE) {
    return localMockTitleEditor(context, rejectedTitle, attempt);
  }

  const prompt = buildTitleEditorPrompt(context, rejectedTitle, validation);
  const edited = await openaiStructured(prompt);
  return normalizeWhitespace(edited.title);
}

function repairDanglingTitleEnding(
  title: string,
  context: MetadataRunContext
): TitleValidationResult {
  const repairedCore = cleanDetailPhrase(stripBrandVariants(title, context.brandName));
  if (!repairedCore) {
    return validateTitleCandidate(title, context);
  }
  return resolveTitleCandidate(repairedCore, context);
}

async function finalizeTitle(
  seedTitle: string,
  context: MetadataRunContext
): Promise<TitleValidationResult> {
  const normalizedSeed = normalizeWhitespace(seedTitle) || normalizeWhitespace(context.currentTitle);
  let best = resolveTitleCandidate(normalizedSeed, context);

  if (best.accepted) {
    return best;
  }

  for (let attempt = 1; attempt <= TITLE_REWRITE_ATTEMPTS; attempt += 1) {
    const rewrittenTitle = await callTitleEditor(context, best.title || normalizedSeed, best, attempt);
    const rewritten = resolveTitleCandidate(rewrittenTitle, context);

    if (scoreTitleValidation(rewritten) > scoreTitleValidation(best)) {
      best = rewritten;
    }
    if (rewritten.accepted) {
      return rewritten;
    }
  }

  const deterministic = buildDeterministicTitleCandidates(context, best.title || normalizedSeed)
    .map((candidate) => resolveTitleCandidate(candidate, context))
    .sort((left, right) => scoreTitleValidation(right) - scoreTitleValidation(left))[0];

  if (deterministic && scoreTitleValidation(deterministic) > scoreTitleValidation(best)) {
    best = deterministic;
  }

  // Never ship a title that still reads as clipped — strip the dangling
  // trailing word/separator rather than deliver an incomplete phrase.
  if (!best.accepted && (best.codes.includes('incomplete_ending') || best.codes.includes('dangling_separator'))) {
    const repaired = repairDanglingTitleEnding(best.title, context);
    if (repaired.accepted || scoreTitleValidation(repaired) > scoreTitleValidation(best)) {
      best = repaired;
    }
  }

  return best;
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
      const validatedTitle = await finalizeTitle(finalTitle, context);
      finalTitle = validatedTitle.title;
    }
    if (options.gen_desc) {
      finalDesc = await finalizeDescription(finalDesc, context, options.clamp_desc);
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
