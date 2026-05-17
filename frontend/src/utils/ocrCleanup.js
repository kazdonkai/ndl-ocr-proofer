/**
 * Rule-based OCR noise cleanup (Part 13).
 * Only removes patterns that are unambiguously garbage.
 * Single punctuation marks are never touched.
 */

export const CLEANUP_RULES = [
  {
    id: 'consecutive_square',
    description: '連続する □ 記号',
    // 2+ consecutive □ — a single □ may represent a legitimate unknown char
    pattern: /□{2,}/g,
    replaceWith: '',
  },
  {
    id: 'symbol_garbage',
    description: '記号ゴミ列（・.、の混在）',
    // 3+ chars composed entirely of ・ . 、 — single or double are left alone
    pattern: /[・.、]{3,}/g,
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
