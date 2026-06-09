// Page navigation and seamless scroll — maps to WorkspaceLeaf / view state in Obsidian
import { useState, useEffect, useRef } from 'react';

export function usePageView(documentData, initialViewMode = 'paged') {
  const [viewMode, setViewMode] = useState(initialViewMode); // 'paged' | 'seamless'
  const [currentPage, setCurrentPage] = useState(0); // 0-indexed
  const imageContainerRef = useRef(null);
  const pageBlockRefs = useRef([]);
  const isUserScrolling = useRef(true);
  const totalPages = documentData?.ocr_pages?.length || 0;
  // Track the last confirmed non-null doc_id and viewMode so we can distinguish
  // "reload of same document" (doc_id: X→null→X) from "new document opened" (X→null→Y).
  const knownDocIdRef = useRef(null);
  const prevEffectViewModeRef = useRef(null);

  // Seamless mode: IntersectionObserver for scroll-linked page tracking
  useEffect(() => {
    if (viewMode !== 'seamless' || !totalPages) return;
    const container = imageContainerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!isUserScrolling.current) return;
        const activeEntry = entries.find(entry => entry.isIntersecting);
        if (activeEntry) {
          const idx = parseInt(activeEntry.target.dataset.pageIdx, 10);
          if (!isNaN(idx)) setCurrentPage(idx);
        }
      },
      { root: container, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    const timer = setTimeout(() => {
      pageBlockRefs.current.forEach(el => { if (el) observer.observe(el); });
    }, 200);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [viewMode, totalPages, documentData?.doc_id]);

  // Reset scroll position when switching to seamless OR when a genuinely different
  // document is opened. Does NOT reset on same-document reload (doc_id goes null→same).
  useEffect(() => {
    const docId = documentData?.doc_id ?? null;
    const viewModeJustBecameSeamless = viewMode === 'seamless' && prevEffectViewModeRef.current !== 'seamless';
    prevEffectViewModeRef.current = viewMode;

    // isNewDoc: docId became a non-null value different from the last seen non-null value
    const isNewDoc = docId !== null && docId !== knownDocIdRef.current;
    if (docId !== null) knownDocIdRef.current = docId;

    if (viewMode !== 'seamless' || !imageContainerRef.current) return;
    if (!viewModeJustBecameSeamless && !isNewDoc) return;

    isUserScrolling.current = false;
    imageContainerRef.current.scrollTop = 0;
    setCurrentPage(0);
    setTimeout(() => { isUserScrolling.current = true; }, 500);
  }, [viewMode, documentData?.doc_id]);

  const scrollToPage = (idx) => {
    if (viewMode !== 'seamless') return;
    const target = pageBlockRefs.current[idx];
    if (target && imageContainerRef.current) {
      isUserScrolling.current = false;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { isUserScrolling.current = true; }, 800);
    }
  };

  const handleNextPage = () => {
    const next = currentPage >= totalPages - 1 ? 0 : currentPage + 1;
    setCurrentPage(next);
    scrollToPage(next);
  };

  const handlePrevPage = () => {
    const prev = currentPage <= 0 ? totalPages - 1 : currentPage - 1;
    setCurrentPage(prev);
    scrollToPage(prev);
  };

  const handleSeamlessImageClick = (pageIdx) => {
    setCurrentPage(pageIdx);
    scrollToPage(pageIdx);
  };

  return {
    viewMode, setViewMode,
    currentPage, setCurrentPage,
    totalPages,
    imageContainerRef, pageBlockRefs,
    handleNextPage, handlePrevPage, handleSeamlessImageClick,
    scrollToPage,
  };
}
