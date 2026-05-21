// Document load / OCR / save API — maps to future Obsidian file open / workspace.openLinkText

export async function fetchDocument(id) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}`);
  if (!res.ok) throw new Error('読み込み失敗');
  return await res.json();
}

export async function runOcrForDocument(id) {
  const encodedId = encodeURIComponent(id);
  const res = await fetch(`/api/document/${encodedId}/run_ocr`, { method: 'POST' });
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
