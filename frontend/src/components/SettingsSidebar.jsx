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
  onClose,
}) {
  const [flushStatus, setFlushStatus] = useState(null); // null | 'pending' | 'ok' | 'error'
  const [flushedCount, setFlushedCount] = useState(null);

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
