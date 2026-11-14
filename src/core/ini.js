// Tiny INI helpers used by GUI apps that edit config files (lightdm, apt periodic...).
export function setIni(sys, path, section, key, value) {
  let txt = sys.vfs.exists(path) ? sys.vfs.readFile(path) : '';
  const lines = txt.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let inSec = false; let secAt = -1; let done = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = /^\[(.+)\]$/.exec(l);
    if (m) { if (inSec && !done) { lines.splice(i, 0, `${key}=${value}`); done = true; break; } inSec = m[1] === section; if (inSec) secAt = i; continue; }
    if (inSec && new RegExp(`^#?\\s*${key}\\s*=`).test(l)) { lines[i] = `${key}=${value}`; done = true; break; }
  }
  if (!done) { if (secAt < 0) lines.push(`[${section}]`); lines.push(`${key}=${value}`); }
  sys.vfs.writeFile(path, lines.join('\n') + '\n');
}
export function getIni(sys, path, section, key) {
  if (!sys.vfs.exists(path)) return null;
  let sec = ''; let val = null;
  for (const raw of sys.vfs.readFile(path).split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith(';')) continue;
    const m = /^\[(.+)\]$/.exec(l); if (m) { sec = m[1]; continue; }
    const kv = /^([^=\s]+)\s*=\s*(.*)$/.exec(l);
    if (sec === section && kv && kv[1] === key) val = kv[2];
  }
  return val;
}
