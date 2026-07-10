#!/usr/bin/env node
// Builds one MetadataRunContext per row (brand policy, title-length
// budget, current values) from a keyword-mapping CSV + a scraped/blank
// "sf" CSV. Ported from enrichMetadataContext/generateRows' row-merge
// logic in app/api/metadata/route.ts, minus the AI call — Claude drafts
// against contexts.json in the next step (see SKILL.md).
//
// Usage:
//   node build-contexts.mjs --kw-csv mapping.csv --sf-csv sf.csv \
//     --brand "Acme Corp" [--no-gen-title] [--no-gen-desc] [--gen-h1] \
//     [--no-clamp-desc] [--bypass-brand-suffix] --out contexts.json

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseCsv, findColumn } from './lib/csv.mjs';
import { normUrl, enrichMetadataContext, getTargetsFromOptions } from './lib/generate.mjs';

const DEFAULT_OPTIONS = {
  gen_title: true,
  gen_desc: true,
  gen_h1: false,
  clamp_desc: true,
  bypass_brand_suffix: false
};

function parseArgs(argv) {
  const args = { kwCsv: null, sfCsv: null, brand: null, out: null, options: { ...DEFAULT_OPTIONS } };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kw-csv') args.kwCsv = argv[++i];
    else if (arg === '--sf-csv') args.sfCsv = argv[++i];
    else if (arg === '--brand') args.brand = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--gen-title') args.options.gen_title = true;
    else if (arg === '--no-gen-title') args.options.gen_title = false;
    else if (arg === '--gen-desc') args.options.gen_desc = true;
    else if (arg === '--no-gen-desc') args.options.gen_desc = false;
    else if (arg === '--gen-h1') args.options.gen_h1 = true;
    else if (arg === '--no-gen-h1') args.options.gen_h1 = false;
    else if (arg === '--clamp-desc') args.options.clamp_desc = true;
    else if (arg === '--no-clamp-desc') args.options.clamp_desc = false;
    else if (arg === '--bypass-brand-suffix') args.options.bypass_brand_suffix = true;
  }
  return args;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.kwCsv || !args.sfCsv || !args.out) {
    fail('Usage: build-contexts.mjs --kw-csv <path> --sf-csv <path> --brand "<name>" --out <path>');
  }
  if (!args.brand || !args.brand.trim()) {
    fail('Brand/Name is required.');
  }

  const kwRows = parseCsv(readFileSync(args.kwCsv, 'utf8'));
  const urlCol = findColumn(kwRows, ['URL', 'Address', 'Url', 'url', 'address']);
  const kwCol = findColumn(kwRows, ['Keyword', 'keyword', 'KW', 'Primary Keyword']);
  if (!urlCol || !kwCol) {
    fail('Keyword mapping must include URL (or Address) and Keyword columns.');
  }

  const keywordMap = new Map();
  for (const row of kwRows) {
    const key = normUrl(row[urlCol] ?? '');
    if (!key) continue;
    keywordMap.set(key, row[kwCol] ?? '');
  }

  const sfRows = parseCsv(readFileSync(args.sfCsv, 'utf8'));
  const targets = getTargetsFromOptions(args.options);
  const brand = args.brand.trim();

  const rows = sfRows.map((row, index) => {
    const address = row.Address ?? '';
    const keyword = keywordMap.get(normUrl(address)) ?? '';

    const workingRow = {
      Address: address,
      Keyword: keyword,
      'Title 1': row['Title 1'] ?? '',
      'Meta Description 1': row['Meta Description 1'] ?? '',
      'H1-1': row['H1-1'] ?? ''
    };

    return { index, context: enrichMetadataContext(workingRow, targets, brand, args.options) };
  });

  writeFileSync(args.out, JSON.stringify({ brand, options: args.options, rows }, null, 2), 'utf8');
  process.stdout.write(JSON.stringify({ wrote: args.out, rows: rows.length, targets }) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
