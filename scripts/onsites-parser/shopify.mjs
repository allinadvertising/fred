#!/usr/bin/env node
// Shopify onsites-parser CLI. Ported from app/onsites-parser/shopify/page.tsx
// + lib/shopify-onsites.ts, minus the browser upload/download.
//
// Usage:
//   node shopify.mjs --onsites onsites.csv [--no-bypass-h1] --out-dir ./out
//
// --bypass-h1 defaults to true (matching the original UI default).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShopifyOnsitesOutput } from './lib/shopify-onsites.mjs';

function parseArgs(argv) {
  const args = { onsites: null, bypassH1: true, outDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--onsites') args.onsites = argv[++i];
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

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.onsites || !args.outDir) {
    fail('Usage: shopify.mjs --onsites <path> --out-dir <dir> [--no-bypass-h1]');
  }

  const onsitesCsv = readFileSync(args.onsites, 'utf8');

  let result;
  try {
    result = buildShopifyOnsitesOutput({
      onsitesCsv,
      onsiteFileName: args.onsites.split(/[\\/]/).pop(),
      bypassH1Update: args.bypassH1
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Unexpected error while parsing the Shopify CSV.');
    return;
  }

  mkdirSync(args.outDir, { recursive: true });
  const written = result.files.map((file) => {
    const outPath = join(args.outDir, file.fileName);
    writeFileSync(outPath, file.csvText, 'utf8');
    return { path: outPath, label: file.label, rowCount: file.rowCount, kind: file.kind };
  });

  process.stdout.write(JSON.stringify({ files: written, summary: result.summary }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
