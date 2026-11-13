// localStorage セーブ。v0.3 は新しいキー。v0.2・v0.1 のセーブは読み込みはするが、消したり上書きしたりしない。
const KEY = 'domino-world-save-v3';
const V2 = 'domino-world-save-v2';
const SETTINGS = 'domino-world-settings-v3';
const OLD_SETTINGS = 'domino-world-settings-v2';

const read = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };

/** v3 が無ければ v2 を読み込んで移行用に返す（v2 本体はそのまま残す） */
export function loadSave() {
  const v3 = read(KEY);
  if (v3) return { data: v3, migratedFrom: null };
  const noImport = localStorage.getItem('domino-world-v3-noimport');
  const v2 = noImport ? null : read(V2);
  if (v2) return { data: v2, migratedFrom: 'v0.2' };
  return { data: null, migratedFrom: localStorage.getItem('domino-world-save-v1') ? 'v0.1' : null };
}
export function writeSave(data) {
  try {
    const s = JSON.stringify(data);
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(KEY + '-backup', prev);
    localStorage.setItem(KEY, s);
    return s.length;
  } catch { return 0; }
}
export function loadBackup() { return read(KEY + '-backup'); }
export function clearSave() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-backup'); localStorage.setItem('domino-world-v3-noimport', '1'); } catch { /* noop */ } }
export function loadSettings() { return read(SETTINGS) || read(OLD_SETTINGS) || {}; }
export function writeSettings(s) { try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* noop */ } }
