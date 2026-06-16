import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import Proofreader from './components/Proofreader';
import SettingsSidebar from './components/SettingsSidebar';
import FileBrowserSidebar from './components/FileBrowserSidebar';
import DictionaryManager from './components/DictionaryManager';
import './App.css';

import { useSettings } from './state/useSettings';
import { useKeybindings } from './state/useKeybindings';
import { useSplitPane } from './state/useSplitPane';
import { usePageView } from './state/usePageView';
import { useVaultFiles } from './state/useVaultFiles';
import { useDocumentOpen } from './state/useDocumentOpen';

import { saveDocumentPage, runOcrForDocument as apiRunOcrForDocument, runOcrForPage as apiRunOcrForPage, updateDocumentStatus, registerTemporaryTerm, getAppConfig, getConfigStatus, updateAppConfig } from './services/documentService';
// Phase 3D: getOcrSettings / getDictionarySettings は documentService.js からも削除済み（旧 GET /api/settings/{ocr,dictionary} は backend からも削除済み）
// Phase 2C: updateOcrSettings / updateDictionarySettings は旧 API（deprecated）のため App.jsx 内では未使用
import { logDictionarySettingChanged } from './services/learningEventLogger';
import {
  normalizeCorrections,
  buildExportRows,
  getExportFilename,
  downloadAsJson,
  downloadAsCsv,
  parseImportRows,
} from './services/correctionSerializer';

import { getImageUrl } from './utils/imageUrl';
import { buildObsidianUri, deriveVaultName } from './utils/obsidianUri';
import { flushToBackend } from './services/learningEventLogger';

