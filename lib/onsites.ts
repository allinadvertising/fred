import Papa from 'papaparse';
import { findColumn, parseCsvText, type CsvRow } from '@/lib/csv';

export type OnsitesSourceType = 'products' | 'posts' | 'pages';
export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous';
export type MatchMethod = 'url' | 'path' | 'slug' | '';

export type OnsiteEntry = {
  url: string;
  title: string;
  keyword: string;
  h1: string;
  metaDescription: string;
};

export type OnsitesGeneratedFile = {
  kind: 'matched' | 'non_matched';
  sourceType?: OnsitesSourceType;
  fileName: string;
  label: string;
  rowCount: number;
  csvText: string;
};

export type OnsitesParserSummary = {
  total: number;
  matched: number;
  nonMatched: number;
  unmatched: number;
  ambiguous: number;
  matchedBySource: Record<OnsitesSourceType, number>;
  nonMatchedRate: number;
  suggestionNeeded: boolean;
  suggestedSources: OnsitesSourceType[];
};

type SourceFieldMap = {
  id?: string;
  slug?: string;
  h1?: string;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
};

type SourceRecord = {
  recordId: string;
  sourceType: OnsitesSourceType;
  slug: string;
  values: CsvRow;
  comparableUrls: string[];
  comparablePaths: string[];
};

type SourceContext = {
  sourceType: OnsitesSourceType;
  fieldMap: SourceFieldMap;
  records: SourceRecord[];
};

type SourceIndexes = {
  byUrl: Map<string, SourceRecord[]>;
  byPath: Map<string, SourceRecord[]>;
  bySlug: Map<string, SourceRecord[]>;
};

type MatchResult = {
  status: MatchStatus;
  method: MatchMethod;
  record: SourceRecord | null;
  reason: string;
};

type EvaluatedEntry = {
  entry: OnsiteEntry;
  status: MatchStatus;
  method: MatchMethod;
  record: SourceRecord | null;
  reason: string;
};

const SOURCE_LABELS: Record<OnsitesSourceType, string> = {
  products: 'Products',
  posts: 'Posts',
  pages: 'Pages'
};

const ONSITE_LABELS = {
  title: ['Title'],
  keyword: ['Keywords', 'Keyword', 'Focus Keyword', 'Focus Keywords', 'Keyphrase', 'Keyphrases'],
  h1: ['H1 Tag', 'H1'],
  metaDescription: ['Meta Description', 'Description']
} as const;

const URL_COLUMN_CANDIDATES = ['URL', 'Address', 'Url', 'url', 'permalink', 'link', 'custom_link'];
const SLUG_COLUMN_CANDIDATES = ['post_name', 'slug', 'post_slug'];
const ID_COLUMN_CANDIDATES = ['ID', 'id'];
const H1_COLUMN_CANDIDATES = ['post_title', 'title', 'Title'];
const META_TITLE_COLUMN_CANDIDATES = [
  'aioseo_title',
  'rank_math_title',
  'seo_title',
  'yoast_wpseo_title',
  'meta_title',
  'Meta Title'
];
const META_DESCRIPTION_COLUMN_CANDIDATES = [
  'aioseo_description',
  'rank_math_description',
  'meta_desc',
  'yoast_wpseo_metadesc',
  'meta_description',
  'Meta Description'
];
const FOCUS_KEYWORD_COLUMN_CANDIDATES = [
  'keyphrases',
  'rank_math_focus_keyword',
  'focus_keyword',
  'focuskeywords',
  'focus keyword',
  '_yoast_wpseo_focuskw'
];

const NON_MATCHED_COLUMNS = [
  'URL',
  'Title',
  'Keywords',
  'H1 Tag',
  'Meta Description',
  'Match Status',
  'Matched By',
  'Match Note'
];

const normalizeText = (value: string) => value.trim();

const csvEscape = (value: string) => {
  const raw = value ?? '';
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const rowsToCsv = (columns: string[], rows: CsvRow[]) => {
  const lines = [columns.join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(row[column] ?? '')).join(','));
  });
  return lines.join('\n');
};

const buildBaseFileName = (fileName?: string) =>
  (fileName ?? 'onsites').replace(/\.csv$/i, '').replace(/\s+/g, '_');

const normalizeComparableUrl = (value: string) => {
  const parsed = new URL(value);
  const path = (parsed.pathname.replace(/\/+$/g, '') || '/').toLowerCase();
  return `${parsed.host.toLowerCase()}${path}`;
};

