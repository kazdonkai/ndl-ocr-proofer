// Vault file index API — maps to future Obsidian vault adapter / TFile enumeration

export async function fetchFileList() {
  const res = await fetch('/api/files');
  if (!res.ok) throw new Error('file list fetch failed');
  const data = await res.json();
  return data.files || [];
}

export async function rescanVault() {
  const res = await fetch('/api/files/rescan', { method: 'POST' });
  if (!res.ok) throw new Error('rescan failed');
  return await res.json(); // { added, removed, total, added_files }
}
