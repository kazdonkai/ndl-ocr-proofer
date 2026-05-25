// Document load / OCR / save API — maps to future Obsidian file open / workspace.openLinkText

export async function fetchDocument(id) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}`);
  if (!res.ok) throw new Error('読み込み失敗');
  return await res.json();
}

export async function runOcrForDocument(id, { statusPropertyName = 'analyzed_status' } = {}) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}/run_ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status_property_name: statusPropertyName }),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || 'OCR実行に失敗しました');
  }
}

export async function runOcrForPage(id, page) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}/run_ocr_page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page }),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || `ページ ${page} のOCR実行に失敗しました`);
  }
  return await res.json();
}

export async function updateDocumentStatus(id, propertyName, value) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_name: propertyName, value }),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || 'ステータス更新に失敗しました');
  }
  return await res.json();
}

export async function getOcrSettings() {
  const res = await fetch('/api/settings/ocr');
  if (!res.ok) return { rename_images_before_ocr: true };
  return await res.json();
}

export async function updateOcrSettings(settings) {
  const res = await fetch('/api/settings/ocr', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || '設定の保存に失敗しました');
  }
  return await res.json();
}

export async function getDictionarySettings() {
  const res = await fetch('/api/settings/dictionary');
  if (!res.ok) return { use_experimental: false };
  return await res.json();
}

export async function updateDictionarySettings(settings) {
  const res = await fetch('/api/settings/dictionary', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || '辞書設定の保存に失敗しました');
  }
  return await res.json();
}

// ── temporary辞書 API (Phase M-1) ─────────────────────────────────────────────

export async function getTemporaryTerms() {
  const res = await fetch('/api/dictionary/temporary');
  if (!res.ok) throw new Error('一時辞書の取得に失敗しました');
  return await res.json(); // TemporaryDictListResponse: { terms, total, enabled_count }
}

export async function registerTemporaryTerm(data) {
  // data: { term, normalized, variants?, reading?, category?, domain?, priority?, note? }
  const res = await fetch('/api/dictionary/temporary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || '登録に失敗しました');
  }
  return await res.json(); // TemporaryDictEntry
}

export async function toggleTemporaryTerm(term, enabled) {
  const encodedTerm = encodeURIComponent(term);
  const res = await fetch(`/api/dictionary/temporary/${encodedTerm}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || '更新に失敗しました');
  }
  return await res.json(); // TemporaryDictEntry
}

export async function saveDocumentPage(id, pageData) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pageData),
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || '保存に失敗しました');
  }
}
