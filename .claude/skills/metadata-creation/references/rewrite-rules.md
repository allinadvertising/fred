# Rewrite rules

Apply these when `pending.json` (from `scripts/metadata-creation/validate.mjs`) lists a row/field that failed QA. Each pending entry carries the field (`title` or `description`), the `rejectedText` (best candidate so far), and either `messages` (title) or `codes` (description) explaining why it failed — the same failure detail that used to go to OpenAI in `buildTitleEditorPrompt`/`buildDescriptionEditorPrompt`. Rewrite only the listed field for that row; do not touch fields that aren't pending.

Write rewrites as JSON: `{ "rows": [ { "index": <row index>, "title": "..." } , { "index": <row index>, "description": "..." } ] }` — one entry per pending field (a row can have both a title and a description entry if both are pending).

## Title rewrite (`field: "title"`)

- Return one complete meta title.
- Keep the title tightly aligned to the row's primary keyword, and weave it into the title as a real grammatical part of the phrase. Never staple it on as a separate clause after a colon, dash, or pipe (e.g. "Product Name: keyword" is wrong). Either lead with the keyword as a natural descriptor ("Keyword Product Name"), fold its distinguishing word directly into the product name, or attach it with a real connector word like "with" or "for".
- Prefer 55 to 65 characters.
- Allow 66 to 70 only if needed to preserve a complete phrase.
- Do not clip, trim, or cut off the ending.
- Expand short titles with a real differentiator from the H1 or URL slug when needed.
- Preserve the row's brand policy exactly (see drafting-rules.md's Title rule 5).
- Read `messages` for the specific QA failures to fix — each one names exactly what's wrong (too short, missing keyword, dangling separator, brand mismatch, etc.).

## Description rewrite (`field: "description"`)

- The description must read as one or more complete sentences ending in proper punctuation. Never stop mid-thought, mid-clause, or on a dangling word.
- Target 150 to 160 characters, but a shorter complete description beats a longer incomplete one.
- Use the primary keyword naturally if it fits without forcing it.
- No HTML, no surrounding quotes.
- `codes` lists the specific QA failures (`too_long`, `incomplete_ending`, `dangling_separator`, `missing_terminal_punctuation`).

## Budget

Titles get one rewrite pass after the initial draft before the pipeline gives up and falls back to a deterministic repair. Descriptions get one rewrite pass before falling back to a hard character clamp. `validate.mjs` tracks this automatically — a row only appears in `pending.json` if it still has budget left, so always attempt a genuinely different rewrite rather than resubmitting the same text.
