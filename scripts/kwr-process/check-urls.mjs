#!/usr/bin/env node
// Validates a list of URLs (HTTP status check, manual redirect) the same
// way the old /api/url-status route + kwr-process page did, minus the
// browser round-trip.
//
// Usage:
//   node check-urls.mjs --input urls.json [--concurrency 5] [--out result.json]
//   cat urls.json | node check-urls.mjs
//
// Input JSON shape:
//   { "urls": ["https://example.com/page-1", "example.com/page-2"] }
//
// Output JSON shape:
//   {
//     total, uniqueChecked, okCount, redirectCount, notFoundCount,
//     validUrls: string[],               // normalized, status 200, deduped
//     nonOk: [{ url, status, description }]  // raw input url + description
//   }

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { input: null, out: null, concurrency: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      args.input = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--concurrency') {
      args.concurrency = Number(argv[++i]) || 5;
    }
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function normalizeUrlForCheck(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
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

async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    return response.status;
  } catch {
    return 0;
  }
}

export function describeStatus(status) {
  const normalized = String(status).trim().toLowerCase();
  if (!normalized) return 'No response or status unavailable.';
  if (normalized === 'invalid') return 'Invalid URL; must be http(s).';
  if (normalized === 'unknown' || normalized === '0') return 'No response or status unavailable.';

  const code = Number(normalized);
  if (!Number.isFinite(code)) return 'Non-200 response.';
  if (code === 301) return 'Moved permanently; update to the new URL.';
  if (code === 302) return 'Found (temporary redirect); consider updating URL.';
  if (code === 307) return 'Temporary redirect; consider updating URL.';
  if (code === 308) return 'Permanent redirect; update to the new URL.';
  if (code === 400) return 'Bad request; check URL formatting.';
  if (code === 401) return 'Unauthorized; authentication required.';
  if (code === 403) return 'Forbidden; access denied.';
  if (code === 404) return 'Not found; the URL does not exist.';
  if (code === 408) return 'Request timeout; server took too long.';
  if (code === 429) return 'Too many requests; rate limited.';
  if (code >= 500 && code <= 599) return 'Server error; try again later.';
  if (code >= 300 && code <= 399) return 'Redirected; update to final URL.';
  return 'Non-200 response.';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawText = args.input ? readFileSync(args.input, 'utf8') : readStdin();

  if (!rawText.trim()) {
    process.stderr.write(
      JSON.stringify({ error: 'No input JSON provided (use --input <path> or pipe JSON via stdin).' }) + '\n'
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: `Invalid JSON input: ${error.message}` }) + '\n');
    process.exit(1);
  }

  const rawUrls = Array.isArray(raw.urls) ? raw.urls.map((url) => String(url ?? '').trim()).filter(Boolean) : [];
  if (rawUrls.length === 0) {
    process.stderr.write(JSON.stringify({ error: 'Input JSON must include a non-empty "urls" array.' }) + '\n');
    process.exit(1);
  }

  const normalizedUrls = rawUrls.map((url) => ({ raw: url, normalized: normalizeUrlForCheck(url) }));
  const invalidUrls = normalizedUrls.filter((entry) => !entry.normalized);
  const uniqueUrls = Array.from(new Set(normalizedUrls.map((entry) => entry.normalized).filter(Boolean)));

  const statusMap = new Map();
  await mapWithConcurrency(uniqueUrls, args.concurrency, async (url) => {
    const status = await fetchStatus(url);
    statusMap.set(url, status);
  });

  const nonOk = invalidUrls.map((entry) => ({
    url: entry.raw,
    status: 'invalid',
    description: describeStatus('invalid')
  }));

  let okCount = 0;
  let redirectCount = 0;
  let notFoundCount = 0;

  normalizedUrls.forEach((entry) => {
    if (!entry.normalized) return;
    const statusCode = statusMap.get(entry.normalized) ?? 0;
    if (statusCode === 200) {
      okCount += 1;
      return;
    }
    const statusText = String(statusCode || 'unknown');
    nonOk.push({ url: entry.raw, status: statusText, description: describeStatus(statusText) });
    if ([301, 302, 307, 308].includes(statusCode)) redirectCount += 1;
    else if (statusCode === 404) notFoundCount += 1;
  });

  const validUrls = Array.from(
    new Set(
      normalizedUrls
        .filter((entry) => entry.normalized && statusMap.get(entry.normalized) === 200)
        .map((entry) => entry.normalized)
    )
  );

  const result = {
    total: rawUrls.length,
    uniqueChecked: uniqueUrls.length,
    okCount,
    redirectCount,
    notFoundCount,
    validUrls,
    nonOk
  };

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(args.out, json, 'utf8');
    const { validUrls: _validUrls, nonOk: _nonOk, ...counts } = result;
    process.stdout.write(JSON.stringify({ wrote: args.out, ...counts }) + '\n');
  } else {
    process.stdout.write(json + '\n');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
