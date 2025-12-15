# Prompt Workbench for Keyword Research

This is a small Next.js workbench that streamlines prompt generation for AI chatbots to run keyword research workflows. It outputs three ready-to-use prompts based on a single client form, so you can copy/paste them into your chatbot without rewriting context each time.

## How it works
- Fill the client form once (name, URL, target market, optional details).
- The app generates three prompts: executive research summary, Ahrefs keyword extraction, and keyword scoring/clustering.
- Each prompt has a copy button and stays scrollable for easy handoff.

## Dependency on custom connectors
This workflow relies on your chatbot supporting custom connectors:
- The Ahrefs prompt requires an Ahrefs MCP server. **Currently, Claude is the only supported chatbot confirmed to work with this Ahrefs MCP server.**
- Other chatbots may work if they support compatible connectors, but they are untested.

## Running locally
1) Install deps: `npm install`  
2) Start dev server: `npm run dev`  
3) Open `http://localhost:3000`

## Deploying to GitHub Pages
- A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs `next build` (with `output: 'export'` in `next.config.mjs`), then publishes the generated `out/` folder to the `gh-pages` branch.
- Base path and asset prefix are set to `/fred` during the build so assets resolve correctly on `https://<user>.github.io/fred`.
- After the first successful workflow run, set GitHub Pages to serve from the `gh-pages` branch (root). Subsequent pushes to `main` will auto-update Pages.

## Using the workbench
1) Complete required fields (client name, URL, target market for Ahrefs).  
2) Click **Validate & Generate**.  
3) Copy any prompt and paste into your chatbot that has the needed connectors enabled.  
4) For Ahrefs-specific steps, use Claude with the Ahrefs MCP server configured.

## Next steps
- Add validation for pasted URLs (ensure at least 10 URLs, and at least 90% return HTTP 200).

## Notes
- Prompts live in `lib/prompts.ts` and are mirrored from the markdown files in `/prompts`.
- The Ahrefs prompt must be run in a chatbot session that can call the Ahrefs MCP server; without it, the prompt will not function as intended.
