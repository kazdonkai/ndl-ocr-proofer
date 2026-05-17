// Minimum public API for standalone (non-Obsidian) reuse of the core resolver.
// Obsidian-specific surface lives in src/obsidian/ocr-document-resolver.ts.
// Internal implementation details (constants.ts) are intentionally omitted.

export type {
  ResolutionMethod,
  ResolutionConfidence,
  ResolutionStep,
  FileRef,
  OcrPage,
  OcrDocumentSet,
} from './types';

export type { ResolverSettings } from './settings';
export { DEFAULT_RESOLVER_SETTINGS } from './settings';

export type { VaultAdapter } from './vault-adapter';

export type { ResolutionStrategy } from './resolution-strategy';
export { DefaultResolutionStrategy, isSameFile } from './resolution-strategy';
