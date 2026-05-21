/**
 * Rule-based OCR noise cleanup (Part 13).
 * Only removes patterns that are unambiguously garbage.
 * Single punctuation marks are never touched.
 */

export const CLEANUP_RULES = [
  {
    id: 'consecutive_square',
    description: '連続する □ 記号',
    pattern: /□{2,}/g,
    replaceWith: '',
  },
  {
    id: 'symbol_garbage',
    description: '記号ゴミ列（・.、の混在）',
    pattern: /[・.、]{3,}/g,
    replaceWith: '',
  },
  {
    id: 'consecutive_ellipsis',
    description: '連続する … 記号（水平省略記号）',
    // U+2026 が2個以上連続するのは明確なOCRノイズ
    pattern: /…{2,}/g,
    replaceWith: '',
  },
  {
    id: 'consecutive_dots_wide',
    description: '連続する点列（。・…などの混在3文字以上）',
    pattern: /[。・…．｡]{3,}/g,
    replaceWith: '',
  },
];

/**
 * Scan `text` for cleanup candidates.
 * Returns { total, rules: [{ id, description, count, examples }] }
 */
export function detectCleanupCandidates(text) {
  const ruleResults = [];
  let total = 0;
  for (const rule of CLEANUP_RULES) {
    const matches = [...text.matchAll(rule.pattern)];
    if (matches.length > 0) {
      ruleResults.push({
        id: rule.id,
        description: rule.description,
        count: matches.length,
        examples: matches.slice(0, 3).map(m => m[0]),
      });
      total += matches.length;
    }
  }
  return { total, rules: ruleResults };
}

/**
 * Apply all cleanup rules to `text` and return the cleaned string.
 */
export function applyCleanup(text) {
  let result = text;
  for (const rule of CLEANUP_RULES) {
    result = result.replace(rule.pattern, rule.replaceWith);
  }
  return result;
}

/**
 * Return flat array of every match across all rules (used to build cleanup correction log).
 */
export function detectCleanupMatches(text) {
  const entries = [];
  for (const rule of CLEANUP_RULES) {
    const matches = [...text.matchAll(rule.pattern)];
    matches.forEach((match, idx) => {
      entries.push({ ruleId: rule.id, matchedText: match[0], occurrenceIndex: idx });
    });
  }
  return entries;
}
