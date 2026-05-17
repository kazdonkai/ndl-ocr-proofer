export type ResolutionMethod = 'body-callout' | 'frontmatter' | 'basename' | 'folder-scan' | 'none';
export type ResolutionConfidence = 'high' | 'medium' | 'low';
export type ResolutionStep = 'body-callout' | 'frontmatter' | 'basename' | 'folder-scan';

/** Vault-agnostic file reference. Structurally compatible with Obsidian TFile. */
export interface FileRef {
  path: string;
  basename: string;
  extension: string;
  /**
   * Retained as a temporary compatibility shim for existing file.parent?.path references.
   * Phase 2+: VaultAdapter will expose folderPath (or equivalent) directly,
   * at which point this field can be narrowed or removed from FileRef.
   */
  parent: { path: string } | null;
}

/** One page of a multi-page OCR document. page is 1-based. */
export interface OcrPage {
  page: number;
  imageFile: FileRef | null;
  /**
   * Text extracted from the [!ocr] callout.
   * null  = callout absent from body.
   * ''    = callout present but contains no text.
   * other = callout content.
   */
  ocrText: string | null;
}

export interface OcrDocumentSet {
  sourceFile: FileRef;
  /** Primary model: one entry per page, 1-based. Empty when no pages were resolved. */
  pages: OcrPage[];
  /** Legacy: pages[0]?.imageFile ?? null. Retained for body-callout-unaware consumers. */
  imageFile: FileRef | null;
  ocrDataFile: FileRef | null;
  correctionLogFile: FileRef | null;
  resolutionMethod: ResolutionMethod;
  confidence: ResolutionConfidence;
  /** Which of image / ocr-text / ocr-data / correction-log could not be located. */
  missing: string[];
}
