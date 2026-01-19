# Prompt Workbench (KWR + Metadata)

This is a Next.js workbench with two workflows:
- KWR Process: build three AI prompt templates from one client intake form.
- Metadata Creation: generate new metadata CSVs using a keyword mapping CSV and OpenAI, with optional live scraping for context.

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
3) Run dev server: `npm run dev`
4) Open `http://localhost:3000`

## Production build
This app is serverful (App Router + API routes). Use:
```
npm run build
npm run start
```

`npm run start` runs `server.js`, which binds to `process.env.PORT` (useful for cPanel or shared hosting).

## Tests
- Watch: `npm run test`
- One-shot: `npm run test:run`

The suite includes unit tests, API route tests, and basic UI tests.

## Notes
- Prompts are defined in `lib/prompts.ts`. The `/prompts` folder contains human-readable copies.
- The Ahrefs prompt expects a chatbot session with an Ahrefs MCP server; Claude is the only verified client so far.
