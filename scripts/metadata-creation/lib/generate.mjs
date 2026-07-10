// Deterministic metadata QA/brand-policy/title-scoring logic, ported 1:1
// from app/api/metadata/route.ts. This module intentionally contains no
// AI calls — drafting and rewriting metadata copy is Claude's job (done
// in the skill flow, between calls to this module's CLI wrappers).
// Everything here stays exactly as tuned in the original route (see the
// README changelog entry from 2026-03-09) so the QA behavior is
// unchanged by the webapp -> skill port.

export const TITLE_SOFT_TARGET = 60;
export const TITLE_PREFERRED_MIN = 55;
export const TITLE_PREFERRED_MAX = 65;
export const TITLE_FALLBACK_MAX = 70;
export const TITLE_CORE_MIN = 35;
export const DESCRIPTION_HARD_MAX = 160;
export const BAD_TITLE_ENDINGS = [
  'to', 'for', 'and', 'with', 'of', 'in', 'on', 'at', 'from', 'by', 'after',
  'before', 'into', 'near', 'vs', 'versus', 'without', 'the', 'a', 'an'
];
// AI-rewrite budget: how many times Claude gets to redraft a rejected
// field before the deterministic fallback takes over. Title keeps the
// original 2-attempt budget; description keeps the original 1-attempt
// budget (see finalizeDescription in the pre-port route.ts).
export const TITLE_REWRITE_ATTEMPTS = 2;
export const DESCRIPTION_REWRITE_ATTEMPTS = 1;

