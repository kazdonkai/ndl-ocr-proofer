import { App } from 'obsidian';
import type { FileRef } from '../core/types';
import type { VaultAdapter } from '../core/vault-adapter';

/**
 * Obsidian implementation of VaultAdapter.
 * TFile is structurally assignable to FileRef (path / basename / extension /
 * parent all present), so no explicit casting is required.
 */
export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  getFiles(): FileRef[] {
    // TFile[] satisfies FileRef[] structurally.
    return this.app.vault.getFiles();
  }

  getFileByPath(path: string): FileRef | null {
    return this.app.vault.getFileByPath(path);
  }

  resolveLink(linktext: string, sourcePath: string): FileRef | null {
    return this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
  }

  getFrontmatter(file: FileRef): Record<string, unknown> | null {
    // Resolve the TFile by path so the metadata cache can be queried.
    const tfile = this.app.vault.getFileByPath(file.path);
    if (!tfile) return null;
    return this.app.metadataCache.getFileCache(tfile)?.frontmatter ?? null;
  }

  async getFileContent(file: FileRef): Promise<string | null> {
    const tfile = this.app.vault.getFileByPath(file.path);
    if (!tfile) return null;
    // cachedRead returns from memory when available; falls back to disk.
    return this.app.vault.cachedRead(tfile);
  }
}
