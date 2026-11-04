// Notepad (Windows 11 version): tab strip, File / Edit / View menus, status bar, save prompts.
// Files outside the user's profile need an elevated Notepad (like the real thing, because of NTFS permissions).
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as S from '../win/state.js';

const protectedPath = (p) => /^\/(Windows|Program Files|Program Files \(x86\)|ProgramData|CyberPatriot)(\/|$)/i.test(p);

export function open(env, opts = {}) {
  const sys = env.sys;
  let path = opts.path || (opts.args && opts.args[0] ? S.resolve(sys, S.fromWin(opts.args[0], `/Users/${env.user}`)) : null);
  let saved = path && sys.vfs.isFile(path) ? sys.vfs.readFile(path).replace(/\r\n/g, '\n') : '';
  const ta = h('textarea', { spellcheck: false, title: 'Text', oninput: () => { upd(); }, onkeyup: () => pos(), onclick: () => pos() });
  ta.value = saved;
  const name = () => (path ? path.split('/').pop() : 'Untitled');
  const tabT = h('span', null, '');
  const st = { pos: h('span', null, 'Ln 1, Col 1'), chars: h('span', null, ''), zoom: h('span', null, '100%'), eol: h('span', null, 'Windows (CRLF)'), enc: h('span', null, 'UTF-8') };
  let zoom = 100;
  const dirty = () => ta.value !== saved;
  const upd = () => { tabT.textContent = (dirty() ? '● ' : '') + name(); win.setTitle(`${dirty() ? '*' : ''}${name()} - Notepad`); st.chars.textContent = `${ta.value.length} characters`; };
  const pos = () => { const b = ta.value.slice(0, ta.selectionStart); const ln = b.split('\n').length; st.pos.textContent = `Ln ${ln}, Col ${b.length - b.lastIndexOf('\n')}`; };
  const menu = (label, items) => h('div', { title: `${label} menu`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom + 2, items()); } }, label);
  const root = h('div', { class: 'wnp' },
    h('div', { class: 'wnp-tabs' }, h('div', { class: 'wnp-tab' }, icon('w-notepad', 16), tabT)),
    h('div', { class: 'wnp-menu' },
      menu('File', () => [{ label: 'New tab', hint: 'Ctrl+N', action: () => env.openApp('notepad') }, { label: 'Open…', hint: 'Ctrl+O', action: openDlg }, { label: 'Save', hint: 'Ctrl+S', action: () => save() }, { label: 'Save as…', action: () => save(true) }, 'sep', { label: 'Exit', action: () => win.close() }]),
      menu('Edit', () => [{ label: 'Select all', hint: 'Ctrl+A', action: () => ta.select() }, { label: 'Time/Date', hint: 'F5', action: () => insert(new Date(sys.now()).toLocaleString()) }]),
      menu('View', () => [{ label: 'Zoom in', action: () => z(10) }, { label: 'Zoom out', action: () => z(-10) }, { label: 'Restore default zoom', action: () => z(0) }, { label: `Word wrap ${ta.style.whiteSpace === 'pre-wrap' ? '✓' : ''}`, action: () => { ta.style.whiteSpace = ta.style.whiteSpace === 'pre-wrap' ? 'pre' : 'pre-wrap'; } }])),
    ta, h('div', { class: 'wnp-status' }, st.pos, st.chars, h('span', { style: { flex: 1 } }), st.zoom, st.eol, st.enc));
  const win = env.wm.open({ title: `${name()} - Notepad`, icon: 'w-notepad', width: 760, height: 520, appId: 'notepad', content: root });
  function z(d) { zoom = d === 0 ? 100 : Math.max(50, Math.min(300, zoom + d)); ta.style.fontSize = (15 * zoom) / 100 + 'px'; st.zoom.textContent = `${zoom}%`; }
  function insert(t) { const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd); upd(); }
  async function openDlg() {
    const p = await env.ui.prompt({ title: 'Open', message: 'File name (full path):', value: `C:\\Users\\${env.user}\\Documents\\` });
    if (!p) return;
    const r = S.resolve(sys, S.fromWin(p, `/Users/${env.user}`));
    if (!sys.vfs.isFile(r)) { env.ui.alert({ title: 'Notepad', heading: `${S.toWin(r)}`, message: 'File not found.\nCheck the file name and try again.', icon: 'w-warn' }); return; }
    env.openApp('notepad', { path: r, elevated: opts.elevated });
  }
  async function save(as = false) {
    let target = path;
    if (as || !target) {
      const p = await env.ui.prompt({ title: 'Save as', message: 'File name (full path):', value: target ? S.toWin(target) : `C:\\Users\\${env.user}\\Documents\\Untitled.txt` });
      if (!p) return false;
      target = S.resolve(sys, S.fromWin(p, `/Users/${env.user}`));
    }
    if (protectedPath(target) && !opts.elevated) {
      env.ui.alert({ title: 'Notepad', heading: `You don't have permission to save in this location.`, message: `Access to ${S.toWin(target)} is denied.\n\nOpen Notepad as an administrator (right-click it in Start > Run as administrator) to edit system files.`, icon: 'w-warn' });
      return false;
    }
    const dir = target.slice(0, target.lastIndexOf('/')) || '/';
    if (!sys.vfs.isDir(dir)) { env.ui.alert({ title: 'Notepad', heading: S.toWin(dir), message: 'Path does not exist.\nCheck the path and try again.', icon: 'w-warn' }); return false; }
    sys.vfs.writeFile(target, ta.value, { mode: 0o666, uid: 0, gid: 0 });
    sys.touch('fs');
    path = target; saved = ta.value; upd();
    env.desktop?.renderIcons?.();
    return true;
  }
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openDlg(); }
    if (e.key === 'F5') { e.preventDefault(); insert(new Date(sys.now()).toLocaleString()); }
    if (e.key === 'Tab') { e.preventDefault(); insert('\t'); }
  });
  win.onClose(() => {
    if (!dirty()) return true;
    env.ui.modal((done) => h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Notepad'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('h3', null, `Do you want to save changes to ${name()}?`))),
      h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: async () => { done(); if (await save()) win.close(); } }, 'Save'), h('button', { class: 'btn', onclick: () => { done(); saved = ta.value; win.close(); } }, "Don't save"), h('button', { class: 'btn', onclick: () => done() }, 'Cancel'))));
    return false;
  });
  upd(); pos();
  setTimeout(() => ta.focus(), 30);
  return win;
}
