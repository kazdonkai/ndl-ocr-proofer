// Image path → URL — maps to vault.getResourcePath(TFile) in Obsidian
export function getImageUrl(relativePath) {
  if (!relativePath) return null;
  return '/images/' + relativePath.split(/[/\\]/).map(encodeURIComponent).join('/');
}
