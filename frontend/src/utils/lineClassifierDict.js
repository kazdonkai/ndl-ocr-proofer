/**
 * Line-level classifier rule dictionary for particle normalization.
 *
 * Rule schema is designed to support Phase 1 (include/exclude binary) and
 * future Phase 2 (modern_score / classical_score weighted model).
 *
 * Fields:
 *   id          - unique string identifier
 *   description - human-readable label (shown in preview UI)
 *   pattern     - RegExp tested against a single line
 *   appliesTo   - granularity ('line'; future: 'word', 'sentence')
 *   enabled     - toggle without removing the rule
 *   priority    - 0–100; higher = evaluated first (used for sorting / display)
 *   ruleType    - 'include' (classical indicator) | 'exclude' (modern indicator)
 *   weight      - 0.0–1.0; Phase 1 informational, Phase 2 score contribution
 *   category    - 'classical' | 'modern' | 'punctuation'
 */

const DICT_STORAGE_KEY = 'ocr_app_line_classifier_rules';

export const INITIAL_RULES = [
  // ── Classical indicators (ruleType: 'include') ────────────────────────────
  // Compound forms evaluated before 候 alone (higher priority = stronger signal)
  {
    id: 'cls_moushisourou',
    description: '申候（古文書定型句）',
    pattern: /申候/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_tsukamatsurisourou',
    description: '仕候（古文書定型句）',
    pattern: /仕候/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_gozasourou',
    description: '御座候（古文書定型句）',
    pattern: /御座候/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_sourounari',
    description: '候也（古文書結語）',
    pattern: /候也/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_souroudokoro',
    description: '候処（古文書定型句）',
    pattern: /候処/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_sourouaida',
    description: '候間（古文書定型句）',
    pattern: /候間/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_kudashioku',
    description: '被下（古文書定型句）',
    pattern: /被下/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_oosetsuke',
    description: '被仰付（古文書定型句）',
    pattern: /被仰付/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_ooidashi',
    description: '被仰出（古文書定型句）',
    pattern: /被仰出/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_subeki',
    description: '可被（古文書定型句）',
    pattern: /可被/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_yorinokudannnogotoshi',
    description: '仍如件（古文書結語）',
    pattern: /仍如件/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_yorishikashite',
    description: '仍而如件（古文書結語）',
    pattern: /仍而如件/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_souin_nashi',
    description: '相違無之（古文書定型句）',
    pattern: /相違無之/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'include',
    weight: 0.9,
    category: 'classical',
  },
  {
    id: 'cls_migi_no_toori',
    description: '右之通（古文書定型句）',
    pattern: /右之通/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'include',
    weight: 0.8,
    category: 'classical',
  },
  {
    id: 'cls_koreniyori',
    description: '依之（古文書接続詞）',
    pattern: /依之/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'include',
    weight: 0.8,
    category: 'classical',
  },
  // ── RECOMMENDED_DEFAULT_DICTIONARY_V2 追加ルール（承認済 2026-05-20） ────────
  // 候なし古文書行の FN 削減と複合句 UI 特定性向上が目的。
  {
    id: 'cls_sourotomo',
    description: '候共（古文書逆接複合句）',
    pattern: /候共/,
    appliesTo: 'line',
    enabled: true,
    priority: 85,
    ruleType: 'include',
    weight: 0.85,
    category: 'classical',
  },
  {
    id: 'cls_iedomo',
    description: '雖（雖モ・雖然・雖トモ — 古文書逆接）',
    pattern: /雖/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'include',
    weight: 0.8,
    category: 'classical',
  },
  {
    id: 'cls_womottecu',
    description: 'ヲ以テ（古文書手段・理由の助詞連語）',
    pattern: /[ヲを]以[テて]/,
    appliesTo: 'line',
    enabled: true,
    priority: 70,
    ruleType: 'include',
    weight: 0.7,
    category: 'classical',
  },
  {
    id: 'cls_moushitate',
    description: '申立候/申立ル/申立テ/申立レ共（古文書出訴・動詞語形）',
    // 名詞用法「申立」単独を除外するため、実コーパスで確認された動詞語形のみを列挙。
    // 候:152件 / ツ?ル:17件(連体形) / テ:3件(連用) / レ(?:共|トモ):8件(已然形+逆接) / ラ:0件→削除
    pattern: /申立(?:候|テ|ツ?ル|レ(?:共|トモ))/,
    appliesTo: 'line',
    enabled: true,
    priority: 65,
    ruleType: 'include',
    weight: 0.65,
    category: 'classical',
  },
  {
    id: 'cls_nitsuki',
    description: 'ニ付（漢字・カタカナ混用助詞）',
    pattern: /ニ付/,
    appliesTo: 'line',
    enabled: true,
    priority: 60,
    ruleType: 'include',
    weight: 0.6,
    category: 'classical',
  },
  {
    id: 'cls_nite',
    description: 'ニ而（漢字・カタカナ混用助詞）',
    pattern: /ニ而/,
    appliesTo: 'line',
    enabled: true,
    priority: 60,
    ruleType: 'include',
    weight: 0.6,
    category: 'classical',
  },
  {
    // 候 alone: weaker than compound forms; listed last so higher-priority
    // compound rules appear first in matched reason display
    id: 'cls_sourou',
    description: '候（古文書敬語語尾）',
    pattern: /候/,
    appliesTo: 'line',
    enabled: true,
    priority: 50,
    ruleType: 'include',
    weight: 0.5,
    category: 'classical',
  },

  // ── Modern indicators (ruleType: 'exclude') ───────────────────────────────
  // Longer / more specific forms listed first (higher priority) to ensure the
  // strongest reason is shown in the preview when multiple rules match.
  {
    id: 'mod_deshita',
    description: 'でした（現代語過去形）',
    pattern: /でした/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'exclude',
    weight: 0.9,
    category: 'modern',
  },
  {
    id: 'mod_mashita',
    description: 'ました（現代語過去形）',
    pattern: /ました/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'exclude',
    weight: 0.9,
    category: 'modern',
  },
  {
    id: 'mod_masen',
    description: 'ません（現代語否定形）',
    pattern: /ません/,
    appliesTo: 'line',
    enabled: true,
    priority: 90,
    ruleType: 'exclude',
    weight: 0.9,
    category: 'modern',
  },
  {
    id: 'mod_deatta',
    description: 'であった（論文調過去形）',
    pattern: /であった/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'exclude',
    weight: 0.8,
    category: 'modern',
  },
  {
    id: 'mod_datta',
    description: 'だった（現代語口語過去形）',
    pattern: /だった/,
    appliesTo: 'line',
    enabled: true,
    priority: 70,
    ruleType: 'exclude',
    weight: 0.7,
    category: 'modern',
  },
  {
    id: 'mod_desu',
    description: 'です（現代語丁寧形）',
    pattern: /です/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'exclude',
    weight: 0.8,
    category: 'modern',
  },
  {
    id: 'mod_masu',
    description: 'ます（現代語丁寧形）',
    pattern: /ます/,
    appliesTo: 'line',
    enabled: true,
    priority: 80,
    ruleType: 'exclude',
    weight: 0.8,
    category: 'modern',
  },
  {
    id: 'mod_dearu',
    description: 'である（論文調断定）',
    pattern: /である/,
    appliesTo: 'line',
    enabled: true,
    priority: 70,
    ruleType: 'exclude',
    weight: 0.7,
    category: 'modern',
  },
  {
    // Weak: 「だ」は誤爆しやすいため weight / priority を低く設定。
    // INCLUDE ルールが同行にあれば上書きされる。
    id: 'mod_da_weak',
    description: 'だ（現代語断定・弱指標）',
    pattern: /だ/,
    appliesTo: 'line',
    enabled: true,
    priority: 30,
    ruleType: 'exclude',
    weight: 0.3,
    category: 'modern',
  },

  // ── Punctuation heuristics ────────────────────────────────────────────────
  {
    // 「。」は modern の弱い指標。強い classical 句が同行にあれば INCLUDE が勝つ。
    id: 'pct_kuten',
    description: '。（句点・近代文書の弱い指標）',
    pattern: /。/,
    appliesTo: 'line',
    enabled: true,
    priority: 30,
    ruleType: 'exclude',
    weight: 0.3,
    category: 'punctuation',
  },
];

