// Keyboard shortcut configuration — maps to PluginSettingTab keybinding section in Obsidian
import { useState, useEffect } from 'react';

export const DEFAULT_KEYBINDINGS = { nextSpan: 'n', prevSpan: 'p', openSpan: 'Enter' };

export const displayKey = (key) => {
  const map = {
    Enter: '↵ Enter', ' ': 'Space',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Tab: 'Tab', Backspace: '⌫',
  };
  return map[key] ?? key.toUpperCase();
};

export function useKeybindings() {
  const [keybindings, setKeybindings] = useState(() => {
    try {
      const saved = localStorage.getItem('ocr_keybindings');
      return saved ? { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) } : DEFAULT_KEYBINDINGS;
    } catch {
      return DEFAULT_KEYBINDINGS;
    }
  });
  const [capturingKey, setCapturingKey] = useState(null);

  useEffect(() => {
    if (!capturingKey) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturingKey(null); return; }
      const updated = { ...keybindings, [capturingKey]: e.key };
      setKeybindings(updated);
      localStorage.setItem('ocr_keybindings', JSON.stringify(updated));
      setCapturingKey(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturingKey, keybindings]);

  const resetKeybindings = () => {
    setKeybindings(DEFAULT_KEYBINDINGS);
    localStorage.removeItem('ocr_keybindings');
  };

  return { keybindings, capturingKey, setCapturingKey, resetKeybindings };
}
