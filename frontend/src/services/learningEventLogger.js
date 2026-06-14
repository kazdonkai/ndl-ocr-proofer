// Phase L-0: Learning event logger (localStorage-backed).
// Collects high-value user operation signals for semi-automatic dictionary improvement.
// Phase L-1 will add a backend flush endpoint to persist events to JSONL.
//
// Call sites in Proofreader.jsx:
//   logParticleNormCancelled  → when setParticleNormConfirm(null) is called WITHOUT executeParticleNorm
//   logParticleNormApplied    → inside executeParticleNorm(), after setParticleNormConfirm(null)
//   logManualUndoParticle     → inside performUndo(), when entry.isParticleNorm === true
//   logDoctypeSwitched        → inside handleDocTypeBadgeClick(), after setManualDocType()

const STORAGE_KEY = 'ocr_app_learning_v0';

// Cancels within 5 s of preview opening are likely misclicks — skip.
const MIN_PREVIEW_MS = 5_000;

function _append(payload) {
  let events;
  try {
    events = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    events = [];
  }
  events.push({ ts: new Date().toISOString(), ...payload });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // localStorage quota exceeded — silently drop
  }
}

// Tier 1 — high-value signals

export function logParticleNormCancelled({ docId, docType, matchCount, previewOpenedAt }) {
  const elapsedMs = previewOpenedAt != null ? Date.now() - previewOpenedAt : null;
  if (elapsedMs != null && elapsedMs < MIN_PREVIEW_MS) return;
  _append({ event: 'particle_norm_cancelled', docId, docType, matchCount, elapsedMs });
}

export function logManualUndoParticle({ docId, docType, pageNum }) {
  _append({ event: 'manual_undo_particle', docId, docType, pageNum });
}

export function logDoctypeSwitched({ docId, prevType, newType, confidence }) {
  _append({ event: 'doctype_switched', docId, prevType, newType, confidence });
}

// Tier 2 — optional weak signal

export function logParticleNormApplied({ docId, docType, matchCount }) {
  _append({ event: 'particle_norm_applied', docId, docType, matchCount });
}

// Tier 2 — span-level skip signal (user dismissed popover without selecting)
// popoverOpenMs: duration popover was open (ms); dismissTrigger: what caused close;
// candidatesViewed: number of candidates displayed in the popover
// rank1FromExperimental: rank1 candidate came from experimental (staging/) dict tier; null → omit
// rank1FromFrontmatter: rank1 candidate was boosted by a frontmatter token; null → omit
export function logSpanSkipped({ docId, spanId, suspectSpan, isDangerous, popoverOpenMs, dismissTrigger, candidatesViewed, rank1FromExperimental, rank1FromFrontmatter }) {
  const payload = { event: 'span_skipped', docId, spanId, suspectSpan, isDangerous, popoverOpenMs, dismissTrigger, candidatesViewed };
  if (rank1FromExperimental != null) payload.rank1FromExperimental = rank1FromExperimental;
  if (rank1FromFrontmatter != null) payload.rank1FromFrontmatter = rank1FromFrontmatter;
  _append(payload);
}

// Tier 2 — top1 candidate rejection (user explicitly rejected the top-ranked candidate)
// reject_target is always "top1" in the initial version; tier is reserved for semi-mode (nullable)
// rank1FromExperimental: rank1 candidate came from experimental (staging/) dict tier; null → omit
// rank1FromFrontmatter: rank1 candidate was boosted by a frontmatter token; null → omit
export function logSpanRejected({ docId, spanId, suspectSpan, isDangerous, rejectedCandidate, tier, rank1FromExperimental, rank1FromFrontmatter }) {
  const payload = { event: 'span_rejected', docId, spanId, suspectSpan, isDangerous, reject_target: 'top1', rejected_candidate: rejectedCandidate, tier: tier ?? null };
  if (rank1FromExperimental != null) payload.rank1FromExperimental = rank1FromExperimental;
  if (rank1FromFrontmatter != null) payload.rank1FromFrontmatter = rank1FromFrontmatter;
  _append(payload);
}

// Tier 1 — span accepted (user selected a candidate from the popover).
// Written to span_accepted.jsonl via the flush endpoint for bigram rule-promotion analysis.
// Fields:
//   wasBigramSuspect       — span came from detect_hira_bigram_suspects (e.g. より→ヨリ)
//   particleScript         — document-level script hint from DocumentStyleHints
//   dismissedDangerFlag    — user chose a candidate despite is_dangerous === true
//   candidateRank          — 0-indexed position of chosenCandidate in candidateList; -1 if manual input
//   hintSource             — populated when chosenCandidate is a soft hint (e.g. "manual_override_seed")
//   rank1FromExperimental  — rank1 candidate came from experimental (staging/) dict tier; null → omit
//   rank1FromFrontmatter   — rank1 candidate was boosted by a frontmatter token; null → omit
export function logSpanAccepted({
  docId, spanId, suspectSpan, chosenCandidate, candidateList,
  wasBigramSuspect, particleScript, dismissedDangerFlag, candidateRank, hintSource, rank1FromExperimental, rank1FromFrontmatter,
}) {
  const payload = {
    event: 'span_accepted',
    docId,
    spanId,
    suspectSpan,
    chosenCandidate,
    candidateList: candidateList ?? [],
    wasBigramSuspect: wasBigramSuspect ?? false,
    particleScript: particleScript ?? null,
    dismissedDangerFlag: dismissedDangerFlag ?? false,
    candidateRank: candidateRank ?? -1,
  };
  if (hintSource != null) payload.hintSource = hintSource;
  if (rank1FromExperimental != null) payload.rank1FromExperimental = rank1FromExperimental;
  if (rank1FromFrontmatter != null) payload.rank1FromFrontmatter = rank1FromFrontmatter;
  _append(payload);
}

// Tier 2 — dictionary setting changed (settings panel toggle)
// reload_result: 'success' | 'error'
export function logDictionarySettingChanged({ key, old_value, new_value, reload_result }) {
  _append({ event: 'dictionary_setting_changed', key, old_value, new_value, reload_result });
}

// Tier 2 — manual selection correction (Phase 1)
// ユーザーが textarea でテキストを選択し、手動訂正ダイアログで書き換えた操作を記録する。
// NOTE: このイベントは user_actions.jsonl に記録されるが、
//       aggregate_experimental.py の A〜I 指標（span 単位の実験的辞書評価）には含まれない。
//       manual_selection_corrected は span 検出とは独立した補正経路のため、
//       span_accepted / span_rejected / span_skipped とは別系統として扱う。
export function logManualSelectionCorrected({ docId, selectedText, correctedText, selectionStart, selectionEnd }) {
  _append({
    event: 'manual_selection_corrected',
    docId,
    selectedText,
    correctedText,
    selectionStart,
    selectionEnd,
  });
}

// ── Read / clear ────────────────────────────────────────────────────────────

export function readLearningEvents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearLearningEvents() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Backend flush (Phase 0-b) ────────────────────────────────────────────────
// POSTs accumulated events to /api/learning/flush, then clears localStorage.
// Call from SettingsSidebar or on app shutdown.

export async function flushToBackend() {
  const events = readLearningEvents();
  if (events.length === 0) return { flushed: 0 };
  const res = await fetch('/api/learning/flush', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    throw new Error(`learning flush failed: ${res.status}`);
  }
  clearLearningEvents();
  return await res.json();
}