/**
 * Classify a single line as 'include', 'exclude', or 'neutral'.
 *
 * Priority: INCLUDE > EXCLUDE.
 * If any include (classical) rule fires, the line is included regardless of
 * exclude matches — this lets strong classical phrases override 「。」 or 「だ」.
 *
 * Returns:
 *   { status: 'include'|'exclude'|'neutral', matchedInclude: Rule[], matchedExclude: Rule[] }
 */
export function classifyLine(line, rules = INITIAL_RULES) {
  const active = rules.filter(r => r.enabled);
  const matchedInclude = active.filter(r => r.ruleType === 'include' && r.pattern.test(line));
  const matchedExclude = active.filter(r => r.ruleType === 'exclude' && r.pattern.test(line));

  if (matchedInclude.length > 0) return { status: 'include', matchedInclude, matchedExclude };
  if (matchedExclude.length > 0) return { status: 'exclude', matchedInclude: [], matchedExclude };
  return { status: 'neutral', matchedInclude: [], matchedExclude: [] };
}

/**
 * Build the set of character positions belonging to non-excluded lines.
 * Used by scanParticleNorm / applyParticleNorm / scanParticleHighlights.
 */
export function buildIncludedPositions(text, rules = INITIAL_RULES) {
  const lines = text.split('\n');
  const included = new Set();
  let offset = 0;
  for (const line of lines) {
    const { status } = classifyLine(line, rules);
    if (status !== 'exclude') {
      for (let i = 0; i < line.length; i++) included.add(offset + i);
    }
    offset += line.length + 1; // +1 for the \n separator
  }
  return included;
}

/**
 * Collect per-line classification results for preview stats.
 * Returns an array of { line, offset, status, matchedInclude, matchedExclude }.
 */
export function classifyLines(text, rules = INITIAL_RULES) {
  const lines = text.split('\n');
  const results = [];
  let offset = 0;
  for (const line of lines) {
    const classification = classifyLine(line, rules);
    results.push({ line, offset, ...classification });
    offset += line.length + 1;
  }
  return results;
}

// ── Persistence stubs (Phase 2: allow user to toggle/reweight rules) ─────────
// RegExp objects cannot be JSON-serialised directly. The persisted payload
// stores only per-rule overrides (enabled, weight, priority); patterns and
// descriptions always come from INITIAL_RULES at runtime.

export function loadRules() {
  try {
    const raw = localStorage.getItem(DICT_STORAGE_KEY);
    if (!raw) return INITIAL_RULES;
    const overrides = JSON.parse(raw); // [{ id, enabled, weight, priority }]
    return INITIAL_RULES.map(rule => {
      const ov = overrides.find(o => o.id === rule.id);
      return ov ? { ...rule, ...ov } : rule;
    });
  } catch {
    return INITIAL_RULES;
  }
}

export function saveRules(rules) {
  try {
    const payload = rules.map(({ id, enabled, weight, priority }) => ({ id, enabled, weight, priority }));
    localStorage.setItem(DICT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore (private browsing, storage full)
  }
}
