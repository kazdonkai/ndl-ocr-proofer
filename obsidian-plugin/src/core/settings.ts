import type { ResolutionStep } from './types';

// Designed for direct placement in PluginSettingTab.
// frontmatterKeys stores a single primary string per slot; the structure is
// intentionally extendable to string[] (multiple candidates) without API churn.
// resolutionPriority is an ordered array so future strategy providers can be
// inserted without changing the interface.

export interface ResolverSettings {
  /** Primary frontmatter key for each slot (user-configurable per vault). */
  frontmatterKeys: {
    image: string;
    ocrData: string;
    correctionLog: string;
  };
  /** Ordered list of resolution steps to try; first successful match wins. */
  resolutionPriority: ResolutionStep[];
  /** Whether each slot is treated as required (drives Notice severity). */
  required: {
    image: boolean;
    ocrData: boolean;
    correctionLog: boolean;
  };
}

export const DEFAULT_RESOLVER_SETTINGS: ResolverSettings = {
  frontmatterKeys: {
    image: 'ocr_image',
    ocrData: 'ocr_data',
    correctionLog: 'correction_log',
  },
  resolutionPriority: ['body-callout', 'frontmatter', 'basename', 'folder-scan'],
  required: {
    image: true,
    ocrData: true,
    correctionLog: false,
  },
};
