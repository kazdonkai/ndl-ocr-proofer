// Vault file index state — maps to vault.getMarkdownFiles() / vault.on('create'/'delete') in Obsidian
import { useState } from 'react';
import { fetchFileList, rescanVault } from '../services/vaultService';

export function useVaultFiles() {
  const [fileList, setFileList] = useState([]);
  const [newlyAddedFiles, setNewlyAddedFiles] = useState([]);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanNotice, setRescanNotice] = useState(null);

  const loadFileList = async () => {
    try {
      const files = await fetchFileList();
      setFileList(files);
    } catch (err) {
      console.error('fetchFileList:', err);
    }
  };

  const handleVaultRescan = async () => {
    setIsRescanning(true);
    setRescanNotice(null);
    setNewlyAddedFiles([]);
    try {
      const data = await rescanVault();
      setRescanNotice(`+${data.added} added  −${data.removed} removed  total ${data.total}`);
      setNewlyAddedFiles(data.added_files || []);
      await loadFileList();
    } catch (err) {
      setRescanNotice('Rescan failed: ' + err.message);
    } finally {
      setIsRescanning(false);
    }
  };

  return { fileList, newlyAddedFiles, isRescanning, rescanNotice, loadFileList, handleVaultRescan };
}
