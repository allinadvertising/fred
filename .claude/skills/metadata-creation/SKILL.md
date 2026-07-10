---
name: metadata-creation
description: This skill should be used when the user asks to "generate metadata", "run metadata creation", "create new titles and descriptions", "build SEO metadata from a keyword mapping CSV", or wants new meta titles/descriptions/H1s written and QA'd for a list of URLs against a keyword-mapping CSV.
---

# Metadata Creation

Turn a keyword-mapping CSV (URL + target keyword per row) into a CSV of new meta titles, descriptions, and H1s. Claude writes the actual copy; a set of scripts under `scripts/metadata-creation/` enforces every QA rule deterministically (brand-suffix policy, title length bands, keyword fidelity, dangling-ending/incomplete-phrase detection, rewrite budgets, and a non-AI fallback for anything that never passes). No API keys or external LLM calls are involved — everything runs locally via `node`, and Claude does the drafting/rewriting inline as part of this conversation.

Do not draft copy without following `references/drafting-rules.md` and `references/rewrite-rules.md` — those are the exact rules the deterministic validator checks against, ported unchanged from the original tuned pipeline. Free-form copywriting that ignores them will just bounce back as `pending` rows over and over.

## Inputs to collect

- **Keyword mapping CSV path** (required) — must have a URL/Address column and a Keyword column.
- **Brand/Name** (required).
- **Scrape for current metadata?** (default yes) — scrapes each URL's live title/description/H1 as context. If declined, current-value columns stay blank.
- **Fields to generate**: title (default on), description (default on), H1 (default off).
- **Bypass `| Brand Name` suffix?** (default no).
- **Clamp description to 160 chars?** (default yes — this is the `--clamp-desc` / `--no-clamp-desc` flag; it only affects whether the length check is enforced, not whether descriptions get written).

## Workflow

Work in a scratch directory (e.g. the scratchpad, or alongside the input CSV) for the intermediate JSON files — `contexts.json`, `drafts.json`, `state.json`, `pending.json`. Only the final CSV needs to land somewhere the user will keep.

1. **Build the "current metadata" CSV.**
   - If scraping: `node scripts/metadata-creation/scrape.mjs --kw-csv <kw.csv> --out sf.csv` (concurrency 3, same as the original UI). Prints `{ wrote, rows, scraped, cached }`.
   - If skipping: `node scripts/metadata-creation/scrape.mjs --kw-csv <kw.csv> --out sf.csv --skip` (writes blank current-value rows, no network calls).

2. **Build row contexts.**
   ```
   node scripts/metadata-creation/build-contexts.mjs --kw-csv <kw.csv> --sf-csv sf.csv \
     --brand "<Brand Name>" [--no-gen-title] [--no-gen-desc] [--gen-h1] \
     [--no-clamp-desc] [--bypass-brand-suffix] --out contexts.json
   ```
   Prints `{ wrote, rows, targets }`. Each row in `contexts.json` carries its own `brandPolicy`, `preferredCoreTitleChars`, and `fallbackCoreTitleChars` — already computed, don't re-derive them.

3. **Draft (Claude).** Read `contexts.json`. For every row, write a first-draft `title`/`description`/`h1` per `references/drafting-rules.md`, for whichever fields are in that row's `targets`. Write `drafts.json` as `{ "rows": [ { "index": 0, "title": "...", "description": "...", "h1": "..." }, ... ] }`.
   - For large CSVs, draft in batches of roughly 40–60 rows per pass rather than one giant pass or one row at a time — keeps quality high without burning excessive turns. Merge batches into one `drafts.json` before validating.

4. **Validate.**
   ```
   node scripts/metadata-creation/validate.mjs --contexts contexts.json --drafts drafts.json \
     --out-state state.json --out-pending pending.json
   ```
   Prints a summary (`{ rows, titleAccepted, titleExhausted, descriptionAccepted, descriptionExhausted, pending }`). Read `pending.json`.

5. **Rewrite loop.** While `pending.json`'s `rows` array is non-empty:
   - Read the pending entries (each has `index`, `field`, `rejectedText`, and `messages`/`codes`).
   - Rewrite just those fields per `references/rewrite-rules.md`. Write a new `drafts.json` containing **only** the rewritten rows/fields (e.g. `{ "rows": [ { "index": 3, "title": "..." } ] }`).
   - Re-run validate.mjs, this time passing the accumulated state:
     ```
     node scripts/metadata-creation/validate.mjs --contexts contexts.json --drafts drafts.json \
       --state state.json --out-state state.json --out-pending pending.json
     ```
   - The script enforces the rewrite budget itself (titles: 1 rewrite; descriptions: 1 rewrite) — once a field's budget is spent it stops appearing in `pending.json` even if still unaccepted, so this loop always terminates in at most 2 rewrite rounds.

6. **Finalize.**
   ```
   node scripts/metadata-creation/finalize.mjs --contexts contexts.json --state state.json --out <final>.csv
   ```
   Prints `{ wrote, rows, titleFellBackToDeterministic, descriptionFellBackToClamp }`. Rows that never passed QA after the rewrite budget get a deterministic repair (title) or a hard clamp (description) automatically — this is not an error state, just report the counts.

7. **Report back to the user**: where the final CSV landed, row count, and the fallback counts from step 6 (e.g. "3 of 40 titles needed the deterministic fallback after rewrites"). Clean up the intermediate JSON/CSV scratch files unless the user wants to inspect them.

## Output shape

`Address,Keyword,Current Title,New Title,Current Description,New Description,Current H1,New H1` — same 8 columns as the original webapp export.

## Reference files

- **`references/drafting-rules.md`** — full title/description/H1 authoring rules for the initial draft (step 3).
- **`references/rewrite-rules.md`** — rules for rewriting a rejected field, plus what the `messages`/`codes` in `pending.json` mean (step 5).
