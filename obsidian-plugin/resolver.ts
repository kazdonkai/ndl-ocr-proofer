// Pure re-export facade.  No logic lives here.
// Obsidian-coupled code: src/obsidian/ocr-document-resolver.ts
// Core (Obsidian-free) code: src/core/

export type {
  ResolutionMethod,
  ResolutionConfidence,
  ResolutionStep,
  FileRef,
  OcrPage,
  OcrDocumentSet,
} from './src/core/types';
export type { ResolverSettings } from './src/core/settings';
export { DEFAULT_RESOLVER_SETTINGS } from './src/core/settings';
export type { VaultAdapter } from './src/core/vault-adapter';
export { ObsidianVaultAdapter } from './src/obsidian/obsidian-vault-adapter';
export type { ResolutionStrategy } from './src/core/resolution-strategy';
export { DefaultResolutionStrategy, isSameFile } from './src/core/resolution-strategy';
export { OcrDocumentResolver, resolveOcrDocumentFromTFile } from './src/obsidian/ocr-document-resolver';
