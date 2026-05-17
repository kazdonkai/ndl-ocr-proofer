// Persistent settings state — maps to Plugin.loadData() / Plugin.saveData() in Obsidian
import { useState } from 'react';
import { loadSettings, saveSettings } from '../settings';

export function useSettings() {
  const [settings, setSettings] = useState(() => loadSettings());

  const updateSetting = (section, key, value) => {
    setSettings(prev => {
      const next = { ...prev, [section]: { ...prev[section], [key]: value } };
      saveSettings(next);
      return next;
    });
  };

  return { settings, updateSetting };
}