export function normalizeWhitespace(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeToken(text) {
  return normalizeWhitespace(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function toPathname(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';

  if (raw.startsWith('/')) {
    return raw.toLowerCase();
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).pathname.toLowerCase() || '/';
  } catch {
    const slashIndex = raw.indexOf('/');
    if (slashIndex >= 0) {
      return raw.slice(slashIndex).toLowerCase();
    }
    return '/';
  }
}

export function normUrl(value) {
  if (!value || !value.trim()) return '';
  let text = value.trim();
  if (!/^https?:\/\//i.test(text)) {
    text = `http://${text}`;
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }

  const params = new URLSearchParams(parsed.search);
  for (const key of Array.from(params.keys())) {
    if (/^(utm_|gclid|fbclid)/i.test(key)) {
      params.delete(key);
    }
  }

  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const search = params.toString();
  const normalized = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${
    search ? `?${search}` : ''
  }`;

  return normalized.replace(/^[a-z]+:\/\//i, '');
}

export function ensureHttpUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function endsWithTerminalPunctuation(text) {
  return /[.!?]['"’”)]?$/.test(normalizeWhitespace(text));
}

export function cleanDetailPhrase(text) {
  let result = normalizeWhitespace(text).replace(/\s*[|\-–—:/&]\s*$/g, '').trim();
  const endingPattern = new RegExp(`\\b(${BAD_TITLE_ENDINGS.join('|')})\\s*$`, 'i');

  while (result && endingPattern.test(result)) {
    result = result.replace(endingPattern, '').trim();
  }

  return result;
}

export function clampDescription(text, maxChars) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return normalized;

  const withinLimit = normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);

  const sentenceMatches = Array.from(withinLimit.matchAll(/[.!?](?=\s|$)/g));
  const lastSentenceEnd = sentenceMatches.length
    ? (sentenceMatches[sentenceMatches.length - 1].index ?? -1) + 1
    : -1;

  let trimmed;
  if (lastSentenceEnd >= Math.floor(maxChars * 0.55)) {
    trimmed = withinLimit.slice(0, lastSentenceEnd);
  } else {
    const lastComma = withinLimit.lastIndexOf(',');
    if (lastComma >= Math.floor(maxChars * 0.55)) {
      trimmed = withinLimit.slice(0, lastComma);
    } else {
      trimmed = /\s\S*$/.test(withinLimit) ? withinLimit.replace(/\s+\S*$/, '') : withinLimit;
    }
    trimmed = cleanDetailPhrase(trimmed);
  }

  trimmed = trimmed.trim();
  if (!trimmed) return trimmed;
  return endsWithTerminalPunctuation(trimmed) ? trimmed : `${trimmed}.`;
}

export function computeBrandPolicy({ url, keyword, brandName }) {
  const pathname = toPathname(url);
  const k = normalizeWhitespace(keyword).toLowerCase();
  const brandCompact = normalizeToken(brandName);
  const keywordCompact = normalizeToken(keyword);

  const isHome = pathname === '/' || pathname === '';

  const commercialPaths = [
    '/product', '/products', '/shop', '/store', '/collections', '/category',
    '/service', '/services', '/solutions', '/pricing'
  ];

  const infoPaths = ['/blog', '/guide', '/guides', '/resources', '/learn', '/faq', '/how-to'];
  const transactionalTerms = ['buy', 'price', 'quote', 'order', 'custom', 'near me', 'shipping'];

  const isCommercial =
    commercialPaths.some((path) => pathname.includes(path)) ||
    transactionalTerms.some((term) => k.includes(term));
  const isInformational = infoPaths.some((path) => pathname.includes(path));
  const isBrandedKeyword = Boolean(brandCompact) && keywordCompact.includes(brandCompact);

  if (isHome) return 'never';
  if (isBrandedKeyword) return 'always';
  if (isCommercial) return 'always';
  if (isInformational) return 'conditional';
  return 'conditional';
}

export function computeCoreTitleChars({ brandPolicy, brandName, bypassBrandSuffix }) {
  const suffix = ` | ${normalizeWhitespace(brandName)}`;
  const reservedBrandLen =
    brandPolicy === 'always' && !bypassBrandSuffix && normalizeWhitespace(brandName) ? suffix.length : 0;

  return {
    preferredCoreTitleChars: Math.max(TITLE_CORE_MIN, TITLE_PREFERRED_MAX - reservedBrandLen),
    fallbackCoreTitleChars: Math.max(TITLE_CORE_MIN, TITLE_FALLBACK_MAX - reservedBrandLen)
  };
}

export function getTargetsFromOptions(options) {
  const targets = [];
  if (options.gen_title) targets.push('title');
  if (options.gen_desc) targets.push('description');
  if (options.gen_h1) targets.push('h1');
  return targets.length ? targets : ['title', 'description', 'h1'];
}

export function enrichMetadataContext(row, targets, brandName, options) {
  const ctxBase = {
    url: row.Address ?? '',
    keyword: row.Keyword ?? '',
    currentTitle: row['Title 1'] ?? '',
    currentDesc: row['Meta Description 1'] ?? '',
    currentH1: row['H1-1'] ?? '',
    brandName: normalizeWhitespace(brandName),
    targets
  };

  const brandPolicy = computeBrandPolicy({
    url: ctxBase.url,
    keyword: ctxBase.keyword,
    brandName: ctxBase.brandName
  });

  const { preferredCoreTitleChars, fallbackCoreTitleChars } = computeCoreTitleChars({
    brandPolicy,
    brandName: ctxBase.brandName,
    bypassBrandSuffix: options.bypass_brand_suffix
  });

  return {
    ...ctxBase,
    brandPolicy,
    preferredCoreTitleChars,
    fallbackCoreTitleChars,
    bypassBrandSuffix: options.bypass_brand_suffix
  };
}

export function stripBrandVariants(title, brandName) {
  const t = normalizeWhitespace(title);
  const b = normalizeWhitespace(brandName);
  if (!t || !b) return t;

  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spacedPattern = escaped.split('').join('\\s*');
  const spacedRe = new RegExp(spacedPattern, 'ig');
  const exactRe = new RegExp(`\\b${escaped}\\b`, 'ig');

  return t
    .replace(exactRe, '')
    .replace(spacedRe, '')
    .replace(/\s+\|\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function getSeoTokens(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function getSignificantKeywordTokens(text) {
  return getSeoTokens(text).filter((token) => !['a', 'an', 'the'].includes(token));
}

export function countOrderedMatches(candidateTokens, keywordTokens) {
  if (!keywordTokens.length) return 0;
  let keywordIndex = 0;
  let matches = 0;

  for (const token of candidateTokens) {
    if (token === keywordTokens[keywordIndex]) {
      matches += 1;
      keywordIndex += 1;
      if (keywordIndex >= keywordTokens.length) break;
    }
  }

  return matches;
}

export function getKeywordCoverage(title, keyword) {
  const keywordTokens = getSignificantKeywordTokens(keyword);
  if (!keywordTokens.length) return 1;

  const candidateTokens = getSignificantKeywordTokens(title);
  const matched = countOrderedMatches(candidateTokens, keywordTokens);
  return matched / keywordTokens.length;
}

export function hasStrongKeywordFidelity(title, keyword) {
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  const normalizedKeyword = normalizeWhitespace(keyword).toLowerCase();
  if (!normalizedKeyword) return true;
  if (normalizedTitle.includes(normalizedKeyword)) return true;

  const keywordTokens = getSignificantKeywordTokens(keyword);
  if (!keywordTokens.length) return true;

  const coverage = getKeywordCoverage(title, keyword);
  const minimumCoverage = keywordTokens.length <= 4 ? 1 : 0.85;
  return coverage >= minimumCoverage;
}

export function hasDanglingSeparator(title) {
  return /\s*[|\-–—:/&]\s*$/.test(normalizeWhitespace(title));
}

export function hasDisconnectedKeywordClause(title, keyword) {
  const normalizedKeyword = normalizeWhitespace(keyword).toLowerCase();
  if (!normalizedKeyword) return false;

  // Splits only on a colon or a spaced dash (" - "), not on hyphens inside
  // compound words/model numbers like "B-500SF" or "N-Cal-Mag". A keyword
  // leading the title ("Keyword - Detail") still reads as one phrase; a
  // keyword stapled on as the trailing clause ("Detail: keyword") doesn't.
  const segments = normalizeWhitespace(title)
    .split(/\s+[-–—]\s+|:\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) return false;
  return segments[segments.length - 1].toLowerCase() === normalizedKeyword;
}

export function endsWithBadTitleEnding(title) {
  const endings = BAD_TITLE_ENDINGS.join('|');
  return new RegExp(`\\b(${endings})\\s*$`, 'i').test(normalizeWhitespace(title));
}

export function hasUnmatchedPunctuation(title) {
  const text = normalizeWhitespace(title);
  const doubleQuotes = (text.match(/"/g) ?? []).length;
  const singleQuotes = (text.match(/'/g) ?? []).length;
  const openParens = (text.match(/\(/g) ?? []).length;
  const closeParens = (text.match(/\)/g) ?? []).length;
  const openBrackets = (text.match(/\[/g) ?? []).length;
  const closeBrackets = (text.match(/\]/g) ?? []).length;

  return (
    doubleQuotes % 2 !== 0 ||
    singleQuotes % 2 !== 0 ||
    openParens !== closeParens ||
    openBrackets !== closeBrackets
  );
}

export function countBrandMentions(title, brandName) {
  const normalizedBrand = normalizeWhitespace(brandName);
  if (!normalizedBrand) return 0;

  const escaped = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRe = new RegExp(`\\b${escaped}\\b`, 'ig');
  return normalizeWhitespace(title).match(exactRe)?.length ?? 0;
}

export function getSlugHint(url) {
  const path = toPathname(url);
  const parts = path.split('/').map((segment) => segment.trim()).filter(Boolean);
  const slug = parts[parts.length - 1] ?? '';
  return slug.replace(/[-_]+/g, ' ').trim();
}

export function hasDifferentiator(title, context) {
  const titleTokens = new Set(getSeoTokens(title));
  const keywordTokens = new Set(getSeoTokens(context.keyword));
  const hintSources = [normalizeWhitespace(context.currentH1), getSlugHint(context.url)];

  for (const source of hintSources) {
    for (const token of getSeoTokens(source)) {
      if (token.length > 2 && !keywordTokens.has(token) && titleTokens.has(token)) {
        return true;
      }
    }
  }

  return false;
}

export function buildValidationMessages(codes) {
  return codes.map((code) => {
    switch (code) {
      case 'too_short':
        return `Keep the final title at least ${TITLE_PREFERRED_MIN} characters unless you can add a real differentiator.`;
      case 'too_long':
        return `Keep the final title at ${TITLE_FALLBACK_MAX} characters or fewer without clipping wording.`;
      case 'thin_intent':
        return 'Expand the title with a page-specific differentiator from the slug or H1 so the keyword intent stays specific.';
      case 'missing_keyword':
        return 'Stay tightly aligned to the primary keyword and preserve its full intent.';
      case 'incomplete_ending':
        return 'Do not end with a clipped phrase, trailing preposition, conjunction, or article.';
      case 'dangling_separator':
        return 'Do not end with a dangling separator such as "|", "-", ":", "/", or "&".';
      case 'unmatched_punctuation':
        return 'Close any open punctuation and keep the title as one complete thought.';
      case 'brand_mismatch':
        return 'Apply the brand policy exactly once and use the exact suffix format only when required.';
      case 'disconnected_keyword_clause':
        return 'Do not staple the keyword on as its own clause after a colon or dash (e.g. "Product Name: keyword"). Weave it into the title as a real grammatical part of the phrase instead.';
      default:
        return '';
    }
  });
}

export function validateTitleCandidate(title, context) {
  const normalizedTitle = normalizeWhitespace(title);
  const codes = [];
  const keywordCoverage = getKeywordCoverage(normalizedTitle, context.keyword);
  const titleHasDifferentiator = hasDifferentiator(normalizedTitle, context);
  const normalizedBrand = normalizeWhitespace(context.brandName);
  const brandSuffix = normalizedBrand ? ` | ${normalizedBrand}` : '';
  const brandMentions = countBrandMentions(normalizedTitle, normalizedBrand);
  const coreTitleForEndingChecks =
    brandSuffix && normalizedTitle.endsWith(brandSuffix)
      ? normalizedTitle.slice(0, Math.max(0, normalizedTitle.length - brandSuffix.length)).trim()
      : normalizedTitle;

  if (!normalizedTitle || normalizedTitle.length < TITLE_PREFERRED_MIN) {
    codes.push('too_short');
  }
  if (normalizedTitle.length > TITLE_FALLBACK_MAX) {
    codes.push('too_long');
  }
  if (normalizedTitle.length < TITLE_PREFERRED_MIN && !titleHasDifferentiator) {
    codes.push('thin_intent');
  }
  if (!hasStrongKeywordFidelity(normalizedTitle, context.keyword)) {
    codes.push('missing_keyword');
  }
  if (endsWithBadTitleEnding(coreTitleForEndingChecks)) {
    codes.push('incomplete_ending');
  }
  if (hasDanglingSeparator(coreTitleForEndingChecks) || hasDanglingSeparator(normalizedTitle)) {
    codes.push('dangling_separator');
  }
  if (hasDisconnectedKeywordClause(coreTitleForEndingChecks, context.keyword)) {
    codes.push('disconnected_keyword_clause');
  }
  if (hasUnmatchedPunctuation(normalizedTitle)) {
    codes.push('unmatched_punctuation');
  }

  if (context.brandPolicy === 'never' && brandMentions > 0) {
    codes.push('brand_mismatch');
  }
  if (!context.bypassBrandSuffix && normalizedBrand) {
    if (context.brandPolicy === 'always') {
      if (!normalizedTitle.endsWith(brandSuffix) || brandMentions !== 1) {
        codes.push('brand_mismatch');
      }
    } else if (context.brandPolicy === 'conditional') {
      if (brandMentions > 1 || (brandMentions === 1 && !normalizedTitle.endsWith(brandSuffix))) {
        codes.push('brand_mismatch');
      }
    }
  }

  const uniqueCodes = Array.from(new Set(codes));
  const accepted = uniqueCodes.length === 0;
  const band =
    accepted && normalizedTitle.length <= TITLE_PREFERRED_MAX
      ? 'preferred'
      : accepted && normalizedTitle.length <= TITLE_FALLBACK_MAX
        ? 'fallback'
        : 'rejected';

  return {
    accepted,
    band,
    title: normalizedTitle,
    codes: uniqueCodes,
    messages: buildValidationMessages(uniqueCodes),
    keywordCoverage,
    hasDifferentiator: titleHasDifferentiator
  };
}

export function buildTitlePolicyCandidates(title, context) {
  const normalizedTitle = normalizeWhitespace(title);
  if (!normalizedTitle) return [''];

  const normalizedBrand = normalizeWhitespace(context.brandName);
  const core =
    !context.bypassBrandSuffix || context.brandPolicy === 'never'
      ? stripBrandVariants(normalizedTitle, normalizedBrand)
      : normalizedTitle;

  if (!normalizedBrand || context.brandPolicy === 'never') {
    return [core || normalizedTitle];
  }
  if (context.bypassBrandSuffix) {
    return [normalizedTitle];
  }

  const withBrand = normalizeWhitespace(`${core} | ${normalizedBrand}`);
  if (context.brandPolicy === 'always') {
    return [withBrand];
  }

  return Array.from(new Set([withBrand, core].filter(Boolean)));
}

export function scoreTitleValidation(result) {
  const bandScore = result.band === 'preferred' ? 100 : result.band === 'fallback' ? 90 : 0;
  const distanceScore = Math.max(0, 20 - Math.abs(result.title.length - TITLE_SOFT_TARGET));
  const keywordScore = Math.round(result.keywordCoverage * 10);
  const differentiatorScore = result.hasDifferentiator ? 5 : 0;
  const penalty = result.codes.length * 15;
  return bandScore + distanceScore + keywordScore + differentiatorScore - penalty;
}

export function resolveTitleCandidate(title, context) {
  const validations = buildTitlePolicyCandidates(title, context).map((candidate) =>
    validateTitleCandidate(candidate, context)
  );

  return validations.sort((left, right) => scoreTitleValidation(right) - scoreTitleValidation(left))[0];
}

export function combineKeywordAndDetail(keyword, detail) {
  if (!keyword) return detail;
  if (!detail) return keyword;

  return /^(for|after|before|with|without|in|on|near|around|vs|versus)\b/i.test(detail)
    ? `${keyword} ${detail}`
    : `${keyword} for ${detail}`;
}

const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via', 'with'
]);

export function toTitleCase(text) {
  const words = normalizeWhitespace(text).split(' ');
  return words
    .map((word, index) => {
      if (!word) return word;
      // Leave words that already carry a capital (e.g. from an H1) untouched;
      // only fix fully lowercase fragments pulled from a URL slug.
      if (/[A-Z]/.test(word)) return word;
      const isEdge = index === 0 || index === words.length - 1;
      if (!isEdge && TITLE_CASE_MINOR_WORDS.has(word.toLowerCase())) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function buildDeterministicTitleCandidates(context, seedTitle) {
  const keyword = normalizeWhitespace(context.keyword);
  const detailPhrases = Array.from(
    new Set(
      [context.currentH1, getSlugHint(context.url)]
        .map((value) => toTitleCase(cleanDetailPhrase(value)))
        .filter(Boolean)
        .filter((value) => !keyword.toLowerCase().includes(value.toLowerCase()))
    )
  );

  const candidates = [
    normalizeWhitespace(seedTitle),
    ...detailPhrases.map((detail) => normalizeWhitespace(`${keyword} ${detail}`)),
    ...detailPhrases.map((detail) => normalizeWhitespace(combineKeywordAndDetail(keyword, detail))),
    ...detailPhrases.map((detail) => normalizeWhitespace(`${detail} With ${keyword}`)),
    keyword
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

export function validateDescriptionCandidate(text, enforceLength) {
  const normalized = normalizeWhitespace(text);
  const codes = [];

  if (!normalized) {
    return { accepted: false, text: normalized, codes };
  }

  if (enforceLength && normalized.length > DESCRIPTION_HARD_MAX) {
    codes.push('too_long');
  }
  if (endsWithBadTitleEnding(normalized)) {
    codes.push('incomplete_ending');
  }
  if (hasDanglingSeparator(normalized)) {
    codes.push('dangling_separator');
  }
  if (!endsWithTerminalPunctuation(normalized)) {
    codes.push('missing_terminal_punctuation');
  }

  return { accepted: codes.length === 0, text: normalized, codes };
}

export function repairDanglingTitleEnding(title, context) {
  const repairedCore = cleanDetailPhrase(stripBrandVariants(title, context.brandName));
  if (!repairedCore) {
    return validateTitleCandidate(title, context);
  }
  return resolveTitleCandidate(repairedCore, context);
}

export function repairDisconnectedKeywordClause(title, context) {
  const keyword = normalizeWhitespace(context.keyword);
  const keywordLower = keyword.toLowerCase();
  const core = stripBrandVariants(title, context.brandName);
  const segments = normalizeWhitespace(core)
    .split(/\s+[-–—]\s+|:\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const detailSegment = segments.find((segment) => segment.toLowerCase() !== keywordLower);
  if (!detailSegment) {
    return validateTitleCandidate(title, context);
  }

  // Merge the keyword and the remaining detail into one phrase instead of
  // leaving them as separate clauses split by a colon or dash.
  return resolveTitleCandidate(normalizeWhitespace(`${keyword} ${detailSegment}`), context);
}

// Deterministic title fallback used once the AI-rewrite budget is spent
// and the title still doesn't pass QA. Mirrors the tail of the original
// finalizeTitle(): try slug/H1-derived candidates, then targeted repairs
// for the two most common failure modes, and ship whatever scores best
// even if it still doesn't fully pass (same as production today).
export function finalizeTitleDeterministic(best, context) {
  if (best.accepted) return best;

  const deterministic = buildDeterministicTitleCandidates(context, best.title)
    .map((candidate) => resolveTitleCandidate(candidate, context))
    .sort((left, right) => scoreTitleValidation(right) - scoreTitleValidation(left))[0];

  if (deterministic && scoreTitleValidation(deterministic) > scoreTitleValidation(best)) {
    best = deterministic;
  }

  if (!best.accepted && best.codes.includes('disconnected_keyword_clause')) {
    const repaired = repairDisconnectedKeywordClause(best.title, context);
    if (repaired.accepted || scoreTitleValidation(repaired) > scoreTitleValidation(best)) {
      best = repaired;
    }
  }

  if (!best.accepted && (best.codes.includes('incomplete_ending') || best.codes.includes('dangling_separator'))) {
    const repaired = repairDanglingTitleEnding(best.title, context);
    if (repaired.accepted || scoreTitleValidation(repaired) > scoreTitleValidation(best)) {
      best = repaired;
    }
  }

  return best;
}
