// Settings sidebar — maps to PluginSettingTab in Obsidian
import { useState } from 'react';
import { displayKey } from '../state/useKeybindings';

const KEYBINDING_LABELS = [
  { id: 'nextSpan', label: '次の疑義箇所' },
  { id: 'prevSpan', label: '前の疑義箇所' },
  { id: 'openSpan', label: '候補を開く' },
];

export default function SettingsSidebar({
  settings, updateSetting,
  onViewModeChange,
  historyLimit, onHistoryLimitChange,
  keybindings, capturingKey, setCapturingKey, resetKeybindings,
  isRescanning, rescanNotice, onVaultRescan,
  onExportCsv, onExportJson,
  onFlushEvents,
  ocrSettings, onOcrSettingChange,
  dictionarySettings, onDictionarySettingChange, isSavingDictionary,
  temporaryTerms = [], isLoadingTempDict = false, tempDictError = null,
  onRegisterTemporaryTerm, onToggleTemporaryTerm,
  onClose,
}) {
  const [flushStatus, setFlushStatus] = useState(null); // null | 'pending' | 'ok' | 'error'
  const [flushedCount, setFlushedCount] = useState(null);

  // ── 一時辞書 登録フォーム state ──────────────────────────────────────────
  const [tempFormTerm, setTempFormTerm] = useState('');
  const [tempFormNormalized, setTempFormNormalized] = useState('');
  const [tempFormCategory, setTempFormCategory] = useState('');
  const [tempFormNote, setTempFormNote] = useState('');
  const [tempRegisterStatus, setTempRegisterStatus] = useState(null); // null|'pending'|'ok'|'error'
  const [tempRegisterError, setTempRegisterError] = useState('');
  const [tempShowForm, setTempShowForm] = useState(false);

  const handleTempRegister = async () => {
    if (!tempFormTerm.trim() || !tempFormNormalized.trim()) return;
    setTempRegisterStatus('pending');
    setTempRegisterError('');
    try {
      await onRegisterTemporaryTerm?.({
        term: tempFormTerm.trim(),
        normalized: tempFormNormalized.trim(),
        category: tempFormCategory.trim(),
        note: tempFormNote.trim(),
      });
      setTempRegisterStatus('ok');
      setTempFormTerm('');
      setTempFormNormalized('');
      setTempFormCategory('');
      setTempFormNote('');
      setTimeout(() => setTempRegisterStatus(null), 2000);
    } catch (err) {
      setTempRegisterStatus('error');
      setTempRegisterError(err.message ?? '登録失敗');
    }
  };

  const handleFlush = async () => {
    setFlushStatus('pending');
    setFlushedCount(null);
    try {
      const result = await onFlushEvents();
      setFlushedCount(result.flushed ?? 0);
      setFlushStatus('ok');
    } catch {
      setFlushStatus('error');
    }
  };

  return (
    <aside className="settings-sidebar">
      <div className="sidebar-header-sm">SETTINGS</div>

      <div className="setting-item">
        <label>表示モード</label>
        <div className="view-mode-toggle-compact">
          <button
            className={`mode-btn-sm ${settings.display.viewMode === 'paged' ? 'active' : ''}`}
            onClick={() => onViewModeChange('paged')}
          >📄 ページ別</button>
          <button
            className={`mode-btn-sm ${settings.display.viewMode === 'seamless' ? 'active' : ''}`}
            onClick={() => onViewModeChange('seamless')}
          >📜 シームレス</button>
        </div>
      </div>

      <div className="setting-item">
        <label>フォントサイズ: {settings.display.fontSize}rem</label>
        <input
          type="range" min="0.8" max="2.5" step="0.1" value={settings.display.fontSize}
          onChange={(e) => updateSetting('display', 'fontSize', parseFloat(e.target.value))}
        />
      </div>

      <div className="setting-item">
        <label>行間: {settings.display.lineHeight}</label>
        <input
          type="range" min="1.0" max="3.0" step="0.1" value={settings.display.lineHeight}
          onChange={(e) => updateSetting('display', 'lineHeight', parseFloat(e.target.value))}
        />
      </div>

      <div className="setting-item">
        <label>履歴表示件数: {historyLimit}件</label>
        <input
          type="range" min="1" max="50" step="1" value={historyLimit}
          onChange={(e) => onHistoryLimitChange(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="setting-item">
        <label>キーボードショートカット</label>
        <div className="keybinding-list">
          {KEYBINDING_LABELS.map(({ id, label }) => (
            <div key={id} className="keybinding-row">
              <span className="keybinding-label">{label}</span>
              <button
                className={`keybinding-btn${capturingKey === id ? ' capturing' : ''}`}
                onClick={() => setCapturingKey(id)}
                title="クリックして新しいキーを押す"
              >
                {capturingKey === id ? '...' : displayKey(keybindings[id])}
              </button>
            </div>
          ))}
          <button className="keybinding-reset" onClick={resetKeybindings}>リセット</button>
        </div>
      </div>

      <div className="settings-section-label">VAULT</div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={settings.vault.showNotificationOnRescan}
            onChange={e => updateSetting('vault', 'showNotificationOnRescan', e.target.checked)}
          />
          Rescan 完了通知を表示
        </label>
      </div>

      <div className="setting-item">
        <button
          className="btn"
          style={{ width: '100%', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={onVaultRescan}
          disabled={isRescanning}
        >
          {isRescanning ? 'Scanning...' : 'Vault Rescan'}
        </button>
        {settings.vault.showNotificationOnRescan && rescanNotice && (
          <div className="rescan-notice" style={{ marginTop: '6px' }}>{rescanNotice}</div>
        )}
      </div>

      <div className="settings-section-label">VAULT FILES パネル</div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={settings.panel.openOnStartup}
            onChange={e => updateSetting('panel', 'openOnStartup', e.target.checked)}
          />
          起動時にパネルを開く
        </label>
      </div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={settings.panel.autoCloseAfterSelect}
            onChange={e => updateSetting('panel', 'autoCloseAfterSelect', e.target.checked)}
          />
          ファイル選択後に自動で閉じる
        </label>
      </div>

      <div className="setting-item">
        <label>パネル幅: {settings.panel.initialWidth}px</label>
        <input
          type="range" min="200" max="500" step="10"
          value={settings.panel.initialWidth}
          onChange={e => updateSetting('panel', 'initialWidth', parseInt(e.target.value, 10))}
        />
      </div>

      <div className="settings-section-label">OCR</div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={ocrSettings?.rename_images_before_ocr ?? true}
            onChange={e => onOcrSettingChange?.('rename_images_before_ocr', e.target.checked)}
          />
          OCR前に画像をリネーム
        </label>
        <span className="setting-hint">ノート名＋連番形式にリネームしてから OCR を実行します</span>
      </div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={ocrSettings?.write_status_after_ocr ?? true}
            onChange={e => onOcrSettingChange?.('write_status_after_ocr', e.target.checked)}
          />
          OCR完了後にステータスを書き込む
        </label>
        <span className="setting-hint">フロントマターの {settings.document.statusPropertyName} に値 2 を書き込みます</span>
      </div>

      <div className="settings-section-label">辞書</div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={dictionarySettings?.use_experimental ?? false}
            disabled={isSavingDictionary}
            onChange={e => onDictionarySettingChange?.('use_experimental', e.target.checked)}
          />
          temporary辞書を使用 (staging/)
          {isSavingDictionary && <span className="setting-saving-indicator"> 保存中…</span>}
        </label>
        <span className="setting-hint">staging/ ディレクトリのtemporary辞書も読み込みます。候補スコアに ×0.8 の減衰が適用されます</span>
      </div>

      {/* ── 一時辞書管理 (Phase M-1) ── */}
      <div className="settings-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>temporary辞書</span>
        <span style={{ fontSize: '0.7rem', fontWeight: 'normal', color: 'var(--text-muted, #6b7280)' }}>
          {temporaryTerms.filter(t => t.enabled).length}/{temporaryTerms.length} 有効
        </span>
      </div>

      {/* 登録フォーム トグル */}
      <div className="setting-item">
        <button
          className="btn"
          style={{ width: '100%', fontSize: '0.8rem', padding: '5px 0' }}
          onClick={() => setTempShowForm(v => !v)}
        >
          {tempShowForm ? '▲ temporary辞書登録を閉じる' : 'temporary辞書登録'}
        </button>
      </div>

      {tempShowForm && (
        <div className="temp-dict-form">
          <div className="temp-dict-form-row">
            <label className="temp-dict-form-label">疑義表記 *</label>
            <input
              className="setting-text-input"
              type="text"
              value={tempFormTerm}
              onChange={e => setTempFormTerm(e.target.value)}
              placeholder="例: 申渡"
            />
          </div>
          <div className="temp-dict-form-row">
            <label className="temp-dict-form-label">正規化形 *</label>
            <input
              className="setting-text-input"
              type="text"
              value={tempFormNormalized}
              onChange={e => setTempFormNormalized(e.target.value)}
              placeholder="例: 申し渡し"
            />
          </div>
          <div className="temp-dict-form-row">
            <label className="temp-dict-form-label">カテゴリ</label>
            <input
              className="setting-text-input"
              type="text"
              value={tempFormCategory}
              onChange={e => setTempFormCategory(e.target.value)}
              placeholder="例: 法制語"
            />
          </div>
          <div className="temp-dict-form-row">
            <label className="temp-dict-form-label">メモ</label>
            <input
              className="setting-text-input"
              type="text"
              value={tempFormNote}
              onChange={e => setTempFormNote(e.target.value)}
              placeholder="任意"
            />
          </div>
          <button
            className="btn"
            style={{ width: '100%', marginTop: '6px', fontSize: '0.8rem', padding: '5px 0' }}
            disabled={!tempFormTerm.trim() || !tempFormNormalized.trim() || tempRegisterStatus === 'pending'}
            onClick={handleTempRegister}
          >
            {tempRegisterStatus === 'pending' ? '登録中…' : '登録'}
          </button>
          {tempRegisterStatus === 'ok' && (
            <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#34d399' }}>登録完了</div>
          )}
          {tempRegisterStatus === 'error' && (
            <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#f87171' }}>{tempRegisterError}</div>
          )}
        </div>
      )}

      {/* 登録済み一覧 */}
      {temporaryTerms.length === 0 ? (
        <div className="setting-hint" style={{ paddingLeft: '8px' }}>登録済みの語はありません</div>
      ) : (
        <div className="temp-dict-list">
          {temporaryTerms.map(entry => (
            <div key={entry.term} className={`temp-dict-item${entry.enabled ? '' : ' temp-dict-item--disabled'}${entry.is_stale ? ' temp-dict-item--stale' : ''}`}>
              <div className="temp-dict-item-main">
                <span className="temp-dict-term">{entry.term}</span>
                <span className="temp-dict-arrow">→</span>
                <span className="temp-dict-normalized">{entry.normalized}</span>
                {entry.is_stale && <span className="temp-dict-tag temp-dict-tag--stale">未使用</span>}
              </div>
              <div className="temp-dict-item-meta">
                {entry.category && <span className="temp-dict-meta-text">{entry.category}</span>}
                {entry.note && <span className="temp-dict-meta-text">{entry.note}</span>}
              </div>
              <button
                className={`btn-temp-toggle${entry.enabled ? ' active' : ''}`}
                disabled={isLoadingTempDict}
                onClick={() => onToggleTemporaryTerm?.(entry.term, !entry.enabled)}
                title={entry.enabled ? '無効化' : '有効化'}
              >
                {entry.enabled ? '有効' : '無効'}
              </button>
            </div>
          ))}
        </div>
      )}
      {tempDictError && (
        <div className="setting-hint" style={{ color: '#f87171', paddingLeft: '8px' }}>{tempDictError}</div>
      )}

      <div className="settings-section-label">インポート</div>

      <div className="setting-item">
        <label>デフォルト動作</label>
        <div className="setting-radio-group">
          <label className="setting-radio-label">
            <input
              type="radio" name="import-behavior" value="replace"
              checked={settings.import.defaultBehavior === 'replace'}
              onChange={() => updateSetting('import', 'defaultBehavior', 'replace')}
            />
            上書き (replace)
          </label>
          <label className="setting-radio-label">
            <input
              type="radio" name="import-behavior" value="merge"
              checked={settings.import.defaultBehavior === 'merge'}
              onChange={() => updateSetting('import', 'defaultBehavior', 'merge')}
            />
            追記 (merge)
          </label>
        </div>
      </div>

      <div className="settings-section-label">DOCUMENT STATUS</div>

      <div className="setting-item">
        <label>Status property name</label>
        <input
          type="text"
          className="setting-text-input"
          value={settings.document.statusPropertyName}
          onChange={e => updateSetting('document', 'statusPropertyName', e.target.value.trim())}
          placeholder="e.g. minji_status"
        />
        <span className="setting-hint">Frontmatter key used to track document status</span>
      </div>

      <div className="setting-item">
        <label>Completion status value: {settings.document.completionStatusValue}</label>
        <input
          type="range" min="1" max="10" step="1"
          value={settings.document.completionStatusValue}
          onChange={e => updateSetting('document', 'completionStatusValue', parseInt(e.target.value, 10))}
        />
        <span className="setting-hint">Value written to the status property when marking Complete</span>
      </div>

      <div className="setting-item">
        <label>全ページカタカナ優勢判定閾値: {Math.round((settings.document.bulkKatakanaThreshold ?? 0.85) * 100)}%</label>
        <input
          type="range" min="0.85" max="1.00" step="0.05"
          value={settings.document.bulkKatakanaThreshold ?? 0.85}
          onChange={e => updateSetting('document', 'bulkKatakanaThreshold', Math.max(0.85, parseFloat(e.target.value)))}
        />
        <span className="setting-hint">この比率以上のカタカナ優勢ファイルでのみ「全ページ カタカナ化」ボタンが表示されます（最低値 85% 固定）</span>
      </div>

      <div className="settings-section-label">データ</div>

      <div className="setting-item">
        <button
          className="btn"
          style={{ width: '100%', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={handleFlush}
          disabled={flushStatus === 'pending'}
        >
          {flushStatus === 'pending' ? '送信中...' : '学習イベントを送信'}
        </button>
        {flushStatus === 'ok' && (
          <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#34d399' }}>
            {flushedCount === 0 ? '送信済み（未送信なし）' : `${flushedCount} 件送信完了`}
          </div>
        )}
        {flushStatus === 'error' && (
          <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#f87171' }}>
            送信失敗
          </div>
        )}
      </div>

      <div className="setting-item setting-export-row">
        <button
          className="btn"
          style={{ flex: 1, fontSize: '0.8rem', padding: '6px 0' }}
          onClick={onExportCsv}
        >
          CSV 書き出し
        </button>
        <button
          className="btn"
          style={{ flex: 1, fontSize: '0.8rem', padding: '6px 0' }}
          onClick={onExportJson}
        >
          JSON 書き出し
        </button>
      </div>

      <button className="btn-close-sm" onClick={onClose}>設定終了</button>
    </aside>
  );
}
