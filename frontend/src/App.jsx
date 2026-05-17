import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import Proofreader from './components/Proofreader';
import SettingsSidebar from './components/SettingsSidebar';
import FileBrowserSidebar from './components/FileBrowserSidebar';
import './App.css';

import { useSettings } from './state/useSettings';
import { useKeybindings } from './state/useKeybindings';
import { useSplitPane } from './state/useSplitPane';
import { usePageView } from './state/usePageView';
import { useVaultFiles } from './state/useVaultFiles';
import { useDocumentOpen } from './state/useDocumentOpen';

import { saveDocumentPage } from './services/documentService';
import {
  normalizeCorrections,
  buildExportRows,
  getExportFilename,
  downloadAsJson,
  downloadAsCsv,
  parseImportRows,
} from './services/correctionSerializer';

import { getImageUrl } from './utils/imageUrl';

function App() {
  // ─── Persistent settings & view preferences ─────────────────────────────
  const { settings, updateSetting } = useSettings();
  const { keybindings, capturingKey, setCapturingKey, resetKeybindings } = useKeybindings();
  const { splitRatio, isDragging, workspaceRef, handleMouseDown } = useSplitPane();
  const vaultFiles = useVaultFiles();

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
  } = useDocumentOpen({ onDocumentLoaded: () => setCurrentPageRef.current(0) });
  // openDocumentById / openDocumentByPath are exported from the hook and available
  // for future Obsidian command / file-menu wiring — not used in App.jsx directly.

  // ─── Page / view navigation ──────────────────────────────────────────────
  // Receives documentData so totalPages and seamless-scroll effects stay in sync.
  const {
    viewMode, setViewMode,
    currentPage, setCurrentPage,
    totalPages,
    imageContainerRef, pageBlockRefs,
    handleNextPage, handlePrevPage, handleSeamlessImageClick,
  } = usePageView(documentData);

  // Keep the bridge ref in sync with the stable setter after every commit.
  // useLayoutEffect runs synchronously after DOM mutations, ensuring the ref is
  // current before any async onDocumentLoaded callback can fire.
  useLayoutEffect(() => { setCurrentPageRef.current = setCurrentPage; });

  // ─── Import state ────────────────────────────────────────────────────────
  const [isImporting, setIsImporting] = useState(false);

  // ─── UI state (not persisted in settings.js) ─────────────────────────────
  const [fontSize, setFontSize] = useState(1.3);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [historyLimit, setHistoryLimit] = useState(() => {
    try { return parseInt(localStorage.getItem('ocr_history_limit') || '10', 10); } catch { return 10; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(() => settings.panel.openOnStartup);
  const [fileHistory, setFileHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('ocr_file_history');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const proofreaderRef = useRef(null);
  const importFileRef = useRef(null);

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
  const handleLoadDocument = (id) => {
    if (!id) return;
    openDocument(id);
    setFileHistory(prev => {
      const newHistory = [id, ...prev.filter(item => item !== id)].slice(0, 50);
      localStorage.setItem('ocr_file_history', JSON.stringify(newHistory));
      return newHistory;
    });
  };

  // ─── Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!documentData) return;
    try {
      if (Object.keys(pageEdits).length > 0) {
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
      await reloadDocument();
      alert('保存しました');
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

  // ─── Effects ──────────────────────────────────────────────────────────────
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

  // ─── Derived ──────────────────────────────────────────────────────────────
  const displayedHistory = fileHistory.slice(0, historyLimit);
  const currentImagePath =
    documentData?.ocr_pages?.[currentPage]?.image_path ||
    documentData?.image_paths?.[currentPage] ||
    documentData?.image_path;

  const appStyle = { '--font-size': `${fontSize}rem`, '--line-height': lineHeight };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container" style={appStyle}>
      <header className="app-header">
        <h1>Classical OCR Proofer</h1>
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
              className={`btn-icon ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="設定"
            >⚙️</button>
            <input
              type="text"
              className="search-input"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              placeholder="ファイル名またはパス"
              list="file-history"
            />
            <select
              className="search-input-history"
              value=""
              onChange={(e) => setDocId(e.target.value)}
              title="履歴から選択"
            >
              <option value="" disabled hidden>▼</option>
              {displayedHistory.length === 0
                ? <option value="" disabled>履歴なし</option>
                : displayedHistory.map((item, index) => (
                  <option key={index} value={item}>{item}</option>
                ))
              }
            </select>
            <datalist id="file-history">
              {displayedHistory.map((item, index) => <option key={index} value={item} />)}
            </datalist>
            <button className="btn" onClick={() => handleLoadDocument(docId)}>読み込み</button>
          </div>

          <button className="btn btn-success" onClick={handleSave}>保存</button>
          {documentData && (
            <>
              <button className="btn" onClick={handleExportJson} title="補正ログをJSONで書き出し">Export JSON</button>
              <button className="btn" onClick={handleExportCsv} title="補正ログをCSVで書き出し">Export CSV</button>
              <button
                className="btn"
                onClick={() => importFileRef.current?.click()}
                disabled={isImporting}
                title="補正ログ（JSON/CSV）を読み込んで補正状態を復元します"
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,.csv"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
            </>
          )}
        </div>
      </header>

      <main
        className={`workspace ${isDragging ? 'is-dragging' : ''} ${showSettings ? 'settings-open' : ''}`}
        ref={workspaceRef}
      >
        {showSettings && (
          <SettingsSidebar
            settings={settings}
            updateSetting={updateSetting}
            viewMode={viewMode}
            setViewMode={setViewMode}
            fontSize={fontSize}
            setFontSize={setFontSize}
            lineHeight={lineHeight}
            setLineHeight={setLineHeight}
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
            onClose={() => setShowSettings(false)}
          />
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

        {loading && <div className="loading">読み込み中...</div>}
        {error && <div className="error-msg">{error}</div>}

        {documentData && !loading && (
          <>
            <div className="panel image-panel" style={{ width: `${splitRatio}%` }}>
              <div className="panel-header">
                SOURCE IMAGE
                {totalPages > 0 && (
                  <span className="page-info">{currentPage + 1} / {totalPages} ページ</span>
                )}
              </div>
              <div
                ref={imageContainerRef}
                className={`panel-content image-container ${viewMode === 'seamless' ? 'seamless-scroll' : ''}`}
              >
                {viewMode === 'paged' ? (
                  currentImagePath
                    ? <img src={getImageUrl(currentImagePath)} alt={`Page ${currentPage + 1}`} />
                    : <div className="placeholder-msg">No image found</div>
                ) : (
                  documentData.ocr_pages && documentData.ocr_pages.length > 0
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
                          ? <img src={getImageUrl(page.image_path)} alt={`Page ${idx + 1}`} />
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
                        <img src={getImageUrl(path)} alt={`Page ${idx + 1}`} />
                      </div>
                    ))
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
              </div>
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
                  isOcrRunning={isOcrRunning}
                  runOcr={runOcr}
                  runOcrPage={runOcrPage}
                  onCorrectionAccepted={handleCorrectionAccepted}
                  onRemoveLastCorrection={handleRemoveLastCorrection}
                  onBulkSetPageCorrections={handleBulkSetPageCorrections}
                  keybindings={keybindings}
                  onNextPage={handleNextPage}
                  onPrevPage={handlePrevPage}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
