import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import './Proofreader.css';
import { detectCleanupCandidates, applyCleanup, detectCleanupMatches } from '../utils/ocrCleanup.js';
import { classifyLine, buildIncludedPositions, classifyLines, INITIAL_RULES } from '../utils/lineClassifierDict.js';
import ProposalsPanel from './ProposalsPanel.jsx';
import {
  logParticleNormCancelled,
  logParticleNormApplied,
  logManualUndoParticle,
  logDoctypeSwitched,
  logSpanSkipped,
  logSpanRejected,
  logSpanAccepted,
} from '../services/learningEventLogger.js';

const DEFAULT_KB = { nextSpan: 'n', prevSpan: 'p', openSpan: 'Enter' };

function getKanaLabel(str) {
  const hasHiragana = /[ぁ-ゖ]/.test(str);
  const hasKatakana = /[ァ-ヶ]/.test(str);
  if (hasHiragana && !hasKatakana) return 'ひらがな';
  if (hasKatakana && !hasHiragana) return 'カタカナ';
  return null;
}

// ── All-hiragana → katakana bulk conversion utilities ────────────────────────
function countHiraAll(text) {
  return (text.match(/[ぁ-ん]/g) || []).length;
}

/** ひらがな文字ごとの出現数集計（上位 N 件をダイアログ表示に使用） */
function scanHiraAll(text) {
  const freq = {};
  for (const c of text) {
    const code = c.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) freq[c] = (freq[c] || 0) + 1;
  }
  return Object.entries(freq)
    .map(([hira, count]) => ({ hira, kata: String.fromCharCode(hira.charCodeAt(0) + 0x60), count }))
    .sort((a, b) => b.count - a.count);
}

/** 全ひらがな → カタカナ変換を適用 */
function applyHiraAll(text) {
  return text.replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// ── Particle normalization utilities (P6 / line-aware) ───────────────────────
const _KANJI_KATA_CLS = '[一-龠々ァ-ヶ]';
const _PARTICLE_DEFS = [
  { hira: 'に', kata: 'ニ', re: new RegExp(`(?<=${_KANJI_KATA_CLS})(に)(?=${_KANJI_KATA_CLS})`, 'g') },
  { hira: 'を', kata: 'ヲ', re: new RegExp(`(?<=${_KANJI_KATA_CLS})(を)(?=${_KANJI_KATA_CLS})`, 'g') },
  { hira: 'は', kata: 'ハ', re: new RegExp(`(?<=${_KANJI_KATA_CLS})(は)(?=${_KANJI_KATA_CLS})`, 'g') },
];

// Compound expressions where hiragana particles should NOT be converted.
function _buildExcludedPositions(text) {
  const excluded = new Set();
  const pat = /において|における|について|については|につき|にて|にも|には|または|あるいは|はじめ|はなく|はもと|はもちろん|をもって|をめぐって|をめぐる/g;
  let m;
  while ((m = pat.exec(text)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) excluded.add(i);
  }
  return excluded;
}

/**
 * Scan for particle normalisation candidates, respecting line-level classification.
 *
 * Returns:
 *   {
 *     particles : [{ hira, kata, count, samples }],
 *     lineStats : {
 *       total            : number,   // all lines (including blank)
 *       included         : number,   // explicit classical indicator
 *       excluded         : number,   // modern/punctuation indicator (no classical override)
 *       neutral          : number,   // no indicator — treated as included in classical doc
 *       excludedLineReasons: [{ linePreview, rules: string[] }],  // up to 5 samples
 *     }
 *   }
 *
 * "included" lines (status !== 'exclude') have their character positions added
 * to the scan window. The existing compound-expression exclusion still applies
 * within included lines.
 */
function scanParticleNorm(text, rules = INITIAL_RULES) {
  const lineData = classifyLines(text, rules);
  const includedPositions = new Set();
  let includedCount = 0;
  let excludedCount = 0;
  let neutralCount = 0;
  const excludedLineReasons = [];

  for (const { line, offset, status, matchedExclude } of lineData) {
    if (status === 'exclude') {
      excludedCount++;
      if (excludedLineReasons.length < 5) {
        excludedLineReasons.push({
          linePreview: line.length > 22 ? line.slice(0, 22) + '…' : line,
          rules: matchedExclude
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 2)
            .map(r => r.description),
        });
      }
    } else {
      if (status === 'include') includedCount++;
      else neutralCount++;
      for (let i = 0; i < line.length; i++) includedPositions.add(offset + i);
    }
  }

  const phraseExcluded = _buildExcludedPositions(text);
  const particles = [];

  for (const { hira, kata, re } of _PARTICLE_DEFS) {
    const pat = new RegExp(re.source, 'g');
    const hits = [];
    let m;
    while ((m = pat.exec(text)) !== null) {
      if (!phraseExcluded.has(m.index) && includedPositions.has(m.index)) hits.push(m.index);
    }
    if (hits.length === 0) continue;
    const samples = hits.slice(0, 3).map(idx => {
      const start = Math.max(0, idx - 4);
      const end = Math.min(text.length, idx + 1 + 4);
      return text.slice(start, idx) + `【${hira}】` + text.slice(idx + 1, end);
    });
    particles.push({ hira, kata, count: hits.length, samples });
  }

  return {
    particles,
    lineStats: {
      total: lineData.length,
      included: includedCount,
      excluded: excludedCount,
      neutral: neutralCount,
      excludedLineReasons,
    },
  };
}

function applyParticleNorm(text, rules = INITIAL_RULES) {
  const includedPositions = buildIncludedPositions(text, rules);
  const phraseExcluded = _buildExcludedPositions(text);
  let result = text;
  for (const { kata, re } of _PARTICLE_DEFS) {
    const pat = new RegExp(re.source, 'g');
    result = result.replace(pat, (match, _p1, offset) => {
      if (phraseExcluded.has(offset) || !includedPositions.has(offset)) return match;
      return kata;
    });
  }
  return result;
}

