#!/usr/bin/env node
// Runs the deterministic title/description QA against Claude's drafts
// (or rewrites), tracks the best candidate seen so far per row/field,
// and reports which rows still need another rewrite pass. This is the
// referee half of the "Claude drafts, the script referees" split (see
// SKILL_CONVERSION_PLAN.md §4.2) — every scoring/acceptance rule here is
// ported unchanged from app/api/metadata/route.ts.
//
// Rewrite budgets match the original: titles get 1 initial pass + 2
// rewrites (TITLE_REWRITE_ATTEMPTS); descriptions get 1 initial pass + 1
// rewrite (DESCRIPTION_REWRITE_ATTEMPTS). Once a field's budget is spent
// without acceptance, its status becomes "exhausted" and finalize.mjs
// applies the deterministic fallback — never asks Claude again.
//
// Usage (repeat while pending.json has rows):
//   node validate.mjs --contexts contexts.json --drafts drafts.json \
//     [--state state.json] --out-state state.json --out-pending pending.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  resolveTitleCandidate,
  scoreTitleValidation,
  validateDescriptionCandidate,
  TITLE_REWRITE_ATTEMPTS,
  DESCRIPTION_REWRITE_ATTEMPTS
} from './lib/generate.mjs';

const TITLE_MAX_EVALUATIONS = 1 + TITLE_REWRITE_ATTEMPTS;
const DESCRIPTION_MAX_EVALUATIONS = 1 + DESCRIPTION_REWRITE_ATTEMPTS;

function parseArgs(argv) {
  const args = { contexts: null, drafts: null, state: null, outState: null, outPending: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--contexts') args.contexts = argv[++i];
    else if (arg === '--drafts') args.drafts = argv[++i];
    else if (arg === '--state') args.state = argv[++i];
    else if (arg === '--out-state') args.outState = argv[++i];
    else if (arg === '--out-pending') args.outPending = argv[++i];
  }
  return args;
}

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

function freshFieldState() {
  return { status: 'pending', evaluations: 0, best: null, bestScore: null };
}

function initState(contextRows) {
  return {
    rows: contextRows.map(({ index }) => ({
      index,
      title: freshFieldState(),
      description: freshFieldState(),
      h1: { set: false, text: '' }
    }))
  };
}

function processTitle(fieldState, context, draftTitle) {
  if (fieldState.status !== 'pending') return fieldState;

  const isInitial = fieldState.evaluations === 0;
  if (!draftTitle && !isInitial) return fieldState; // no new candidate this round, nothing to do

  const seed = (draftTitle && draftTitle.trim()) || fieldState.best?.title || context.currentTitle;
  const result = resolveTitleCandidate(seed, context);
  const score = scoreTitleValidation(result);

  const next = { ...fieldState, evaluations: fieldState.evaluations + 1 };
  if (!next.best || score > next.bestScore) {
    next.best = result;
    next.bestScore = score;
  }

  if (result.accepted) {
    next.status = 'accepted';
  } else if (next.evaluations >= TITLE_MAX_EVALUATIONS) {
    next.status = 'exhausted';
  }

  return next;
}

function processDescription(fieldState, context, options, draftDescription) {
  if (fieldState.status !== 'pending') return fieldState;

  const isInitial = fieldState.evaluations === 0;
  if (!draftDescription && !isInitial) return fieldState;

  const seed = (draftDescription && draftDescription.trim()) || fieldState.best?.text || context.currentDesc;
  const result = validateDescriptionCandidate(seed, options.clamp_desc);

  const next = { ...fieldState, evaluations: fieldState.evaluations + 1 };
  const isBetter = !next.best || result.accepted || result.codes.length < next.best.codes.length;
  if (isBetter) {
    next.best = result;
  }

  if (result.accepted) {
    next.status = 'accepted';
  } else if (next.evaluations >= DESCRIPTION_MAX_EVALUATIONS) {
    next.status = 'exhausted';
  }

  return next;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contexts || !args.drafts || !args.outState || !args.outPending) {
    fail('Usage: validate.mjs --contexts <path> --drafts <path> [--state <path>] --out-state <path> --out-pending <path>');
  }

  const { options, rows: contextRows } = JSON.parse(readFileSync(args.contexts, 'utf8'));
  const draftsFile = JSON.parse(readFileSync(args.drafts, 'utf8'));
  const draftsByIndex = new Map((draftsFile.rows ?? []).map((row) => [row.index, row]));

  const state = args.state && existsSync(args.state)
    ? JSON.parse(readFileSync(args.state, 'utf8'))
    : initState(contextRows);
  const stateByIndex = new Map(state.rows.map((row) => [row.index, row]));

  for (const { index, context } of contextRows) {
    const stateRow = stateByIndex.get(index);
    const draft = draftsByIndex.get(index);
    const targets = context.targets;

    if (targets.includes('title')) {
      stateRow.title = processTitle(stateRow.title, context, draft?.title);
    } else if (stateRow.title.status === 'pending') {
      stateRow.title.status = 'skipped';
    }

    if (targets.includes('description')) {
      stateRow.description = processDescription(stateRow.description, context, options, draft?.description);
    } else if (stateRow.description.status === 'pending') {
      stateRow.description.status = 'skipped';
    }

    if (targets.includes('h1')) {
      if (!stateRow.h1.set) {
        const proposed = (draft?.h1 ?? '').trim();
        stateRow.h1 = { set: true, text: proposed || context.currentH1 };
      }
    } else if (!stateRow.h1.set) {
      stateRow.h1 = { set: true, text: context.currentH1 };
    }
  }

  const pendingRows = [];
  for (const { index, context } of contextRows) {
    const stateRow = stateByIndex.get(index);
    if (stateRow.title.status === 'pending') {
      pendingRows.push({
        index,
        address: context.url,
        field: 'title',
        rejectedText: stateRow.title.best?.title ?? context.currentTitle,
        messages: stateRow.title.best?.messages ?? []
      });
    }
    if (stateRow.description.status === 'pending') {
      pendingRows.push({
        index,
        address: context.url,
        field: 'description',
        rejectedText: stateRow.description.best?.text ?? context.currentDesc,
        codes: stateRow.description.best?.codes ?? []
      });
    }
  }

  writeFileSync(args.outState, JSON.stringify(state, null, 2), 'utf8');
  writeFileSync(args.outPending, JSON.stringify({ rows: pendingRows }, null, 2), 'utf8');

  const summary = {
    rows: contextRows.length,
    titleAccepted: state.rows.filter((r) => r.title.status === 'accepted').length,
    titleExhausted: state.rows.filter((r) => r.title.status === 'exhausted').length,
    descriptionAccepted: state.rows.filter((r) => r.description.status === 'accepted').length,
    descriptionExhausted: state.rows.filter((r) => r.description.status === 'exhausted').length,
    pending: pendingRows.length
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
