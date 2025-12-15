export type FormValues = {
  clientName: string;
  clientUrl: string;
  businessType: string;
  knownProducts: string;
  focus: string;
  targetMarket: string;
  keywordUrls: string;
};

export type PromptDefinition = {
  id: string;
  name: string;
  instruction: string;
  build: (values: FormValues) => string;
};

export type PromptOutput = {
  id: string;
  name: string;
  instruction: string;
  content: string;
};

const emptyFallback = 'Not provided';

const cleanValue = (value: string) => value.trim() || emptyFallback;

const prompt1Template = (values: FormValues) => {
  const clientName = cleanValue(values.clientName);
  const clientUrl = cleanValue(values.clientUrl);
  const targetMarket = cleanValue(values.targetMarket);
  const businessType = cleanValue(values.businessType);
  const knownProducts = cleanValue(values.knownProducts);
  const focus = cleanValue(values.focus);

  return `## Client Inputs
- **CLIENT_NAME:** ${clientName}
- **CLIENT_URL (starting point):** ${clientUrl}
- **TARGET MARKET (required for Ahrefs):** ${targetMarket}
- **BUSINESS_TYPE (optional):** ${businessType}
- **KNOWN_PRODUCTS/SERVICES (optional):** ${knownProducts}
- **FOCUS (optional):** ${focus}

---

## Role
You are a senior market researcher and positioning strategist with strong web research skills.

## Objective
Research public information about **${clientName}** from the web (starting from **${clientUrl}**) and produce an evidence-based executive summary covering:

- Core business (what they sell, how they sell it, and to whom)
- Market messaging and positioning (value proposition, differentiation, proof points)
- Buyer persona(s)
- Ideal Customer Profiles (ICPs)

## Non-negotiable rules
1. Use web research. Do not rely on prior knowledge.
2. No hallucinations. If a detail cannot be verified, mark it as **Unknown** and explain what you could not confirm.
3. Cite every key claim with a source URL (inline citations preferred).
4. Prioritize primary sources (the company website, official social profiles, retailer listings, press coverage from reputable outlets).
5. Recency matters. Prefer the most recent sources when statements may change (pricing, availability, product lineup, distribution).

## Research scope and source priorities

### Required sources (check all that apply)
- Client site pages: Home, About, Product/Services pages, FAQs, Shipping/Returns, Contact, Wholesale/Trade, Blog/Press (if available)
- Any "Where to Buy" pages, store locator, or stockists/retail partners listed by the client
- Public social profiles (Instagram, TikTok, Facebook, LinkedIn, YouTube), ideally linked from the client site
- Reputable press mentions or interviews
- Retail marketplace listings (if the brand sells through third parties)
- Public reviews (only for patterns; avoid over-weighting individual anecdotes)

### Optional sources (use if useful and credible)
- Podcasts, event pages, collaborations, industry publications
- Public trademark filings or business registry data (only if relevant and easy to verify)

### Exclusions
- Do not use low-credibility sources as primary evidence (content farms, scraped directories).
- Do not include personally identifying information about private individuals.

---

## Output requirements
Deliver the final response in the structure below. Use concise business language and make it scannable with headings and bullets.

### 1) Executive Summary (8-12 bullets)
- What the company is
- What they sell and key differentiators
- Target audience and occasions/use cases
- Primary channels (DTC, retail, wholesale, etc.)
- Positioning thesis (one sentence)
- Key evidence highlights (with citations)

### 2) Core Business

**Offerings**
- Product/service categories and formats (with examples)
- Pricing architecture (if public): entry price, bundles, subscriptions, retainers, tiers
- Key attributes (e.g., premium ingredients, certified, fast delivery, enterprise-grade, etc.)

**Business model**
- Sales channels: DTC, retail, wholesale, subscription, marketplaces, partnerships
- Geography served (countries/states) and fulfillment notes (shipping restrictions, lead times, delivery radius, etc.)
- Partnerships (retailers, distributors, integrations, affiliates, collaborations), if documented

**Customer value**
- Jobs-to-be-done
- Primary benefits: functional, emotional, social
- Top 3 reasons to believe (proof points)

> Include a small table summarizing:
> **Product/Service Line | Format | Price (if listed) | Key claim | Source**

### 3) Market Messaging and Positioning

**Messaging pillars**
- 3-5 pillars with a 1-2 sentence explanation each
- Supporting copy snippets (paraphrased) and citations

**Positioning**
- Category definition (how the brand frames the market)
- Differentiation: what they emphasize versus alternatives
- Brand personality/voice cues (tone, adjectives, style)

**Proof and credibility**
- Ingredient/material/feature claims, awards, certifications, press, UGC indicators
- Any explicit guarantees (quality, shipping, satisfaction, refunds, SLAs)

> Include a "Positioning statement":
> "For **[target]**, **${clientName}** is the **[category]** that **[primary benefit]** because **[key differentiator/proof]**."

### 4) Buyer Persona(s)
Create 2-4 personas if warranted by evidence. For each persona, provide:

- Persona name and short descriptor
- Demographics (only if clearly implied; otherwise "Unknown")
- Psychographics: motivations, values, lifestyle/work context
- Primary occasions/use cases
- Purchase triggers
- Objections and friction points
- Decision criteria
- Preferred channels and content formats
- Example messages that would resonate (2-3)

> Provide a brief **Evidence notes** subsection per persona with citations supporting why that persona exists.

### 5) Ideal Customer Profiles (ICPs)
Provide at least 2 ICPs, separated into B2C and B2B where applicable.

**B2C ICP format**
- Segment name
- Geography
- Behaviors (buying patterns)
- Needs and constraints
- High-intent signals (what they search, what pages they visit)
- Best-fit product/offer mapping

**B2B ICP format (only if supported by sources)**
- Buyer type (retailer, procurement, bar/restaurant, event planner, corporate gifting, IT leader, operations, etc.)
- Business size and geography
- Buying criteria
- Compliance/logistics constraints
- Typical order size and cadence (if inferable; otherwise "Unknown")
- Outreach angles and objections

> Include a prioritization matrix:
> **ICP | Estimated fit (High/Med/Low) | Rationale | Evidence**

### 6) Competitive and Category Context (lightweight)
Without doing a full competitor deep dive, include:
- The category alternatives customers compare against
- Key differentiation axes (price, convenience, quality, taste/performance, brand, gifting, etc.)
- 3-5 competitor examples only if clearly relevant and easy to verify

### 7) Key Takeaways and Strategic Implications
- 5-8 bullets: implications for SEO, paid ads, landing pages, email, retail/wholesale collateral, partnerships
- Quick wins versus longer-term bets

---

## Quality checks before finalizing
- Are all major claims cited?
- Did you separate **facts** from **inferences** and label inferences?
- Did you avoid repeating boilerplate?
- Is the summary actionable for marketing strategy?

## Formatting and citation guidance
- Use Markdown headings and bullet lists for readability.
- Provide inline citations as: (Source: URL)
- If many citations are needed, you may use numbered references, but keep them close to the claims they support.

## If browsing is restricted or sources are unavailable
If you cannot access the site or sources:
- State the limitation clearly.
- Provide a best-effort outline and list the exact sources you would need to complete the task.`;
};