function scanParticleHighlights(text, rules = INITIAL_RULES) {
  const includedPositions = buildIncludedPositions(text, rules);
  const phraseExcluded = _buildExcludedPositions(text);
  const spans = [];
  for (const { hira, kata, re } of _PARTICLE_DEFS) {
    const pat = new RegExp(re.source, 'g');
    let m;
    while ((m = pat.exec(text)) !== null) {
      if (!phraseExcluded.has(m.index) && includedPositions.has(m.index)) {
        spans.push({ id: `particle_${hira}_${m.index}`, start: m.index, end: m.index + m[0].length, hira, kata });
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
// ────────────────────────────────────────────────────────────────────────

const Proofreader = forwardRef(function Proofreader({ document, currentPage, viewMode, onDocumentChange, onOcrChange, isOcrRunning, runOcr, runOcrPage, onCorrectionAccepted, keybindings = DEFAULT_KB, onNextPage, onPrevPage, onRemoveLastCorrection, onBulkSetPageCorrections }, ref) {
  const [fullContent, setFullContent] = useState(document?.markdown_content || '');
  const [ocrContent, setOcrContent] = useState('');
  const [mode, setMode] = useState('preview'); // 'preview' = 疑義箇所チェック, 'edit' = エディタ
  const [analyzedSpans, setAnalyzedSpans] = useState([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [activeSpanId, setActiveSpanId] = useState(null);
  const [inputError, setInputError] = useState(null);
  const [writingMode, setWritingMode] = useState('horizontal'); // 'horizontal' | 'vertical'
  // キーボードナビゲーション: analyzedSpans 内の現在位置
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  // ポップオーバー内で 1-9 で選択中の候補インデックス
  const [popoverCandidateIndex, setPopoverCandidateIndex] = useState(-1);
  const [blinkingSpanId, setBlinkingSpanId] = useState(null);
  // Undo / Redo 用履歴スタック
  const [historyStack, setHistoryStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  // 表示フィルタ: 'all' | 'uncorrected' | 'corrected'
  const [displayFilter, setDisplayFilter] = useState('all');

  // resizable right sidebar
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [sectionsOpen, setSectionsOpen] = useState({ corrections: true, proposals: true });
  const [activeTab, setActiveTab] = useState('corrections');
  const [processingDropdownOpen, setProcessingDropdownOpen] = useState(false);
  const [sectionSplitPx, setSectionSplitPx] = useState(null);
  // 一括補正確認ダイアログ状態 — { suspect_span, candidate, candidateRank, targetSpans } | null
  const [changeAllConfirm, setChangeAllConfirm] = useState(null);
  // ノイズ除去確認ダイアログ状態 — { total, rules } | null
  const [cleanupConfirm, setCleanupConfirm] = useState(null);
  // P6: ドキュメント種別・助詞正規化状態
  const [docType, setDocType] = useState('unknown');
  const [docTypeConfidence, setDocTypeConfidence] = useState(0);
  const [docTypeSource, setDocTypeSource] = useState('heuristic');
  // Phase 1-b: 助詞書体スタイルヒント
  const [documentStyleHints, setDocumentStyleHints] = useState(null);
  // document-level doc type: classical wins; used as fallback for insufficient_text pages
  const [documentDocType, setDocumentDocType] = useState('unknown');
  // ユーザー手動オーバーライド: null | 'modern' | 'classical'
  const [manualDocType, setManualDocType] = useState(null);
  // 助詞正規化確認ダイアログ — [{hira, kata, count, samples}] | null
  const [particleNormConfirm, setParticleNormConfirm] = useState(null);
  // 助詞ハイライトスパン — 古文書モード時に ocrContent から自動計算
  const [particleHighlightSpans, setParticleHighlightSpans] = useState([]);

  // import 処理中フラグ
  const [isImporting, setIsImporting] = useState(false);

  // manualDocType が最優先。ページ判定が unknown なら文書レベルの型を使う
  const effectiveDocType = useMemo(() => {
    if (manualDocType) return manualDocType;
    if (docType !== 'unknown') return docType;
    if (documentDocType !== 'unknown') return documentDocType;
    return 'unknown';
  }, [manualDocType, docType, documentDocType]);

  // 助詞正規化候補件数: preview/apply と同一ロジックで算出し count と表示の一致を保証 (P1)
  const particleNormCount = useMemo(
    () => effectiveDocType === 'classical'
      ? scanParticleNorm(ocrContent).particles.reduce((n, p) => n + p.count, 0)
      : 0,
    [ocrContent, effectiveDocType]
  );

  // 全ひらがな→カタカナ一括変換: カタカナ優勢文書でのみ件数を算出
  const hiraAllCount = useMemo(
    () => documentStyleHints?.particle_script === 'katakana_dominant'
      ? countHiraAll(ocrContent)
      : 0,
    [ocrContent, documentStyleHints]
  );
  // 一括変換確認ダイアログ状態 — null | { count, chars: [{hira, kata, count}] }
  const [hiraAllConfirm, setHiraAllConfirm] = useState(null);
  // 一括変換ログ — 補正一覧に summary 行として表示する { pageNum, count }[]
  const [hiraAllNormLog, setHiraAllNormLog] = useState([]);

  const textareaRef = useRef(null);
  const highlightLayerRef = useRef(null);
  // stale closure を避けるため最新の handleCandidateSelect / performUndo / performRedo / importCorrections を常に ref に保持
  const handleCandidateSelectRef = useRef(null);
  const performUndoRef = useRef(null);
  const performRedoRef = useRef(null);
  const importCorrectionsRef = useRef(null);
  const popoverOpenedAtRef = useRef(null);
  const popoverDragOffsetRef = useRef({ x: 0, y: 0 });
  const popoverIsDraggingRef = useRef(false);
  // manualDocType auto-trigger 用: ocrContent の最新値を stale closure なしに参照する
  const ocrContentRef = useRef(ocrContent);
  // manualDocType の直前値を追跡し modern→classical 遷移のみ検知する
  const prevManualDocTypeRef = useRef(null);
  const sidebarRef = useRef(null);
  const processingDropdownRef = useRef(null);
  const correctionsRef = useRef(null);
  const sidebarInnerRef = useRef(null);
  // particle norm preview open timestamp — for logParticleNormCancelled elapsed calc
  const particleNormPreviewOpenedAtRef = useRef(null);
  // debounce timer for re-analysis after manual textarea edits
  const analyzeDebounceRef = useRef(null);

  // writingMode 切替時にスクロール残留値をリセット
  useEffect(() => {
    const editor = textareaRef.current;
    const layer = editor?.parentElement?.querySelector('.highlight-layer');
    if (!editor || !layer) return;
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
    layer.scrollTop = 0;
    layer.scrollLeft = 0;
  }, [writingMode]);

  // cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (analyzeDebounceRef.current) clearTimeout(analyzeDebounceRef.current);
    };
  }, []);

  // ocrContentRef を常に最新値に同期（manualDocType 発火時の stale closure 対策）
  useEffect(() => { ocrContentRef.current = ocrContent; }, [ocrContent]);

  // ポップオーバー状態 — { spanId, span, x, y } | null
  const [popover, setPopover] = useState(null);
  // 手動入力バッファ（ポップオーバーが開いている間のみ有効）
  const [manualInput, setManualInput] = useState('');
  // 確定済み補正（P4 で実書き換えに昇格予定）
  const [acceptedCorrections, setAcceptedCorrections] = useState({});
  // ページ別補正済みOCRテキストキャッシュ（ページ再訪時に補正結果を復元するため）
  const [pageOcrTextCache, setPageOcrTextCache] = useState({});
  // ページ別補正済みスパンキャッシュ（ページ再訪時に再解析をスキップして復元するため）
  const [pageAnalyzedSpansCache, setPageAnalyzedSpansCache] = useState({});

  // 現在ページの補正済みスパン一覧（review panel 用）
  const reviewItems = useMemo(() =>
    analyzedSpans.filter(sp => acceptedCorrections[sp.id] !== undefined),
    [analyzedSpans, acceptedCorrections]
  );

  // フィルタに応じたスパン一覧（stable reference — useMemo）
  const filteredSpans = useMemo(() => {
    if (displayFilter === 'all') return analyzedSpans;
    if (displayFilter === 'corrected') return analyzedSpans.filter(sp => acceptedCorrections[sp.id] !== undefined);
    return analyzedSpans.filter(sp => acceptedCorrections[sp.id] === undefined);
  }, [analyzedSpans, acceptedCorrections, displayFilter]);

  const currentPageData = document?.ocr_pages?.[currentPage];
  const currentPageHasOcrText = !!(currentPageData?.ocr_text?.trim());
  const currentPageHasImage = !!(
    currentPageData?.image_path ||
    currentPageData?.image_name ||
    document?.image_paths?.[currentPage]
  );
  const totalOcrPages = document?.ocr_pages?.length ?? 0;
  const pagesWithOcr = document?.ocr_pages?.filter(p => p.ocr_text?.trim()).length ?? 0;

  // ドキュメントが変わったら全体をリセット
  useEffect(() => {
    if (document) {
      setFullContent(document.markdown_content || '');
    }
  }, [document?.doc_id, document?.markdown_content]);

  // ドキュメント切替時のみ補正状態をリセット（ページ切替・viewMode切替では保持する）
  useEffect(() => {
    if (document) {
      setAcceptedCorrections({});
      setPageOcrTextCache({});
      setPageAnalyzedSpansCache({});
      setPopover(null);
      setHistoryStack([]);
      setRedoStack([]);
      setDocType('unknown');
      setDocTypeConfidence(0);
      setDocTypeSource('heuristic');
      setDocumentDocType('unknown');
      // doc切替時: 手動オーバーライドと preview を必ずリセット
      setManualDocType(null);
      setParticleNormConfirm(null);
    }
  }, [document?.doc_id]);

  // ページ切替・ドキュメント切替でキーボードナビゲーション位置と開いている preview をリセット
  useEffect(() => {
    setKeyboardIndex(-1);
    setPopoverCandidateIndex(-1);
    setParticleNormConfirm(null);
    // pending re-analysis from manual edits is no longer relevant after page/doc change
    if (analyzeDebounceRef.current) {
      clearTimeout(analyzeDebounceRef.current);
      analyzeDebounceRef.current = null;
    }
  }, [document?.doc_id, currentPage]);

  // フィルタ変更時もキーボードインデックスをリセット
  useEffect(() => {
    setKeyboardIndex(-1);
  }, [displayFilter]);

  // 現在ページのOCRテキストを取得する関数
  const getCurrentOcrText = () => {
    if (!document?.ocr_pages?.length) return '';
    // 両モード共通: 現在ページのテキストを表示（スクロール連動対応）
    const page = document.ocr_pages[currentPage];
    return page?.ocr_text || '';
  };

  // ページ切替 or ドキュメント変更時にOCRテキストを更新して解析
  useEffect(() => {
    if (document) {
      const cached = pageOcrTextCache[currentPage];
      const ocrText = cached ?? getCurrentOcrText();
      setOcrContent(ocrText);
      if (cached !== undefined) {
        // 補正済みキャッシュがあれば再解析せずスパンも復元する（①②の修正）
        setAnalyzedSpans(pageAnalyzedSpansCache[currentPage] ?? []);
      } else {
        analyzeText(ocrText, document.ocr_json, true, false);
      }
    }
  // viewMode は除外: 表示モード切替だけで再解析しない（ocrContent/analyzedSpans はページ単位で保持）
  }, [document?.doc_id, document?.markdown_content, currentPage]);

  // preserveContent=true のとき、バックエンドの normalized_content で ocrContent を上書きしない
  const analyzeText = async (text, ocr, isInitialLoad, preserveContent = false) => {
    if (!text) {
      setAnalyzedSpans([]);
      setPopover(null);
      return;
    }
    setPopover(null);
    setLoadingAnalysis(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown_content: text, ocr_json: ocr, frontmatter: document?.frontmatter ?? null })
      });
      const data = await response.json();
      if (!preserveContent && (isInitialLoad || mode === 'preview')) {
        setOcrContent(data.normalized_content || text);
      }
      const pageNum = currentPage + 1;
      setAnalyzedSpans((data.results || []).map(r => ({
        id: `p${pageNum}_o${r.occurrence_index}_s${r.start}`,
        ...r
      })));
      // P6: capture doc type and particle normalization info
      const newDocType = data.doc_type || 'unknown';
      const newConf = data.doc_type_confidence || 0;
      setDocType(newDocType);
      setDocTypeConfidence(newConf);
      setDocTypeSource(data.doc_type_source || 'heuristic');
      setDocumentStyleHints(data.document_style_hints ?? null);
      if (newDocType !== 'unknown') {
        // classical を優先。同率なら初回判定を維持
        setDocumentDocType(curr => (newDocType === 'classical' || curr === 'unknown') ? newDocType : curr);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // ─── キーボードナビゲーション ───────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'preview') return;

    const isAnyInputFocused = () => {
      const tag = window.document.activeElement?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' ||
        window.document.activeElement?.isContentEditable;
    };
    const isManualInputFocused = () =>
      window.document.activeElement?.classList?.contains('manual-input');

    const scrollToSpan = (span) => {
      const el = highlightLayerRef.current?.querySelector(`[data-span-id="${span.id}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // highlight-layer の scrollTop/Left を textarea に同期
      setTimeout(() => {
        if (!textareaRef.current || !highlightLayerRef.current) return;
        if (writingMode === 'vertical') {
          textareaRef.current.scrollLeft = highlightLayerRef.current.scrollLeft;
        } else {
          textareaRef.current.scrollTop = highlightLayerRef.current.scrollTop;
        }
      }, 150);
    };

    const openPopoverForSpan = (span) => {
      const el = highlightLayerRef.current?.querySelector(`[data-span-id="${span.id}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const popoverW = 280, popoverH = 300, margin = 8;
      let x, y;
      if (writingMode === 'vertical') {
        x = rect.left - popoverW - margin;
        if (x < 10) x = rect.right + margin;
        x = Math.min(x, window.innerWidth - popoverW - 10);
        x = Math.max(10, x);
        y = rect.top;
        if (y + popoverH > window.innerHeight - 10) y = window.innerHeight - popoverH - 10;
        y = Math.max(10, y);
      } else {
        x = Math.min(rect.left, window.innerWidth - popoverW - 10);
        x = Math.max(10, x);
        y = rect.bottom + margin;
        if (y + popoverH > window.innerHeight - 10) y = rect.top - popoverH - margin;
        y = Math.max(10, y);
      }
      setPopover({ spanId: span.id, span, x, y });
      popoverOpenedAtRef.current = Date.now();
      setActiveSpanId(span.id);
      setManualInput('');
      setPopoverCandidateIndex(-1);
    };

    const handler = (e) => {
      if (popover) {
        // Esc は常に閉じる
        if (e.key === 'Escape') {
          e.preventDefault();
          dismissPopover('escape');
          return;
        }
        // 手動入力欄にフォーカス中は他のポップオーバーショートカットを無効化
        if (isManualInputFocused()) return;
        // Enter: 現在選択中候補を確定（未選択なら先頭）
        if (e.key === 'Enter') {
          e.preventDefault();
          const candidates = popover.span.candidates || [];
          const idx = popoverCandidateIndex >= 0 ? popoverCandidateIndex : 0;
          if (idx < candidates.length) {
            handleCandidateSelectRef.current?.(candidates[idx], idx);
          }
          setPopoverCandidateIndex(-1);
          return;
        }
        // 1〜9: 候補を選択して確定
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault();
          const idx = parseInt(e.key, 10) - 1;
          const candidates = popover.span.candidates || [];
          if (idx < candidates.length) {
            setPopoverCandidateIndex(idx);
            handleCandidateSelectRef.current?.(candidates[idx], idx);
          }
          return;
        }
        return; // ポップオーバー表示中は他のキーをブロック
      }

      // ポップオーバーなし — ナビゲーションショートカット（入力中は無効化）
      if (isAnyInputFocused()) return;

      const isNext = e.key === keybindings.nextSpan || (keybindings.nextSpan !== 'j' && e.key === 'j');
      const isPrev = e.key === keybindings.prevSpan || (keybindings.prevSpan !== 'k' && e.key === 'k');
      const isOpen = e.key === keybindings.openSpan;

      if (isNext) {
        e.preventDefault();
        if (filteredSpans.length === 0) { onNextPage?.(); return; }
        if (keyboardIndex >= filteredSpans.length - 1) { onNextPage?.(); return; }
        const nextIdx = keyboardIndex < 0 ? 0 : keyboardIndex + 1;
        setKeyboardIndex(nextIdx);
        setActiveSpanId(filteredSpans[nextIdx].id);
        scrollToSpan(filteredSpans[nextIdx]);
      } else if (isPrev) {
        e.preventDefault();
        if (filteredSpans.length === 0) { onPrevPage?.(); return; }
        if (keyboardIndex === 0) { onPrevPage?.(); return; }
        const prevIdx = keyboardIndex < 0 ? filteredSpans.length - 1 : keyboardIndex - 1;
        setKeyboardIndex(prevIdx);
        setActiveSpanId(filteredSpans[prevIdx].id);
        scrollToSpan(filteredSpans[prevIdx]);
      } else if (isOpen) {
        e.preventDefault();
        if (keyboardIndex >= 0 && keyboardIndex < filteredSpans.length) {
          openPopoverForSpan(filteredSpans[keyboardIndex]);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, popover, filteredSpans, keyboardIndex, popoverCandidateIndex, writingMode, keybindings, onNextPage, onPrevPage]);

  // ポップオーバードラッグ — ヘッダーを掴んで移動できる
  // isDragging / offset を ref で管理し、mousemove ごとに setPopover だけ呼ぶ（re-render は最小限）
  useEffect(() => {
    const onMove = (e) => {
      if (!popoverIsDraggingRef.current) return;
      const { x: ox, y: oy } = popoverDragOffsetRef.current;
      setPopover(prev => prev ? { ...prev, x: e.clientX - ox, y: e.clientY - oy } : null);
    };
    const onUp = () => { popoverIsDraggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Ctrl+Z (Undo) / Ctrl+Shift+Z (Redo) — ref 経由で常に最新の関数を呼ぶ
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndoRef.current?.();
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        performRedoRef.current?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!processingDropdownOpen) return;
    const handler = (e) => {
      if (!processingDropdownRef.current?.contains(e.target)) setProcessingDropdownOpen(false);
    };
    window.document.addEventListener('mousedown', handler);
    return () => window.document.removeEventListener('mousedown', handler);
  }, [processingDropdownOpen]);
  // ────────────────────────────────────────────────────────────────────────

  const handleTextChange = (e) => {
    const val = e.target.value;
    if (mode === 'preview') {
      const oldText = ocrContent;

      // Locate the edit region by finding common prefix and suffix lengths.
      // This lets us shift spans that lie after the edit without a full re-parse.
      let editStart = 0;
      const minLen = Math.min(oldText.length, val.length);
      while (editStart < minLen && oldText[editStart] === val[editStart]) editStart++;

      let oldEnd = oldText.length;
      let newEnd = val.length;
      while (oldEnd > editStart && newEnd > editStart && oldText[oldEnd - 1] === val[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      const delta = newEnd - oldEnd; // positive = inserted, negative = deleted

      // Shift spans after the edit; drop spans that overlap the changed region.
      const newSpans = analyzedSpans.reduce((acc, sp) => {
        if (sp.end <= editStart) {
          acc.push(sp);
        } else if (sp.start >= oldEnd) {
          acc.push({ ...sp, start: sp.start + delta, end: sp.end + delta });
        }
        // spans overlapping [editStart, oldEnd) are invalidated — omit them
        return acc;
      }, []);

      setOcrContent(val);
      setAnalyzedSpans(newSpans);

      const pageNum = currentPage + 1; // 常に 1-indexed
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        setInputError(`無効なページ番号 (${pageNum}) のため保存できません`);
        return;
      }
      setInputError(null);
      if (onOcrChange) onOcrChange(val, pageNum);

      // Debounce re-analysis so markers refresh after the user pauses typing (1.5 s).
      if (analyzeDebounceRef.current) clearTimeout(analyzeDebounceRef.current);
      analyzeDebounceRef.current = setTimeout(() => {
        analyzeText(val, document?.ocr_json, false, true);
      }, 1500);
    } else {
      setFullContent(val);
      if (onDocumentChange) onDocumentChange(val);
    }
  };

  // スパン要素の getBoundingClientRect() 基準でポップオーバーを配置する
  const handleSpanClick = (e, span) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverW = 280;
    const popoverH = 300;
    const margin = 8;

    let x, y;

    if (writingMode === 'vertical') {
      // 縦書き: スパンの左隣を第一候補、左に収まらなければ右隣
      x = rect.left - popoverW - margin;
      if (x < 10) x = rect.right + margin;
      x = Math.min(x, window.innerWidth - popoverW - 10);
      x = Math.max(10, x);

      y = rect.top;
      if (y + popoverH > window.innerHeight - 10) y = window.innerHeight - popoverH - 10;
      y = Math.max(10, y);
    } else {
      // 横書き: スパンの下側、収まらなければ上側
      x = Math.min(rect.left, window.innerWidth - popoverW - 10);
      x = Math.max(10, x);

      y = rect.bottom + margin;
      if (y + popoverH > window.innerHeight - 10) y = rect.top - popoverH - margin;
      y = Math.max(10, y);
    }

    setPopover({ spanId: span.id, span, x, y });
    popoverOpenedAtRef.current = Date.now();
    setActiveSpanId(span.id);
    setManualInput('');
    setPopoverCandidateIndex(-1);
    // マウスクリック時もキーボードインデックスを同期しておく（続けて n/p ナビできるように）
    const idx = filteredSpans.findIndex(s => s.id === span.id);
    if (idx >= 0) setKeyboardIndex(idx);
  };

  // 候補未選択でポップオーバーを閉じる（skip ログ付き）
  // trigger: "overlay" | "close_btn" | "escape" | "reject"
  const dismissPopover = (trigger = 'overlay') => {
    if (popover && !acceptedCorrections[popover.spanId]) {
      const popoverOpenMs = popoverOpenedAtRef.current != null
        ? Date.now() - popoverOpenedAtRef.current
        : null;
      logSpanSkipped({
        docId: document?.doc_id ?? '',
        spanId: popover.spanId,
        suspectSpan: popover.span.suspect_span,
        isDangerous: popover.span.is_dangerous ?? false,
        popoverOpenMs,
        dismissTrigger: trigger,
        candidatesViewed: popover.span.candidates?.length ?? 0,
      });
    }
    setPopover(null);
    setPopoverCandidateIndex(-1);
  };

  // top1 候補の却下: 補正は適用せず、ログのみ記録してポップオーバーを閉じる
  // reject_target は常に "top1"（span全体の否定ではなく、先頭候補1件の却下）
  const handleRejectTop1 = () => {
    if (!popover) return;
    const candidates = popover.span.candidates || [];
    const top1 = candidates[0] ?? null;
    logSpanRejected({
      docId: document?.doc_id ?? '',
      spanId: popover.spanId,
      suspectSpan: popover.span.suspect_span,
      isDangerous: popover.span.is_dangerous ?? false,
      rejectedCandidate: top1,
      tier: null,
    });
    dismissPopover('reject');
  };

  // ポップオーバーヘッダーのドラッグ開始
  const handlePopoverDragStart = (e) => {
    if (e.target.closest('.btn-icon')) return; // ×ボタン上では発火しない
    e.preventDefault();
    popoverDragOffsetRef.current = { x: e.clientX - popover.x, y: e.clientY - popover.y };
    popoverIsDraggingRef.current = true;
  };

  // P5: offset ベース置換 — popover.span.start/end を使い該当1箇所だけを置換する
  // candidateRank: 候補リスト上の 0-indexed 番号。手動入力の場合は -1。
  const handleCandidateSelect = (candidate, candidateRank) => {
    if (!popover) return;
    const { start, end } = popover.span;
    const newOcr = ocrContent.slice(0, start) + candidate + ocrContent.slice(end);
    const delta = candidate.length - (end - start);

    logSpanAccepted({
      docId: document?.doc_id ?? '',
      spanId: popover.spanId,
      suspectSpan: popover.span.suspect_span,
      chosenCandidate: candidate,
      candidateList: popover.span.candidates ?? [],
      wasBigramSuspect: popover.span.is_bigram_suspect ?? false,
      particleScript: documentStyleHints?.particle_script ?? null,
      dismissedDangerFlag: (popover.span.is_dangerous ?? false) && candidateRank !== -1,
      candidateRank,
      hintSource: popover.span.soft_hint_candidates?.[candidate] ?? null,
    });

    const newSpans = analyzedSpans
      .filter(sp => {
        if (sp.id === popover.spanId) return candidate !== '';
        // 削除時: 削除範囲内に収まるサブスパンも除去 (別検出器の重複スパンによるずれを防止)
        if (candidate === '' && sp.start >= start && sp.end <= end) return false;
        return true;
      })
      .map(sp => {
        if (sp.id === popover.spanId) return { ...sp, end: start + candidate.length };
        if (sp.start >= end) return { ...sp, start: sp.start + delta, end: sp.end + delta };
        return sp;
      });
    const newAccepted = { ...acceptedCorrections, [popover.spanId]: candidate };
    const newCache = { ...pageOcrTextCache, [currentPage]: newOcr };
    const newSpansCache = { ...pageAnalyzedSpansCache, [currentPage]: newSpans };
    const pageNum = currentPage + 1;

    const correctionEntry = {
      spanId: popover.spanId,
      suspect_span: popover.span.suspect_span,
      chosen: candidate,
      candidate_rank: candidateRank,
      is_manual_input: candidateRank === -1,
      correction_mode: 'single',
    };

    // Undo 用スナップショットを履歴に積む（新規補正は redo スタックをクリア）
    setHistoryStack(prev => [...prev, {
      before: { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache },
      after: { ocrContent: newOcr, analyzedSpans: newSpans, acceptedCorrections: newAccepted, pageOcrTextCache: newCache, pageAnalyzedSpansCache: newSpansCache },
      page: currentPage,
      pageNum,
      spanId: popover.spanId,
      correctionEntry,
    }]);
    setRedoStack([]);

    setOcrContent(newOcr);
    setAnalyzedSpans(newSpans);
    setAcceptedCorrections(newAccepted);
    setPageOcrTextCache(newCache);
    setPageAnalyzedSpansCache(newSpansCache);

    if (Number.isInteger(pageNum) && pageNum >= 1) {
      if (onOcrChange) onOcrChange(newOcr, pageNum);
      if (onCorrectionAccepted) onCorrectionAccepted(correctionEntry, pageNum);
    }
    setPopover(null);
    setActiveSpanId(null); // 補正確定後はアクティブ選択を解除（④の修正）
  };
  // キーボードハンドラから最新の handleCandidateSelect を参照できるよう毎レンダーで更新
  handleCandidateSelectRef.current = handleCandidateSelect;

  // 一括補正: 確認ダイアログを開く（未補正の同一語が2件以上の場合のみ呼ばれる）
  const handleChangeAll = (candidate, candidateRank) => {
    if (!popover) return;
    const targetSpans = analyzedSpans.filter(sp =>
      sp.suspect_span === popover.span.suspect_span &&
      acceptedCorrections[sp.id] === undefined
    );
    setChangeAllConfirm({ suspect_span: popover.span.suspect_span, candidate, candidateRank, targetSpans });
  };

  // 一括補正: 確認後に実行
  const executeChangeAll = () => {
    if (!changeAllConfirm) return;
    const { suspect_span, candidate, candidateRank, targetSpans } = changeAllConfirm;
    const sorted = [...targetSpans].sort((a, b) => a.start - b.start);

    let workOcr = ocrContent;
    let workSpans = [...analyzedSpans];
    let workAccepted = { ...acceptedCorrections };
    const correctionEntries = [];
    const spanIds = [];

    for (const target of sorted) {
      const live = workSpans.find(sp => sp.id === target.id);
      if (!live) continue;
      const { start, end } = live;
      const delta = candidate.length - (end - start);
      workOcr = workOcr.slice(0, start) + candidate + workOcr.slice(end);
      workSpans = workSpans
        .filter(sp => {
          if (sp.id === live.id) return candidate !== '';
          if (candidate === '' && sp.start >= start && sp.end <= end) return false;
          return true;
        })
        .map(sp => {
          if (sp.id === live.id) return { ...sp, end: start + candidate.length };
          if (sp.start >= end) return { ...sp, start: sp.start + delta, end: sp.end + delta };
          return sp;
        });
      workAccepted = { ...workAccepted, [live.id]: candidate };
      correctionEntries.push({
        spanId: live.id,
        suspect_span,
        chosen: candidate,
        candidate_rank: candidateRank,
        is_manual_input: candidateRank === -1,
        correction_mode: 'change_all',
      });
      spanIds.push(live.id);
    }

    const newCache = { ...pageOcrTextCache, [currentPage]: workOcr };
    const newSpansCache = { ...pageAnalyzedSpansCache, [currentPage]: workSpans };
    const pageNum = currentPage + 1;

    setHistoryStack(prev => [...prev, {
      before: { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache },
      after: { ocrContent: workOcr, analyzedSpans: workSpans, acceptedCorrections: workAccepted, pageOcrTextCache: newCache, pageAnalyzedSpansCache: newSpansCache },
      page: currentPage,
      pageNum,
      isBatch: true,
      spanIds,
      correctionEntries,
    }]);
    setRedoStack([]);

    setOcrContent(workOcr);
    setAnalyzedSpans(workSpans);
    setAcceptedCorrections(workAccepted);
    setPageOcrTextCache(newCache);
    setPageAnalyzedSpansCache(newSpansCache);

    if (Number.isInteger(pageNum) && pageNum >= 1) {
      if (onOcrChange) onOcrChange(workOcr, pageNum);
      correctionEntries.forEach(entry => {
        if (onCorrectionAccepted) onCorrectionAccepted(entry, pageNum);
      });
    }

    setChangeAllConfirm(null);
    setPopover(null);
    setActiveSpanId(null);
  };

  // ─── Noise Cleanup ──────────────────────────────────────────────────────
  const handleCleanupPreview = () => {
    const preview = detectCleanupCandidates(ocrContent);
    setCleanupConfirm(preview);
  };

  const executeCleanup = () => {
    if (!cleanupConfirm) return;
    const pageNum = currentPage + 1;

    // Build cleanup correction log entries before applying (offsets still valid here)
    const cleanupMatches = detectCleanupMatches(ocrContent);
    const cleanupEntries = cleanupMatches.map(m => ({
      spanId: `cleanup_p${pageNum}_${m.ruleId}_${m.occurrenceIndex}`,
      span_id: `cleanup_p${pageNum}_${m.ruleId}_${m.occurrenceIndex}`,
      suspect_span: m.matchedText,
      original_text: m.matchedText,
      chosen: '',
      candidate_rank: -1,
      is_manual_input: false,
      occurrence_index: m.occurrenceIndex,
      correction_mode: 'cleanup',
      cleanup_rule: m.ruleId,
    }));

    const newOcr = applyCleanup(ocrContent);

    // Remove accepted corrections for the current page (their offsets are now invalid)
    const pagePrefix = `p${pageNum}_`;
    const newAccepted = Object.fromEntries(
      Object.entries(acceptedCorrections).filter(([key]) => !key.startsWith(pagePrefix))
    );
    const newCache = { ...pageOcrTextCache, [currentPage]: newOcr };
    const newSpansCache = { ...pageAnalyzedSpansCache, [currentPage]: [] };

    setHistoryStack(prev => [...prev, {
      before: { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache },
      after: { ocrContent: newOcr, analyzedSpans: [], acceptedCorrections: newAccepted, pageOcrTextCache: newCache, pageAnalyzedSpansCache: newSpansCache },
      page: currentPage,
      pageNum,
      isCleanup: true,
      cleanupEntries,
      cleanupSpanIds: cleanupEntries.map(e => e.span_id),
    }]);
    setRedoStack([]);

    setOcrContent(newOcr);
    setAnalyzedSpans([]);
    setAcceptedCorrections(newAccepted);
    setPageOcrTextCache(newCache);
    setPageAnalyzedSpansCache(newSpansCache);

    if (Number.isInteger(pageNum) && pageNum >= 1) {
      if (onOcrChange) onOcrChange(newOcr, pageNum);
      cleanupEntries.forEach(e => {
        if (onCorrectionAccepted) onCorrectionAccepted(e, pageNum);
      });
    }
    analyzeText(newOcr, document?.ocr_json, false, true);

    setCleanupConfirm(null);
    setPopover(null);
  };
  // ────────────────────────────────────────────────────────────────────────

  // 古文書モード時に ocrContent が変わるたびに助詞ハイライトを再計算
  useEffect(() => {
    if (mode === 'preview' && effectiveDocType === 'classical') {
      setParticleHighlightSpans(scanParticleHighlights(ocrContent));
    } else {
      setParticleHighlightSpans([]);
    }
  }, [ocrContent, effectiveDocType, mode]);

  // ─── Doc type badge toggle ────────────────────────────────────────────────
  const handleDocTypeBadgeClick = () => {
    if (effectiveDocType === 'modern') {
      setManualDocType('classical');
      logDoctypeSwitched({ docId: document?.doc_id ?? '', prevType: 'modern', newType: 'classical', confidence: docTypeConfidence });
    } else if (effectiveDocType === 'classical') {
      setManualDocType('modern');
      logDoctypeSwitched({ docId: document?.doc_id ?? '', prevType: 'classical', newType: 'modern', confidence: docTypeConfidence });
    }
  };

  // modern → classical へ手動切替したときに助詞統一 preview を自動で開く
  useEffect(() => {
    if (manualDocType !== 'classical') {
      prevManualDocTypeRef.current = manualDocType;
      return;
    }
    const prev = prevManualDocTypeRef.current;
    prevManualDocTypeRef.current = 'classical';
    // 遷移が classical→classical（再マウントなど）でなければ発火
    if (prev !== 'classical') {
      const result = scanParticleNorm(ocrContentRef.current);
      if (result.particles.length > 0) {
        particleNormPreviewOpenedAtRef.current = Date.now();
        setParticleNormConfirm(result);
      }
      // 候補 0 件の場合は何もしない（要件 3）
    }
  }, [manualDocType]);
  // ────────────────────────────────────────────────────────────────────────

  // ─── Particle Normalization ──────────────────────────────────────────────
  const handleParticleNormPreview = () => {
    const result = scanParticleNorm(ocrContent);
    particleNormPreviewOpenedAtRef.current = Date.now();
    setParticleNormConfirm(result);
  };

  const handleParticleNormCancel = () => {
    const matchCount = particleNormConfirm?.particles?.reduce((n, p) => n + p.count, 0) ?? 0;
    logParticleNormCancelled({
      docId: document?.doc_id ?? '',
      docType: effectiveDocType,
      matchCount,
      previewOpenedAt: particleNormPreviewOpenedAtRef.current,
    });
    setParticleNormConfirm(null);
  };

  const executeParticleNorm = () => {
    if (!particleNormConfirm) return;
    const pageNum = currentPage + 1;
    const newOcr = applyParticleNorm(ocrContent);

    const pagePrefix = `p${pageNum}_`;
    const newAccepted = Object.fromEntries(
      Object.entries(acceptedCorrections).filter(([key]) => !key.startsWith(pagePrefix))
    );
    const newCache = { ...pageOcrTextCache, [currentPage]: newOcr };
    const newSpansCache = { ...pageAnalyzedSpansCache, [currentPage]: [] };

    setHistoryStack(prev => [...prev, {
      before: { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache },
      after: { ocrContent: newOcr, analyzedSpans: [], acceptedCorrections: newAccepted, pageOcrTextCache: newCache, pageAnalyzedSpansCache: newSpansCache },
      page: currentPage,
      pageNum,
      isParticleNorm: true,
    }]);
    setRedoStack([]);

    setOcrContent(newOcr);
    setAnalyzedSpans([]);
    setAcceptedCorrections(newAccepted);
    setPageOcrTextCache(newCache);
    setPageAnalyzedSpansCache(newSpansCache);

    if (Number.isInteger(pageNum) && pageNum >= 1) {
      if (onOcrChange) onOcrChange(newOcr, pageNum);
    }
    analyzeText(newOcr, document?.ocr_json, false, true);

    logParticleNormApplied({
      docId: document?.doc_id ?? '',
      docType: effectiveDocType,
      matchCount: particleNormCount,
    });
    setParticleNormConfirm(null);
    setPopover(null);
  };
  // ────────────────────────────────────────────────────────────────────────

  // ─── 全ひらがな→カタカナ一括変換 ──────────────────────────────────────────
  const handleHiraAllNormPreview = () => {
    const chars = scanHiraAll(ocrContent);
    setHiraAllConfirm({ count: chars.reduce((n, c) => n + c.count, 0), chars });
  };

  const executeHiraAllNorm = () => {
    if (!hiraAllConfirm) return;
    const pageNum = currentPage + 1;
    const convertedCount = hiraAllConfirm.count;
    const newOcr = applyHiraAll(ocrContent);
    const pagePrefix = `p${pageNum}_`;
    const newAccepted = Object.fromEntries(
      Object.entries(acceptedCorrections).filter(([key]) => !key.startsWith(pagePrefix))
    );
    const newCache = { ...pageOcrTextCache, [currentPage]: newOcr };
    const newSpansCache = { ...pageAnalyzedSpansCache, [currentPage]: [] };

    setHistoryStack(prev => [...prev, {
      before: { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache },
      after: { ocrContent: newOcr, analyzedSpans: [], acceptedCorrections: newAccepted, pageOcrTextCache: newCache, pageAnalyzedSpansCache: newSpansCache },
      page: currentPage,
      pageNum,
      isHiraAllNorm: true,
      hiraAllCount: convertedCount,
    }]);
    setRedoStack([]);
    setHiraAllNormLog(prev => [...prev, { pageNum, count: convertedCount }]);

    setOcrContent(newOcr);
    setAnalyzedSpans([]);
    setAcceptedCorrections(newAccepted);
    setPageOcrTextCache(newCache);
    setPageAnalyzedSpansCache(newSpansCache);

    if (Number.isInteger(pageNum) && pageNum >= 1) {
      if (onOcrChange) onOcrChange(newOcr, pageNum);
    }
    analyzeText(newOcr, document?.ocr_json, false, true);
    setHiraAllConfirm(null);
    setPopover(null);
  };
  // ────────────────────────────────────────────────────────────────────────

  // ─── Undo / Redo ────────────────────────────────────────────────────────
  const performUndo = () => {
    if (historyStack.length === 0) return;
    const entry = historyStack[historyStack.length - 1];
    setHistoryStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, entry]);
    setAcceptedCorrections(entry.before.acceptedCorrections);
    setPageOcrTextCache(entry.before.pageOcrTextCache);
    setPageAnalyzedSpansCache(entry.before.pageAnalyzedSpansCache);
    if (entry.page === currentPage) {
      setOcrContent(entry.before.ocrContent);
      setAnalyzedSpans(entry.before.analyzedSpans);
    }
    // App 側の pageEdits / pageCorrections を巻き戻す
    if (entry.isImport) {
      // import 対象の全ページを import 前の状態に戻す
      const restoreData = {};
      (entry.importPageNums || []).forEach(pageNum => {
        restoreData[pageNum] = entry.beforePageCorrections?.[pageNum] ?? [];
      });
      if (onBulkSetPageCorrections) onBulkSetPageCorrections(restoreData);
      (entry.importPageNums || []).forEach(pageNum => {
        const beforeOcr = entry.before.pageOcrTextCache[pageNum - 1]
          ?? document?.ocr_pages?.[pageNum - 1]?.ocr_text ?? '';
        if (onOcrChange) onOcrChange(beforeOcr, pageNum);
      });
    } else {
      const beforeOcr = entry.before.pageOcrTextCache[entry.page]
        ?? document?.ocr_pages?.[entry.page]?.ocr_text ?? '';
      if (onOcrChange) onOcrChange(beforeOcr, entry.pageNum);
      if (entry.isBatch) {
        entry.spanIds.forEach(spanId => {
          if (onRemoveLastCorrection) onRemoveLastCorrection(entry.pageNum, spanId);
        });
      } else if (entry.isCleanup) {
        (entry.cleanupSpanIds || []).forEach(spanId => {
          if (onRemoveLastCorrection) onRemoveLastCorrection(entry.pageNum, spanId);
        });
      } else if (entry.isParticleNorm) {
        // particle norm adds no individual corrections — nothing to remove
        logManualUndoParticle({ docId: document?.doc_id ?? '', docType: effectiveDocType, pageNum: entry.pageNum });
      } else if (entry.isHiraAllNorm) {
        setHiraAllNormLog(prev => {
          const idx = prev.map(e => e.pageNum).lastIndexOf(entry.pageNum);
          return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
        });
      } else {
        if (onRemoveLastCorrection) onRemoveLastCorrection(entry.pageNum, entry.spanId);
      }
    }
    setPopover(null);
  };
  performUndoRef.current = performUndo;

  const performRedo = () => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setHistoryStack(prev => [...prev, entry]);
    setAcceptedCorrections(entry.after.acceptedCorrections);
    setPageOcrTextCache(entry.after.pageOcrTextCache);
    setPageAnalyzedSpansCache(entry.after.pageAnalyzedSpansCache);
    if (entry.page === currentPage) {
      setOcrContent(entry.after.ocrContent);
      setAnalyzedSpans(entry.after.analyzedSpans);
      if (entry.isCleanup || entry.isParticleNorm || entry.isHiraAllNorm) {
        analyzeText(entry.after.ocrContent, document?.ocr_json, false, true);
      }
    }
    // App 側の pageEdits / pageCorrections を再適用
    if (entry.isImport) {
      if (onBulkSetPageCorrections) onBulkSetPageCorrections(entry.afterPageCorrections ?? {});
      (entry.importPageNums || []).forEach(pageNum => {
        const afterOcr = entry.after.pageOcrTextCache[pageNum - 1] ?? '';
        if (onOcrChange) onOcrChange(afterOcr, pageNum);
      });
    } else {
      if (onOcrChange) onOcrChange(entry.after.ocrContent, entry.pageNum);
      if (entry.isCleanup) {
        (entry.cleanupEntries || []).forEach(e => {
          if (onCorrectionAccepted) onCorrectionAccepted(e, entry.pageNum);
        });
      } else if (entry.isParticleNorm) {
        // particle norm adds no individual corrections — nothing to notify
      } else if (entry.isHiraAllNorm) {
        setHiraAllNormLog(prev => [...prev, { pageNum: entry.pageNum, count: entry.hiraAllCount ?? 0 }]);
      } else if (entry.isBatch) {
        entry.correctionEntries.forEach(ce => {
          if (onCorrectionAccepted) onCorrectionAccepted(ce, entry.pageNum);
        });
      } else {
        if (onCorrectionAccepted) onCorrectionAccepted(entry.correctionEntry, entry.pageNum);
      }
    }
    setPopover(null);
  };
  performRedoRef.current = performRedo;

  // ─── Import corrections ─────────────────────────────────────────────────
  // rows: export 形式の補正ログ行配列（doc_id フィルタ・必須フィールド検証済み）
  // beforePageCorrections: App.jsx の pageCorrections（import 前スナップショット、Undo 復元用）
  const importCorrections = async (rows, beforePageCorrections) => {
    if (!rows || rows.length === 0) return;
    setIsImporting(true);
    setPopover(null);

    // ① before スナップショット保存
    const beforeState = { ocrContent, analyzedSpans, acceptedCorrections, pageOcrTextCache, pageAnalyzedSpansCache };

    // ② ページ単位でグループ化（save_page 優先、0-indexed）
    const pageMap = {};
    for (const row of rows) {
      const pi = (row.save_page ?? row.page) - 1;
      if (pi < 0) continue;
      if (!pageMap[pi]) pageMap[pi] = [];
      pageMap[pi].push(row);
    }

    let workAccepted = {};
    const workOcrCache = {};
    const workSpansCache = {};
    let workOcrContent = ocrContent;
    let workAnalyzedSpans = analyzedSpans;
    const importPageNums = [];
    const afterPageCorrections = {};
    let currentPageNeedsReanalyze = false;

    // ③ 各ページを順次処理
    for (const [piStr, pageRows] of Object.entries(pageMap)) {
      const pi = parseInt(piStr, 10);
      const pageNum = pi + 1;
      importPageNums.push(pageNum);

      // span_id で重複排除（last-wins）
      const deduped = Object.values(
        pageRows.reduce((acc, r) => {
          const key = r.span_id || `${r.suspect_span}_${r.occurrence_index}`;
          return { ...acc, [key]: r };
        }, {})
      );

      const cleanupRows = deduped.filter(r => r.correction_mode === 'cleanup');
      const corrRows = deduped.filter(r => r.correction_mode === 'single' || r.correction_mode === 'change_all');

      const origOcr = document?.ocr_pages?.[pi]?.ocr_text ?? '';
      const hasCleanup = cleanupRows.length > 0;
      const baseOcr = hasCleanup ? applyCleanup(origOcr) : origOcr;

      // App 側 pageCorrections 用エントリ（cleanup 分）
      const pageEntries = cleanupRows.map(r => ({
        span_id: r.span_id, spanId: r.span_id,
        suspect_span: r.suspect_span,
        original_text: r.original_text || r.suspect_span,
        chosen: '', selected_candidate: '',
        candidate_rank: -1, is_manual_input: false,
        time_per_correction: r.time_per_correction ?? 0,
        occurrence_index: r.occurrence_index ?? 0,
        correction_mode: 'cleanup', cleanup_rule: r.cleanup_rule,
      }));

      if (corrRows.length === 0) {
        workOcrCache[pi] = baseOcr;
        workSpansCache[pi] = [];
        if (pi === currentPage) {
          workOcrContent = baseOcr;
          workAnalyzedSpans = [];
          currentPageNeedsReanalyze = true;
        }
        afterPageCorrections[pageNum] = pageEntries;
        continue;
      }

      // backend で再解析してスパン位置を確定する
      let spans = [];
      try {
        const resp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown_content: baseOcr, ocr_json: document?.ocr_json }),
        });
        const data = await resp.json();
        spans = (data.results || []).map(r => ({
          id: `p${pageNum}_o${r.occurrence_index}_s${r.start}`,
          ...r,
        }));
      } catch (err) {
        console.error(`Import: analyze failed for page ${pageNum}`, err);
      }

      // occurrence_index + suspect_span でスパンを特定し、開始位置順に適用
      let workOcr = baseOcr;
      let workSpans = [...spans];
      const workAcc = {};

      const rowsWithSpan = corrRows.flatMap(row => {
        const sp = workSpans.find(s => {
          const m = /p\d+_o(\d+)_s\d+/.exec(s.id);
          return m && parseInt(m[1], 10) === row.occurrence_index && s.suspect_span === row.suspect_span;
        });
        return sp ? [{ row, spanId: sp.id, start: sp.start }] : [];
      }).sort((a, b) => a.start - b.start);

      for (const { row, spanId } of rowsWithSpan) {
        const live = workSpans.find(s => s.id === spanId);
        if (!live) continue;
        const candidate = row.selected_candidate;
        const { start, end } = live;
        const delta = candidate.length - (end - start);
        workOcr = workOcr.slice(0, start) + candidate + workOcr.slice(end);
        workSpans = workSpans.map(s => {
          if (s.id === live.id) return { ...s, end: start + candidate.length };
          if (s.start >= end) return { ...s, start: s.start + delta, end: s.end + delta };
          return s;
        });
        workAcc[live.id] = candidate;
        pageEntries.push({
          span_id: live.id, spanId: live.id,
          suspect_span: row.suspect_span,
          original_text: row.original_text || row.suspect_span,
          chosen: candidate, selected_candidate: candidate,
          candidate_rank: row.candidate_rank ?? -1,
          is_manual_input: row.is_manual_input ?? false,
          time_per_correction: row.time_per_correction ?? 0,
          occurrence_index: row.occurrence_index ?? 0,
          correction_mode: row.correction_mode,
          cleanup_rule: null,
        });
      }

      workOcrCache[pi] = workOcr;
      workSpansCache[pi] = workSpans;
      Object.assign(workAccepted, workAcc);

      if (pi === currentPage) {
        workOcrContent = workOcr;
        workAnalyzedSpans = workSpans;
      }

      afterPageCorrections[pageNum] = pageEntries;
    }

    // ④ after スナップショット構築
    const afterState = {
      ocrContent: workOcrContent,
      analyzedSpans: workAnalyzedSpans,
      acceptedCorrections: workAccepted,
      pageOcrTextCache: workOcrCache,
      pageAnalyzedSpansCache: workSpansCache,
    };

    // ⑤ 履歴に 1アクションとして積む
    setHistoryStack(prev => [...prev, {
      before: beforeState,
      after: afterState,
      page: currentPage,
      pageNum: currentPage + 1,
      isImport: true,
      importPageNums,
      beforePageCorrections: beforePageCorrections ?? {},
      afterPageCorrections,
    }]);
    setRedoStack([]);

    // ⑥ 状態を一括適用
    setAcceptedCorrections(workAccepted);
    setPageOcrTextCache(workOcrCache);
    setPageAnalyzedSpansCache(workSpansCache);
    setOcrContent(workOcrContent);
    setAnalyzedSpans(workAnalyzedSpans);

    // ⑦ App 側に通知
    for (const [piStr] of Object.entries(workOcrCache)) {
      const pi = parseInt(piStr, 10);
      const pageNum = pi + 1;
      if (onOcrChange) onOcrChange(workOcrCache[pi], pageNum);
    }
    if (onBulkSetPageCorrections) onBulkSetPageCorrections(afterPageCorrections);

    // ⑧ cleanup のみのページは再解析してスパンを復元
    if (currentPageNeedsReanalyze) {
      analyzeText(workOcrContent, document?.ocr_json, false, true);
    }

    setIsImporting(false);
  };
  importCorrectionsRef.current = importCorrections;

  useImperativeHandle(ref, () => ({
    importCorrections: (...args) => importCorrectionsRef.current?.(...args),
  }), []);
  // ────────────────────────────────────────────────────────────────────────

  // review panel クリック用スクロール（refs 経由で writingMode を参照）
  const scrollToSpanEl = (spanId) => {
    const el = highlightLayerRef.current?.querySelector(`[data-span-id="${spanId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      if (!textareaRef.current || !highlightLayerRef.current) return;
      if (writingMode === 'vertical') {
        textareaRef.current.scrollLeft = highlightLayerRef.current.scrollLeft;
      } else {
        textareaRef.current.scrollTop = highlightLayerRef.current.scrollTop;
      }
    }, 150);
  };

  const handleReviewItemClick = (spanId) => {
    scrollToSpanEl(spanId);
    setActiveSpanId(spanId);
    const idx = filteredSpans.findIndex(s => s.id === spanId);
    if (idx >= 0) setKeyboardIndex(idx);
    setBlinkingSpanId(spanId);
    setTimeout(() => setBlinkingSpanId(null), 1800);
  };

  const handleScroll = (e) => {
    const layer = e.target.parentElement.querySelector('.highlight-layer');
    if (!layer) return;
    if (writingMode === 'vertical') {
      layer.scrollLeft = e.target.scrollLeft;
      // scrollTop 残留値が縦書きレイアウトを崩さないよう明示的にリセット
      layer.scrollTop = 0;
    } else {
      layer.scrollTop = e.target.scrollTop;
      // scrollLeft 残留値が横書きレイアウトを崩さないよう明示的にリセット
      layer.scrollLeft = 0;
    }
  };

  const renderHighlights = (content) => {
    if (!content) return null;
    const elements = [];
    let cursor = 0;
    const visibleIds = new Set(filteredSpans.map(sp => sp.id));

    // analyzedSpans を優先し、助詞ハイライトをマージ（同位置は analyzed が勝つ）
    const combined = [
      ...analyzedSpans.map(sp => ({ ...sp, _type: 'analyzed' })),
      ...particleHighlightSpans.map(sp => ({ ...sp, _type: 'particle' })),
    ].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a._type === 'analyzed' ? -1 : 1;
    });

    for (const span of combined) {
      const spanStart = span.start;
      const spanEnd = span._type === 'particle'
        ? span.end
        : (span.end || (span.start + span.suspect_span.length));

      // skip overlapping or out-of-order spans
      if (spanStart < cursor) continue;

      if (spanStart > cursor) {
        elements.push(<span key={`t_${cursor}`}>{content.slice(cursor, spanStart)}</span>);
      }

      if (span._type === 'particle') {
        elements.push(
          <span
            key={span.id}
            data-span-id={span.id}
            className="highlight-particle"
            title={`助詞統一候補: ${span.hira} → ${span.kata}`}
          >
            {content.slice(spanStart, spanEnd)}
          </span>
        );
      } else if (visibleIds.has(span.id)) {
        elements.push(
          <span
            key={span.id}
            data-span-id={span.id}
            className={[
              'highlight-span',
              activeSpanId === span.id ? 'highlight-active' : '',
              acceptedCorrections[span.id] !== undefined ? 'highlight-corrected' : '',
              span.is_protected ? 'highlight-protected' : '',
              acceptedCorrections[span.id] === undefined && span.is_dangerous ? 'highlight-dangerous' : '',
              blinkingSpanId === span.id ? 'highlight-blink' : '',
            ].filter(Boolean).join(' ')}
            onClick={(e) => handleSpanClick(e, span)}
          >
            {content.slice(spanStart, spanEnd)}
          </span>
        );
      } else {
        elements.push(
          <span key={span.id} data-span-id={span.id}>
            {content.slice(spanStart, spanEnd)}
          </span>
        );
      }

      cursor = spanEnd;
    }

    if (cursor < content.length) {
      elements.push(<span key={`t_${cursor}`}>{content.slice(cursor)}</span>);
    }

    return <div className="highlight-text-container">{elements}</div>;
  };

  const totalSpans = analyzedSpans.length;
  const correctedCount = analyzedSpans.filter(sp => acceptedCorrections[sp.id] !== undefined).length;
  const allCorrected = totalSpans > 0 && correctedCount === totalSpans;

  // ─── Sidebar helpers ────────────────────────────────────────────────────
  const isNarrowSidebar = sidebarWidth < 240;

  const toggleSection = (key) => {
    setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const startSidebarResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarRef.current?.offsetWidth ?? sidebarWidth;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.min(480, Math.max(220, startW + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startSectionResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = correctionsRef.current?.offsetHeight ?? (sectionSplitPx ?? 200);
    const totalH = sidebarInnerRef.current?.offsetHeight ?? 400;
    const MIN_H = 56;
    const onMove = (ev) => {
      const newH = Math.min(totalH - MIN_H - 5, Math.max(MIN_H, startH + (ev.clientY - startY)));
      setSectionSplitPx(newH);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const renderCorrectionsList = () => {
    const currentPageNum = currentPage + 1;
    const hiraAllEntries = hiraAllNormLog.filter(e => e.pageNum === currentPageNum);
    if (reviewItems.length === 0 && hiraAllEntries.length === 0) {
      return (
        <div className="crp-empty">
          {loadingAnalysis ? '' : totalSpans === 0 ? 'このページに疑義語はありません' : 'まだ補正されていません'}
        </div>
      );
    }
    return (
      <div className="crp-list">
        {hiraAllEntries.map((entry, i) => (
          <div key={`hira-all-${i}`} className="crp-item crp-bulk-norm">
            <div className="crp-main-row">
              <span className="crp-suspect">ひらがな全一括</span>
              <span className="crp-arrow">→</span>
              <span className="crp-chosen">カタカナ</span>
            </div>
            <span className="crp-occ">{entry.count}文字</span>
          </div>
        ))}
        {reviewItems.map(sp => (
          <button
            key={sp.id}
            className={`crp-item${activeSpanId === sp.id ? ' crp-item-active' : ''}`}
            onClick={() => handleReviewItemClick(sp.id)}
            title={sp.id}
          >
            <div className="crp-main-row">
              <span className="crp-suspect">{sp.suspect_span}</span>
              <span className="crp-arrow">→</span>
              <span className="crp-chosen">{acceptedCorrections[sp.id]}</span>
            </div>
            {sp.occurrence_index !== undefined && (
              <span className="crp-occ">o{sp.occurrence_index}</span>
            )}
          </button>
        ))}
      </div>
    );
  };
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="proofreader-container">
      <div className="proofreader-toolbar">
        {/* ROW 1: 文書操作 */}
        <div className="toolbar-row">
          <div className="mode-tabs">
            <button className={`tab-btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => setMode('preview')}>疑義チェック</button>
            <button className={`tab-btn ${mode === 'edit' ? 'active' : ''}`} onClick={() => setMode('edit')}>エディタ</button>
          </div>
          {mode === 'preview' && effectiveDocType !== 'unknown' && (
            <span
              className={`doc-type-badge doc-type-${effectiveDocType}${docType === 'unknown' && !manualDocType ? ' doc-type-fallback' : ''}${manualDocType ? ' doc-type-manual' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={handleDocTypeBadgeClick}
              title={
                manualDocType
                  ? `手動設定: ${effectiveDocType === 'classical' ? '古文書' : '近代文書'}（クリックして${effectiveDocType === 'classical' ? '近代文書' : '古文書'}に切替）`
                  : docType === 'unknown'
                    ? `このページ単独では判定できないため文書全体の種別を使用（${documentDocType === 'classical' ? '古文書' : '近代文書'}）クリックで切替`
                    : docTypeSource === 'frontmatter_era'
                      ? `frontmatter の era フィールドから古文書と判定 (${Math.round(docTypeConfidence * 100)}% confidence)（クリックで切替）`
                      : `ドキュメント種別: ${effectiveDocType === 'classical' ? '古文書' : '近代文書'} (${Math.round(docTypeConfidence * 100)}% confidence)（クリックで切替）`
              }
            >
              {effectiveDocType === 'classical' ? '古文書' : '近代文書'}{manualDocType ? ' ✎' : ''}
            </span>
          )}
          {mode === 'preview' && documentStyleHints && (
            <span
              className={`style-hint-badge style-hint-${documentStyleHints.particle_script}`}
              title={
                documentStyleHints.particle_script === 'insufficient'
                  ? `助詞サンプル不足（${documentStyleHints.total_particles}件）`
                  : `カタカナ ${documentStyleHints.kata_particle_count} / ひらがな ${documentStyleHints.hira_particle_count} | 総計 ${documentStyleHints.total_particles}件`
              }
            >
              {documentStyleHints.particle_script === 'katakana_dominant'
                ? `カタカナ優勢 ${Math.round(documentStyleHints.kata_ratio * 100)}%`
                : documentStyleHints.particle_script === 'hiragana_dominant'
                  ? `ひらがな優勢 ${Math.round((1 - documentStyleHints.kata_ratio) * 100)}%`
                  : documentStyleHints.particle_script === 'mixed'
                    ? `混在（カタカナ${Math.round(documentStyleHints.kata_ratio * 100)}% / ひらがな${Math.round((1 - documentStyleHints.kata_ratio) * 100)}%）`
                    : '—'}
            </span>
          )}
          <div className="toolbar-spacer" />
          {mode === 'preview' && totalSpans > 0 && (
            <div className={`progress-indicator${allCorrected ? ' all-corrected' : ''}`}>
              {allCorrected ? `全件補正済み ${correctedCount} / ${totalSpans}` : `補正済み ${correctedCount} / ${totalSpans}`}
            </div>
          )}
          {mode === 'preview' && viewMode === 'paged' && document?.ocr_pages?.length > 0 && (
            <div className="page-indicator">
              Page {currentPage + 1} / {document.ocr_pages.length}
            </div>
          )}
          {mode === 'preview' && totalOcrPages > 0 && (
            <div className={`ocr-status-badge${currentPageHasOcrText ? ' ocr-status-done' : ' ocr-status-pending'}`}>
              OCR {pagesWithOcr}/{totalOcrPages}p
              {!currentPageHasOcrText && ' · このページ未実行'}
            </div>
          )}
          {(loadingAnalysis || isImporting) && <div className="loader-small"></div>}
          {isImporting && <span className="import-status-label">インポート中...</span>}
        </div>

        {/* ROW 2: 処理 / 表示モード */}
        {mode === 'preview' && (
          <div className="toolbar-row toolbar-row-2">
            <div className="writing-mode-segment">
              <button
                className={`seg-btn ${writingMode === 'horizontal' ? 'active' : ''}`}
                onClick={() => setWritingMode('horizontal')}
                title="横書き"
              >
                <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden="true">
                  <rect x="0" y="0"  width="15" height="2" rx="1" fill="currentColor"/>
                  <rect x="0" y="5"  width="15" height="2" rx="1" fill="currentColor"/>
                  <rect x="0" y="10" width="15" height="2" rx="1" fill="currentColor"/>
                </svg>
              </button>
              <span className="seg-sep">｜</span>
              <button
                className={`seg-btn ${writingMode === 'vertical' ? 'active' : ''}`}
                onClick={() => setWritingMode('vertical')}
                title="縦書き"
              >
                <svg width="12" height="15" viewBox="0 0 12 15" fill="none" aria-hidden="true">
                  <rect x="0"  y="0" width="2" height="15" rx="1" fill="currentColor"/>
                  <rect x="5"  y="0" width="2" height="15" rx="1" fill="currentColor"/>
                  <rect x="10" y="0" width="2" height="15" rx="1" fill="currentColor"/>
                </svg>
              </button>
            </div>
            <div className="processing-dropdown-wrapper" ref={processingDropdownRef}>
              <button type="button" className="processing-btn" onClick={() => setProcessingDropdownOpen(v => !v)}>
                処理 ▾
              </button>
              {processingDropdownOpen && (
                <div className="processing-dropdown-menu">
                  {effectiveDocType === 'classical' && particleNormCount > 0 && (
                    <button
                      type="button"
                      className="processing-menu-item"
                      disabled={!ocrContent}
                      onClick={() => { handleParticleNormPreview(); setProcessingDropdownOpen(false); }}
                    >
                      助詞統一 ({particleNormCount})
                    </button>
                  )}
                  <button
                    type="button"
                    className="processing-menu-item"
                    disabled={!ocrContent}
                    onClick={() => { handleCleanupPreview(); setProcessingDropdownOpen(false); }}
                  >
                    ノイズ除去
                  </button>
                </div>
              )}
            </div>
            <div className="filter-tabs">
              <button className={`tab-btn ${displayFilter === 'all' ? 'active' : ''}`} onClick={() => setDisplayFilter('all')}>すべて</button>
              <button className={`tab-btn ${displayFilter === 'uncorrected' ? 'active' : ''}`} onClick={() => setDisplayFilter('uncorrected')}>未補正</button>
              <button className={`tab-btn ${displayFilter === 'corrected' ? 'active' : ''}`} onClick={() => setDisplayFilter('corrected')}>補正済み</button>
            </div>
          </div>
        )}
      </div>
      
      {mode === 'preview' && displayFilter === 'uncorrected' && !loadingAnalysis && filteredSpans.length === 0 && totalSpans > 0 && (
        <div className="all-corrected-banner">このページの疑義語はすべて補正済みです</div>
      )}

      <div className="proofreader-main">
        <div className="editor-area-integrated">
          {inputError && <div className="page-error-msg">{inputError}</div>}
          {mode === 'preview' && !currentPageHasOcrText && currentPageHasImage ? (
            <div className="ocr-prompt-container">
              <h3>このページにOCRテキストがありません</h3>
              <p>Page {currentPage + 1} の画像はありますが、OCRがまだ実行されていません。</p>
              {isOcrRunning ? (
                <div className="ocr-running-msg">
                  <div className="loader-small"></div>
                  <span>OCRを実行しています... 数分かかる場合があります</span>
                </div>
              ) : (
                <div className="ocr-prompt-actions">
                  <button
                    className="btn-primary ocr-run-btn"
                    onClick={() => runOcrPage?.(currentPage + 1)}
                  >
                    このページをOCRする (Page {currentPage + 1})
                  </button>
                  {totalOcrPages > 1 && (
                    <button
                      className="ocr-run-btn-all"
                      onClick={runOcr}
                    >
                      全ページをOCRする
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className={`editor-composite-container${writingMode === 'vertical' ? ' vertical' : ''}`}>
              <div className="highlight-layer" ref={highlightLayerRef}>{renderHighlights(mode === 'preview' ? ocrContent : fullContent)}</div>
              <textarea
                ref={textareaRef}
                className="text-editor-integrated"
                value={mode === 'preview' ? ocrContent : fullContent}
                onChange={handleTextChange}
                onScroll={handleScroll}
                spellCheck={false}
                placeholder={mode === 'preview' ? "OCRテキストがありません" : "Markdownテキストを入力..."}
              />
            </div>
          )}
        </div>

        {mode === 'preview' && (
          <div className="right-sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
            <div className="sidebar-resize-handle" onMouseDown={startSidebarResize} />
            <div className="sidebar-inner" ref={sidebarInnerRef}>
              {isNarrowSidebar ? (
                <>
                  <div className="sidebar-tab-bar">
                    <button
                      className={`sidebar-tab-btn${activeTab === 'corrections' ? ' active' : ''}`}
                      onClick={() => setActiveTab('corrections')}
                    >補正{(reviewItems.length + hiraAllNormLog.filter(e => e.pageNum === currentPage + 1).length) > 0 ? ` (${reviewItems.length + hiraAllNormLog.filter(e => e.pageNum === currentPage + 1).length})` : ''}</button>
                    <button
                      className={`sidebar-tab-btn${activeTab === 'proposals' ? ' active' : ''}`}
                      onClick={() => setActiveTab('proposals')}
                    >判定</button>
                  </div>
                  <div className="sidebar-tab-content">
                    {activeTab === 'corrections' && renderCorrectionsList()}
                    {activeTab === 'proposals' && (
                      <ProposalsPanel
                        analyzedSpans={analyzedSpans}
                        currentPageData={currentPageData}
                        open={true}
                        onToggle={() => {}}
                        onSpanClick={handleReviewItemClick}
                        headless
                        hiraAllCount={hiraAllCount}
                        onHiraAllNorm={handleHiraAllNormPreview}
                        acceptedCorrections={acceptedCorrections}
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={`sidebar-section${sectionsOpen.corrections ? ' is-open' : ''}`}
                    ref={correctionsRef}
                    style={
                      sectionsOpen.corrections && sectionsOpen.proposals && sectionSplitPx !== null
                        ? { height: sectionSplitPx, flex: 'none' }
                        : undefined
                    }
                  >
                    <button className="sidebar-acc-header" onClick={() => toggleSection('corrections')}>
                      <span>補正一覧{(reviewItems.length + hiraAllNormLog.filter(e => e.pageNum === currentPage + 1).length) > 0 ? ` (${reviewItems.length + hiraAllNormLog.filter(e => e.pageNum === currentPage + 1).length})` : ''}</span>
                      <span className="acc-chevron">{sectionsOpen.corrections ? '▾' : '▸'}</span>
                    </button>
                    {sectionsOpen.corrections && (
                      <div className="sidebar-section-body">
                        {renderCorrectionsList()}
                      </div>
                    )}
                  </div>
                  {sectionsOpen.corrections && sectionsOpen.proposals && (
                    <div className="sidebar-section-resizer" onMouseDown={startSectionResize} />
                  )}
                  <div className={`sidebar-section${sectionsOpen.proposals ? ' is-open' : ''}`}>
                    <button className="sidebar-acc-header" onClick={() => toggleSection('proposals')}>
                      <span>判定</span>
                      <span className="acc-chevron">{sectionsOpen.proposals ? '▾' : '▸'}</span>
                    </button>
                    {sectionsOpen.proposals && (
                      <div className="sidebar-section-body">
                        <ProposalsPanel
                          analyzedSpans={analyzedSpans}
                          currentPageData={currentPageData}
                          open={true}
                          onToggle={() => {}}
                          onSpanClick={handleReviewItemClick}
                          headless
                          hiraAllCount={hiraAllCount}
                          onHiraAllNorm={handleHiraAllNormPreview}
                          acceptedCorrections={acceptedCorrections}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {changeAllConfirm && (
        <div className="change-all-overlay" onClick={() => setChangeAllConfirm(null)}>
          <div className="change-all-dialog" onClick={e => e.stopPropagation()}>
            <div className="cad-header">一括補正の確認</div>
            <div className="cad-body">
              <div className="cad-row">
                <span className="cad-label">対象語</span>
                <span className="cad-value">「{changeAllConfirm.suspect_span}」</span>
              </div>
              <div className="cad-row">
                <span className="cad-label">補正候補</span>
                <span className="cad-value cad-value-candidate">「{changeAllConfirm.candidate}」</span>
              </div>
              <div className="cad-row">
                <span className="cad-label">対象件数</span>
                <span className="cad-value">{changeAllConfirm.targetSpans.length}件（未補正のみ）</span>
              </div>
            </div>
            <div className="cad-actions">
              <button className="cad-cancel" onClick={() => setChangeAllConfirm(null)}>キャンセル</button>
              <button className="cad-confirm" onClick={executeChangeAll}>一括補正する</button>
            </div>
          </div>
        </div>
      )}

      {cleanupConfirm && (
        <div className="change-all-overlay" onClick={() => setCleanupConfirm(null)}>
          <div className="change-all-dialog cleanup-dialog" onClick={e => e.stopPropagation()}>
            <div className="cad-header">ノイズ除去プレビュー</div>
            {cleanupConfirm.total === 0 ? (
              <>
                <div className="cleanup-no-match">除去対象のノイズは検出されませんでした</div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={() => setCleanupConfirm(null)}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                <div className="cad-body">
                  {cleanupConfirm.rules.map(r => (
                    <div key={r.id} className="cleanup-rule-item">
                      <div className="cleanup-rule-header">
                        <span className="cad-label">{r.description}</span>
                        <span className="cleanup-count">×{r.count}件</span>
                      </div>
                      {r.examples.length > 0 && (
                        <div className="cleanup-examples">
                          {r.examples.map((ex, i) => (
                            <span key={i} className="cleanup-example">{ex.length > 12 ? ex.slice(0, 12) + '…' : ex}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="cleanup-summary">
                    合計 <strong>{cleanupConfirm.total}</strong> 件を除去します（現在ページのみ）
                  </div>
                  <div className="cleanup-undo-note">Ctrl+Z で元に戻せます</div>
                </div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={() => setCleanupConfirm(null)}>キャンセル</button>
                  <button className="cad-confirm" onClick={executeCleanup}>除去を実行</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {particleNormConfirm !== null && (
        <div className="change-all-overlay" onClick={handleParticleNormCancel}>
          <div className="change-all-dialog particle-norm-dialog" onClick={e => e.stopPropagation()}>
            <div className="cad-header">助詞正規化プレビュー</div>
            {particleNormConfirm.particles.length === 0 ? (
              <>
                <div className="cleanup-no-match">正規化対象の助詞は検出されませんでした</div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={() => setParticleNormConfirm(null)}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                <div className="cad-body">
                  {/* 行単位フィルタ統計 */}
                  <div className="pn-line-stats">
                    <span className="pn-stat-item pn-stat-target">
                      対象行 <strong>{particleNormConfirm.lineStats.total - particleNormConfirm.lineStats.excluded}</strong>
                    </span>
                    {particleNormConfirm.lineStats.excluded > 0 && (
                      <span className="pn-stat-item pn-stat-excluded">
                        除外行 <strong>{particleNormConfirm.lineStats.excluded}</strong>
                      </span>
                    )}
                  </div>
                  {/* 除外行の理由（最大5件） */}
                  {particleNormConfirm.lineStats.excludedLineReasons.length > 0 && (
                    <div className="pn-excluded-lines">
                      <div className="pn-excluded-title">除外行（近代文書指標を検出）:</div>
                      {particleNormConfirm.lineStats.excludedLineReasons.map((r, i) => (
                        <div key={i} className="pn-excluded-item">
                          <span className="pn-excluded-preview">{r.linePreview}</span>
                          <span className="pn-excluded-rules">{r.rules.join(' / ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 助詞別ヒット */}
                  {particleNormConfirm.particles.map(({ hira, kata, count, samples }) => (
                    <div key={hira} className="cleanup-rule-item">
                      <div className="cleanup-rule-header">
                        <span className="cad-label">{hira} → {kata}</span>
                        <span className="cleanup-count">×{count}件</span>
                      </div>
                      {samples.length > 0 && (
                        <div className="cleanup-examples">
                          {samples.map((s, i) => (
                            <span key={i} className="cleanup-example">{s.length > 14 ? s.slice(0, 14) + '…' : s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="cleanup-summary">
                    合計 <strong>{particleNormConfirm.particles.reduce((n, p) => n + p.count, 0)}</strong> 件を正規化します（現在ページのみ）
                  </div>
                  <div className="cleanup-undo-note">Ctrl+Z で元に戻せます</div>
                </div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={handleParticleNormCancel}>キャンセル</button>
                  <button className="cad-confirm" onClick={executeParticleNorm}>正規化を実行</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {hiraAllConfirm !== null && (
        <div className="change-all-overlay" onClick={() => setHiraAllConfirm(null)}>
          <div className="change-all-dialog particle-norm-dialog" onClick={e => e.stopPropagation()}>
            <div className="cad-header">ひらがな → カタカナ 一括変換</div>
            {hiraAllConfirm.count === 0 ? (
              <>
                <div className="cleanup-no-match">変換対象のひらがなは検出されませんでした</div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={() => setHiraAllConfirm(null)}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                <div className="cad-body">
                  <div className="pn-line-stats">
                    <span className="pn-stat-item pn-stat-target">
                      変換対象 <strong>{hiraAllConfirm.count}</strong> 文字
                    </span>
                  </div>
                  <div className="crp-list" style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
                    {hiraAllConfirm.chars.slice(0, 12).map(({ hira, kata, count }) => (
                      <div key={hira} className="cleanup-rule-item">
                        <div className="cleanup-rule-header">
                          <span className="cad-label">{hira} → {kata}</span>
                          <span className="cleanup-count">×{count}件</span>
                        </div>
                      </div>
                    ))}
                    {hiraAllConfirm.chars.length > 12 && (
                      <div className="cleanup-rule-item" style={{ color: 'var(--color-muted)' }}>
                        …他 {hiraAllConfirm.chars.length - 12} 種
                      </div>
                    )}
                  </div>
                  <div className="cleanup-summary">
                    合計 <strong>{hiraAllConfirm.count}</strong> 文字を変換します（現在ページのみ）
                  </div>
                  <div className="cleanup-undo-note">Ctrl+Z で元に戻せます</div>
                </div>
                <div className="cad-actions">
                  <button className="cad-cancel" onClick={() => setHiraAllConfirm(null)}>キャンセル</button>
                  <button className="cad-confirm" onClick={executeHiraAllNorm}>変換を実行</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {popover && (
        <>
          <div className="overlay" onClick={() => dismissPopover('overlay')} />
          <div
            className="popover"
            style={{ left: popover.x, top: popover.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="popover-header" onMouseDown={handlePopoverDragStart}>
              <span className="popover-drag-handle" aria-hidden="true">⠿</span>
              <h4>「{popover.span.suspect_span}」の候補</h4>
              <button className="btn-icon popover-close" onClick={() => dismissPopover('close_btn')}>×</button>
            </div>
            <div className="popover-reason">{popover.span.reason}</div>
            <div className="candidates-list">
              {(() => {
                const sameUncorrected = analyzedSpans.filter(sp =>
                  sp.suspect_span === popover.span.suspect_span &&
                  acceptedCorrections[sp.id] === undefined
                );
                const showChangeAll = sameUncorrected.length >= 2;
                return (popover.span.candidates || []).map((cand, i) => {
                  const kanaLabel = getKanaLabel(cand);
                  const isDeletionCandidate = cand === '';
                  return (
                  <div key={i} className="candidate-row">
                    <button
                      className={[
                        isDeletionCandidate ? 'delete-span-btn delete-span-btn--candidate' : 'candidate-btn',
                        !isDeletionCandidate && acceptedCorrections[popover.spanId] === cand ? 'candidate-selected' : '',
                        !isDeletionCandidate && popoverCandidateIndex === i ? 'candidate-keyboard-selected' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleCandidateSelect(cand, i)}
                    >
                      {!isDeletionCandidate && <span className="candidate-shortcut">{i < 9 ? i + 1 : ''}</span>}
                      {isDeletionCandidate ? '削除' : (cand + (kanaLabel ? '' : ''))}
                      {!isDeletionCandidate && kanaLabel && <span className="kana-label">（{kanaLabel}）</span>}
                    </button>
                    {showChangeAll && (
                      <button
                        className="change-all-btn"
                        onClick={() => handleChangeAll(manualInput || cand, manualInput ? -1 : i)}
                        title={manualInput
                          ? `手動入力「${manualInput}」でこのページの${sameUncorrected.length}件を一括補正`
                          : isDeletionCandidate
                            ? `このページの「${popover.span.suspect_span}」${sameUncorrected.length}件をすべて削除`
                            : `このページの「${popover.span.suspect_span}」${sameUncorrected.length}件をすべて補正`}
                      >全</button>
                    )}
                  </div>
                );
                });
              })()}
            </div>
            <div className="manual-input-section">
              <input
                className="manual-input"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="手動入力..."
              />
              {!(popover.span.candidates || []).includes('') && (
                <button
                  className="delete-span-btn"
                  onClick={() => handleCandidateSelect('', -1)}
                  title="この箇所を削除"
                >削除</button>
              )}
              <button
                className="save-btn"
                disabled={!manualInput}
                onClick={() => {
                  if (manualInput) handleCandidateSelect(manualInput, -1);
                }}
              >確定</button>
            </div>
            {(popover.span.candidates?.length ?? 0) > 0 && !acceptedCorrections[popover.spanId] && (
              <div className="popover-reject-section">
                <button
                  className="reject-top1-btn"
                  onClick={handleRejectTop1}
                  title={`「${popover.span.candidates[0]}」を除外（この候補は学習対象から除外）`}
                >
                  「{popover.span.candidates[0]}」を除外
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default Proofreader;
