#!/usr/bin/env node
// WordPress onsites-parser CLI. Ported from app/onsites-parser/wordpress/page.tsx
// + lib/onsites.ts, minus the browser upload/download — reads CSVs from
// disk, writes the matched/non-matched CSVs to --out-dir instead of
// triggering browser downloads.
//
// Usage:
//   node wordpress.mjs --onsites onsites.csv \
//     [--products products.csv] [--product-categories categories.csv] \
//     [--posts posts.csv] [--pages pages.csv] \
//     [--no-bypass-h1] --out-dir ./out
//
// At least one of --products/--product-categories/--posts/--pages is
// required (same "at least one source" rule as the original UI).
// --bypass-h1 defaults to true (matching the original UI default).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOnsitesParserOutput } from './lib/onsites.mjs';

function parseArgs(argv) {
  const args = {
    onsites: null,
    products: null,
    productCategories: null,
    posts: null,
    pages: null,
    bypassH1: true,
    outDir: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--onsites') args.onsites = argv[++i];
    else if (arg === '--products') args.products = argv[++i];
    else if (arg === '--product-categories') args.productCategories = argv[++i];
    else if (arg === '--posts') args.posts = argv[++i];
    else if (arg === '--pages') args.pages = argv[++i];
    else if (arg === '--bypass-h1') args.bypassH1 = true;
    else if (arg === '--no-bypass-h1') args.bypassH1 = false;
    else if (arg === '--out-dir') args.outDir = argv[++i];
  }
  return args;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

function readIfGiven(path) {
  return path ? readFileSync(path, 'utf8') : undefined;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.onsites || !args.outDir) {
    fail('Usage: wordpress.mjs --onsites <path> --out-dir <dir> [--products <path>] [--product-categories <path>] [--posts <path>] [--pages <path>]');
  }
  if (!args.products && !args.productCategories && !args.posts && !args.pages) {
    fail('Upload at least one source CSV: --products, --product-categories, --posts, or --pages.');
  }

  const onsitesCsv = readFileSync(args.onsites, 'utf8');

  let result;
  try {
    result = buildOnsitesParserOutput({
      onsitesCsv,
      productsCsv: readIfGiven(args.products),
      productCategoriesCsv: readIfGiven(args.productCategories),
      postsCsv: readIfGiven(args.posts),
      pagesCsv: readIfGiven(args.pages),
      bypassH1Update: args.bypassH1,
      onsiteFileName: args.onsites.split(/[\\/]/).pop()
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Unexpected error while parsing the CSV files.');
    return;
  }

  mkdirSync(args.outDir, { recursive: true });
  const written = result.files.map((file) => {
    const outPath = join(args.outDir, file.fileName);
    writeFileSync(outPath, file.csvText, 'utf8');
    return { path: outPath, label: file.label, rowCount: file.rowCount, kind: file.kind, sourceType: file.sourceType };
  });

  process.stdout.write(JSON.stringify({ files: written, summary: result.summary }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
