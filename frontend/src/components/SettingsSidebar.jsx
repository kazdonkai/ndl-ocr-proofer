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
  // Phase 3C: ocrSettings / dictionarySettings / isSavingDictionary 廃止。
  // appConfig?.ocr / appConfig?.dictionary / appConfig?.status を正本として直接参照する。
  // isSavingConfig が OCR / dictionary / status / CONFIG セクションすべての concurrent save ガード。
  onOcrSettingChange,
  onDictionarySettingChange,
  appConfig = null,
  configStatus = null,
  onConfigUpdate,
  isSavingConfig = false,
  configSaveError = null,
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

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="settings-modal-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal">
      <div className="settings-modal-inner">
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

      {/* Phase 3C: appConfig?.ocr を正本として参照。isSavingConfig が concurrent save ガード。 */}
      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={appConfig?.ocr?.rename_images_before_ocr ?? true}
            disabled={isSavingConfig || configStatus?.config_file_exists === false}
            onChange={e => onOcrSettingChange?.('rename_images_before_ocr', e.target.checked)}
          />
          OCR前に画像をリネーム
          {isSavingConfig && <span className="setting-saving-indicator"> 保存中…</span>}
        </label>
        <span className="setting-hint">ノート名＋連番形式にリネームしてから OCR を実行します</span>
      </div>

      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={appConfig?.ocr?.write_status_after_ocr ?? true}
            disabled={isSavingConfig || configStatus?.config_file_exists === false}
            onChange={e => onOcrSettingChange?.('write_status_after_ocr', e.target.checked)}
          />
          OCR完了後にステータスを書き込む
        </label>
        <span className="setting-hint">フロントマターの {settings.document.statusPropertyName} に値 2 を書き込みます</span>
      </div>

      <div className="settings-section-label">辞書</div>

      {/* Phase 3C: appConfig?.dictionary を正本として参照。isSavingConfig が concurrent save ガード。 */}
      <div className="setting-item">
        <label className="setting-check-label">
          <input
            type="checkbox"
            checked={appConfig?.dictionary?.use_experimental ?? false}
            disabled={isSavingConfig || configStatus?.config_file_exists === false}
            onChange={e => onDictionarySettingChange?.('use_experimental', e.target.checked)}
          />
          temporary辞書を使用 (staging/)
          {isSavingConfig && <span className="setting-saving-indicator"> 保存中…</span>}
        </label>
        <span className="setting-hint">staging/ ディレクトリのtemporary辞書も読み込みます。候補スコアに ×0.8 の減衰が適用されます</span>
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

      <div className="setting-item">
        <label>全ページカタカナ優勢判定閾値: {Math.round((settings.document.bulkKatakanaThreshold ?? 0.85) * 100)}%</label>
        <input
          type="range" min="0.85" max="1.00" step="0.05"
          value={settings.document.bulkKatakanaThreshold ?? 0.85}
          onChange={e => updateSetting('document', 'bulkKatakanaThreshold', Math.max(0.85, parseFloat(e.target.value)))}
        />
        <span className="setting-hint">この比率以上のカタカナ優勢ファイルでのみ「全ページ カタカナ化」ボタンが表示されます（最低値 85% 固定）</span>
      </div>

      {/* ── CONFIG セクション (Phase 2B-2 — 4キー編集可能) ── */}
      <div className="settings-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>CONFIG (app.toml)</span>
        {isSavingConfig && (
          <span style={{ fontSize: '0.65rem', fontWeight: 'normal', color: '#60a5fa' }}>保存中…</span>
        )}
      </div>

      {configStatus ? (
        <div className="config-status-block">
          {/* 設定ファイル種別バッジ */}
          <div className="config-status-row">
            <span className="config-status-label">設定ファイル</span>
            <span className={`config-status-badge ${configStatus.config_file_exists ? 'config-badge-ok' : 'config-badge-fallback'}`}>
              {configStatus.config_file_exists ? 'app.toml' : 'YAML fallback'}
            </span>
          </div>

          {appConfig && (
            <>
              {/* ── 編集可能: ocr.rename_images_before_ocr ── */}
              <div className="config-kv-row config-kv-editable">
                <label className="config-kv-check-label">
                  <input
                    type="checkbox"
                    checked={appConfig.ocr?.rename_images_before_ocr ?? true}
                    disabled={isSavingConfig || !configStatus.config_file_exists}
                    onChange={e => onConfigUpdate?.({ 'ocr.rename_images_before_ocr': e.target.checked })}
                  />
                  <span className="config-kv-key">OCR リネーム</span>
                </label>
              </div>

              {/* ── 編集可能: ocr.write_status_after_ocr ── */}
              <div className="config-kv-row config-kv-editable">
                <label className="config-kv-check-label">
                  <input
                    type="checkbox"
                    checked={appConfig.ocr?.write_status_after_ocr ?? true}
                    disabled={isSavingConfig || !configStatus.config_file_exists}
                    onChange={e => onConfigUpdate?.({ 'ocr.write_status_after_ocr': e.target.checked })}
                  />
                  <span className="config-kv-key">OCR 後ステータス書込</span>
                </label>
              </div>

              {/* ── 編集可能: dictionary.use_experimental ── */}
              <div className="config-kv-row config-kv-editable">
                <label className="config-kv-check-label">
                  <input
                    type="checkbox"
                    checked={appConfig.dictionary?.use_experimental ?? false}
                    disabled={isSavingConfig || !configStatus.config_file_exists}
                    onChange={e => onConfigUpdate?.({ 'dictionary.use_experimental': e.target.checked })}
                  />
                  <span className="config-kv-key">temporary辞書 (staging/)</span>
                </label>
              </div>

              {/* ── 編集可能: status.property_name (Phase 3B) ── */}
              <div className="config-kv-row config-kv-editable">
                <span className="config-kv-key">status プロパティ名</span>
                <input
                  type="text"
                  className="config-kv-input"
                  defaultValue={appConfig.status?.property_name ?? ''}
                  key={appConfig.status?.property_name}
                  disabled={isSavingConfig || !configStatus.config_file_exists}
                  onBlur={e => {
                    const trimmed = e.target.value.trim();
                    if (trimmed && trimmed !== appConfig.status?.property_name) {
                      onConfigUpdate?.({ 'status.property_name': trimmed });
                    } else if (!trimmed) {
                      // 空文字は拒否: 元の値に戻す
                      e.target.value = appConfig.status?.property_name ?? '';
                    }
                  }}
                />
              </div>

              {/* ── 編集可能: status.ocr_done_value (Phase 3B) ── */}
              <div className="config-kv-row config-kv-editable">
                <span className="config-kv-key">OCR完了値</span>
                <input
                  type="number"
                  className="config-kv-input config-kv-input-num"
                  min="1"
                  step="1"
                  defaultValue={appConfig.status?.ocr_done_value ?? 1}
                  key={appConfig.status?.ocr_done_value}
                  disabled={isSavingConfig || !configStatus.config_file_exists}
                  onBlur={e => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val !== appConfig.status?.ocr_done_value) {
                      onConfigUpdate?.({ 'status.ocr_done_value': val });
                    } else {
                      // 不正値は元に戻す
                      e.target.value = appConfig.status?.ocr_done_value ?? 1;
                    }
                  }}
                />
              </div>

              {/* ── 編集可能: auto_downweight.mode ── */}
              <div className="config-kv-row config-kv-editable">
                <span className="config-kv-key">AUTO_DOWNWEIGHT</span>
                <select
                  className="config-kv-select"
                  value={appConfig.auto_downweight?.mode ?? 'off'}
                  disabled={isSavingConfig || !configStatus.config_file_exists}
                  onChange={e => onConfigUpdate?.({ 'auto_downweight.mode': e.target.value })}
                >
                  <option value="off">off</option>
                  <option value="semi">semi</option>
                </select>
              </div>

              {/* エラー表示 */}
              {configSaveError && (
                <div className="config-save-error">{configSaveError}</div>
              )}
            </>
          )}

          {/* パス表示（read-only） */}
          <div className="config-path-row">
            <span className="config-path-label">config</span>
            <span className="config-path-val" title={configStatus.config_file_path}>{configStatus.config_file_path?.split('/').slice(-2).join('/') ?? '—'}</span>
          </div>
          <div className="config-path-row">
            <span className="config-path-label">dict</span>
            <span className="config-path-val" title={configStatus.dict_dir}>{configStatus.dict_dir?.split('/').slice(-3).join('/') ?? '—'}</span>
          </div>
        </div>
      ) : (
        <div className="setting-hint" style={{ paddingLeft: '8px' }}>取得中…</div>
      )}

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
      </div>
      </div>
    </div>
  );
}