const normalizeComparablePath = (value: string) => {
  const input = normalizeText(value);
  if (!input) return '';

  let path = input;
  if (/^https?:\/\//i.test(input)) {
    path = new URL(input).pathname;
  } else {
    path = input.split(/[?#]/)[0] ?? input;
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return (normalized.replace(/\/+$/g, '') || '/').toLowerCase();
};

const tryParseAbsoluteUrl = (value: string) => {
  const input = normalizeText(value);
  if (!/^https?:\/\//i.test(input)) return '';

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const buildAbsoluteUrl = (value: string, siteOrigin: string) => {
  const input = normalizeText(value);
  if (!input) return '';

  try {
    if (/^https?:\/\//i.test(input)) {
      const parsed = new URL(input);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.toString();
    }

    if (input.startsWith('/')) {
      return new URL(input, siteOrigin).toString();
    }

    if (/^[^/]+\.[^/]+/i.test(input)) {
      return new URL(`https://${input}`).toString();
    }

    return new URL(`/${input.replace(/^\/+/g, '')}`, siteOrigin).toString();
  } catch {
    return '';
  }
};

const lastPathSegment = (path: string) => {
  const segments = normalizeComparablePath(path)
    .split('/')
    .filter(Boolean);
  return (segments[segments.length - 1] ?? '').toLowerCase();
};

const canUseSlugFallback = (path: string) => {
  const segments = normalizeComparablePath(path)
    .split('/')
    .filter(Boolean);

  if (segments.length === 1) return true;
  return (
    segments.length === 2 &&
    ['product', 'blog', 'news', 'article', 'articles'].includes(segments[0] ?? '')
  );
};

const inferPreferredSource = (path: string): OnsitesSourceType | null => {
  const normalizedPath = normalizeComparablePath(path);
  if (normalizedPath.startsWith('/product/')) return 'products';
  if (
    normalizedPath.startsWith('/blog/') ||
    normalizedPath.startsWith('/news/') ||
    normalizedPath.startsWith('/article/') ||
    normalizedPath.startsWith('/articles/')
  ) {
    return 'posts';
  }
  return null;
};

const inferLikelySource = (path: string): OnsitesSourceType => {
  const normalizedPath = normalizeComparablePath(path);
  if (
    normalizedPath.startsWith('/product/') ||
    normalizedPath.startsWith('/product-category/') ||
    normalizedPath.startsWith('/shop/')
  ) {
    return 'products';
  }
  if (
    normalizedPath.startsWith('/blog/') ||
    normalizedPath.startsWith('/news/') ||
    normalizedPath.startsWith('/article/') ||
    normalizedPath.startsWith('/articles/')
  ) {
    return 'posts';
  }
  return 'pages';
};

const hasAnyMatchableKeys = (contexts: Partial<Record<OnsitesSourceType, SourceContext>>) =>
  Object.values(contexts).some((context) =>
    (context?.records ?? []).some(
      (record) => record.slug || record.comparableUrls.length > 0 || record.comparablePaths.length > 0
    )
  );

const uniqueRecords = (records: SourceRecord[]) => {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.recordId)) return false;
    seen.add(record.recordId);
    return true;
  });
};

const chooseRecord = (records: SourceRecord[], preferredSource: OnsitesSourceType | null) => {
  const deduped = uniqueRecords(records);
  if (!deduped.length) return null;
  if (preferredSource) {
    const preferred = deduped.filter((record) => record.sourceType === preferredSource);
    if (preferred.length === 1) return preferred[0];
    if (preferred.length > 1) return null;
  }
  return deduped.length === 1 ? deduped[0] : null;
};

const pushIndex = (map: Map<string, SourceRecord[]>, key: string, record: SourceRecord) => {
  if (!key) return;
  const current = map.get(key) ?? [];
  current.push(record);
  map.set(key, current);
};

const buildSourceIndexes = (records: SourceRecord[]): SourceIndexes => {
  const indexes: SourceIndexes = {
    byUrl: new Map(),
    byPath: new Map(),
    bySlug: new Map()
  };

  records.forEach((record) => {
    record.comparableUrls.forEach((comparableUrl) => pushIndex(indexes.byUrl, comparableUrl, record));
    record.comparablePaths.forEach((comparablePath) =>
      pushIndex(indexes.byPath, comparablePath, record)
    );

    if (record.slug) {
      pushIndex(indexes.bySlug, record.slug, record);
    }
  });

  return indexes;
};

const parseSourceCsv = (text: string, sourceType: OnsitesSourceType, siteOrigin: string): SourceContext => {
  const parsed = parseCsvText(text);
  if (parsed.errors.length > 0) {
    throw new Error(`Could not parse ${sourceType} CSV: ${parsed.errors[0] ?? 'Unknown error.'}`);
  }

  const fields = parsed.fields;
  const fieldMap: SourceFieldMap = {
    id: findColumn(fields, ID_COLUMN_CANDIDATES) ?? undefined,
    slug: findColumn(fields, SLUG_COLUMN_CANDIDATES) ?? undefined,
    h1: findColumn(fields, H1_COLUMN_CANDIDATES) ?? undefined,
    metaTitle: findColumn(fields, META_TITLE_COLUMN_CANDIDATES) ?? undefined,
    metaDescription: findColumn(fields, META_DESCRIPTION_COLUMN_CANDIDATES) ?? undefined,
    focusKeyword: findColumn(fields, FOCUS_KEYWORD_COLUMN_CANDIDATES) ?? undefined
  };

  const explicitUrlColumns = URL_COLUMN_CANDIDATES.map((candidate) => findColumn(fields, [candidate]))
    .filter((value): value is string => Boolean(value));

  const records = parsed.rows.map((row, index) => {
    const slugValue = fieldMap.slug ? normalizeText(row[fieldMap.slug] ?? '').toLowerCase() : '';
    const candidateUrls = new Set<string>();
    const candidatePaths = new Set<string>();

    explicitUrlColumns.forEach((column) => {
      const absolute = buildAbsoluteUrl(row[column] ?? '', siteOrigin);
      if (!absolute) return;
      candidateUrls.add(normalizeComparableUrl(absolute));
      candidatePaths.add(normalizeComparablePath(absolute));
    });

    if (slugValue) {
      const constructedPath = sourceType === 'products' ? `/product/${slugValue}/` : `/${slugValue}/`;
      const absolute = buildAbsoluteUrl(constructedPath, siteOrigin);
      if (absolute) {
        candidateUrls.add(normalizeComparableUrl(absolute));
      }
      candidatePaths.add(normalizeComparablePath(constructedPath));
    }

    return {
      recordId: `${sourceType}:${index}`,
      sourceType,
      slug: slugValue,
      values: row,
      comparableUrls: Array.from(candidateUrls),
      comparablePaths: Array.from(candidatePaths)
    } satisfies SourceRecord;
  });

  return { sourceType, fieldMap, records };
};

const buildUnmatchedReason = (
  entry: OnsiteEntry,
  indexes: SourceIndexes,
  sourceContexts: Partial<Record<OnsitesSourceType, SourceContext>>
) => {
  const comparablePath = normalizeComparablePath(entry.url);
  const likelySource = inferLikelySource(comparablePath);

  if (!sourceContexts[likelySource]) {
    return `URL looks like a ${likelySource.slice(0, -1)} URL, but the ${SOURCE_LABELS[likelySource]} export was not uploaded.`;
  }

  if (!hasAnyMatchableKeys(sourceContexts)) {
    return 'Uploaded exports did not include usable URL or slug fields for matching.';
  }

  const slug = lastPathSegment(comparablePath);
  const slugMatches = slug ? uniqueRecords(indexes.bySlug.get(slug) ?? []) : [];

  if (slugMatches.length > 0 && !canUseSlugFallback(comparablePath)) {
    return 'A similar slug exists, but this deeper URL needs an exact URL or path match.';
  }

  return 'No exact URL, path, or safe slug match was found in the uploaded exports.';
};

const buildAmbiguousReason = (method: MatchMethod) => {
  if (method === 'url') {
    return 'More than one uploaded row matched this exact URL.';
  }
  if (method === 'path') {
    return 'More than one uploaded row matched this URL path.';
  }
  if (method === 'slug') {
    return 'More than one uploaded row shared this slug, so the match was skipped.';
  }
  return 'Multiple possible matches were found, so this row needs manual review.';
};

const findMatch = (
  entry: OnsiteEntry,
  indexes: SourceIndexes,
  sourceContexts: Partial<Record<OnsitesSourceType, SourceContext>>
): MatchResult => {
  const comparableUrl = normalizeComparableUrl(entry.url);
  const comparablePath = normalizeComparablePath(entry.url);
  const preferredSource = inferPreferredSource(comparablePath);

  const urlMatches = uniqueRecords(indexes.byUrl.get(comparableUrl) ?? []);
  if (urlMatches.length > 0) {
    const chosen = chooseRecord(urlMatches, preferredSource);
    return {
      status: chosen ? 'matched' : 'ambiguous',
      method: 'url',
      record: chosen,
      reason: chosen ? '' : buildAmbiguousReason('url')
    };
  }

  const pathMatches = uniqueRecords(indexes.byPath.get(comparablePath) ?? []);
  if (pathMatches.length > 0) {
    const chosen = chooseRecord(pathMatches, preferredSource);
    return {
      status: chosen ? 'matched' : 'ambiguous',
      method: 'path',
      record: chosen,
      reason: chosen ? '' : buildAmbiguousReason('path')
    };
  }

  if (!canUseSlugFallback(comparablePath)) {
    return {
      status: 'unmatched',
      method: '',
      record: null,
      reason: buildUnmatchedReason(entry, indexes, sourceContexts)
    };
  }

  const slug = lastPathSegment(comparablePath);
  if (!slug) {
    return {
      status: 'unmatched',
      method: '',
      record: null,
      reason: buildUnmatchedReason(entry, indexes, sourceContexts)
    };
  }

  const slugMatches = uniqueRecords(indexes.bySlug.get(slug) ?? []);
  if (!slugMatches.length) {
    return {
      status: 'unmatched',
      method: '',
      record: null,
      reason: buildUnmatchedReason(entry, indexes, sourceContexts)
    };
  }

  const chosen = chooseRecord(slugMatches, preferredSource);
  return {
    status: chosen ? 'matched' : 'ambiguous',
    method: 'slug',
    record: chosen,
    reason: chosen ? '' : buildAmbiguousReason('slug')
  };
};

const buildMatchedColumns = (fieldMap: SourceFieldMap, bypassH1Update: boolean) => {
  const ordered = [
    fieldMap.id,
    fieldMap.slug,
    bypassH1Update ? undefined : fieldMap.h1,
    fieldMap.metaTitle,
    fieldMap.metaDescription,
    fieldMap.focusKeyword
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(ordered));
};

const buildMatchedRow = (
  entry: OnsiteEntry,
  record: SourceRecord,
  fieldMap: SourceFieldMap,
  bypassH1Update: boolean
) => {
  const row: CsvRow = {};

  if (fieldMap.id) {
    row[fieldMap.id] = record.values[fieldMap.id] ?? '';
  }
  if (fieldMap.slug) {
    row[fieldMap.slug] = record.values[fieldMap.slug] ?? '';
  }
  if (!bypassH1Update && fieldMap.h1) {
    row[fieldMap.h1] = entry.h1;
  }
  if (fieldMap.metaTitle) {
    row[fieldMap.metaTitle] = entry.title;
  }
  if (fieldMap.metaDescription) {
    row[fieldMap.metaDescription] = entry.metaDescription;
  }
  if (fieldMap.focusKeyword) {
    row[fieldMap.focusKeyword] = entry.keyword;
  }

  return row;
};

const buildNonMatchedRows = (entries: EvaluatedEntry[]) =>
  entries
    .filter((item) => item.status !== 'matched')
    .map((item) => ({
      URL: item.entry.url,
      Title: item.entry.title,
      Keywords: item.entry.keyword,
      'H1 Tag': item.entry.h1,
      'Meta Description': item.entry.metaDescription,
      'Match Status': item.status,
      'Matched By': item.method,
      'Match Note': item.reason
    }));

export const parseOnsitesCsv = (text: string): OnsiteEntry[] => {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false
  });

  const rows = (parsed.data as unknown[]).map((row) => {
    if (!Array.isArray(row)) return [String(row ?? '')];
    return row.map((cell) => String(cell ?? ''));
  });

  const entries: OnsiteEntry[] = [];
  let current: OnsiteEntry | null = null;

  const flushCurrent = () => {
    if (!current?.url) return;
    entries.push({
      url: current.url,
      title: current.title,
      keyword: current.keyword,
      h1: current.h1,
      metaDescription: current.metaDescription
    });
  };

  rows.forEach((row) => {
    const first = normalizeText(row[0] ?? '');
    const second = normalizeText(row[1] ?? '');
    const absoluteUrl = tryParseAbsoluteUrl(first);

    if (absoluteUrl) {
      flushCurrent();
      current = {
        url: absoluteUrl,
        title: '',
        keyword: '',
        h1: '',
        metaDescription: ''
      };
      return;
    }

    if (!current || !first) return;

    if (ONSITE_LABELS.title.some((label) => label.toLowerCase() === first.toLowerCase())) {
      current.title = second;
      return;
    }

    if (ONSITE_LABELS.keyword.some((label) => label.toLowerCase() === first.toLowerCase())) {
      current.keyword = second;
      return;
    }

    if (ONSITE_LABELS.h1.some((label) => label.toLowerCase() === first.toLowerCase())) {
      current.h1 = second;
      return;
    }

    if (
      ONSITE_LABELS.metaDescription.some((label) => label.toLowerCase() === first.toLowerCase())
    ) {
      current.metaDescription = second;
    }
  });

  flushCurrent();
  return entries;
};

