import type { FileRef } from './types';

/**
 * Abstraction over vault I/O.  Implementations are injected into resolution
 * strategies so the core logic has no Obsidian import dependency.
 */
export interface VaultAdapter {
  /** All files currently in the vault. */
  getFiles(): FileRef[];
  /** Exact-path lookup; returns null when not found. */
  getFileByPath(path: string): FileRef | null;
  /**
   * Resolve a wikilink or bare path relative to sourcePath.
   * Covers both [[wikilink]] and plain path strings.
   */
  resolveLink(linktext: string, sourcePath: string): FileRef | null;
  /** Parsed frontmatter for the file, or null if absent / not yet cached. */
  getFrontmatter(file: FileRef): Record<string, unknown> | null;
  /** Raw text content of a file. Returns null when the file cannot be read. */
  getFileContent(file: FileRef): Promise<string | null>;
}
