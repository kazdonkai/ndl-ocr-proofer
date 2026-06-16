import { useState, useEffect, useMemo } from 'react';
import {
  getApprovedEntries,
  addApprovedEntry,
  updateApprovedEntry,
  deleteApprovedEntry,
  backupDictionary,
  getTemporaryTerms,
  registerTemporaryTerm,
  updateTemporaryEntry,
  deleteTemporaryEntry,
  toggleTemporaryTerm,
  promoteEntry,
  createDictFile,
  deleteDictFile,
  renameDictFile,
} from '../services/documentService';

// ── variants 変換ユーティリティ ───────────────────────────────────────────────
// 内部保存: ';' 区切り  /  GUI 表示: ', ' 区切り
// 入力: ';' と ',' の両方を受け付ける。半角スペース単体は区切りとして扱わない。

const variantsToDisplay = (raw) => {
  if (!raw) return '';
  return raw.split(';').map(s => s.trim()).filter(Boolean).join(', ');
};

const variantsToStorage = (input) => {
  if (!input) return '';
  const seen = new Set();
  return input
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(s => s && !seen.has(s) && seen.add(s))
    .join(';');
};

const EMPTY_APPROVED_FORM = {
  filename: '',
  term: '',
  normalized: '',
  variants: '',
  reading: '',
  category: '',
  domain: '',
  priority: '0.8',
  protect: false,
  source: 'manual',
  approved: true,
};

// ── サブコンポーネント: 昇格ダイアログ ─────────────────────────────────────────

