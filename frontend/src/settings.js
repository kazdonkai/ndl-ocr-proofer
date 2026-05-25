const STORAGE_KEY = 'ocr_app_settings';

export const DEFAULT_SETTINGS = {
  display: {
    fontSize: 1.3,
    lineHeight: 1.8,
    viewMode: 'paged',
  },
  vault: {
    showNotificationOnRescan: true,
  },
  panel: {
    openOnStartup: false,
    autoCloseAfterSelect: true,
    initialWidth: 280,
  },
  import: {
    defaultBehavior: 'replace',
  },
  document: {
    statusPropertyName: 'analyzed_status',
    completionStatusValue: 5,
    statusOptions: [1, 2, 3, 4, 5],
    bulkKatakanaThreshold: 0.85,
  },
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// Obsidian plugin への移植時は loadData() に置き換える
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

// Obsidian plugin への移植時は saveData() に置き換える
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore (private browsing, storage full, etc.)
  }
}
