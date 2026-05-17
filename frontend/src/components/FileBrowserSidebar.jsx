// Vault file browser panel — maps to file-explorer custom view / registerView in Obsidian
// onFileSelect(path) decouples "select" from "open", matching TFile / openLinkText separation

export default function FileBrowserSidebar({
  settings,
  fileList, newlyAddedFiles,
  isRescanning, rescanNotice,
  onVaultRescan,
  docId,
  onFileSelect,
  onClose,
}) {
  return (
    <aside className="file-browser-sidebar" style={{ width: `${settings.panel.initialWidth}px` }}>
      <div className="sidebar-header-sm vault-sidebar-header">
        VAULT FILES
        <button className="vault-close-btn" onClick={onClose} title="閉じる">×</button>
      </div>

      <div className="file-browser-actions">
        <button
          className="btn"
          style={{ width: '100%', fontSize: '0.8rem', padding: '6px 0' }}
          onClick={onVaultRescan}
          disabled={isRescanning}
        >
          {isRescanning ? 'Scanning...' : 'Vault Rescan'}
        </button>
      </div>

      {settings.vault.showNotificationOnRescan && rescanNotice && (
        <div className="rescan-notice">{rescanNotice}</div>
      )}

      <div className="file-list">
        {fileList.length === 0 ? (
          <div className="file-list-empty">ファイルなし</div>
        ) : (
          <>
            {newlyAddedFiles.length > 0 && (
              <>
                <div className="file-list-section-label">新規追加</div>
                {newlyAddedFiles.map((f) => (
                  <div
                    key={`new_${f.path}`}
                    className={`file-item file-item-new ${docId === f.path || docId === f.name ? 'active' : ''}`}
                    onClick={() => onFileSelect(f.path)}
                    title={f.path}
                  >
                    {f.name}
                  </div>
                ))}
                <div className="file-list-divider" />
              </>
            )}
            {fileList.map((f) => (
              <div
                key={f.path}
                className={`file-item ${docId === f.path || docId === f.name ? 'active' : ''}`}
                onClick={() => onFileSelect(f.path)}
                title={f.path}
              >
                {f.name}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
