import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

export type CsvParseResult = {
  rows: CsvRow[];
  fields: string[];
  errors: string[];
};

export const parseCsvText = (text: string): CsvParseResult => {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true
  });

  const fields = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {});
  const rows = parsed.data.map((row) => {
    const normalized: CsvRow = {};
    fields.forEach((field) => {
      normalized[field] = row[field] == null ? '' : String(row[field]);
    });
    return normalized;
  });

  const errors = parsed.errors.map((error) => error.message);

  return {
    rows: rows.filter((row) => Object.values(row).some((value) => value.trim() !== '')),
    fields,
    errors
  };
};

export const normalizeUrlForFetch = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const withScheme = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

export const findColumn = (fields: string[], candidates: string[]) => {
  const lookup = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
};

const escapeCsv = (value: string) => {
  const raw = value ?? '';
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export const buildSfCsv = (rows: Array<Record<string, string>>) => {
  const header = ['Address', 'Title 1', 'Meta Description 1', 'H1-1'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      header
        .map((key) => escapeCsv(row[key] ?? ''))
        .join(',')
    );
  }
  return lines.join('\n');
};
