const KEY = 'domino-world-save-v1';
const SETTINGS = 'domino-world-settings-v1';

export function loadSave() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; }
}
export function writeSettings(s) {
  try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* noop */ }
}
