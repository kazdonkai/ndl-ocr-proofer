// Obsidian URI builder — obsidian://open?vault=...&file=...
// vault: Obsidian vault name (= folder name, NOT the absolute path)
// file:  vault-relative note path, .md extension stripped
//
// vaultRelativePath（DocumentResponse.vault_relative_path）が指定された場合はそれを優先する。
// 同名ノートが Vault 内に複数存在する場合でも正しいノートを一意に開ける。
// 未指定時は filePath（ユーザー入力の docId）にフォールバックする。

export function deriveVaultName(vaultRoot) {
  if (!vaultRoot) return '';
  const parts = vaultRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function buildObsidianUri(vaultName, filePath, vaultRelativePath) {
  if (!vaultName || !filePath) return null;
  const raw = vaultRelativePath || filePath;
  const path = raw.replace(/\.md$/, '').replace(/\\/g, '/');
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}
