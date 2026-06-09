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

// Phase 4B: updateOcrSettings / updateDictionarySettings 削除済み（旧 PATCH /api/settings/* は backend からも削除済み）

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

// ── Config API (Phase 2A — read-only) ────────────────────────────────────────

/**
 * GET /api/config — app.toml の全設定を返す（read-only）。
 * app.toml 不在時は .agent/settings.yaml の値を返す（後方互換フォールバック）。
 */
export async function getAppConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) return null;
  return await res.json();
}

/**
 * GET /api/config/status — 実行環境情報を返す（診断・表示用途）。
 * config_file_path / vault_root 等のパス情報を含む。
 */
export async function getConfigStatus() {
  const res = await fetch('/api/config/status');
  if (!res.ok) return null;
  return await res.json();
}

/**
 * PATCH /api/config — 許可キー（4キー）を部分更新する（Phase 2B-2）。
 * updates: { "ocr.rename_images_before_ocr": bool, ... }
 * 許可キー: ocr.rename_images_before_ocr / ocr.write_status_after_ocr /
 *            dictionary.use_experimental / auto_downweight.mode
 * レスポンス: { updated: [...], config: {...全設定} }
 */
export async function updateAppConfig(updates) {
  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || '設定の保存に失敗しました');
  }
  return await res.json();
}

// ── approved辞書 CRUD API (Phase 5: 辞書GUI) ─────────────────────────────────

export async function getApprovedEntries(q = '') {
  const url = q ? `/api/dictionary/entries?q=${encodeURIComponent(q)}` : '/api/dictionary/entries';
  const res = await fetch(url);
  if (!res.ok) throw new Error('辞書の取得に失敗しました');
  return await res.json();
}

export async function addApprovedEntry(data) {
  const res = await fetch('/api/dictionary/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '追加に失敗しました');
  }
  return await res.json();
}

export async function updateApprovedEntry(filename, term, updates) {
  const res = await fetch(`/api/dictionary/entries/${encodeURIComponent(filename)}/${encodeURIComponent(term)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '更新に失敗しました');
  }
  return await res.json();
}

export async function deleteApprovedEntry(filename, term) {
  const res = await fetch(`/api/dictionary/entries/${encodeURIComponent(filename)}/${encodeURIComponent(term)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '削除に失敗しました');
  }
  return await res.json();
}

export async function backupDictionary() {
  const res = await fetch('/api/dictionary/backup', { method: 'POST' });
  if (!res.ok) throw new Error('バックアップに失敗しました');
  return await res.json();
}

// ── temporary辞書 編集・削除 API ─────────────────────────────────────────────

export async function updateTemporaryEntry(filename, term, updates) {
  const res = await fetch(
    `/api/dictionary/temporary/${encodeURIComponent(filename)}/${encodeURIComponent(term)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '更新に失敗しました');
  }
  return await res.json();
}

export async function deleteTemporaryEntry(filename, term) {
  const res = await fetch(
    `/api/dictionary/temporary/${encodeURIComponent(filename)}/${encodeURIComponent(term)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '削除に失敗しました');
  }
  return await res.json();
}

// ── 昇格 API ──────────────────────────────────────────────────────────────────

export async function promoteEntry(data) {
  // data: { source_file, term, target_file, on_conflict }
  const res = await fetch('/api/dictionary/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '昇格に失敗しました');
  }
  return await res.json(); // PromoteEntryResponse
}

// ── 辞書ファイル作成・削除 API ────────────────────────────────────────────────

export async function createDictFile(dictType, filename) {
  const res = await fetch('/api/dictionary/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dict_type: dictType, filename }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'ファイルの作成に失敗しました');
  }
  return await res.json();
}

export async function deleteDictFile(dictType, filename) {
  const res = await fetch(
    `/api/dictionary/files/${encodeURIComponent(dictType)}/${encodeURIComponent(filename)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'ファイルの削除に失敗しました');
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
