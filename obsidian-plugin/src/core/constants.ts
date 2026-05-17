export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'gif']);
export const OCR_DATA_EXTS = new Set(['json']);
export const CORRECTION_LOG_EXTS = new Set(['csv', 'log']);

// Fallback frontmatter keys checked after the primary configured key.
// These preserve backward-compatibility with vaults that used the old defaults.
export const FALLBACK_IMAGE_KEYS = ['image', 'source_image'];
export const FALLBACK_OCR_KEYS   = ['ocr_json', 'ocr_result'];
export const FALLBACK_LOG_KEYS   = ['ocr_log', 'log'];
