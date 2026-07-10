// CSV helpers, ported from app/api/metadata/route.ts. Kept as its own
// copy (not shared with the onsites-parser's papaparse-based lib/csv.ts)
// because the metadata route was tuned against csv-parse's specific
// parsing behavior (BOM handling, quoting) — swapping parsers is a
// behavior change this port intentionally avoids.
import { parse } from 'csv-parse/sync';

export function parseCsv(text) {
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  });

  return records.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value === null || value === undefined ? '' : String(value);
    }
    return normalized;
  });
}

export function findColumn(rows, candidates) {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  const lookup = new Map(columns.map((col) => [col.toLowerCase(), col]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

export function csvEscape(value) {
  const raw = value ?? '';
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function rowsToCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  return lines.join('\n');
}

export const SF_COLUMNS = ['Address', 'Title 1', 'Meta Description 1', 'H1-1'];
export const OUTPUT_COLUMNS = [
  'Address', 'Keyword', 'Current Title', 'New Title',
  'Current Description', 'New Description', 'Current H1', 'New H1'
];
