// Settings sidebar — maps to PluginSettingTab in Obsidian
import { displayKey } from '../state/useKeybindings';

const KEYBINDING_LABELS = [
  { id: 'nextSpan', label: '次の疑義箇所' },
  { id: 'prevSpan', label: '前の疑義箇所' },
  { id: 'openSpan', label: '候補を開く' },
];

export default function SettingsSidebar({
  settings, updateSetting,
  viewMode, setViewMode,
  fontSize, setFontSize,
  lineHeight, setLineHeight,
  historyLimit, onHistoryLimitChange,
  keybindings, capturingKey, setCapturingKey, resetKeybindings,
  isRescanning, rescanNotice, onVaultRescan,
  onClose,
}) {
  return (
    <aside className="settings-sidebar">
      <div className="sidebar-header-sm">SETTINGS</div>

      <div className="setting-item">
        <label>表示モード</label>
        <div className="view-mode-toggle-compact">
          <button
            className={`mode-btn-sm ${viewMode === 'paged' ? 'active' : ''}`}
            onClick={() => setViewMode('paged')}
          >📄 ページ別</button>
          <button
            className={`mode-btn-sm ${viewMode === 'seamless' ? 'active' : ''}`}
            onClick={() => setViewMode('seamless')}
          >📜 シームレス</button>
        </div>
      </div>

      <div className="setting-item">
        <label>フォントサイズ: {fontSize}rem</label>
        <input
          type="range" min="0.8" max="2.5" step="0.1" value={fontSize}
          onChange={(e) => setFontSize(parseFloat(e.target.value))}
        />
      </div>

      <div className="setting-item">
        <label>行間: {lineHeight}</label>
        <input
          type="range" min="1.0" max="3.0" step="0.1" value={lineHeight}
          onChange={(e) => setLineHeight(parseFloat(e.target.value))}
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

      <button className="btn-close-sm" onClick={onClose}>設定終了</button>
    </aside>
  );
}