const prompt2Template = (values: FormValues) => {
  const targetMarket = cleanValue(values.targetMarket);

  const formattedUrls = values.keywordUrls
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return `# Ahrefs Keyword Extraction + URL Mapping Prompt (Anti-Cannibalization + Relevance Guardrails)

## Role
You are an SEO keyword strategist. Your job is to assign keywords to specific URLs in a way that is (1) relevant and (2) prevents keyword cannibalization.

## Input Parameters
- Target Market (Ahrefs location and language): ${targetMarket}
- URLs: (see list at bottom)

## Primary Goal
Produce a keyword-to-URL mapping where each keyword is assigned to exactly one best-fit URL, with high topical relevance and clear intent alignment.

## Non-Negotiable Rules (Hard Constraints)
1. One keyword maps to one URL only.
   - You must not assign the same keyword to multiple URLs.
   - This includes near-duplicates and close variants (singular/plural, word order, minor modifiers) that represent the same query intent.
2. No random associations.
   - Do not map a keyword to a URL unless the URL's content clearly matches the product/service/topic expressed by the keyword.
   - Example: “vacuum forming machine” must not be mapped to an “infrared oven” page unless the page is actually about vacuum forming machines.
3. Intent alignment is mandatory.
   - Transactional keywords should map to product, collection/category, or service pages (not unrelated informational pages).
   - Informational keywords should map to guides/blog resources (not pure product pages), unless the page itself is informational.
4. If two URLs could plausibly target the same keyword, you must pick one “canonical target URL” and select an alternative keyword for the other URL(s).
5. If the Ahrefs API fails globally (no data returned or repeated outage responses), stop immediately and report: "Ahrefs API is having issues. please try again in 10 minutes".

## Required Workflow (Follow in Order)
### Step 1: Understand each URL before choosing keywords
For each URL, infer the page topic and page type using:
- URL slug and path
- If accessible in your environment, also use the page title/H1 and primary on-page product/category cues

Classify each URL as one of:
- Homepage / Brand hub
- Category / Collection
- Product / SKU
- Service page
- Blog / Resource

### Step 2: Build a candidate keyword set per URL using Ahrefs
Using Ahrefs Keywords Explorer (for ${targetMarket}), generate candidates that are tightly related to that URL's topic.
For each candidate, collect:
- Search Volume
- Keyword Difficulty
- CPC
- Parent Topic
- Intent (Informational, Commercial, Transactional, Navigational)

### Step 3: Relevance Validation Gate (must pass to be eligible)
A keyword can be assigned to a URL only if BOTH are true:
- Topical match: the keyword describes what the URL is about (product/category/service/topic).
- SERP sanity check: the typical top-ranking pages for that keyword match the URL's page type or offering (use Ahrefs SERP overview as your check).

If you cannot reasonably validate relevance, discard the keyword and choose a more accurate alternative.

### Step 4: Global de-duplication and conflict resolution (anti-cannibalization pass)
After generating candidates across all URLs:
- Create a global list of normalized keywords (treat close variants as duplicates when they share the same intent).
- If a duplicate appears across multiple URLs, resolve it using these tie-breakers in order:
  1) Best topical match to the URL's core offering
  2) Best page-type fit (category for broad head terms; product for highly specific product terms; service page for service terms)
  3) Most specific relevant page wins over broad pages (avoid mapping non-brand keywords to the homepage unless truly appropriate)
- Reassign the losing URL(s) to the next-best non-duplicate keyword that still passes the relevance gate.

### Step 5: Final output formatting check
Before output:
- Confirm there are zero duplicate keywords across different URLs.
- Confirm every row has all required columns populated (Parent Topic can be blank only if unavailable, but try to include it).

## Output Requirement (Strict)
Return ONLY a CSV (no commentary, no markdown) with this exact header and columns:
URL,Keyword,Search Volume,Keyword Difficulty,CPC,Parent Topic,Intent

${formattedUrls ? `\nURLs:\n${formattedUrls}` : ""}`;
};

