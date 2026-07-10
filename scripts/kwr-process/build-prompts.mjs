#!/usr/bin/env node
// Builds the three KWR Process prompts from a client intake payload.
//
// Usage:
//   node build-prompts.mjs --input intake.json [--out prompts.json]
//   cat intake.json | node build-prompts.mjs [--out prompts.json]
//
// Input JSON shape (all string fields; keywordUrls may be a string of
// newline-separated URLs or an array of URL strings):
//   {
//     "clientName": "Acme Corp",
//     "clientUrl": "https://example.com",
//     "targetMarket": "USA",
//     "keywordUrls": ["https://example.com/page-1", "https://example.com/page-2"],
//     "businessType": "",
//     "knownProducts": "",
//     "focus": ""
//   }
//
// Output: JSON array of { id, name, instruction, content } written to
// stdout (or --out, if given).

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildPromptOutputs, requiredFields } from './lib/prompts.mjs';

const FIELD_KEYS = [
  'clientName',
  'clientUrl',
  'businessType',
  'knownProducts',
  'focus',
  'targetMarket',
  'keywordUrls'
];

function parseArgs(argv) {
  const args = { input: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      args.input = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
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

export function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeInput(raw) {
  const values = {};
  for (const key of FIELD_KEYS) {
    const value = raw[key];
    if (key === 'keywordUrls' && Array.isArray(value)) {
      values[key] = value.map((entry) => String(entry).trim()).filter(Boolean).join('\n');
      continue;
    }
    values[key] = typeof value === 'string' ? value : '';
  }
  return values;
}

export function validate(values) {
  const errors = {};
  if (!values.clientName.trim()) errors.clientName = 'Client name is required.';
  if (!values.clientUrl.trim()) errors.clientUrl = 'Client URL is required.';
  if (values.clientUrl && !isValidUrl(values.clientUrl)) errors.clientUrl = 'Enter a valid http(s) URL.';
  if (!values.targetMarket.trim()) errors.targetMarket = 'Target market is required.';
  if (!values.keywordUrls.trim()) errors.keywordUrls = 'List of URLs for keyword research is required.';
  return errors;
}

function main() {
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

  const values = normalizeInput(raw);
  const errors = validate(values);

  if (Object.keys(errors).length > 0) {
    process.stderr.write(
      JSON.stringify({ error: 'Validation failed.', fields: errors, required: requiredFields }) + '\n'
    );
    process.exit(1);
  }

  const outputs = buildPromptOutputs(values);
  const json = JSON.stringify(outputs, null, 2);

  if (args.out) {
    writeFileSync(args.out, json, 'utf8');
    process.stdout.write(JSON.stringify({ wrote: args.out, count: outputs.length }) + '\n');
  } else {
    process.stdout.write(json + '\n');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
