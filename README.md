# Prompt Workbench (KWR + Metadata + Onsites)

This is a Next.js workbench with three workflows:
- KWR Process: build three AI prompt templates from one client intake form.
- Metadata Creation: generate new metadata CSVs using a keyword mapping CSV and OpenAI, with optional live scraping for context.
- Onsites Parser: turn Onsites URL recommendations into WordPress or Shopify-ready SEO exports.

## Workflows

### KWR Process (`/kwr-process`)
- Collects client details and a URL list, then generates three prompts:
  - Executive research summary
  - Ahrefs keyword extraction
  - Keyword scoring and clustering
- Optional URL validation via `/api/url-status` with a progress bar.
- Non-200 URLs are shown in a copy-ready modal.
- A "Don't check URLs status" toggle bypasses validation.

### Metadata Creation (`/metadata-creation`)
- Upload a keyword mapping CSV and enter Brand/Name (required).
- Optionally scrape each URL to gather current title, description, and H1 as context.
- A "Don't fetch current metadata" toggle skips scraping and uses only the keyword mapping.
- Generates a CSV with current and new values.

Output CSV columns:
```
Address,Keyword,Current Title,New Title,Current Description,New Description,Current H1,New H1
```

### Onsites Parser (`/onsites-parser`)
- `/onsites-parser` is a platform selector for WordPress and Shopify workflows.

WordPress parser (`/onsites-parser/wordpress`)
- Upload the Onsites CSV plus at least one source export: Products, Product Categories, Posts, or Pages.
- Matched URLs are split into separate CSVs by source type.
- Each matched export only includes URLs with `Match Status = matched`.
- Matched exports keep source header names for the update fields and do not carry current metadata values forward.
- Nested product detail URLs under `/store/products/.../<product>/` are treated as product URLs and can match Products exports by product slug.
- Product category URLs under `/product-category/` can be matched from taxonomy-style category CSVs, including nested category paths when the source rows provide hierarchy data.
- SEO column mapping supports AIOSEO, Yoast, and Rank Math style exports.
- H1 updates are bypassed by default, so the H1 column is omitted from matched exports unless that bypass is disabled.
- Anything not matched is exported into a separate non-matched CSV for review, including a short best-guess note about why the match failed.
- If 30% or more of the original URL set is non-matched, the UI suggests uploading missing source exports.

Shopify parser (`/onsites-parser/shopify`)
- Upload only the Onsites CSV.
- Product URLs under `/products/` and `/collections/<collection>/products/<product>` are exported.
- Collection-scoped product URLs are normalized to the canonical `/products/<product>` path before export.
- Outputs a Shopify-ready CSV with `Handle`, `SEO Title`, and `SEO Description`.
- `Title` is reserved for the onsite H1 and is only included when H1 bypass is turned off.
- Non-product URLs are split into a separate exclusion CSV with a short reason.

## API routes
- `POST /api/metadata/`
  - Accepts JSON or multipart form data.
  - JSON fields: `kw_csv` (required), `sf_csv` (optional), `brand` (required), and options.
  - Query `format=csv` returns a downloadable CSV.
- `POST /api/scrape/`
  - JSON: `{ "url": "https://example.com" }`
  - Returns `{ url, metaTitle, metaDescription, metaH1 }`.
- `POST /api/url-status/`
  - JSON: `{ "url": "https://example.com" }`
  - Returns `{ url, status, location }`.
- `GET /api/env-check/`
  - Returns environment status and test mode flags.

Note: `trailingSlash: true` is enabled, so API routes use a trailing slash. If you hit the non-slash URL, Next will 308 redirect.

## Environment variables
See `.env.example`:
- `OPENAI_API_KEY` (required unless `META_TEST_MODE=true`)
- `OPENAI_MODEL` (defaults to `gpt-4o-mini`)
- `META_TEST_MODE` (when true, OpenAI calls are mocked)

## Running locally
1) Install deps: `npm install`
2) Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`.
3) Run the development server while editing: `npm run dev`
4) Open `http://localhost:3000`

## Production build
This app is serverful (App Router + API routes). Use:
``` 
npm run build
npm run start
```

`npm run start` runs `server.js` in production mode and binds to `process.env.PORT` (useful for cPanel or shared hosting). Do not use `npm run start` as a local dev substitute; use `npm run dev` for that.

## Tests
- Watch: `npm run test`
- One-shot: `npm run test:run`

The suite includes unit tests, API route tests, and basic UI tests.

## Notes
- Prompts are defined in `lib/prompts.ts`. The `/prompts` folder contains human-readable copies.
- The Ahrefs prompt expects a chatbot session with an Ahrefs MCP server; Claude is the only verified client so far.

## Change Log

### 2026-03-09 - Meta title pipeline switched to rewrite-first QA.

- The metadata pipeline in `app/api/metadata/route.ts` now treats title length as a validation target, not a clipping rule.
- Preferred title range is `55` to `65` characters.
- Fallback title range is `66` to `70` characters only when shortening the title would weaken keyword fidelity or create an incomplete phrase.
- Final titles are validated before output for:
  - keyword fidelity to the primary keyword
  - semantic completeness
  - natural endings with no dangling separators or clipped phrases
  - brand-policy compliance

- The title flow is now:
  - generate the first draft
  - validate the draft
  - send failed drafts through an AI editor / rewrite pass
  - revalidate the rewritten title before delivery

- The runtime no longer mechanically trims or clips final titles.
  - Overlength titles are rewritten.
  - Short thin titles are expanded with real page-specific differentiators from the URL slug or H1.
  - Final output must remain a complete thought.

- API acceptance coverage in `tests/api/metadata.test.ts` now verifies:
  - complete titles land in the preferred `55` to `65` range when possible
  - complete fallback titles can use `66` to `70` when needed
  - thin short drafts are rejected and rewritten
  - incomplete endings are rewritten instead of clipped
  - primary keyword fidelity is preserved through the rewrite pass
  - validation reruns after a failed editorial rewrite
