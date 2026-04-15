import { parseOnsitesCsv, type OnsiteEntry } from '@/lib/onsites';

export type ShopifyOnsitesRow = {
  Handle: string;
  'SEO Title': string;
  'SEO Description': string;
  Title?: string;
};

export type ShopifyExcludedRow = {
  URL: string;
  Title: string;
  Keywords: string;
  'H1 Tag': string;
  'Meta Description': string;
  'Match Status': string;
  'Match Note': string;
};

export type ShopifyOnsitesGeneratedFile = {
  kind: 'products' | 'excluded';
  fileName: string;
  label: string;
  rowCount: number;
  csvText: string;
};

export type ShopifyOnsitesSummary = {
  total: number;
  exported: number;
  excluded: number;
  nonProduct: number;
};

const PRODUCT_EXPORT_COLUMNS = ['Handle', 'SEO Title', 'SEO Description'] as const;
const EXCLUDED_COLUMNS = [
  'URL',
  'Title',
  'Keywords',
  'H1 Tag',
  'Meta Description',
  'Match Status',
  'Match Note'
] as const;

const csvEscape = (value: string) => {
  const raw = value ?? '';
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const rowsToCsv = (columns: readonly string[], rows: Array<Record<string, string>>) => {
  const lines = [columns.join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(row[column] ?? '')).join(','));
  });
  return lines.join('\n');
};

const buildBaseFileName = (fileName?: string) =>
  (fileName ?? 'onsites').replace(/\.csv$/i, '').replace(/\s+/g, '_');

const normalizePath = (url: string) => {
  const parsed = new URL(url);
  return (parsed.pathname.replace(/\/+$/g, '') || '/').toLowerCase();
};

const decodeUrlSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const extractShopifyProductUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const normalizedPath = normalizePath(url);
    const directProductMatch = normalizedPath.match(/^\/products\/([^/]+)$/i);
    const collectionProductMatch = normalizedPath.match(
      /^\/collections\/[^/]+\/products\/([^/]+)$/i
    );
    const productLikePath = /^\/products$/i.test(normalizedPath);
    const collectionProductLikePath = /^\/collections\/[^/]+\/products$/i.test(normalizedPath);
    const rawHandle = directProductMatch?.[1] ?? collectionProductMatch?.[1] ?? '';
    const handle = decodeUrlSegment(rawHandle).trim().toLowerCase();
    const canonicalPath = handle ? `/products/${encodeURIComponent(handle)}` : '/products';

    if (handle || productLikePath || collectionProductLikePath) {
      return {
        canonicalUrl: `${parsed.origin}${canonicalPath}`,
        handle
      };
    }

    return null;
  } catch {
    return null;
  }
};

const buildProductRow = (
  entry: OnsiteEntry,
  handle: string,
  bypassH1Update: boolean
): ShopifyOnsitesRow => {
  const row: ShopifyOnsitesRow = {
    Handle: handle,
    'SEO Title': entry.title,
    'SEO Description': entry.metaDescription
  };

  if (!bypassH1Update) {
    row.Title = entry.h1;
  }

  return row;
};

const buildExcludedRow = (
  entry: OnsiteEntry,
  status: string,
  reason: string,
  urlOverride?: string
): ShopifyExcludedRow => ({
  URL: urlOverride ?? entry.url,
  Title: entry.title,
  Keywords: entry.keyword,
  'H1 Tag': entry.h1,
  'Meta Description': entry.metaDescription,
  'Match Status': status,
  'Match Note': reason
});

export const buildShopifyOnsitesOutput = ({
  onsitesCsv,
  onsiteFileName,
  bypassH1Update = true
}: {
  onsitesCsv: string;
  onsiteFileName?: string;
  bypassH1Update?: boolean;
}) => {
  const onsiteEntries = parseOnsitesCsv(onsitesCsv);
  if (!onsiteEntries.length) {
    throw new Error('Could not find any URL blocks in the onsites CSV.');
  }

  const productRows: ShopifyOnsitesRow[] = [];
  const excludedRows: ShopifyExcludedRow[] = [];
  let nonProduct = 0;

  onsiteEntries.forEach((entry) => {
    const productUrl = extractShopifyProductUrl(entry.url);

    if (!productUrl) {
      nonProduct += 1;
      excludedRows.push(
        buildExcludedRow(
          entry,
          'excluded_non_product',
          'Only Shopify product URLs under /products/ or /collections/*/products/ are supported by this parser.'
        )
      );
      return;
    }

    const normalizedEntry: OnsiteEntry = {
      ...entry,
      url: productUrl.canonicalUrl
    };
    const handle = productUrl.handle;
    if (!handle) {
      excludedRows.push(
        buildExcludedRow(
          normalizedEntry,
          'excluded_missing_handle',
          'Product URL did not include a usable Shopify product handle.',
          productUrl.canonicalUrl
        )
      );
      return;
    }

    productRows.push(buildProductRow(normalizedEntry, handle, bypassH1Update));
  });

  const baseFileName = buildBaseFileName(onsiteFileName);
  const productColumns = [
    ...PRODUCT_EXPORT_COLUMNS,
    ...(!bypassH1Update ? (['Title'] as const) : [])
  ];

  const files: ShopifyOnsitesGeneratedFile[] = [];

  if (productRows.length > 0) {
    files.push({
      kind: 'products',
      fileName: `${baseFileName}_shopify.csv`,
      label: 'Shopify product export',
      rowCount: productRows.length,
      csvText: rowsToCsv(productColumns, productRows as Array<Record<string, string>>)
    });
  }

  if (excludedRows.length > 0) {
    files.push({
      kind: 'excluded',
      fileName: `${baseFileName}_shopify_excluded.csv`,
      label: 'Excluded URLs',
      rowCount: excludedRows.length,
      csvText: rowsToCsv(EXCLUDED_COLUMNS, excludedRows as Array<Record<string, string>>)
    });
  }

  const summary: ShopifyOnsitesSummary = {
    total: onsiteEntries.length,
    exported: productRows.length,
    excluded: excludedRows.length,
    nonProduct
  };

  return {
    summary,
    rows: productRows,
    excludedRows,
    files
  };
};