export const buildOnsitesParserOutput = ({
  onsitesCsv,
  productsCsv,
  postsCsv,
  pagesCsv,
  bypassH1Update = true,
  onsiteFileName
}: {
  onsitesCsv: string;
  productsCsv?: string;
  postsCsv?: string;
  pagesCsv?: string;
  bypassH1Update?: boolean;
  onsiteFileName?: string;
}) => {
  const onsiteEntries = parseOnsitesCsv(onsitesCsv);
  if (!onsiteEntries.length) {
    throw new Error('Could not find any URL blocks in the onsites CSV.');
  }

  const siteOrigin = new URL(onsiteEntries[0].url).origin;
  const sourceContexts: Partial<Record<OnsitesSourceType, SourceContext>> = {};

  if (productsCsv) {
    sourceContexts.products = parseSourceCsv(productsCsv, 'products', siteOrigin);
  }
  if (postsCsv) {
    sourceContexts.posts = parseSourceCsv(postsCsv, 'posts', siteOrigin);
  }
  if (pagesCsv) {
    sourceContexts.pages = parseSourceCsv(pagesCsv, 'pages', siteOrigin);
  }

  const allRecords = Object.values(sourceContexts).flatMap((context) => context?.records ?? []);
  const indexes = buildSourceIndexes(allRecords);

  const evaluatedEntries: EvaluatedEntry[] = onsiteEntries.map((entry) => {
    const match = findMatch(entry, indexes, sourceContexts);
    return {
      entry,
      status: match.status,
      method: match.method,
      record: match.record,
      reason: match.reason
    };
  });

  const baseFileName = buildBaseFileName(onsiteFileName);
  const matchedBySource = {
    products: 0,
    posts: 0,
    pages: 0
  } satisfies Record<OnsitesSourceType, number>;

  const matchedFiles: OnsitesGeneratedFile[] = [];

  (['products', 'posts', 'pages'] as OnsitesSourceType[]).forEach((sourceType) => {
    const context = sourceContexts[sourceType];
    if (!context) return;

    const matchedRows = evaluatedEntries.filter(
      (item) => item.status === 'matched' && item.record?.sourceType === sourceType
    );

    matchedBySource[sourceType] = matchedRows.length;
    if (!matchedRows.length) return;

    const columns = buildMatchedColumns(context.fieldMap, bypassH1Update);
    if (!columns.length) return;

    const csvRows = matchedRows.map((item) =>
      buildMatchedRow(item.entry, item.record as SourceRecord, context.fieldMap, bypassH1Update)
    );

    matchedFiles.push({
      kind: 'matched',
      sourceType,
      fileName: `${baseFileName}_${sourceType}_matched.csv`,
      label: `${SOURCE_LABELS[sourceType]} matched export`,
      rowCount: csvRows.length,
      csvText: rowsToCsv(columns, csvRows)
    });
  });

  const nonMatchedRows = buildNonMatchedRows(evaluatedEntries);
  const files: OnsitesGeneratedFile[] = [...matchedFiles];

  if (nonMatchedRows.length > 0) {
    files.push({
      kind: 'non_matched',
      fileName: `${baseFileName}_non_matched.csv`,
      label: 'Non-matched URLs',
      rowCount: nonMatchedRows.length,
      csvText: rowsToCsv(NON_MATCHED_COLUMNS, nonMatchedRows)
    });
  }

  const unmatched = evaluatedEntries.filter((item) => item.status === 'unmatched').length;
  const ambiguous = evaluatedEntries.filter((item) => item.status === 'ambiguous').length;
  const nonMatched = nonMatchedRows.length;
  const suggestedSources = (['products', 'posts', 'pages'] as OnsitesSourceType[]).filter(
    (sourceType) => !sourceContexts[sourceType]
  );

  const summary: OnsitesParserSummary = {
    total: onsiteEntries.length,
    matched: onsiteEntries.length - nonMatched,
    nonMatched,
    unmatched,
    ambiguous,
    matchedBySource,
    nonMatchedRate: onsiteEntries.length ? nonMatched / onsiteEntries.length : 0,
    suggestionNeeded: onsiteEntries.length ? nonMatched / onsiteEntries.length >= 0.3 : false,
    suggestedSources
  };

  return { files, summary };
};
