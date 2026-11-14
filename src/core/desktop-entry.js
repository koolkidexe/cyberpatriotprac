// Pure .desktop parser (no DOM) shared by core code and the UI.
export function parseDesktopText(text) {
  const out = {};
  let inMain = false;
  for (const raw of String(text).split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('[')) { inMain = l === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const i = l.indexOf('=');
    if (i > 0) { const k = l.slice(0, i).trim(); if (!/\[.+\]$/.test(k)) out[k] = l.slice(i + 1).trim(); }
  }
  return out;
}
