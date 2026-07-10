---
name: kwr-process
description: This skill should be used when the user asks to "start the KWR process", "run kwr-process", "build KWR prompts", "generate the keyword research prompts", "create the client intake prompts", or wants the three-prompt workbench (executive research summary, Ahrefs keyword extraction, keyword scoring & clustering) for a new client engagement.
---

# KWR Process

Turn a client intake form into three ready-to-paste AI prompts: a web-research executive summary, an Ahrefs keyword-extraction + URL-mapping prompt, and a keyword scoring/clustering prompt. All logic is deterministic string templating in `scripts/kwr-process/lib/prompts.mjs` — do not regenerate the prompt text from memory; always run the script so output stays byte-identical to the tuned templates.

## Inputs to collect

Ask the user for these fields (or accept them if already provided in the conversation). Required fields must be non-empty before generating:

| Field | Required | Notes |
|---|---|---|
| `clientName` | yes | |
| `clientUrl` | yes | Must be a valid `http(s)://` URL |
| `targetMarket` | yes | Ahrefs location/language, e.g. "Canada, USA, UK" |
| `keywordUrls` | yes | One URL per line, or an array — the pages to build keyword mappings for |
| `businessType` | no | e.g. "DTC ecommerce, SaaS, marketplace" |
| `knownProducts` | no | 1-5 items, useful to disambiguate a generic brand name |
| `focus` | no | e.g. "Prioritize B2B wholesale" |

Empty optional fields render as "Not provided" in the prompts — that's expected, no need to press the user for them.

## Workflow

1. **Ask whether to validate the keyword URLs** before generating (default: yes). Validation catches broken/redirecting URLs before they get baked into the Ahrefs prompt.

2. **If validating**, write the raw URL list to a temp JSON file as `{ "urls": [...] }` and run:
   ```
   node scripts/kwr-process/check-urls.mjs --input <tmp>.json
   ```
   This checks each unique URL with a manual-redirect fetch (concurrency 5) and returns `{ total, uniqueChecked, okCount, redirectCount, notFoundCount, validUrls, nonOk }`. `nonOk` entries carry a human-readable `description` (e.g. "Not found; the URL does not exist.").
   - If `nonOk` is non-empty, show the user a short table (URL / status / description) and ask whether to proceed with only the `validUrls`, fix the list and re-check, or skip validation and use the original list anyway.
   - If `validUrls` is empty, stop and tell the user — there's nothing usable to build prompt 2 from.

3. **Skip validation** entirely if the user opts out — just use the raw `keywordUrls` list as given.

4. **Build the prompts.** Write the final intake payload to a temp JSON file:
   ```json
   {
     "clientName": "...",
     "clientUrl": "...",
     "targetMarket": "...",
     "keywordUrls": ["https://...", "https://..."],
     "businessType": "",
     "knownProducts": "",
     "focus": ""
   }
   ```
   Run:
   ```
   node scripts/kwr-process/build-prompts.mjs --input <tmp>.json
   ```
   This validates required fields itself (exits 1 with a JSON error on `stderr` if something's missing/invalid — surface that message directly rather than re-deriving the rule) and prints a JSON array of `{ id, name, instruction, content }` — one entry per prompt (`prompt1` executive summary, `prompt2` Ahrefs extraction, `prompt3` scoring & clustering).

5. **Present the three prompts** to the user as separate copy-ready fenced code blocks, each preceded by its `name` and `instruction` so the user knows what each one is for and when to run it (prompt1 first for research, prompt2 next inside an Ahrefs-MCP-enabled session, prompt3 last over the resulting CSV). Mention that prompt2 expects an Ahrefs MCP server in the target chat session — note in the original templates that Claude is the only verified client for that so far.

## Notes

- No API keys or network calls are required except the optional URL-validation fetches — everything else is local string templating.
- Clean up temp JSON files after the run.
- If the user only wants one or two of the three prompts (e.g. just the Ahrefs extraction prompt for a page set that's already been researched), still run `build-prompts.mjs` for all three and just present the ones they asked for — the script always builds all three since they share the same intake payload and generating all three is cheap.