function App() {
  // ─── Persistent settings & view preferences ─────────────────────────────
  const { settings, updateSetting } = useSettings();
  const { keybindings, capturingKey, setCapturingKey, resetKeybindings } = useKeybindings();
  const { splitRatio, isDragging, workspaceRef, handleMouseDown } = useSplitPane();
  const vaultFiles = useVaultFiles();

  // ─── OCR setting change (Phase 3C: appConfig 正本・楽観更新→handleConfigUpdate 経由に統一) ───
  const handleOcrSettingChange = async (key, value) => {
    if (isSavingConfig) return; // concurrent save 防止
    const prevConfig = appConfig;
    // 楽観更新: appConfig.ocr を即時更新
    setAppConfig(prev => prev ? { ...prev, ocr: { ...prev.ocr, [key]: value } } : prev);
    const ok = await handleConfigUpdate({ [`ocr.${key}`]: value });
    if (!ok) setAppConfig(prevConfig); // 失敗時は appConfig 全体を revert
  };

  // ─── Dictionary setting change (Phase 3C: appConfig 正本・楽観更新→handleConfigUpdate 経由に統一) ───
  const handleDictionarySettingChange = async (key, value) => {
    if (isSavingConfig) return; // concurrent save 防止
    const prevConfig = appConfig;
    // 楽観更新: appConfig.dictionary を即時更新
    setAppConfig(prev => prev ? { ...prev, dictionary: { ...prev.dictionary, [key]: value } } : prev);
    const ok = await handleConfigUpdate({ [`dictionary.${key}`]: value });
    if (ok) {
      logDictionarySettingChanged({ key, old_value: prevConfig?.dictionary?.[key], new_value: value, reload_result: 'success' });
    } else {
      setAppConfig(prevConfig); // 失敗時は appConfig 全体を revert
      logDictionarySettingChanged({ key, old_value: prevConfig?.dictionary?.[key], new_value: value, reload_result: 'error' });
    }
  };

  // ─── temporary辞書: Proofreader の直接登録フロー向け最小ハンドラ ──────────
  const handleRegisterTemporaryTerm = async (termData) => {
    await registerTemporaryTerm(termData);
  };

  // ─── App config (Phase 3C: frontend 唯一の正本。初回マウントは getAppConfig() のみ) ──
  const [appConfig, setAppConfig] = useState(null);
  const [configStatus, setConfigStatus] = useState(null);
  useEffect(() => {
    // Phase 3C/3D: 旧 getOcrSettings() / getDictionarySettings() は除去済み。
    // getAppConfig() のみで全 config を構成する。
    getAppConfig().then(c => { setAppConfig(c); }).catch(() => {});
    getConfigStatus().then(s => setConfigStatus(s)).catch(() => {});
  }, []);

  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveError, setConfigSaveError] = useState(null);

  /**
   * PATCH /api/config 呼び出し → 成功後に GET /api/config で再同期（正本確定）。
   * Phase 3C: isSavingDictionary ガード廃止。isSavingConfig のみで OCR/dictionary/status/CONFIG
   *            すべての concurrent save を防止。
   * 呼び出し元が楽観更新を行った場合、失敗時は呼び出し元で prevConfig を revert すること。
   * @returns {Promise<boolean>} 保存成功なら true、ガード / エラー時は false
   */
  const handleConfigUpdate = async (updates) => {
    if (isSavingConfig) return false; // Phase 3C: 統一 concurrent save ガード
    setIsSavingConfig(true);
    setConfigSaveError(null);
    try {
      await updateAppConfig(updates);
      // 成功後に GET /api/config を再取得して appConfig を正本として再同期
      const newConfig = await getAppConfig();
      setAppConfig(newConfig);
      return true;
    } catch (err) {
      console.error('Config保存に失敗:', err);
      setConfigSaveError(err.message);
      return false;
    } finally {
      setIsSavingConfig(false);
    }
  };

  // ─── Circular-dep bridge ─────────────────────────────────────────────────
  // useDocumentOpen needs setCurrentPage (from usePageView), but usePageView
  // needs documentData (from useDocumentOpen). A stable ref breaks the cycle:
  // the ref is written once per render (safe for a setter, which is stable),
  // and onDocumentLoaded reads it asynchronously after fetch completes.
  const setCurrentPageRef = useRef(() => {});

  // ─── Document open pipeline ──────────────────────────────────────────────
  // openDocument / openDocumentById / openDocumentByPath are the single entry
  // point for loading a document. Vault Files panel, future command palette,
  // and future file-menu / registerView all funnel through here.
  const {
    docId, setDocId,
    documentData, setDocumentData,
    loading, error,
    pageEdits, setPageEdits,
    pageCorrections, setPageCorrections,
    isOcrRunning,
    openDocument,
    reloadDocument,
    runOcr,
    runOcrPage,
  } = useDocumentOpen({
    // page: the targetPage forwarded by reloadDocument(); null means new-doc open → page 0
    onDocumentLoaded: (data, page) => {
      const maxPage = (data?.ocr_pages?.length ?? 1) - 1;
      setCurrentPageRef.current(Math.min(page ?? 0, maxPage));
    },
  });
  // openDocumentById / openDocumentByPath are exported from the hook and available
  // for future Obsidian command / file-menu wiring — not used in App.jsx directly.

  // ─── Page / view navigation ──────────────────────────────────────────────
  // Receives documentData so totalPages and seamless-scroll effects stay in sync.
  const {
    viewMode, setViewMode: _setViewMode,
    currentPage, setCurrentPage,
    totalPages,
    imageContainerRef, pageBlockRefs,
    handleNextPage, handlePrevPage, handleSeamlessImageClick,
    scrollToPage,
  } = usePageView(documentData, settings.display.viewMode);

  // viewMode 変更時に settings にも永続化する
  const setViewMode = (mode) => {
    _setViewMode(mode);
    updateSetting('display', 'viewMode', mode);
  };

  // Keep the bridge ref in sync with the stable setter after every commit.
  // useLayoutEffect runs synchronously after DOM mutations, ensuring the ref is
  // current before any async onDocumentLoaded callback can fire.
  useLayoutEffect(() => { setCurrentPageRef.current = setCurrentPage; });

  // ─── Import state ────────────────────────────────────────────────────────
  const [isImporting, setIsImporting] = useState(false);

  // ─── UI state (not persisted in settings.js) ─────────────────────────────
  const [historyLimit, setHistoryLimit] = useState(() => {
    try { return parseInt(localStorage.getItem('ocr_history_limit') || '10', 10); } catch { return 10; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(() => settings.panel.openOnStartup);
  const [showDictManager, setShowDictManager] = useState(false);
  const [fileHistory, setFileHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('ocr_file_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      // Deduplicate by basename: keep only first (most recent) occurrence per filename
      const seen = new Set();
      return parsed.filter(item => {
        const name = item.split('/').pop() || item;
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    } catch { return []; }
  });

  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [historyFocusedIndex, setHistoryFocusedIndex] = useState(-1);
  const [copiedHistoryItem, setCopiedHistoryItem] = useState(null);
  const historyDropdownRef = useRef(null);
  const historyListRef = useRef(null);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const proofreaderRef = useRef(null);

  // ─── Image zoom & pan ────────────────────────────────────────────────────
  const [imageZoom, setImageZoom] = useState(1.0);
  const imageZoomRef = useRef(1.0);
  const viewModeRef = useRef(viewMode);
  const imageWrapperRef = useRef(null);       // paged-mode only
  const seamlessContentRef = useRef(null);    // seamless-mode content wrapper
  const imagePanRef = useRef({ x: 0, y: 0 });
  const isImageHoveredRef = useRef(false);

  useEffect(() => { imageZoomRef.current = imageZoom; }, [imageZoom]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // Reset zoom and pan on document or page change
  useEffect(() => {
    setImageZoom(1.0);
    imagePanRef.current = { x: 0, y: 0 };
    if (imageWrapperRef.current) imageWrapperRef.current.style.transform = '';
  }, [documentData?.doc_id, currentPage]);

  // On every zoom change: reset pan and apply zoom
  useEffect(() => {
    imagePanRef.current = { x: 0, y: 0 };
    // Paged mode: scale transform on the single wrapper
    if (imageWrapperRef.current) {
      imageWrapperRef.current.style.transform =
        imageZoom === 1.0 ? '' : `scale(${imageZoom})`;
    }
  }, [imageZoom]);

  // Wheel zoom — non-passive to allow preventDefault
  // Paged mode: any scroll zooms (no Ctrl required)
  // Seamless mode: Ctrl+scroll zooms only (normal scroll navigates pages)
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;
    const onWheel = (e) => {
      if (viewModeRef.current !== 'paged' && !e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setImageZoom(prev => Math.min(4.0, Math.max(0.3, +(prev + delta).toFixed(2))));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentData?.doc_id]);

  // Left-click drag to pan:
  //   paged mode    → transform on imageWrapperRef (DOM direct, no re-render)
  //   seamless mode → scrollLeft/scrollTop on container
  //   In seamless mode, the page-block onClick fires after mouseup — suppress it when dragged.
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;
    let isDragging = false;
    let hasDragged = false;
    let startX = 0, startY = 0;
    let origX = 0, origY = 0;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      // In paged mode, pan only when zoomed in
      if (viewModeRef.current !== 'seamless' && imageZoomRef.current <= 1) return;
      isDragging = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      if (viewModeRef.current === 'seamless') {
        origX = container.scrollLeft;
        origY = container.scrollTop;
        // scroll-behavior: smooth conflicts with direct scrollTop assignment — disable during drag
        container.style.scrollBehavior = 'auto';
      } else {
        origX = imagePanRef.current.x;
        origY = imagePanRef.current.y;
      }
      container.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
      if (viewModeRef.current === 'seamless') {
        container.scrollLeft = origX - dx;
        container.scrollTop  = origY - dy;
      } else {
        const x = origX + dx;
        const y = origY + dy;
        imagePanRef.current = { x, y };
        if (imageWrapperRef.current) {
          const zoom = imageZoomRef.current;
          imageWrapperRef.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        }
      }
    };
    const onMouseUp = (e) => {
      if (e.button !== 0 || !isDragging) return;
      isDragging = false;
      container.style.cursor = 'grab';
      if (viewModeRef.current === 'seamless') {
        container.style.scrollBehavior = ''; // restore CSS scroll-behavior: smooth
      }
      if (hasDragged) {
        window.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        }, { capture: true, once: true });
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentData?.doc_id]);

  // +/-/0 keyboard shortcuts when image panel is hovered
  useEffect(() => {
    const handler = (e) => {
      if (!isImageHoveredRef.current) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setImageZoom(prev => Math.min(4.0, +(prev + 0.2).toFixed(2)));
      } else if (e.key === '-') {
        e.preventDefault();
        setImageZoom(prev => Math.max(0.3, +(prev - 0.2).toFixed(2)));
      } else if (e.key === '0') {
        e.preventDefault();
        setImageZoom(1.0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Page jump ───────────────────────────────────────────────────────────
  const [pageInputValue, setPageInputValue] = useState('1');

  // ─── Bulk OCR state ──────────────────────────────────────────────────────
  const [ocrBulkState, setOcrBulkState] = useState({
    isRunning: false, isComplete: false, done: 0, total: 0, failed: [], isInitialFallback: false,
  });
  const ocrBulkTimerRef = useRef(null);

  // ─── Correction log management ────────────────────────────────────────────
  const handleCorrectionAccepted = (entry, pageNum) => {
    if (!Number.isInteger(pageNum) || pageNum < 1) return;
    const occMatch = /p\d+_o(\d+)_s\d+/.exec(entry.spanId ?? '');
    const augmented = {
      ...entry,
      span_id: entry.span_id ?? entry.spanId ?? '',
      occurrence_index: entry.occurrence_index ?? (occMatch ? parseInt(occMatch[1], 10) : 0),
    };
    setPageCorrections(prev => ({
      ...prev,
      [pageNum]: [...(prev[pageNum] || []), augmented],
    }));
  };

  const handleRemoveLastCorrection = (pageNum, spanId) => {
    setPageCorrections(prev => {
      const entries = prev[pageNum] || [];
      let lastIdx = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if ((entries[i].span_id || entries[i].spanId) === spanId) { lastIdx = i; break; }
      }
      if (lastIdx === -1) return prev;
      return { ...prev, [pageNum]: [...entries.slice(0, lastIdx), ...entries.slice(lastIdx + 1)] };
    });
  };

  const handleBulkSetPageCorrections = useCallback((pageCorrectionsData) => {
    setPageCorrections(prev =>
      settings.import.defaultBehavior === 'replace'
        ? pageCorrectionsData
        : { ...prev, ...pageCorrectionsData }
    );
  }, [settings.import.defaultBehavior, setPageCorrections]);

  // ─── File open ────────────────────────────────────────────────────────────
  // Thin App-layer wrapper: updates file history then delegates to openDocument.
  // Future entry points (command palette, file-menu) bypass this wrapper and
  // call openDocumentById / openDocumentByPath directly from useDocumentOpen.
  const handlePageJump = (value) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      setCurrentPage(n - 1);
    } else {
      setPageInputValue(String(currentPage + 1));
    }
  };

  const handleLoadDocument = (id) => {
    if (!id || ocrBulkState.isRunning) return;
    openDocument(id);
    setFileHistory(prev => {
      const basename = id.split('/').pop() || id;
      const filtered = prev.filter(item => item !== id && (item.split('/').pop() || item) !== basename);
      const newHistory = [id, ...filtered].slice(0, 50);
      localStorage.setItem('ocr_file_history', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const removeFromHistory = (itemToRemove) => {
    setFileHistory(prev => {
      const newHistory = prev.filter(item => item !== itemToRemove);
      localStorage.setItem('ocr_file_history', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  // ─── Page restore after reload ───────────────────────────────────────────
  // Call after every reloadDocument()+setCurrentPage() to ensure seamless mode
  // also scrolls to the correct page before the IntersectionObserver fires.
  const restorePageAfterReload = (page) => {
    setCurrentPage(page);
    scrollToPage(page); // sets isUserScrolling=false, suppresses Observer during scroll
  };

  // ─── Toast helper ────────────────────────────────────────────────────────
  const showToast = (msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  // ─── Open in Obsidian ────────────────────────────────────────────────────
  const handleOpenInObsidian = () => {
    if (!docId) {
      showToast('ノートが開かれていません');
      return;
    }
    const vaultName = settings.obsidian?.vaultName || deriveVaultName(configStatus?.vault_root);
    if (!vaultName) {
      showToast('Vault名が未設定です。設定 > OBSIDIAN から Vault名を入力してください。');
      return;
    }
    const uri = buildObsidianUri(vaultName, docId);
    if (!uri) {
      showToast('Obsidian URI を生成できませんでした');
      return;
    }
    window.location.href = uri;
  };

  // ─── Completion status ───────────────────────────────────────────────────
  const handleMarkComplete = async () => {
    if (!documentData) return;
    const propName = settings.document.statusPropertyName;
    const targetValue = settings.document.completionStatusValue;
    if (!window.confirm(
      `このドキュメントの completion status を ${targetValue} に設定します。\n` +
      `(property: "${propName}")\n\n続行しますか？`
    )) return;
    const pageToRestore = currentPage;
    try {
      await updateDocumentStatus(docId, propName, targetValue);
      await reloadDocument(pageToRestore);
      restorePageAfterReload(pageToRestore);
      showToast(`Document status → ${targetValue}`);
    } catch (err) {
      alert('ステータス更新エラー: ' + err.message);
    }
  };

  const handleStatusChange = async (rawValue) => {
    if (!documentData) return;
    const propName = settings.document.statusPropertyName;
    const numVal = Number(rawValue);
    const value = isNaN(numVal) ? rawValue : numVal;
    setDocumentData(prev => ({
      ...prev,
      frontmatter: { ...(prev.frontmatter || {}), [propName]: value },
    }));
    try {
      await updateDocumentStatus(docId, propName, value);
      showToast(`status → ${value}`);
    } catch (err) {
      const pageToRestore = currentPage;
      await reloadDocument(pageToRestore);
      restorePageAfterReload(pageToRestore);
      alert('ステータス更新エラー: ' + err.message);
    }
  };

  // ─── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!documentData) return;
    const savedPageCount = Object.keys(pageEdits).length;
    const pageToRestore = currentPage;
    try {
      if (savedPageCount > 0) {
        for (const [pageNum, editedText] of Object.entries(pageEdits)) {
          const page = parseInt(pageNum, 10);
          if (!Number.isInteger(page) || page < 1) {
            throw new Error(
              `無効なページ番号 "${pageNum}" が検出されました。` +
              `ページを再度開いて編集し直してから保存してください。`
            );
          }
          await saveDocumentPage(docId, {
            corrected_markdown: documentData.markdown_content,
            corrected_ocr: editedText,
            save_page: page,
            corrections: normalizeCorrections(pageCorrections[page]),
          });
        }
      } else {
        await saveDocumentPage(docId, {
          corrected_markdown: documentData.markdown_content,
          corrections: [],
        });
      }
      setPageEdits({});
      await reloadDocument(pageToRestore);
      restorePageAfterReload(pageToRestore);
      showToast(savedPageCount > 0 ? `保存完了 — OCR ${savedPageCount}p + Markdown` : '保存完了 — Markdown');
    } catch (err) {
      console.error('Save error:', err);
      alert('保存エラー: ' + err.message);
    }
  };

  // ─── Export / Import ──────────────────────────────────────────────────────
  const handleExportJson = () => {
    const docIdStr = docId || documentData?.doc_id || '';
    const timestamp = new Date().toISOString();
    const rows = buildExportRows(pageCorrections, docIdStr, timestamp);
    downloadAsJson(rows, getExportFilename(docIdStr, 'json'));
  };

  const handleExportCsv = () => {
    const docIdStr = docId || documentData?.doc_id || '';
    const timestamp = new Date().toISOString();
    const rows = buildExportRows(pageCorrections, docIdStr, timestamp);
    if (rows.length === 0) { alert('補正データがありません'); return; }
    downloadAsCsv(rows, getExportFilename(docIdStr, 'csv'));
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsImporting(true);
    try {
      const text = await file.text();
      const rows = parseImportRows(text, file.name);

      const REQUIRED = ['doc_id', 'page', 'span_id', 'occurrence_index', 'correction_mode'];
      const validRows = rows.filter(row => {
        if (!REQUIRED.every(f => row[f] !== undefined && row[f] !== null && String(row[f]).trim() !== '')) return false;
        if (row.selected_candidate === undefined || row.selected_candidate === null) return false;
        return true;
      });
      const skipped = rows.length - validRows.length;
      if (skipped > 0) console.warn(`Import: ${skipped}行が必須フィールド不足のためスキップ`);

      const currentDocId = docId || documentData?.doc_id || '';
      const docRows = validRows.filter(row => {
        if (row.doc_id !== currentDocId) {
          console.warn(`Import: doc_id不一致スキップ: "${row.doc_id}"`);
          return false;
        }
        return true;
      });

      if (docRows.length === 0) {
        alert(
          `このドキュメント（${currentDocId}）に対応する補正データが見つかりませんでした。\n` +
          `別の doc_id のファイルかもしれません。`
        );
        return;
      }

      await proofreaderRef.current?.importCorrections(docRows, pageCorrections);
    } catch (err) {
      alert(`インポートに失敗しました:\n${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // ─── Bulk OCR ─────────────────────────────────────────────────────────────
  const runBulkOcr = async () => {
    if (ocrBulkState.isRunning || isOcrRunning || !documentData) return;
    const id = docId || documentData.doc_id;
    if (!id) return;

    if (ocrBulkTimerRef.current) { clearTimeout(ocrBulkTimerRef.current); ocrBulkTimerRef.current = null; }

    const pages = documentData.ocr_pages || [];
    const hasIndexedImages = pages.some(p => p.image_name);
    const hasAnyOcrText = pages.some(p => p.ocr_text?.trim());

    if (!hasIndexedImages || !hasAnyOcrText) {
      // 初回文書またはOCR未実行: 一括OCR（リネーム含む）にフォールバック
      setOcrBulkState({ isRunning: true, isComplete: false, done: 0, total: 0, failed: [], isInitialFallback: true });
      const pageToRestore = currentPage;
      try {
        await apiRunOcrForDocument(id, { statusPropertyName: settings.document.statusPropertyName });
        await reloadDocument(pageToRestore);
        restorePageAfterReload(pageToRestore);
      } catch (err) {
        console.error('Bulk OCR (initial fallback) failed:', err);
      }
      setOcrBulkState(s => ({ ...s, isRunning: false, isComplete: true }));
      ocrBulkTimerRef.current = setTimeout(() => {
        setOcrBulkState({ isRunning: false, isComplete: false, done: 0, total: 0, failed: [], isInitialFallback: false });
        ocrBulkTimerRef.current = null;
      }, 3000);
      return;
    }

    // ページ別 OCR (OCRテキスト未取得かつ image_name があるページのみ対象)
    const targetPages = pages
      .map((p, i) => ({ pageNum: i + 1, ...p }))
      .filter(p => !p.ocr_text?.trim() && p.image_name);

    if (targetPages.length === 0) return;

    setOcrBulkState({ isRunning: true, isComplete: false, done: 0, total: targetPages.length, failed: [], isInitialFallback: false });

    const newFailed = [];
    for (const { pageNum } of targetPages) {
      try {
        await apiRunOcrForPage(id, pageNum);
      } catch {
        newFailed.push(pageNum);
      }
      setOcrBulkState(prev => ({ ...prev, done: prev.done + 1 }));
    }

    await reloadDocument(currentPage);
    restorePageAfterReload(currentPage);

    setOcrBulkState(prev => ({ ...prev, isRunning: false, isComplete: true, failed: newFailed }));
    ocrBulkTimerRef.current = setTimeout(() => {
      setOcrBulkState({ isRunning: false, isComplete: false, done: 0, total: 0, failed: [], isInitialFallback: false });
      ocrBulkTimerRef.current = null;
    }, 3000);
  };

  // ─── Effects ──────────────────────────────────────────────────────────────
  // Sync page jump input when currentPage changes externally
  useEffect(() => { setPageInputValue(String(currentPage + 1)); }, [currentPage]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (ocrBulkTimerRef.current) clearTimeout(ocrBulkTimerRef.current);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Reset bulk OCR state when a different document is loaded
  useEffect(() => {
    if (ocrBulkTimerRef.current) { clearTimeout(ocrBulkTimerRef.current); ocrBulkTimerRef.current = null; }
    setOcrBulkState({ isRunning: false, isComplete: false, done: 0, total: 0, failed: [], isInitialFallback: false });
  }, [documentData?.doc_id]);

  useEffect(() => { openDocument(docId); }, []);

  useEffect(() => {
    if (settings.panel.openOnStartup) vaultFiles.loadFileList();
  }, []);

  // Close file browser with Escape
  useEffect(() => {
    if (!showFileBrowser) return;
    const handler = (e) => { if (e.key === 'Escape') setShowFileBrowser(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showFileBrowser]);

  // Close settings modal with Escape (capturingKey handler is in capture phase and takes priority)
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e) => { if (e.key === 'Escape') setShowSettings(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSettings]);

  // Ref to give document click handler access to current dropdown state
  // (avoids stale closure; updated synchronously on every render)
  const historyDropdownOpenRef = useRef(false);
  useEffect(() => { historyDropdownOpenRef.current = historyDropdownOpen; }, [historyDropdownOpen]);

  // Always-mounted document click handler — no add/remove timing race
  useEffect(() => {
    const handler = (e) => {
      if (!historyDropdownOpenRef.current) return;
      if (historyDropdownRef.current?.contains(e.target)) return;
      setHistoryDropdownOpen(false);
      setHistoryFocusedIndex(-1);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Scroll focused history item into view on keyboard navigation
  useEffect(() => {
    if (!historyDropdownOpen || historyFocusedIndex < 0 || !historyListRef.current) return;
    const items = historyListRef.current.querySelectorAll('.history-dropdown-item');
    items[historyFocusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [historyFocusedIndex, historyDropdownOpen]);

  // Keyboard navigation for history dropdown
  const handleHistoryKeyDown = (e) => {
    if (!historyDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHistoryDropdownOpen(true);
        setHistoryFocusedIndex(e.key === 'ArrowDown' ? 0 : displayedHistory.length - 1);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setHistoryDropdownOpen(false);
      setHistoryFocusedIndex(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistoryFocusedIndex(prev => (prev < displayedHistory.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistoryFocusedIndex(prev => (prev > 0 ? prev - 1 : displayedHistory.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (historyFocusedIndex >= 0 && historyFocusedIndex < displayedHistory.length) {
        handleLoadDocument(displayedHistory[historyFocusedIndex]);
        setHistoryDropdownOpen(false);
        setHistoryFocusedIndex(-1);
      }
    }
  };



  // ─── Derived ──────────────────────────────────────────────────────────────
  const displayedHistory = fileHistory.slice(0, historyLimit);
  const currentImagePath =
    documentData?.ocr_pages?.[currentPage]?.image_path ||
    documentData?.image_paths?.[currentPage] ||
    documentData?.image_path;

  const appStyle = { '--font-size': `${settings.display.fontSize}rem`, '--line-height': settings.display.lineHeight };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container" style={appStyle}>
      <header className="app-header">
        <h1>影印校エディタ</h1>
        <div className="header-controls">
          <div className="search-bar">
            <button
              className={`btn-icon ${showFileBrowser ? 'active' : ''}`}
              onClick={() => {
                if (!showFileBrowser) vaultFiles.loadFileList();
                setShowFileBrowser(v => !v);
              }}
              title="ファイル一覧 (Vault Files)"
            >📂</button>
            <button
              className={`btn-icon ${showDictManager ? 'active' : ''}`}
              onClick={() => setShowDictManager(v => !v)}
              title="辞書管理"
            >📖</button>
            <button
              className={`btn-icon ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="設定"
            >⚙️</button>
            <div className="search-input-wrapper">
              <input
                type="text"
                className="search-input"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLoadDocument(docId);
                  if (e.key === 'ArrowDown' && fileHistory.length > 0) {
                    e.preventDefault();
                    setHistoryDropdownOpen(true);
                    setHistoryFocusedIndex(0);
                  }
                }}
                placeholder="ファイル名またはパス"
              />
              {docId && (
                <button
                  className="search-input-clear"
                  onClick={() => setDocId('')}
                  title="クリア"
                >×</button>
              )}
            </div>
            <div
              className="history-dropdown-wrapper"
              ref={historyDropdownRef}
              onKeyDown={handleHistoryKeyDown}
            >
              <button
                className={`search-input-history-btn ${historyDropdownOpen ? 'active' : ''}`}
                onClick={() => { setHistoryDropdownOpen(v => !v); setHistoryFocusedIndex(-1); }}
                title="履歴から選択 (↓/↑ キーでナビゲート)"
                aria-haspopup="listbox"
                aria-expanded={historyDropdownOpen}
              >▼</button>
              {historyDropdownOpen && (
                <div
                  className="history-dropdown-list"
                  ref={historyListRef}
                  role="listbox"
                >
                  {displayedHistory.length === 0
                    ? <div className="history-dropdown-empty">履歴なし</div>
                    : displayedHistory.map((item, index) => (
                      <div
                        key={index}
                        className={`history-dropdown-item${historyFocusedIndex === index ? ' history-dropdown-item-focused' : ''}`}
                        role="option"
                        aria-selected={historyFocusedIndex === index}
                        onMouseEnter={() => setHistoryFocusedIndex(index)}
                      >
                        <span
                          className="history-dropdown-item-name"
                          onClick={() => { handleLoadDocument(item); setHistoryDropdownOpen(false); setHistoryFocusedIndex(-1); }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            navigator.clipboard.writeText(item);
                            setCopiedHistoryItem(item);
                            setTimeout(() => setCopiedHistoryItem(null), 1500);
                          }}
                          title={item}
                        >{copiedHistoryItem === item ? 'コピーしました' : item}</span>
                        <button
                          className="history-dropdown-item-remove"
                          onClick={(e) => { e.stopPropagation(); removeFromHistory(item); }}
                          title="履歴から削除"
                          tabIndex={-1}
                        >×</button>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
            <button className="btn" onClick={() => handleLoadDocument(docId)} disabled={ocrBulkState.isRunning}>読み込み</button>
          </div>

          {documentData && (
            <div
              className="doc-status-select-wrapper"
              title={`Document status (property: ${settings.document.statusPropertyName})`}
            >
              <span className="doc-status-label">status:</span>
              <select
                className="doc-status-select"
                value={String(documentData.frontmatter?.[settings.document.statusPropertyName] ?? '')}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={ocrBulkState.isRunning}
              >
                <option value="">–</option>
                {(settings.document.statusOptions || []).map(opt => (
                  <option key={opt} value={String(opt)}>{opt}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn btn-success" onClick={handleSave}>保存</button>
          {documentData && (
            <button
              className="btn btn-complete"
              onClick={handleMarkComplete}
              title={`Set completion status to ${settings.document.completionStatusValue}`}
            >Complete</button>
          )}
          {documentData && (
            <button
              className="btn btn-obsidian"
              onClick={handleOpenInObsidian}
              title="Obsidian で現在のノートを開く"
            >Obsidianで開く</button>
          )}
        </div>
      </header>

      <main
        className={`workspace ${isDragging ? 'is-dragging' : ''}`}
        ref={workspaceRef}
      >
        {showSettings && (
          <SettingsSidebar
            settings={settings}
            updateSetting={updateSetting}
            onViewModeChange={setViewMode}
            historyLimit={historyLimit}
            onHistoryLimitChange={(val) => {
              setHistoryLimit(val);
              localStorage.setItem('ocr_history_limit', String(val));
            }}
            keybindings={keybindings}
            capturingKey={capturingKey}
            setCapturingKey={setCapturingKey}
            resetKeybindings={resetKeybindings}
            isRescanning={vaultFiles.isRescanning}
            rescanNotice={vaultFiles.rescanNotice}
            onVaultRescan={vaultFiles.handleVaultRescan}
            onExportCsv={handleExportCsv}
            onExportJson={handleExportJson}
            onImportFile={handleImportFile}
            isImporting={isImporting}
            onFlushEvents={flushToBackend}
            onOcrSettingChange={handleOcrSettingChange}
            onDictionarySettingChange={handleDictionarySettingChange}
            appConfig={appConfig}
            configStatus={configStatus}
            onConfigUpdate={handleConfigUpdate}
            isSavingConfig={isSavingConfig}
            configSaveError={configSaveError}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showDictManager && (
          <DictionaryManager onClose={() => setShowDictManager(false)} />
        )}

        {showFileBrowser && (
          <div className="vault-backdrop" onClick={() => setShowFileBrowser(false)} />
        )}
        {showFileBrowser && (
          <FileBrowserSidebar
            settings={settings}
            fileList={vaultFiles.fileList}
            newlyAddedFiles={vaultFiles.newlyAddedFiles}
            isRescanning={vaultFiles.isRescanning}
            rescanNotice={vaultFiles.rescanNotice}
            onVaultRescan={vaultFiles.handleVaultRescan}
            docId={docId}
            onFileSelect={(path) => {
              handleLoadDocument(path);
              if (settings.panel.autoCloseAfterSelect) setShowFileBrowser(false);
            }}
            onClose={() => setShowFileBrowser(false)}
          />
        )}

        {loading && !documentData && <div className="loading">読み込み中...</div>}
        {error && <div className="error-msg">{error}</div>}

        {documentData && (
          <>
            <div className="panel image-panel" style={{ width: `${splitRatio}%` }}>
              <div className="panel-header">
                SOURCE IMAGE
                {totalPages > 0 && (
                  <span className="page-info">{currentPage + 1} / {totalPages} ページ</span>
                )}
                {imageZoom !== 1.0 && (
                  <button
                    className="zoom-reset-btn"
                    onClick={() => setImageZoom(1.0)}
                    title="ズームリセット (0)"
                  >{Math.round(imageZoom * 100)}%</button>
                )}
              </div>
              <div
                ref={imageContainerRef}
                className={`panel-content image-container ${viewMode === 'seamless' ? 'seamless-scroll' : ''}`}
                style={viewMode === 'paged'
                  ? { overflow: 'hidden', cursor: imageZoom > 1 ? 'grab' : 'default', userSelect: 'none' }
                  : { cursor: 'grab', userSelect: 'none' }}
                onContextMenu={(e) => e.preventDefault()}
                onMouseEnter={() => { isImageHoveredRef.current = true; }}
                onMouseLeave={() => { isImageHoveredRef.current = false; }}
              >
                {viewMode === 'paged' ? (
                  currentImagePath
                    ? (
                      <div
                        ref={imageWrapperRef}
                        className="image-zoom-wrapper image-fit"
                        style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                        onDoubleClick={() => setImageZoom(prev => prev === 1.0 ? 2.0 : 1.0)}
                      >
                        <img src={getImageUrl(currentImagePath)} alt={`Page ${currentPage + 1}`} draggable="false" />
                      </div>
                    )
                    : <div className="placeholder-msg">No image found</div>
                ) : (
                  <div ref={seamlessContentRef} style={{ width: '100%' }}>
                    {documentData.ocr_pages && documentData.ocr_pages.length > 0
                      ? documentData.ocr_pages.map((page, idx) => (
                        <div
                          key={idx}
                          className={`seamless-page-block ${idx === currentPage ? 'seamless-active' : ''}`}
                          data-page-idx={idx}
                          ref={el => pageBlockRefs.current[idx] = el}
                          onClick={() => handleSeamlessImageClick(idx)}
                        >
                          <div className="seamless-page-label">── Page {idx + 1} ──</div>
                          {page.image_path
                            ? (
                              <div
                                className={`image-zoom-wrapper${imageZoom === 1.0 ? ' image-fit-width' : ''}`}
                                style={{ width: imageZoom === 1.0 ? '100%' : `${imageZoom * 100}%` }}
                              >
                                <img src={getImageUrl(page.image_path)} alt={`Page ${idx + 1}`} draggable="false" />
                              </div>
                            )
                            : <div className="placeholder-msg">No image</div>}
                        </div>
                      ))
                      : (documentData.image_paths || []).map((path, idx) => (
                        <div
                          key={idx}
                          className={`seamless-page-block ${idx === currentPage ? 'seamless-active' : ''}`}
                          data-page-idx={idx}
                          ref={el => pageBlockRefs.current[idx] = el}
                          onClick={() => handleSeamlessImageClick(idx)}
                        >
                          <div className="seamless-page-label">── Page {idx + 1} ──</div>
                          <div
                            className={`image-zoom-wrapper${imageZoom === 1.0 ? ' image-fit-width' : ''}`}
                            style={{ width: imageZoom === 1.0 ? '100%' : `${imageZoom * 100}%` }}
                          >
                            <img src={getImageUrl(path)} alt={`Page ${idx + 1}`} draggable="false" />
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
              {viewMode === 'paged' && totalPages > 1 && (
                <div className="page-nav">
                  <button
                    className="nav-btn"
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >◀ 前</button>
                  <div className="page-dots">
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        className={`page-dot ${i === currentPage ? 'active' : ''}`}
                        onClick={() => setCurrentPage(i)}
                      >{i + 1}</button>
                    ))}
                  </div>
                  <input
                    type="number"
                    className="page-jump-input"
                    min={1}
                    max={totalPages}
                    value={pageInputValue}
                    onChange={(e) => {
                      setPageInputValue(e.target.value);
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 1 && n <= totalPages) setCurrentPage(n - 1);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    onBlur={() => {
                      const n = parseInt(pageInputValue, 10);
                      if (isNaN(n) || n < 1 || n > totalPages) setPageInputValue(String(currentPage + 1));
                    }}
                    aria-label="ページ番号入力"
                  />
                  <span className="page-jump-sep">/ {totalPages}</span>
                  <button
                    className="nav-btn"
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage === totalPages - 1}
                  >次 ▶</button>
                </div>
              )}
            </div>

            <div className="workspace-resizer" onMouseDown={handleMouseDown} />

            <div className="panel text-panel">
              <div className="panel-header">
                EDITOR
                <span className="doc-title">{documentData.resolved_name}</span>
                <button
                  className="btn-bulk-ocr"
                  onClick={runBulkOcr}
                  disabled={ocrBulkState.isRunning || isOcrRunning}
                  title="OCRテキスト未取得のページを一括処理します"
                >全ページOCR</button>
              </div>
              {(ocrBulkState.isRunning || ocrBulkState.isComplete) && (
                <div className="ocr-controls-bar">
                  {ocrBulkState.isInitialFallback ? (
                    <span className="ocr-fallback-note">初回文書のため従来の一括OCRにフォールバックします</span>
                  ) : (
                    <div className="ocr-progress-track">
                      <div
                        className={`ocr-progress-fill${ocrBulkState.isComplete && ocrBulkState.failed.length === 0 ? ' ocr-progress-done' : ''}`}
                        style={{ width: `${ocrBulkState.total ? (ocrBulkState.done / ocrBulkState.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                  <span className="ocr-progress-status">
                    {ocrBulkState.isRunning
                      ? ocrBulkState.isInitialFallback
                        ? 'OCR実行中...'
                        : `実行中 ${ocrBulkState.done}/${ocrBulkState.total}ページ`
                      : '完了'}
                  </span>
                  {ocrBulkState.failed.length > 0 && (
                    <span className="ocr-error-inline">
                      失敗 {ocrBulkState.failed.length}件: p{ocrBulkState.failed.join(', p')}
                    </span>
                  )}
                </div>
              )}
              <div className="panel-content">
                <Proofreader
                  ref={proofreaderRef}
                  document={documentData}
                  currentPage={currentPage}
                  viewMode={viewMode}
                  onDocumentChange={(newContent) => {
                    setDocumentData(prev => ({ ...prev, markdown_content: newContent }));
                  }}
                  onOcrChange={(newOcr, pageNum) => {
                    if (!Number.isInteger(pageNum) || pageNum < 1) {
                      console.error(`無効なページ番号 (${pageNum}) のため編集を保存できません`);
                      return;
                    }
                    setPageEdits(prev => ({ ...prev, [pageNum]: newOcr }));
                  }}
                  isOcrRunning={isOcrRunning || ocrBulkState.isRunning}
                  runOcr={runBulkOcr}
                  runOcrPage={runOcrPage}
                  onCorrectionAccepted={handleCorrectionAccepted}
                  onRemoveLastCorrection={handleRemoveLastCorrection}
                  onBulkSetPageCorrections={handleBulkSetPageCorrections}
                  keybindings={keybindings}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                  bulkKatakanaThreshold={settings.document.bulkKatakanaThreshold ?? 0.85}
                  onRegisterTemporaryTerm={handleRegisterTemporaryTerm}
                />
              </div>
            </div>
          </>
        )}
      </main>

      {toast && <div className="app-toast">{toast}</div>}
    </div>
  );
}

export default App;
