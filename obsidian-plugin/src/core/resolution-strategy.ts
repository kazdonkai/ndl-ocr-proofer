import type { ResolutionStep, FileRef, OcrDocumentSet, OcrPage } from './types';
import { DEFAULT_RESOLVER_SETTINGS } from './settings';
import type { ResolverSettings } from './settings';
import type { VaultAdapter } from './vault-adapter';
import {
  IMAGE_EXTS,
  OCR_DATA_EXTS,
  CORRECTION_LOG_EXTS,
  FALLBACK_IMAGE_KEYS,
  FALLBACK_OCR_KEYS,
  FALLBACK_LOG_KEYS,
} from './constants';

const RE_IMAGE = /!\[\[(.*?)(?:\|.*?)?\]\]/;
const RE_OCR_HEADER = />\s*\[!ocr\]/i;

// Path-based identity — works for both Obsidian TFile and standalone adapters.
// Never use object identity (===) to compare FileRef instances in core.
export function isSameFile(a: FileRef, b: FileRef): boolean {
  return a.path === b.path;
}

export interface ResolutionStrategy {
  resolve(adapter: VaultAdapter, file: FileRef): Promise<OcrDocumentSet>;
}

export class DefaultResolutionStrategy implements ResolutionStrategy {
  private readonly settings: ResolverSettings;

  constructor(settings: ResolverSettings = DEFAULT_RESOLVER_SETTINGS) {
    this.settings = settings;
  }

  private get imageKeys(): string[] {
    const p = this.settings.frontmatterKeys.image;
    return [p, ...FALLBACK_IMAGE_KEYS.filter((k) => k !== p)];
  }

  private get ocrKeys(): string[] {
    const p = this.settings.frontmatterKeys.ocrData;
    return [p, ...FALLBACK_OCR_KEYS.filter((k) => k !== p)];
  }

  private get logKeys(): string[] {
    const p = this.settings.frontmatterKeys.correctionLog;
    return [p, ...FALLBACK_LOG_KEYS.filter((k) => k !== p)];
  }

  async resolve(adapter: VaultAdapter, file: FileRef): Promise<OcrDocumentSet> {
    for (const step of this.settings.resolutionPriority) {
      const result = await this.tryStep(step, adapter, file);
      if (result !== null) return result;
    }
    return this.buildNoneResult(file);
  }

  private async tryStep(
    step: ResolutionStep,
    adapter: VaultAdapter,
    file: FileRef,
  ): Promise<OcrDocumentSet | null> {
    switch (step) {
      case 'body-callout': return this.tryBodyCallout(adapter, file);
      case 'frontmatter':  return this.tryFrontmatter(adapter, file);
      case 'basename':     return this.tryBasename(adapter, file);
      case 'folder-scan':  return this.tryFolderScan(adapter, file);
    }
  }

  // ── Primary: body WikiLink images + [!ocr] callouts ──────────────────────────
  //
  // Mirrors backend text_processor.OCRTextProcessor.extract_ocr_pages().
  // Returns null when the note contains no image WikiLinks (fallback proceeds).
  private async tryBodyCallout(adapter: VaultAdapter, file: FileRef): Promise<OcrDocumentSet | null> {
    let content: string | null;
    try {
      content = await adapter.getFileContent(file);
    } catch {
      return null;
    }
    if (!content) return null;

    const pages = this.parsePages(adapter, file, content);
    if (pages.length === 0) return null;

    const missing: string[] = [];
    if (pages.some((p) => p.imageFile === null)) missing.push('image');
    if (pages.some((p) => !p.ocrText))           missing.push('ocr-text');

    return {
      sourceFile: file,
      pages,
      imageFile: pages[0]?.imageFile ?? null,
      ocrDataFile: null,
      correctionLogFile: null,
      resolutionMethod: 'body-callout',
      confidence: missing.length === 0 ? 'high' : 'medium',
      missing,
    };
  }

  // Parse body lines into OcrPage[].  Logic mirrors the backend algorithm.
  private parsePages(adapter: VaultAdapter, file: FileRef, content: string): OcrPage[] {
    const lines = content.split('\n');
    const pages: OcrPage[] = [];
    let i = 0;

    while (i < lines.length) {
      const imgMatch = RE_IMAGE.exec(lines[i]);
      if (imgMatch) {
        const linktext = imgMatch[1].trim();
        const imageFile =
          adapter.resolveLink(linktext, file.path) ??
          adapter.getFileByPath(linktext);

        let ocrText: string | null = null;
        let foundOcr = false;
        let j = i + 1;

        while (j < lines.length) {
          const stripped = lines[j].trim();
          if (RE_OCR_HEADER.test(lines[j])) {
            foundOcr = true;
            j++;
            const ocrLines: string[] = [];
            while (j < lines.length) {
              const s = lines[j].trim();
              if (s.startsWith('>')) {
                ocrLines.push(s.slice(1).trim());
                j++;
              } else if (s === '') {
                // blank line inside callout region — skip (lenient, mirrors backend)
                j++;
              } else {
                break;
              }
            }
            ocrText = ocrLines.join('\n').trim();
            break;
          } else if (stripped === '') {
            j++;
          } else if (RE_IMAGE.test(lines[j])) {
            break; // next image reached before a callout
          } else {
            break; // other content — no callout for this page
          }
        }

        pages.push({
          page: pages.length + 1,
          imageFile,
          ocrText,
        });

        i = foundOcr ? j : i + 1;
      } else {
        i++;
      }
    }

    return pages;
  }

