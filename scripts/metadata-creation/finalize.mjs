#!/usr/bin/env node
// Assembles the final metadata CSV: accepted candidates ship as-is;
// anything that exhausted its rewrite budget without passing QA falls
// back to the deterministic repair path (title) or clampDescription
// (description) — the same non-AI safety net the original route always
// had, so a row can never end up unfinished even if Claude's rewrites
// keep failing QA.
//
// Usage:
//   node finalize.mjs --contexts contexts.json --state state.json --out output.csv

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rowsToCsv, OUTPUT_COLUMNS } from './lib/csv.mjs';
import { finalizeTitleDeterministic, clampDescription, DESCRIPTION_HARD_MAX } from './lib/generate.mjs';

function parseArgs(argv) {
  const args = { contexts: null, state: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--contexts') args.contexts = argv[++i];
    else if (arg === '--state') args.state = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
  }
  return args;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

function resolveFinalTitle(stateRow, context) {
  const field = stateRow.title;
  if (field.status === 'skipped' || !field.best) return context.currentTitle;
  if (field.status === 'accepted') return field.best.title;
  // exhausted (or defensively: still pending) — hand off to the
  // deterministic repair path instead of shipping a rejected draft.
  return finalizeTitleDeterministic(field.best, context).title;
}

function resolveFinalDescription(stateRow, context) {
  const field = stateRow.description;
  if (field.status === 'skipped' || !field.best) return context.currentDesc;
  if (field.status === 'accepted') return field.best.text;
  return clampDescription(field.best.text || context.currentDesc, DESCRIPTION_HARD_MAX);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contexts || !args.state || !args.out) {
    fail('Usage: finalize.mjs --contexts <path> --state <path> --out <path>');
  }

  const { rows: contextRows } = JSON.parse(readFileSync(args.contexts, 'utf8'));
  const { rows: stateRows } = JSON.parse(readFileSync(args.state, 'utf8'));
  const stateByIndex = new Map(stateRows.map((row) => [row.index, row]));

  let titleFellBackToDeterministic = 0;
  let descriptionFellBackToClamp = 0;

  const outputRows = contextRows.map(({ index, context }) => {
    const stateRow = stateByIndex.get(index);
    if (context.targets.includes('title') && stateRow.title.status !== 'accepted' && stateRow.title.status !== 'skipped') {
      titleFellBackToDeterministic += 1;
    }
    if (context.targets.includes('description') && stateRow.description.status !== 'accepted' && stateRow.description.status !== 'skipped') {
      descriptionFellBackToClamp += 1;
    }

    return {
      Address: context.url,
      Keyword: context.keyword,
      'Current Title': context.currentTitle,
      'New Title': resolveFinalTitle(stateRow, context),
      'Current Description': context.currentDesc,
      'New Description': resolveFinalDescription(stateRow, context),
      'Current H1': context.currentH1,
      'New H1': stateRow.h1.text
    };
  });

  writeFileSync(args.out, rowsToCsv(OUTPUT_COLUMNS, outputRows), 'utf8');

  process.stdout.write(
    JSON.stringify({
      wrote: args.out,
      rows: outputRows.length,
      titleFellBackToDeterministic,
      descriptionFellBackToClamp
    }) + '\n'
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
