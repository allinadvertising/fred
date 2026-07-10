// Ported from lib/csv.ts (the subset onsites-parser depends on: Papa-based
// CSV parsing + column matching). Kept papaparse-based deliberately, since
// that's what the original onsites-parser lib was tuned against — not
// unified with metadata-creation's csv-parse-based lib/csv.mjs (see that
// script's header comment for why).
import Papa from 'papaparse';

export function parseCsvText(text) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true
  });

  const fields = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {});
  const rows = parsed.data.map((row) => {
    const normalized = {};
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
}

export function findColumn(fields, candidates) {
  const lookup = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}