  // ── Fallback: frontmatter ─────────────────────────────────────────────────────
  //
  // Step 1 — explicit frontmatter wins unconditionally.
  private tryFrontmatter(adapter: VaultAdapter, file: FileRef): OcrDocumentSet | null {
    const fm = adapter.getFrontmatter(file);
    if (!fm) return null;

    const imageFile         = this.lookupByKeys(adapter, file, this.imageKeys);
    const ocrDataFile       = this.lookupByKeys(adapter, file, this.ocrKeys);
    const correctionLogFile = this.lookupByKeys(adapter, file, this.logKeys);

    // Return null so the next strategy can run if frontmatter has no relevant keys at all.
    if (!imageFile && !ocrDataFile && !correctionLogFile) return null;

    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages   = buildLegacyPages(imageFile);
    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: 'frontmatter',
      confidence: (imageFile !== null && ocrDataFile !== null) ? 'high' : 'medium',
      missing,
    };
  }

  private lookupByKeys(adapter: VaultAdapter, file: FileRef, keys: string[]): FileRef | null {
    const fm = adapter.getFrontmatter(file);
    if (!fm) return null;
    for (const key of keys) {
      const val = fm[key];
      if (typeof val !== 'string') continue;
      const found = lookupVaultFile(adapter, val, file.path);
      if (found) return found;
    }
    return null;
  }

  // Step 2 — same basename, same folder (e.g. doc.md → doc.json, doc.png).
  private tryBasename(adapter: VaultAdapter, file: FileRef): OcrDocumentSet | null {
    const folderPath = file.parent?.path ?? '';
    const matched = adapter.getFiles().filter(
      (f) => !isSameFile(f, file) && f.parent?.path === folderPath && f.basename === file.basename,
    );
    if (matched.length === 0) return null;

    const imageFile         = matched.find((f) => IMAGE_EXTS.has(f.extension)) ?? null;
    const ocrDataFile       = matched.find((f) => OCR_DATA_EXTS.has(f.extension)) ?? null;
    const correctionLogFile = matched.find((f) => CORRECTION_LOG_EXTS.has(f.extension)) ?? null;
    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages   = buildLegacyPages(imageFile);

    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: 'basename',
      confidence: (imageFile !== null && ocrDataFile !== null) ? 'high' : 'medium',
      missing,
    };
  }

  // Step 3 — any file in the same folder with a recognised extension.
  //          Low confidence: at most one candidate per slot is picked.
  //          Always returns a result (acts as the terminal step in the priority chain).
  private tryFolderScan(adapter: VaultAdapter, file: FileRef): OcrDocumentSet {
    const folderPath = file.parent?.path ?? '';
    const siblings = adapter.getFiles().filter(
      (f) => !isSameFile(f, file) && f.parent?.path === folderPath,
    );

    const imageFile         = siblings.find((f) => IMAGE_EXTS.has(f.extension)) ?? null;
    const ocrDataFile       = siblings.find((f) => OCR_DATA_EXTS.has(f.extension)) ?? null;
    const correctionLogFile = siblings.find((f) => CORRECTION_LOG_EXTS.has(f.extension)) ?? null;
    const missing = collectMissing(imageFile, ocrDataFile, correctionLogFile);
    const pages   = buildLegacyPages(imageFile);

    return {
      sourceFile: file,
      pages,
      imageFile,
      ocrDataFile,
      correctionLogFile,
      resolutionMethod: missing.length === 3 ? 'none' : 'folder-scan',
      confidence: 'low',
      missing,
    };
  }

  private buildNoneResult(file: FileRef): OcrDocumentSet {
    return {
      sourceFile: file,
      pages: [],
      imageFile: null,
      ocrDataFile: null,
      correctionLogFile: null,
      resolutionMethod: 'none',
      confidence: 'low',
      missing: ['image', 'ocr-data', 'correction-log'],
    };
  }
}

// Build a single-entry pages[] from a legacy imageFile for fallback strategies.
function buildLegacyPages(imageFile: FileRef | null): OcrPage[] {
  if (!imageFile) return [];
  return [{ page: 1, imageFile, ocrText: null }];
}

function lookupVaultFile(adapter: VaultAdapter, raw: string, sourcePath: string): FileRef | null {
  const clean = raw.replace(/^\[\[|\]\]$/g, '').trim();
  return adapter.getFileByPath(clean) ?? adapter.resolveLink(clean, sourcePath);
}

function collectMissing(
  imageFile: FileRef | null,
  ocrDataFile: FileRef | null,
  correctionLogFile: FileRef | null,
): string[] {
  const out: string[] = [];
  if (!imageFile)         out.push('image');
  if (!ocrDataFile)       out.push('ocr-data');
  if (!correctionLogFile) out.push('correction-log');
  return out;
}
