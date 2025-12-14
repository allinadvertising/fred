# Ahrefs Keyword Extraction Prompt

**Input Parameter:**
* **Target Market:** 

**Instruction:**
Based on the results of your market investigation, use Ahrefs Keywords Explorer, generate a list of high search volume, low competition keywords relevant to the attached list of URLs for the **{TARGET_MARKET}**.

**Output Requirement:**
The desired output is a **CSV file** containing the following specific columns:
1.  `URL` (The specific page the keyword maps to)
2.  `Keyword`
3.  `Search Volume`
4.  `Keyword Difficulty`
5.  `CPC` (Cost Per Click)
6.  `Parent Topic` (Optional, but helpful for grouping)
7.  `Intent` (Must be classified as Informational, Commercial, Transactional, or Navigational)

**Note:** Ensure all columns are populated, as `Intent` and `CPC` are strictly required for downstream scoring calculations.