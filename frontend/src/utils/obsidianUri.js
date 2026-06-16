// Obsidian URI builder — obsidian://open?vault=...&file=...
// vault: Obsidian vault name (= folder name, NOT the absolute path)
// file:  vault-relative note path, .md extension stripped

export function deriveVaultName(vaultRoot) {
  if (!vaultRoot) return '';
  const parts = vaultRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export function buildObsidianUri(vaultName, filePath) {
  if (!vaultName || !filePath) return null;
  const path = filePath.replace(/\.md$/, '').replace(/\\/g, '/');
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}