const prompt3Template = () => `# Keyword Analysis, Scoring & Clustering Prompt

**Context:**
Based on the results of your market investigation, use pandas to filter the attached set of keywords. Look for patterns of all the seed-keywords that fit the core business of my client.

**Instruction:**
Process the attached dataset using the following logic to score, cluster, and format the data.

### 1. Scoring Logic
Calculate a "Keyword Score" for every row to identify the best "Main Keyword" per URL.
* Intent Score: Map Intent column: Transactional (t)/Commercial (c) = 1.0; Informational (i) = 0.5; Navigational (n) = 0.25; Other = 0.5.
* Volume Score: log(1 + Volume) / max(log(1 + Volume)) (Logarithmic normalization).
* Difficulty Score: 1 - (Difficulty / 100) (Inverse difficulty; lower is better).
* CPC Score: Cap at 90th percentile (P90), then calculate CPC / P90.
* Final Formula:
    Score = (Intent x 0.35) + (Volume x 0.30) + (Difficulty x 0.25) + (CPC x 0.10)

### 2. Grouping Logic
* Group by URL: Aggregate all keywords belonging to the same URL.
* Identify Main Keyword: The keyword with the highest "Keyword Score" in the group becomes the Keyword (Main).
* Identify Secondary Keywords: All other keywords for that URL become Keyword_n. Sort them by "Keyword Score" descending.

---

### Output format (VERY IMPORTANT)

Your final answer must be a valid CSV ONLY, with no explanations, commentary, or extra text.

The first row MUST be the header row, exactly as follows:

URL,Keyword,Volume,Difficulty,Keyword_1,Volume_1,Difficulty_1,Keyword_2,Volume_2,Difficulty_2,Keyword_3,Volume_3,Difficulty_3,Keyword_4,Volume_4,Difficulty_4,Keyword_5,Volume_5,Difficulty_5

* If the data contains more than 5 secondary keywords per row, extend this pattern to Keyword_6,Volume_6,Difficulty_6, etc., up to 8 secondary keywords.
* If fewer secondary keywords exist for a row, leave the unused fields blank.

Each subsequent row should represent one unique URL, structured as:

1. URL
2. Keyword (Main Keyword)
3. Volume (Main Keyword)
4. Difficulty (Main Keyword)
5. Keyword_1 (Highest scoring secondary keyword)
6. Volume_1
7. Difficulty_1
8. Keyword_2
9. Volume_2
10. Difficulty_2
11. continuing up to Keyword_n,Volume_n,Difficulty_n

### Data handling rules

* Do NOT change the original keyword text except to trim whitespace.
* Do NOT fabricate any values (volume, difficulty, or keywords). Only use what is present in the CSV.
* If a main keyword has no secondary keywords, still output the row with the primary four fields filled (URL, Keyword, Volume, Difficulty) and leave all Keyword_n fields blank.
* Use a comma as the CSV delimiter and escape any commas inside text values as needed.

### Final requirement

Return ONLY the final consolidated CSV (header + rows) following the structure above, with no additional explanation or formatting.`;

export const promptDefinitions: PromptDefinition[] = [
  {
    id: 'prompt1',
    name: 'Universal Web Research Executive Summary',
    instruction: 'Use after gathering client context; produces an evidence-based executive summary with citations.',
    build: prompt1Template
  },
  {
    id: 'prompt2',
    name: 'Ahrefs Keyword Extraction',
    instruction: 'Pull high-volume, low-competition keywords per URL for the specified market.',
    build: prompt2Template
  },
  {
    id: 'prompt3',
    name: 'Keyword Scoring & Clustering',
    instruction: 'Score and group keywords in pandas to identify the best main and secondary terms per URL.',
    build: prompt3Template
  }
];

export const buildPromptOutputs = (values: FormValues): PromptOutput[] =>
  promptDefinitions.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    instruction: prompt.instruction,
    content: prompt.build(values)
  }));

export const requiredFields: Array<keyof FormValues> = [
  'clientName',
  'clientUrl',
  'targetMarket',
  'keywordUrls'
];
