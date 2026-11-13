// localStorage セーブ。Ver.0.2 は新しいキーを使い、Ver.0.1 のセーブ（domino-world-save-v1）には触れない。
const KEY = 'domino-world-save-v2';
const SETTINGS = 'domino-world-settings-v2';
const OLD_KEY = 'domino-world-save-v1';

export function loadSave() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function writeSave(data) {
  try {
    const s = JSON.stringify(data);
    // 書き込み前に前回分を退避（破損対策）
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(KEY + '-backup', prev);
    localStorage.setItem(KEY, s);
    return s.length;
  } catch { return 0; }
}
export function loadBackup() { try { const s = localStorage.getItem(KEY + '-backup'); return s ? JSON.parse(s) : null; } catch { return null; } }
export function clearSave() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-backup'); } catch { /* noop */ } }
export function hasOldSave() { try { return !!localStorage.getItem(OLD_KEY); } catch { return false; } }
export function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; } }
export function writeSettings(s) { try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* noop */ } }
