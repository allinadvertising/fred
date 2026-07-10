---
name: onsites-parser
description: This skill should be used when the user asks to "parse onsites", "run the onsites parser", "match onsite recommendations to WordPress/Shopify exports", "convert the onsites CSV", or has an Onsites URL-recommendation CSV that needs matching against WordPress (Products/Product Categories/Posts/Pages) or Shopify product exports.
---

# Onsites Parser

Turns an "Onsites" URL-recommendation CSV (a non-standard, block-formatted export — one URL per block, followed by `Title`/`Keywords`/`H1 Tag`/`Meta Description` label rows) into platform-ready SEO update exports. Two platforms, two CLIs, no shared inputs beyond the onsites CSV itself. All matching logic is deterministic — ported unchanged from `lib/onsites.ts`/`lib/shopify-onsites.ts` into `scripts/onsites-parser/lib/`. Do not hand-parse the onsites CSV or reimplement matching; always run the CLI.

## Which platform?

Ask the user (or infer from what they've already told you / uploaded):
- **WordPress** — has separate Products / Product Categories / Posts / Pages exports to match against.
- **Shopify** — only the onsites CSV; product URLs are recognized by path shape, no separate export needed.

## WordPress flow (`wordpress.mjs`)

1. Collect: the onsites CSV path, and **at least one** of a Products / Product Categories / Posts / Pages export CSV (the CLI rejects the run if none are given, same as the original UI). Ask whether to bypass the H1 update (default: yes — H1 column is omitted from matched exports unless the user says no).
2. Run:
   ```
   node scripts/onsites-parser/wordpress.mjs --onsites <onsites.csv> \
     [--products <products.csv>] [--product-categories <categories.csv>] \
     [--posts <posts.csv>] [--pages <pages.csv>] \
     [--no-bypass-h1] --out-dir <output-dir>
   ```
3. Prints `{ files: [{ path, label, rowCount, kind, sourceType }], summary: { total, matched, nonMatched, unmatched, ambiguous, matchedBySource, nonMatchedRate, suggestionNeeded, suggestedSources } }`.
4. Report to the user: how many files were written and where, plus the summary counts (URLs total / matched / non-matched, broken down by source type).
5. **If `summary.suggestionNeeded` is true** (30%+ of URLs didn't match): tell the user which additional source exports to try uploading — `summary.suggestedSources` lists the source types not yet provided (e.g. `["posts", "pages"]`). If `suggestedSources` is empty, all four source types are already uploaded — point the user at the non-matched CSV for manual review instead.
6. Matched files are split one-per-source-type (`<base>_products_matched.csv`, `<base>_product_categories_matched.csv`, etc.), using each source's own header names for the SEO fields (auto-detected across AIOSEO/Yoast/Rank Math naming). A `<base>_non_matched.csv` is written whenever any URLs didn't match, each with a short `Match Note` explaining why.

## Shopify flow (`shopify.mjs`)

1. Collect: the onsites CSV path only. Ask whether to bypass the H1 update (default: yes).
2. Run:
   ```
   node scripts/onsites-parser/shopify.mjs --onsites <onsites.csv> [--no-bypass-h1] --out-dir <output-dir>
   ```
3. Prints `{ files: [{ path, label, rowCount, kind }], summary: { total, exported, excluded, nonProduct } }`.
4. Report: rows exported to the Shopify product CSV (`Handle, SEO Title, SEO Description`, plus `Title` if H1 bypass is off) vs. excluded (non-product URLs, or product URLs missing a usable handle) into `<base>_shopify_excluded.csv`.
5. Only `/products/<handle>` and `/collections/<collection>/products/<handle>` URLs are recognized as products; collection-scoped URLs are normalized to the canonical `/products/<handle>` path before export. Everything else lands in the excluded file with a reason.

## Notes

- No network calls or API keys — this is pure local CSV parsing/matching.
- Nested product URLs under `/store/products/.../<product>/` are treated as product URLs (slug-fallback matching) for WordPress.
- Product category URLs under `/product-category/` support nested taxonomy paths when the category export provides hierarchy (`name`/`parent` columns).
- If the user only has the onsites CSV and no source exports at all, that's a WordPress-flow dead end (the CLI requires at least one) — confirm which platform before assuming WordPress; if it's actually Shopify, no source export is needed in the first place.
