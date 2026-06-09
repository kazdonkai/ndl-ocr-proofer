// Document open pipeline — encapsulates all "open a document" state and logic.
//
// This hook is the single authoritative entry point for opening documents.
// It replaces the ad-hoc inline state that previously lived in App.jsx and
// makes the open logic reusable from any future entry point:
//   - Vault Files panel  → openDocument(path)
//   - command palette    → openDocumentById(id)
//   - file-menu          → openDocumentByPath(tFile.path)  [future]
//   - registerView       → openDocument({ path: viewState.file })  [future]
//
// onDocumentLoaded(data) is called once after a successful fetch.
// App.jsx uses it to reset currentPage to 0 via usePageView.

import { useState, useRef, useEffect, useCallback } from 'react';
import { fetchDocument, runOcrForDocument, runOcrForPage } from '../services/documentService';
import { resolveDocumentRef } from '../services/openService';

export function useDocumentOpen({ onDocumentLoaded } = {}) {
  const [docId, setDocIdState] = useState('');
  const [documentData, setDocumentData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pageEdits, setPageEdits] = useState({});
  const [pageCorrections, setPageCorrections] = useState({});
  const [isOcrRunning, setIsOcrRunning] = useState(false);

  // Stable ref so async callbacks always see the latest docId without
  // being listed as a hook dependency (avoids stale closure in runOcr).
  const docIdRef = useRef('');
  const onDocumentLoadedRef = useRef(onDocumentLoaded);
  useEffect(() => { onDocumentLoadedRef.current = onDocumentLoaded; });

  const setDocId = useCallback((id) => {
    setDocIdState(id);
    docIdRef.current = id;
  }, []);

  // ─── Internal fetch (shared by open and reload) ──────────────────────────
  // targetPage: if non-null, forwarded to onDocumentLoaded so the caller can
  // restore a specific page after reload without a shared mutable ref.
  const _fetch = useCallback(async (id, targetPage = null) => {
    setLoading(true);
    setError(null);
    setDocumentData(null);
    setPageEdits({});
    setPageCorrections({});
    try {
      const data = await fetchDocument(id);
      setDocumentData(data);
      onDocumentLoadedRef.current?.(data, targetPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Open pipeline ───────────────────────────────────────────────────────

  // Main entry point — accepts any document reference (see openService.js).
  // Maps to: workspace.openLinkText(path, ...) in Obsidian plugin.
  const openDocument = useCallback(async (ref) => {
    const id = resolveDocumentRef(ref);
    if (!id) return;
    setDocId(id);
    return _fetch(id);
  }, [setDocId, _fetch]);

  // Named convenience aliases for explicit entry points.
  // These make future Obsidian hook-up sites self-documenting:
  //   command palette  → openDocumentById(activeDocId)
  //   file-menu item   → openDocumentByPath(tFile.path)
  const openDocumentById = useCallback((id) => openDocument(id), [openDocument]);
  const openDocumentByPath = useCallback((path) => openDocument({ type: 'path', value: path }), [openDocument]);

  // ─── Reload (after save / OCR) ───────────────────────────────────────────
  // Does NOT reset docId, does NOT null documentData, does NOT set loading.
  // Keeping panels mounted preserves scrollTop in seamless mode so the
  // IntersectionObserver cannot fire page-0 on a panel remount.
  // Using a ref (reassigned every render) bypasses useCallback HMR stale-closure.
  const _reloadRef = useRef(null);
  _reloadRef.current = async (targetPage = null) => {
    const id = docIdRef.current;
    if (!id) return;
    setPageEdits({});
    setPageCorrections({});
    try {
      const data = await fetchDocument(id);
      setDocumentData(data);
      onDocumentLoadedRef.current?.(data, targetPage);
    } catch (err) {
      setError(err.message);
    }
  };
  const reloadDocument = useCallback((targetPage = null) => {
    return _reloadRef.current(targetPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── OCR ─────────────────────────────────────────────────────────────────
  const runOcr = useCallback(async () => {
    const id = docIdRef.current;
    if (!id) return;
    setIsOcrRunning(true);
    try {
      await runOcrForDocument(id);
      await reloadDocument();
    } catch (err) {
      alert(`エラー: ${err.message}`);
    } finally {
      setIsOcrRunning(false);
    }
  }, [reloadDocument]);

  // pageNum: 1-based
  const runOcrPage = useCallback(async (pageNum) => {
    const id = docIdRef.current;
    if (!id) return;
    setIsOcrRunning(true);
    try {
      await runOcrForPage(id, pageNum);
      await reloadDocument();
    } catch (err) {
      alert(`エラー: ${err.message}`);
    } finally {
      setIsOcrRunning(false);
    }
  }, [reloadDocument]);

  return {
    // State
    docId,
    setDocId,
    documentData,
    setDocumentData,
    loading,
    error,
    pageEdits,
    setPageEdits,
    pageCorrections,
    setPageCorrections,
    isOcrRunning,
    // Open pipeline
    openDocument,
    openDocumentById,
    openDocumentByPath,
    reloadDocument,
    runOcr,
    runOcrPage,
  };
}