function PromoteDialog({ entry, approvalFiles, onClose, onDone }) {
  const [targetFile, setTargetFile] = useState(approvalFiles[0] ?? '');
  const [conflict, setConflict] = useState(null); // null | { existing }
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const doPromote = async (onConflict) => {
    setChecking(true);
    setError(null);
    try {
      const res = await promoteEntry({
        source_file: entry.source_file,
        term: entry.term,
        target_file: targetFile,
        on_conflict: onConflict,
      });
      if (res.status === 'conflict') {
        setConflict(res.conflict);
      } else {
        onDone(res.status);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="dict-confirm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dict-confirm-box" style={{ minWidth: '28rem' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>
          「{entry.term}」を approval 辞書へ昇格
        </div>

        {!conflict ? (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>保存先ファイル</span>
              <select value={targetFile} onChange={e => setTargetFile(e.target.value)}
                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}>
                {approvalFiles.map(fn => <option key={fn} value={fn}>{fn}</option>)}
              </select>
            </label>
            {error && <div className="dict-msg-error">{error}</div>}
            <div className="dict-form-actions">
              <button className="dict-btn dict-btn-primary" onClick={() => doPromote('check')} disabled={checking || !targetFile}>
                {checking ? '確認中…' : '昇格する'}
              </button>
              <button className="dict-btn dict-btn-secondary" onClick={onClose}>キャンセル</button>
            </div>
          </>
        ) : (
          <>
            <div className="dict-msg-warn" style={{ marginBottom: '0.75rem' }}>
              ⚠ 競合: 「{entry.term}」は既に <strong>{targetFile}</strong> に存在します
              {conflict.existing && (
                <div style={{ fontSize: '0.82rem', marginTop: '0.4rem', color: '#666' }}>
                  既存: normalized={conflict.existing.normalized},
                  category={conflict.existing.category || '—'}
                </div>
              )}
            </div>
            {error && <div className="dict-msg-error">{error}</div>}
            <div className="dict-form-actions" style={{ flexWrap: 'wrap' }}>
              <button className="dict-btn dict-btn-danger" onClick={() => doPromote('overwrite')} disabled={checking}>
                {checking ? '…' : '上書き'}
              </button>
              <button className="dict-btn dict-btn-secondary" onClick={() => doPromote('skip')} disabled={checking}>
                スキップ（approval 維持・temp 削除）
              </button>
              <button className="dict-btn dict-btn-secondary" onClick={onClose}>キャンセル</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── サブコンポーネント: 辞書ファイル作成ダイアログ ────────────────────────────

function CreateFileDialog({ onClose, onCreated }) {
  const [dictType, setDictType] = useState('approval');
  const [filename, setFilename] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    let name = filename.trim();
    if (!name) { setError('ファイル名を入力してください'); return; }
    if (!name.endsWith('.csv')) name += '.csv';
    setSaving(true);
    setError(null);
    try {
      const res = await createDictFile(dictType, name);
      onCreated(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dict-confirm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dict-confirm-box" style={{ minWidth: '22rem' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>新規辞書ファイル作成</div>
        <form onSubmit={handleCreate}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>辞書種別</span>
              <select value={dictType} onChange={e => setDictType(e.target.value)}
                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}>
                <option value="approval">approval（正式辞書）</option>
                <option value="temporary">temporary（仮登録辞書）</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>ファイル名（.csv 自動付与）</span>
              <input value={filename} onChange={e => setFilename(e.target.value)}
                placeholder="例: 新規辞書" autoFocus
                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }} />
            </label>
          </div>
          {error && <div className="dict-msg-error">{error}</div>}
          <div className="dict-form-actions">
            <button type="submit" className="dict-btn dict-btn-primary" disabled={saving}>
              {saving ? '作成中…' : '作成'}
            </button>
            <button type="button" className="dict-btn dict-btn-secondary" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── サブコンポーネント: 辞書ファイル名変更ダイアログ ──────────────────────────

function RenameFileDialog({ dictType, currentFilename, onClose, onRenamed }) {
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleRename = async (e) => {
    e.preventDefault();
    let name = newName.trim();
    if (!name) { setError('新しいファイル名を入力してください'); return; }
    if (!name.endsWith('.csv')) name += '.csv';
    if (name === currentFilename) { setError('新しいファイル名が現在のファイル名と同じです'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await renameDictFile(dictType, currentFilename, name);
      onRenamed(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dict-confirm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dict-confirm-box" style={{ minWidth: '22rem' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '0.75rem' }}>辞書ファイル名変更</div>
        <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem' }}>
          現在: <strong>{currentFilename}</strong>
        </div>
        <form onSubmit={handleRename}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#666' }}>新しいファイル名（.csv 自動付与）</span>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="例: 入会研究2"
                autoFocus
                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </label>
          </div>
          {error && <div className="dict-msg-error">{error}</div>}
          <div className="dict-form-actions">
            <button type="submit" className="dict-btn dict-btn-primary" disabled={saving}>
              {saving ? '変更中…' : '名前変更'}
            </button>
            <button type="button" className="dict-btn dict-btn-secondary" onClick={onClose}>キャンセル</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────────────────────

export default function DictionaryManager({ onClose }) {
  // ── データ ──────────────────────────────────────────────────────────────────
  const [approvedEntries, setApprovedEntries] = useState([]);
  const [approvalFiles, setApprovalFiles] = useState([]);
  const [tempEntries, setTempEntries] = useState([]);
  const [tempFiles, setTempFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── フィルタ ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [dictTypeFilter, setDictTypeFilter] = useState('all'); // 'all' | 'approval' | 'temporary'
  const [selectedFile, setSelectedFile] = useState('all');

  // ── エントリ追加フォーム ─────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_APPROVED_FORM);
  const [addError, setAddError] = useState(null);
  const [addSaving, setAddSaving] = useState(false);

  // ── エントリ編集 ─────────────────────────────────────────────────────────────
  const [editingEntry, setEditingEntry] = useState(null); // { entry, form, dictType }
  const [editError, setEditError] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // ── 確認ダイアログ ───────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);       // { entry, dictType }
  const [deleteFileTarget, setDeleteFileTarget] = useState(null); // { dictType, filename }

  // ── 昇格ダイアログ ───────────────────────────────────────────────────────────
  const [promoteTarget, setPromoteTarget] = useState(null); // tempEntry

  // ── ファイル作成ダイアログ ────────────────────────────────────────────────────
  const [showCreateFile, setShowCreateFile] = useState(false);

  // ── ファイル名変更ダイアログ ──────────────────────────────────────────────────
  const [renameFileTarget, setRenameFileTarget] = useState(null); // { dictType, filename }

  // ── temporary 手動登録フォーム ──────────────────────────────────────────────
  const [showTempRegForm, setShowTempRegForm] = useState(false);
  const [tempRegForm, setTempRegForm] = useState({ term: '', normalized: '', category: '', note: '' });
  const [tempRegSaving, setTempRegSaving] = useState(false);
  const [tempRegError, setTempRegError] = useState(null);

  // ── メッセージ ───────────────────────────────────────────────────────────────
  const [infoMsg, setInfoMsg] = useState(null);

  const showInfo = (msg) => {
    setInfoMsg(msg);
    setTimeout(() => setInfoMsg(null), 4000);
  };

  // ── データロード ─────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [approvedData, tempData] = await Promise.all([
        getApprovedEntries(),
        getTemporaryTerms(),
      ]);
      setApprovedEntries(approvedData.entries ?? []);
      setApprovalFiles(approvedData.files ?? []);
      setTempEntries(tempData.terms ?? []);
      // tempData.files があればそれを使う（空ファイル含む）。なければエントリから逆引き。
      setTempFiles(
        tempData.files?.length > 0
          ? tempData.files
          : [...new Set((tempData.terms ?? []).map(e => e.source_file).filter(Boolean))].sort()
      );
      if ((approvedData.files ?? []).length > 0 && addForm.filename === '') {
        setAddForm(f => ({ ...f, filename: approvedData.files[0] }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── 統合エントリリスト ────────────────────────────────────────────────────────
  const allEntries = useMemo(() => {
    const approved = approvedEntries.map(e => ({ ...e, _dictType: 'approval' }));
    const temp = tempEntries.map(e => ({ ...e, _dictType: 'temporary' }));
    return [...approved, ...temp];
  }, [approvedEntries, tempEntries]);

  // ── フィルタ後エントリ ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = allEntries;
    if (dictTypeFilter !== 'all') {
      result = result.filter(e => e._dictType === dictTypeFilter);
    }
    if (selectedFile !== 'all') {
      result = result.filter(e => e.source_file === selectedFile);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(e =>
        (e.term ?? '').toLowerCase().includes(q) ||
        (e.normalized ?? '').toLowerCase().includes(q) ||
        (e.category ?? '').toLowerCase().includes(q) ||
        (e.domain ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [allEntries, dictTypeFilter, selectedFile, searchQuery]);

  // 昇格候補を先頭に並べる（既存の相対順は維持）
  const displayEntries = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.is_promotion_candidate && !b.is_promotion_candidate) return -1;
      if (!a.is_promotion_candidate && b.is_promotion_candidate) return 1;
      return 0;
    });
  }, [filtered]);

  // ── ファイルフィルタ用リスト（種別フィルタ連動） ────────────────────────────
  const visibleFiles = useMemo(() => {
    if (dictTypeFilter === 'approval') return approvalFiles;
    if (dictTypeFilter === 'temporary') return tempFiles;
    return [...approvalFiles, ...tempFiles];
  }, [dictTypeFilter, approvalFiles, tempFiles]);

  // ── エントリ追加（approval のみ） ────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addForm.term.trim()) { setAddError('term は必須です'); return; }
    if (!addForm.filename) { setAddError('保存先ファイルを選択してください'); return; }
    setAddSaving(true);
    setAddError(null);
    try {
      await addApprovedEntry({
        ...addForm,
        normalized: addForm.normalized || addForm.term,
        variants: variantsToStorage(addForm.variants),
        priority: parseFloat(addForm.priority) || 0.8,
      });
      setAddForm(f => ({ ...EMPTY_APPROVED_FORM, filename: f.filename }));
      setShowAddForm(false);
      await load();
    } catch (e) {
      setAddError(e.message);
    } finally {
      setAddSaving(false);
    }
  };

  // ── 編集開始 ────────────────────────────────────────────────────────────────
  const startEdit = (entry, dictType) => {
    const form = {
      normalized: entry.normalized,
      variants: variantsToDisplay(entry.variants),
      reading: entry.reading,
      category: entry.category,
      domain: entry.domain,
      priority: String(entry.priority),
      protect: entry.protect,
      source: entry.source,
      approved: entry.approved,
      note: entry.note ?? '',
      enabled: entry.enabled ?? true,
    };
    setEditingEntry({ entry, form, dictType });
    setEditError(null);
  };

  // ── 編集保存 ────────────────────────────────────────────────────────────────
  const handleEditSave = async () => {
    if (!editingEntry) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const { entry, form, dictType } = editingEntry;
      const updates = {
        ...form,
        variants: variantsToStorage(form.variants),
        priority: parseFloat(form.priority) || entry.priority,
      };
      if (dictType === 'approval') {
        await updateApprovedEntry(entry.source_file, entry.term, updates);
      } else {
        await updateTemporaryEntry(entry.source_file, entry.term, updates);
      }
      setEditingEntry(null);
      await load();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditSaving(false);
    }
  };

  // ── エントリ削除 ────────────────────────────────────────────────────────────
  const handleDeleteEntry = async () => {
    if (!deleteTarget) return;
    try {
      const { entry, dictType } = deleteTarget;
      if (dictType === 'approval') {
        await deleteApprovedEntry(entry.source_file, entry.term);
      } else {
        await deleteTemporaryEntry(entry.source_file, entry.term);
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── enabled トグル ──────────────────────────────────────────────────────────
  const handleToggleEnabled = async (entry) => {
    try {
      await toggleTemporaryTerm(entry.term, !entry.enabled);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── 昇格完了 ────────────────────────────────────────────────────────────────
  const handlePromoteDone = async (status) => {
    setPromoteTarget(null);
    const label = { promoted: '昇格', overwritten: '上書き昇格', skipped: 'スキップ（approval 維持・temp 削除）' };
    showInfo(`完了: ${label[status] ?? status}`);
    await load();
  };

  // ── ファイル削除 ────────────────────────────────────────────────────────────
  const handleDeleteFile = async () => {
    if (!deleteFileTarget) return;
    try {
      await deleteDictFile(deleteFileTarget.dictType, deleteFileTarget.filename);
      setDeleteFileTarget(null);
      setSelectedFile('all');
      showInfo(`削除完了: ${deleteFileTarget.filename}（バックアップ済）`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── ファイル名変更完了 ──────────────────────────────────────────────────────
  const handleRenamedFile = async (res) => {
    setRenameFileTarget(null);
    setSelectedFile(res.renamed_to);
    showInfo(`名前変更完了: ${res.renamed_from} → ${res.renamed_to}`);
    await load();
  };

  // ── バックアップ ────────────────────────────────────────────────────────────
  const handleBackup = async () => {
    try {
      const res = await backupDictionary();
      showInfo(`バックアップ完了: ${res.backed_up} ファイル`);
    } catch (e) {
      setError(e.message);
    }
  };

  // ── temporary 手動登録 ──────────────────────────────────────────────────────
  const handleTempRegister = async (e) => {
    e.preventDefault();
    if (!tempRegForm.term.trim() || !tempRegForm.normalized.trim()) return;
    setTempRegSaving(true);
    setTempRegError(null);
    try {
      await registerTemporaryTerm(tempRegForm);
      setTempRegForm({ term: '', normalized: '', category: '', note: '' });
      setShowTempRegForm(false);
      showInfo('temporary 語を登録しました');
      await load();
    } catch (err) {
      setTempRegError(err.message ?? '登録失敗');
    } finally {
      setTempRegSaving(false);
    }
  };

  // ── 削除可能なファイルかどうか ────────────────────────────────────────────────
  const canDeleteFile = selectedFile !== 'all';
  const selectedFileDictType = useMemo(() => {
    if (approvalFiles.includes(selectedFile)) return 'approval';
    if (tempFiles.includes(selectedFile)) return 'temporary';
    return null;
  }, [selectedFile, approvalFiles, tempFiles]);

  // ── レンダリング ─────────────────────────────────────────────────────────────
  return (
    <div className="dict-manager-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dict-manager-modal">

        {/* ── ヘッダー ── */}
        <div className="dict-manager-header">
          <span className="dict-manager-title">辞書管理</span>
          <div className="dict-manager-header-actions">
            <button className="dict-btn dict-btn-secondary" onClick={handleBackup} title="approval 全ファイルをバックアップ">
              バックアップ
            </button>
            <button className="dict-btn dict-btn-secondary" onClick={load} title="再読込">
              ↺ 再読込
            </button>
            <button className="dict-btn dict-btn-secondary" onClick={() => setShowCreateFile(true)}>
              ＋ファイル作成
            </button>
            <button className="dict-btn dict-btn-primary" onClick={() => { setShowAddForm(v => !v); setAddError(null); }}>
              {showAddForm ? '▲ キャンセル' : '＋ エントリ追加'}
            </button>
            {dictTypeFilter === 'temporary' && (
              <button className="dict-btn dict-btn-primary" onClick={() => { setShowTempRegForm(v => !v); setTempRegError(null); }}>
                {showTempRegForm ? '▲ キャンセル' : '＋ temporary 登録'}
              </button>
            )}
            <button className="dict-manager-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {infoMsg && <div className="dict-msg-info">{infoMsg}</div>}
        {error && <div className="dict-msg-error">{error}</div>}

        {/* ── エントリ追加フォーム（approval のみ） ── */}
        {showAddForm && (
          <form className="dict-add-form" onSubmit={handleAdd}>
            <div className="dict-add-form-title">新規エントリ追加（approval 辞書）</div>
            <div className="dict-form-row">
              <label>保存先ファイル
                <select value={addForm.filename} onChange={e => setAddForm(f => ({ ...f, filename: e.target.value }))}>
                  {approvalFiles.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                </select>
              </label>
              <label>term（疑義表記）*
                <input value={addForm.term} onChange={e => setAddForm(f => ({ ...f, term: e.target.value }))} placeholder="例: 山論" />
              </label>
              <label>normalized（正規形）
                <input value={addForm.normalized} onChange={e => setAddForm(f => ({ ...f, normalized: e.target.value }))} placeholder="空欄で term と同値" />
              </label>
            </div>
            <div className="dict-form-row">
              <label>variants（, または ; 区切り）
                <input value={addForm.variants} onChange={e => setAddForm(f => ({ ...f, variants: e.target.value }))} placeholder="例: 山諍, 山争" />
              </label>
              <label>reading
                <input value={addForm.reading} onChange={e => setAddForm(f => ({ ...f, reading: e.target.value }))} placeholder="例: さんろん" />
              </label>
              <label>category
                <input value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} placeholder="例: 法制語" />
              </label>
              <label>domain
                <input value={addForm.domain} onChange={e => setAddForm(f => ({ ...f, domain: e.target.value }))} placeholder="例: 入会研究" />
              </label>
            </div>
            <div className="dict-form-row">
              <label>priority (0–1)
                <input type="number" step="0.1" min="0" max="1" value={addForm.priority}
                  onChange={e => setAddForm(f => ({ ...f, priority: e.target.value }))} />
              </label>
              <label className="dict-form-check">
                <input type="checkbox" checked={addForm.protect}
                  onChange={e => setAddForm(f => ({ ...f, protect: e.target.checked }))} />
                protect
              </label>
            </div>
            {addError && <div className="dict-msg-error">{addError}</div>}
            <div className="dict-form-actions">
              <button type="submit" className="dict-btn dict-btn-primary" disabled={addSaving}>
                {addSaving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}

        {/* ── temporary 手動登録フォーム ── */}
        {showTempRegForm && (
          <form className="dict-add-form" onSubmit={handleTempRegister}>
            <div className="dict-add-form-title">temporary 語の手動登録</div>
            <div className="dict-form-row">
              <label>term（疑義表記）*
                <input value={tempRegForm.term} onChange={e => setTempRegForm(f => ({ ...f, term: e.target.value }))} placeholder="例: 山論" />
              </label>
              <label>normalized（正規形）*
                <input value={tempRegForm.normalized} onChange={e => setTempRegForm(f => ({ ...f, normalized: e.target.value }))} placeholder="例: 山論" />
              </label>
              <label>category
                <input value={tempRegForm.category} onChange={e => setTempRegForm(f => ({ ...f, category: e.target.value }))} placeholder="例: 法制語" />
              </label>
              <label>note
                <input value={tempRegForm.note} onChange={e => setTempRegForm(f => ({ ...f, note: e.target.value }))} placeholder="任意メモ" />
              </label>
            </div>
            {tempRegError && <div className="dict-msg-error">{tempRegError}</div>}
            <div className="dict-form-actions">
              <button type="submit" className="dict-btn dict-btn-primary" disabled={tempRegSaving}>
                {tempRegSaving ? '登録中…' : '登録'}
              </button>
            </div>
          </form>
        )}

        {/* ── フィルタバー ── */}
        <div className="dict-filters">
          <select value={dictTypeFilter} onChange={e => { setDictTypeFilter(e.target.value); setSelectedFile('all'); setShowTempRegForm(false); }}
            className="dict-file-select" title="辞書種別で絞り込み">
            <option value="all">全種別 ({allEntries.length})</option>
            <option value="approval">approval のみ ({approvedEntries.length})</option>
            <option value="temporary">temporary のみ ({tempEntries.length})</option>
          </select>

          <select value={selectedFile} onChange={e => setSelectedFile(e.target.value)} className="dict-file-select">
            <option value="all">全ファイル</option>
            {visibleFiles.map(fn => (
              <option key={fn} value={fn}>
                {fn} ({allEntries.filter(e => e.source_file === fn).length})
              </option>
            ))}
          </select>

          {canDeleteFile && selectedFileDictType && (
            <>
              <button
                className="dict-btn dict-btn-secondary dict-btn-sm"
                onClick={() => setRenameFileTarget({ dictType: selectedFileDictType, filename: selectedFile })}
                title={`「${selectedFile}」の名前を変更`}
              >
                名前変更
              </button>
              <button
                className="dict-btn dict-btn-danger dict-btn-sm"
                onClick={() => setDeleteFileTarget({ dictType: selectedFileDictType, filename: selectedFile })}
                title={`「${selectedFile}」を削除`}
              >
                ファイル削除
              </button>
            </>
          )}

          <input
            className="dict-search"
            placeholder="検索（term / normalized / category / domain）"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="dict-count">{filtered.length} 件</span>
        </div>

        {/* ── テーブル ── */}
        {loading ? (
          <div className="dict-loading">読み込み中…</div>
        ) : filtered.length === 0 && selectedFile !== 'all' ? (
          <div className="dict-empty">
            <p>「{selectedFile}」はエントリが 0 件です。</p>
            {selectedFileDictType === 'approval' ? (
              <button className="dict-btn dict-btn-primary"
                onClick={() => { setShowAddForm(true); setAddError(null); }}>
                ＋ エントリを追加する
              </button>
            ) : (
              <>
                <p className="dict-empty-hint">
                  temporary エントリは校正画面から自動登録されます。<br />
                  または「＋ temporary 登録」ボタンから手動登録できます。<br />
                  登録後にこの画面で ▲ 昇格 できます。
                </p>
                <button className="dict-btn dict-btn-primary"
                  onClick={() => { setShowTempRegForm(true); setTempRegError(null); }}>
                  ＋ temporary 登録
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="dict-table-wrapper">
            <table className="dict-table">
              <thead>
                <tr>
                  <th style={{ width: '5rem' }}>種別</th>
                  <th>term</th>
                  <th>normalized</th>
                  <th>variants</th>
                  <th>category</th>
                  <th>domain</th>
                  <th>priority</th>
                  <th>protect</th>
                  <th>ファイル</th>
                  <th style={{ minWidth: '10rem' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayEntries.map((entry, idx) => {
                  const isTemp = entry._dictType === 'temporary';
                  const isDisabled = isTemp && entry.enabled === false;
                  const isEditing = editingEntry?.entry === entry;

                  if (isEditing) {
                    return (
                      <tr key={idx} className="dict-row-editing">
                        <td><DictTypeBadge type={entry._dictType} disabled={isDisabled} /></td>
                        <td>{entry.term}</td>
                        <td><input value={editingEntry.form.normalized}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, normalized: e.target.value } }))} /></td>
                        <td><input value={editingEntry.form.variants}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, variants: e.target.value } }))} /></td>
                        <td><input value={editingEntry.form.category}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, category: e.target.value } }))} /></td>
                        <td><input value={editingEntry.form.domain}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, domain: e.target.value } }))} /></td>
                        <td><input type="number" step="0.1" min="0" max="1" style={{ width: '4rem' }}
                          value={editingEntry.form.priority}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, priority: e.target.value } }))} /></td>
                        <td><input type="checkbox" checked={editingEntry.form.protect}
                          onChange={e => setEditingEntry(s => ({ ...s, form: { ...s.form, protect: e.target.checked } }))} /></td>
                        <td style={{ fontSize: '0.8rem', color: '#888' }}>{entry.source_file}</td>
                        <td className="dict-row-actions">
                          {editError && <span className="dict-msg-error">{editError}</span>}
                          <button className="dict-btn dict-btn-primary dict-btn-sm" onClick={handleEditSave} disabled={editSaving}>
                            {editSaving ? '…' : '保存'}
                          </button>
                          <button className="dict-btn dict-btn-secondary dict-btn-sm" onClick={() => setEditingEntry(null)}>
                            取消
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={idx} style={isDisabled ? { opacity: 0.45 } : undefined}>
                      <td><DictTypeBadge type={entry._dictType} disabled={isDisabled} /></td>
                      <td className="dict-cell-term">
                        {entry.term}
                        {entry.is_promotion_candidate && (
                          <span
                            className="dict-badge-candidate"
                            title={`昇格候補：同一訂正が ${entry.approval_count} 回承認されました。temporary 辞書上の注目表示です（approval への昇格は ▲ 昇格ボタンから手動で行います）。`}
                          >
                            昇格候補
                          </span>
                        )}
                      </td>
                      <td>{entry.normalized}</td>
                      <td className="dict-cell-dim">{variantsToDisplay(entry.variants)}</td>
                      <td>{entry.category}</td>
                      <td>{entry.domain}</td>
                      <td>{entry.priority}</td>
                      <td>{entry.protect ? '✓' : ''}</td>
                      <td className="dict-cell-dim" style={{ fontSize: '0.8rem' }}>{entry.source_file}</td>
                      <td className="dict-row-actions">
                        {isTemp && (
                          <>
                            <button
                              className="dict-btn dict-btn-secondary dict-btn-sm"
                              onClick={() => handleToggleEnabled(entry)}
                              title={entry.enabled ? '無効化' : '有効化'}
                            >
                              {entry.enabled ? '無効化' : '有効化'}
                            </button>
                            <button
                              className="dict-btn dict-btn-promote dict-btn-sm"
                              onClick={() => setPromoteTarget(entry)}
                              title="approval 辞書へ昇格"
                              disabled={approvalFiles.length === 0}
                            >
                              ▲ 昇格
                            </button>
                          </>
                        )}
                        <button className="dict-btn dict-btn-secondary dict-btn-sm" onClick={() => startEdit(entry, entry._dictType)}>編集</button>
                        <button
                          className="dict-btn dict-btn-danger dict-btn-sm"
                          onClick={() => setDeleteTarget({ entry, dictType: entry._dictType })}
                          title={isTemp ? 'temporary エントリを削除（物理削除）' : '辞書エントリを削除'}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── エントリ削除 確認ダイアログ ── */}
        {deleteTarget && (
          <div className="dict-confirm-overlay">
            <div className="dict-confirm-box">
              <p>
                エントリ「{deleteTarget.entry.term}」を削除しますか？<br />
                <span className="dict-cell-dim" style={{ fontSize: '0.85rem' }}>
                  {deleteTarget.dictType === 'approval'
                    ? '削除前に自動バックアップされます。'
                    : 'temporary エントリを物理削除します（バックアップ後）。'}
                </span>
              </p>
              <div className="dict-form-actions">
                <button className="dict-btn dict-btn-danger" onClick={handleDeleteEntry}>削除する</button>
                <button className="dict-btn dict-btn-secondary" onClick={() => setDeleteTarget(null)}>キャンセル</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 辞書ファイル削除 確認ダイアログ ── */}
        {deleteFileTarget && (
          <div className="dict-confirm-overlay">
            <div className="dict-confirm-box">
              <p>
                <strong>辞書ファイル「{deleteFileTarget.filename}」を削除しますか？</strong><br />
                <span className="dict-cell-dim" style={{ fontSize: '0.85rem' }}>
                  削除前に自動バックアップされます。この操作はエントリ削除とは異なり、ファイル全体が対象です。
                </span>
              </p>
              <div className="dict-form-actions">
                <button className="dict-btn dict-btn-danger" onClick={handleDeleteFile}>ファイルを削除する</button>
                <button className="dict-btn dict-btn-secondary" onClick={() => setDeleteFileTarget(null)}>キャンセル</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 昇格ダイアログ ── */}
        {promoteTarget && (
          <PromoteDialog
            entry={promoteTarget}
            approvalFiles={approvalFiles}
            onClose={() => setPromoteTarget(null)}
            onDone={handlePromoteDone}
          />
        )}

        {/* ── ファイル作成ダイアログ ── */}
        {showCreateFile && (
          <CreateFileDialog
            onClose={() => setShowCreateFile(false)}
            onCreated={async res => {
              setShowCreateFile(false);
              showInfo(`作成完了: ${res.created}（${res.dict_type}）`);
              await load();
              setDictTypeFilter(res.dict_type);
              setSelectedFile(res.created);
              if (res.dict_type === 'approval') {
                setAddForm(f => ({ ...f, filename: res.created }));
                setShowAddForm(true);
                setAddError(null);
              }
            }}
          />
        )}

        {/* ── ファイル名変更ダイアログ ── */}
        {renameFileTarget && (
          <RenameFileDialog
            dictType={renameFileTarget.dictType}
            currentFilename={renameFileTarget.filename}
            onClose={() => setRenameFileTarget(null)}
            onRenamed={handleRenamedFile}
          />
        )}
      </div>
    </div>
  );
}

// ── 種別バッジ ────────────────────────────────────────────────────────────────

function DictTypeBadge({ type, disabled }) {
  if (type === 'approval') {
    return (
      <span style={{
        display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '3px',
        fontSize: '0.72rem', fontWeight: 'bold',
        background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe',
      }}>approval</span>
    );
  }
  if (disabled) {
    return (
      <span style={{
        display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '3px',
        fontSize: '0.72rem', fontWeight: 'bold',
        background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
      }}>temp 無効</span>
    );
  }
  return (
    <span style={{
      display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '3px',
      fontSize: '0.72rem', fontWeight: 'bold',
      background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a',
    }}>temp</span>
  );
}
