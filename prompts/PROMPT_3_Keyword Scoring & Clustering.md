# Keyword Analysis, Scoring & Clustering Prompt

**Context:**
Based on the results of your market investigation, use `pandas` to filter the attached set of keywords. Look for patterns of all the seed-keywords that fit the core business of my client.

**Instruction:**
Process the attached dataset using the following logic to score, cluster, and format the data.

### 1. Scoring Logic
Calculate a "Keyword Score" for every row to identify the best "Main Keyword" per URL.
* **Intent Score:** Map `Intent` column: Transactional (t)/Commercial (c) = `1.0`; Informational (i) = `0.5`; Navigational (n) = `0.25`; Other = `0.5`.
* **Volume Score:** `log(1 + Volume) / max(log(1 + Volume))` (Logarithmic normalization).
* **Difficulty Score:** `1 - (Difficulty / 100)` (Inverse difficulty; lower is better).
* **CPC Score:** Cap at 90th percentile ($P_{90}$), then calculate `CPC / P_{90}`.
* **Final Formula:**
    $$Score = (Intent \times 0.35) + (Volume \times 0.30) + (Difficulty \times 0.25) + (CPC \times 0.10)$$

### 2. Grouping Logic
* **Group by URL:** Aggregate all keywords belonging to the same URL.
* **Identify Main Keyword:** The keyword with the highest "Keyword Score" in the group becomes the `Keyword` (Main).
* **Identify Secondary Keywords:** All other keywords for that URL become `Keyword_n`. Sort them by "Keyword Score" descending.

---

### Output format (VERY IMPORTANT)

Your final answer must be a **valid CSV ONLY**, with **no explanations, commentary, or extra text**.

The **first row MUST be the header row**, exactly as follows:

`URL,Keyword,Volume,Difficulty,Keyword_1,Volume_1,Difficulty_1,Keyword_2,Volume_2,Difficulty_2,Keyword_3,Volume_3,Difficulty_3,Keyword_4,Volume_4,Difficulty_4,Keyword_5,Volume_5,Difficulty_5`

* If the data contains more than 5 secondary keywords per row, extend this pattern to `Keyword_6,Volume_6,Difficulty_6`, etc., **up 8 secondary keywords**.
* If fewer secondary keywords exist for a row, leave the unused fields **blank**.

Each subsequent row should represent **one unique URL**, structured as:

1.  `URL`
2.  `Keyword` (Main Keyword)
3.  `Volume` (Main Keyword)
4.  `Difficulty` (Main Keyword)
5.  `Keyword_1` (Highest scoring secondary keyword)
6.  `Volume_1`
7.  `Difficulty_1`
8.  `Keyword_2`
9.  `Volume_2`
10. `Difficulty_2`
11. … continuing up to `Keyword_n,Volume_n,Difficulty_n`

### Data handling rules

* Do **NOT** change the original keyword text except to trim whitespace.
* Do **NOT** fabricate any values (volume, difficulty, or keywords). Only use what is present in the CSV.
* If a main keyword has **no secondary keywords**, still output the row with the primary four fields filled (`URL, Keyword, Volume, Difficulty`) and leave all `Keyword_n` fields blank.
* Use a **comma** as the CSV delimiter and escape any commas inside text values as needed.

### Final requirement

Return **ONLY** the final consolidated CSV (header + rows) following the structure above, with **no additional explanation or formatting**.