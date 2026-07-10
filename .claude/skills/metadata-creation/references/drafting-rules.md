# Drafting rules

Apply these when writing the first-draft `title`/`description`/`h1` for each row in `contexts.json` (`scripts/metadata-creation/build-contexts.mjs`'s output). These are the same rules that used to be sent to OpenAI verbatim per row in `app/api/metadata/route.ts`'s `buildPrompt()` — apply them per row using that row's own `context` fields (`url`, `keyword`, `currentTitle`, `currentDesc`, `currentH1`, `brandName`, `brandPolicy`, `bypassBrandSuffix`, `preferredCoreTitleChars`, `fallbackCoreTitleChars`, `targets`).

General:
- Natural, specific, compelling tone. No clickbait. No HTML. No quotes.
- Do not invent claims (pricing, awards, guarantees, "official") unless present in the current title/description/H1 inputs.
- Only draft the fields listed in that row's `targets`. For any field not in `targets`, leave it out of the draft entirely (the pipeline falls back to the current value automatically).
- Output strictly as JSON per row: `{ "index": <row index>, "title": "...", "description": "...", "h1": "..." }` (omit keys for fields not in `targets`).

## Title rules (only if `title` is in `targets`)

1. Weave the keyword into the title as a real grammatical part of it. Do not staple it on.
   - The keyword must function as part of one coherent phrase with the product/page name, not a second clause bolted on with a colon, dash, or pipe.
   - BAD (keyword tacked on as a disconnected clause): "Grow More Sea Grow All Purpose 25 Lb: seaweed fertilizer"
   - GOOD (keyword integrated as a natural descriptor): "Seaweed Fertilizer Grow More Sea Grow All Purpose 25 Lb"
   - BAD: "Grow More Mendocino N-Cal-Mag: liquid cal mag"
   - GOOD (keyword's distinguishing word folded directly into the product name): "Grow More Mendocino Liquid N-Cal-Mag"
   - BAD: "Grow More Water Soluble High Foss: starter fertilizer"
   - GOOD: "Grow More Water Soluble High Foss With Starter Fertilizer"
   - Put the keyword early if it reads naturally as a lead descriptor; otherwise fold it into the product name or attach it with a real connector word ("with", "for") so the title reads as one sentence-like phrase.
   - Prioritize the most compelling complete wording over robotic exact-length matching.
2. Uniqueness requirement:
   - Title must be meaningfully unique for this URL.
   - Include at least one differentiator derived from the URL slug and/or H1 (audience, use case, product type, number, year, material, format, etc.).
   - Avoid generic templates that could apply to many pages.
3. Brand usage (single mention, consistent spelling):
   - Brand may appear at most once.
   - If `bypassBrandSuffix` is false and the existing or proposed title contains the brand in any form, remove it from the core title and only use the final suffix when brand is included.
   - If `bypassBrandSuffix` is false and brand is included, it must be appended exactly as: `" | " + brandName`.
   - If `bypassBrandSuffix` is true, do not append the pipe suffix. Brand may still appear naturally in the title if required by the keyword/page intent.
4. Length and completeness:
   - The full title should land in the preferred 55 to 65 character range whenever possible.
   - A complete title may use the fallback 66 to 70 character range only when shortening it would weaken the keyword intent or create an incomplete phrase.
   - If a draft falls below 55 characters, expand it with a real differentiator from the URL slug or H1 instead of filler.
   - Do not cut wording just to force a limit. Rewrite and compress low-value modifiers instead.
   - Do not end with incomplete phrases, dangling separators, or unfinished brand/product/service wording.
   - The title must read as a complete thought.
5. Apply the row's `brandPolicy`:
   - `"always"`: append brand suffix only when `bypassBrandSuffix` is false; rewrite the core cleanly if needed.
   - `"conditional"`: append brand suffix only if `bypassBrandSuffix` is false and it does not weaken the title.
   - `"never"`: do not include brand anywhere in the title.

## Description rules (only if `description` is in `targets`)

- Target 150 to 160 characters.
- Use the keyword or a close variant once if natural.
- Add specific context from the URL slug or H1. Avoid fluff. No incomplete sentences.

## H1 rules (only if `h1` is in `targets`)

- Clear, human, aligned with page intent. Do not force the brand into the H1.
