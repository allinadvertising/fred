#!/usr/bin/env node
// Scrapes current title/description/H1 for every URL in a keyword-mapping
// CSV and writes a Screaming-Frog-shaped "sf" CSV (Address, Title 1,
// Meta Description 1, H1-1) that build-contexts.mjs consumes as "current
// metadata" context. Ported from app/api/scrape/route.ts (cheerio scrape)
// + app/api/metadata/route.ts's buildSfRowsFromKeywords (concurrency-3
// mapping + per-URL caching).
//
// Usage:
//   node scrape.mjs --kw-csv mapping.csv --out sf.csv [--concurrency 3]
//   node scrape.mjs --kw-csv mapping.csv --out sf.csv --skip   # blank rows, no network calls
//
// Prints { wrote, rows, scraped, cached } as JSON to stdout.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { parseCsv, findColumn, rowsToCsv, SF_COLUMNS } from './lib/csv.mjs';
import { ensureHttpUrl } from './lib/generate.mjs';

function parseArgs(argv) {
  const args = { kwCsv: null, out: null, concurrency: 3, skip: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kw-csv') args.kwCsv = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--concurrency') args.concurrency = Number(argv[++i]) || 3;
    else if (arg === '--skip') args.skip = true;
  }
  return args;
}

export async function mapWithConcurrency(items, limit, iterator) {
  const results = new Array(items.length);
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

export async function scrapeMeta(url) {
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

export async function buildSfRows(kwRows, urlCol, { skip = false, concurrency = 3 } = {}) {
  if (skip) {
    return {
      rows: kwRows.map((row) => ({
        Address: row[urlCol] ?? '',
        'Title 1': '',
        'Meta Description 1': '',
        'H1-1': ''
      })),
      scraped: 0,
      cached: 0
    };
  }

  const cache = new Map();
  let scraped = 0;
  let cached = 0;

  const rows = await mapWithConcurrency(kwRows, concurrency, async (row) => {
    const rawUrl = row[urlCol] ?? '';
    const fetchUrl = ensureHttpUrl(rawUrl);

    let metaPromise = cache.get(fetchUrl);
    if (metaPromise) {
      cached += 1;
    } else {
      scraped += 1;
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

  return { rows, scraped, cached };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.kwCsv || !args.out) {
    process.stderr.write(JSON.stringify({ error: 'Usage: scrape.mjs --kw-csv <path> --out <path> [--skip] [--concurrency N]' }) + '\n');
    process.exit(1);
  }

  const kwRows = parseCsv(readFileSync(args.kwCsv, 'utf8'));
  const urlCol = findColumn(kwRows, ['URL', 'Address', 'Url', 'url', 'address']);
  if (!urlCol) {
    process.stderr.write(JSON.stringify({ error: 'Keyword mapping must include a URL (or Address) column.' }) + '\n');
    process.exit(1);
  }

  const { rows, scraped, cached } = await buildSfRows(kwRows, urlCol, {
    skip: args.skip,
    concurrency: args.concurrency
  });

  writeFileSync(args.out, rowsToCsv(SF_COLUMNS, rows), 'utf8');
  process.stdout.write(JSON.stringify({ wrote: args.out, rows: rows.length, scraped, cached }) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
