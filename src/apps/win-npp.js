// Notepad++ 8.x: classic menu bar (File … ?), toolbar, document tabs, line numbers, status bar.
// "? > Update Notepad++" runs the updater + installer wizard and really upgrades the program (the answer-key path).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { elevate } from '../ui/win-shell.js';
import * as S from '../win/state.js';

const protectedPath = (p) => /^\/(Windows|Program Files|Program Files \(x86\)|ProgramData|CyberPatriot)(\/|$)/i.test(p);
const ID = 'Notepad++.Notepad++';

export function open(env, opts = {}) {
  const sys = env.sys;
  const prog = () => S.listPrograms(sys).find((p) => p.id === ID);
  if (!prog() || !sys.vfs.exists('/Program Files/Notepad++/notepad++.exe')) { env.ui.alert({ title: 'Notepad++', heading: 'Windows cannot find notepad++.exe', message: 'Notepad++ is not installed on this computer.', icon: 'w-warn' }); return null; }
  const docs = [];
  let cur = null;
  const first = opts.path || (opts.args?.[0] ? S.resolve(sys, S.fromWin(opts.args[0], `/Users/${env.user}`)) : null);
  const tabs = h('div', { class: 'npp-tabs' });
  const gutter = h('div', { class: 'npp-gutter' });
  const ta = h('textarea', { class: 'npp-ta', spellcheck: false, title: 'Document', oninput: () => { cur.text = ta.value; drawTabs(); lines(); stat(); }, onscroll: () => { gutter.scrollTop = ta.scrollTop; }, onkeyup: () => stat(), onclick: () => stat() });
  const status = h('div', { class: 'npp-status' });
  const menu = (label, items) => h('div', { class: 'npp-mi', title: `${label} menu`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, label);
  const tool = (t, title, fn) => h('button', { class: 'npp-tb', title, onclick: fn }, t);
  const root = h('div', { class: 'npp' },
    h('div', { class: 'npp-menu' },
      menu('File', () => [{ label: 'New', hint: 'Ctrl+N', action: () => addDoc(null) }, { label: 'Open...', hint: 'Ctrl+O', action: openDlg }, 'sep', { label: 'Save', hint: 'Ctrl+S', action: () => save() }, { label: 'Save As...', action: () => save(true) }, 'sep', { label: 'Close', hint: 'Ctrl+W', action: () => closeDoc(cur) }, { label: 'Exit', action: () => win.close() }]),
      menu('Edit', () => [{ label: 'Select All', action: () => ta.select() }]),
      menu('Search', () => [{ label: 'Find...', hint: 'Ctrl+F', action: find }, { label: 'Replace...', hint: 'Ctrl+H', action: replace }, { label: 'Go to...', hint: 'Ctrl+G', action: goTo }]),
      menu('View', () => [{ label: 'Word wrap', action: () => { ta.style.whiteSpace = ta.style.whiteSpace === 'pre-wrap' ? 'pre' : 'pre-wrap'; } }]),
      menu('Encoding', () => [{ label: '● UTF-8', disabled: true }]), menu('Language', () => [{ label: 'Normal Text', disabled: true }]), menu('Settings', () => [{ label: 'Preferences...', disabled: true }]),
      menu('Tools', () => [{ label: 'MD5 › Generate...', disabled: true }]), menu('Macro', () => []), menu('Run', () => []), menu('Plugins', () => [{ label: 'Plugins Admin...', disabled: true }]), menu('Window', () => docs.map((d) => ({ label: d.name(), action: () => show(d) }))),
      menu('?', () => [{ label: 'Command Line Arguments...', disabled: true }, 'sep', { label: 'Notepad++ Home', action: () => env.openApp('firefox', { args: ['https://notepad-plus-plus.org/'] }) }, 'sep', { label: 'Update Notepad++', action: update }, { label: 'Set Updater Proxy...', disabled: true }, 'sep', { label: 'About Notepad++', hint: 'F1', action: about }])),
    h('div', { class: 'npp-toolbar' }, tool('🗋', 'New', () => addDoc(null)), tool('📂', 'Open', openDlg), tool('💾', 'Save', () => save()), h('span', { class: 'npp-sep' }), tool('🔍', 'Find', find), tool('⇄', 'Replace', replace)),
    tabs, h('div', { class: 'npp-ed' }, gutter, ta), status);
  const win = env.wm.open({ title: 'Notepad++', icon: 'w-notepadpp', width: 900, height: 600, appId: 'notepadpp', content: root });

  function addDoc(path) {
    const d = { path, text: path && sys.vfs.isFile(path) ? sys.vfs.readFile(path).replace(/\r\n/g, '\n') : '', saved: null, n: docs.length + 1, name() { return this.path ? this.path.split('/').pop() : `new ${this.n}`; } };
    d.saved = d.text; docs.push(d); show(d); return d;
  }
  function show(d) { cur = d; ta.value = d.text; drawTabs(); lines(); stat(); win.setTitle(`${d.path ? S.toWin(d.path) : `*${d.name()}`} - Notepad++${opts.elevated ? ' [Administrator]' : ''}`); setTimeout(() => ta.focus(), 20); }
  function drawTabs() { clear(tabs); for (const d of docs) tabs.append(h('div', { class: 'npp-tab' + (d === cur ? ' on' : ''), title: d.path ? S.toWin(d.path) : d.name(), onclick: () => show(d) }, h('span', { class: d.text !== d.saved ? 'npp-dirty' : 'npp-clean' }, '■'), d.name(), h('span', { class: 'npp-x', title: 'Close', onclick: (e) => { e.stopPropagation(); closeDoc(d); } }, '✕'))); }
  function lines() { const n = ta.value.split('\n').length; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gutter.scrollTop = ta.scrollTop; }
  function stat() {
    const b = ta.value.slice(0, ta.selectionStart); const ln = b.split('\n').length; const col = b.length - b.lastIndexOf('\n');
    clear(status); status.append(h('span', null, 'Normal text file'), h('span', null, `length : ${ta.value.length.toLocaleString('en-US')}    lines : ${ta.value.split('\n').length}`), h('span', null, `Ln : ${ln}    Col : ${col}    Pos : ${ta.selectionStart + 1}`), h('span', null, 'Windows (CR LF)'), h('span', null, 'UTF-8'), h('span', null, 'INS'));
  }
  function closeDoc(d) {
    const i = docs.indexOf(d); if (i < 0) return;
    docs.splice(i, 1);
    if (!docs.length) addDoc(null); else show(docs[Math.max(0, i - 1)]);
  }
  async function openDlg() {
    const p = await env.ui.prompt({ title: 'Open', message: 'File name (full path):', value: `C:\\Users\\${env.user}\\Documents\\` });
    if (!p) return;
    const r = S.resolve(sys, S.fromWin(p, `/Users/${env.user}`));
    if (!sys.vfs.isFile(r)) { env.ui.alert({ title: 'Open', heading: S.toWin(r), message: 'Cannot open file.', icon: 'w-warn' }); return; }
    addDoc(r);
  }
  async function save(as = false) {
    let target = cur.path;
    if (as || !target) { const p = await env.ui.prompt({ title: 'Save As', message: 'File name (full path):', value: target ? S.toWin(target) : `C:\\Users\\${env.user}\\Documents\\${cur.name()}.txt` }); if (!p) return false; target = S.resolve(sys, S.fromWin(p, `/Users/${env.user}`)); }
    if (protectedPath(target) && !opts.elevated) {
      const ok = await env.ui.confirm({ title: 'Save failed', heading: `Please check whether if this file is opened in another program.`, message: `Notepad++ cannot write to ${S.toWin(target)} because it is in a protected folder. Open the file as administrator?`, ok: 'Yes', cancel: 'No', icon: 'w-warn' });
      if (ok && await elevate(env, { what: 'Notepad++' })) { /* the elevated save continues below */ } else return false;
    }
    const dir = target.slice(0, target.lastIndexOf('/')) || '/';
    if (!sys.vfs.isDir(dir)) { env.ui.alert({ title: 'Save failed', heading: 'The folder does not exist.', message: S.toWin(dir), icon: 'w-warn' }); return false; }
    sys.vfs.writeFile(target, ta.value, { mode: 0o666, uid: 0, gid: 0 }); sys.touch('fs');
    cur.path = target; cur.text = ta.value; cur.saved = ta.value; show(cur); env.desktop?.renderIcons?.();
    return true;
  }
  async function find() { const q = await env.ui.prompt({ title: 'Find', message: 'Find what:' }); if (!q) return; const i = ta.value.toLowerCase().indexOf(q.toLowerCase(), ta.selectionEnd); const j = i >= 0 ? i : ta.value.toLowerCase().indexOf(q.toLowerCase()); if (j < 0) { env.ui.toast({ title: 'Find', message: `Find: Can't find the text "${q}"`, kind: 'info' }); return; } ta.focus(); ta.setSelectionRange(j, j + q.length); const ln = ta.value.slice(0, j).split('\n').length; ta.scrollTop = Math.max(0, (ln - 5) * 19); stat(); }
  async function replace() { const a = await env.ui.prompt({ title: 'Replace', message: 'Find what:' }); if (!a) return; const b = await env.ui.prompt({ title: 'Replace', message: 'Replace with:' }); if (b == null) return; const n = ta.value.split(a).length - 1; ta.value = ta.value.split(a).join(b); cur.text = ta.value; drawTabs(); lines(); env.ui.toast({ title: 'Replace', message: `Replace All: ${n} occurrence(s) were replaced.`, kind: 'info' }); }
  async function goTo() { const n = Number(await env.ui.prompt({ title: 'Go To...', message: 'Go to line:' })); if (!n) return; const pos = ta.value.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(pos, pos); ta.scrollTop = Math.max(0, (n - 5) * 19); stat(); }
  function about() { const p = prog(); env.ui.alert({ title: 'About Notepad++', heading: `Notepad++ v${p.version}   (64-bit)`, message: 'Build time: simulated\nHome: https://notepad-plus-plus.org/\nGNU General Public Licence', icon: 'w-notepadpp' }); }
  async function update() {
    const p = prog();
    if (!p.latest || p.latest === p.version) { env.ui.alert({ title: 'Notepad++ Update', heading: 'No update is available.', message: `Notepad++ v${p.version} is the latest version.`, icon: 'w-info' }); return; }
    if (!(await env.ui.confirm({ title: 'Notepad++ update', heading: `An update package is available, do you want to download it?`, message: `Current version: ${p.version}\nAvailable version: ${p.latest}`, ok: 'Yes', cancel: 'No', icon: 'w-notepadpp' }))) return;
    if (!(await env.ui.confirm({ title: 'Notepad++ update', heading: 'Notepad++ will be closed to install the update.', message: 'Do you want to continue?', ok: 'Yes', cancel: 'No', icon: 'w-notepadpp' }))) return;
    if (!(await elevate(env, { what: `Notepad++ v${p.latest} installer` }))) return;
    const steps = [['Welcome to Notepad++ v' + p.latest + ' Setup', 'Setup will guide you through the installation of Notepad++ v' + p.latest + '.\n\nIt is recommended that you close all other applications before starting Setup.', 'Next >'], ['License Agreement', 'Please review the license terms before installing Notepad++ v' + p.latest + '. (GNU General Public License)', 'I Agree'], ['Choose Install Location', 'Destination Folder: C:\\Program Files\\Notepad++', 'Next >'], ['Choose Components', 'Select the components you want to install.', 'Next >'], ['Ready to Install', 'Click Install to start the installation.', 'Install'], ['Completing Notepad++ v' + p.latest + ' Setup', 'Notepad++ v' + p.latest + ' has been installed on your computer.\n\nClick Finish to close Setup.', 'Finish']];
    for (const [t, m, b] of steps) {
      const ok = await env.ui.modal((done) => h('div', { class: 'w-dlg', style: { width: '500px' } }, h('div', { class: 'wd-t' }, h('span', null, `Notepad++ v${p.latest} Setup`), h('span', { onclick: () => done(false) }, '✕')),
        h('div', { style: { display: 'flex', gap: '14px', padding: '16px', background: '#fff', minHeight: '170px' } }, icon('w-notepadpp', 56), h('div', null, h('b', { style: { fontSize: '14px' } }, t), h('p', { style: { whiteSpace: 'pre-wrap' } }, m))),
        h('div', { class: 'wd-f' }, b === 'Finish' ? null : h('button', { onclick: () => done(false) }, 'Cancel'), h('button', { class: 'primary', onclick: () => { if (b === 'Install') S.upgradeProgram(sys, p); done(true); } }, b))));
      if (!ok) { if (prog().version !== p.latest) env.ui.toast({ title: 'Notepad++', message: 'Setup was cancelled. Notepad++ was not updated.', kind: 'info' }); return; }
    }
    win.close();
    env.openApp('notepadpp', {});
  }
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.altKey); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openDlg(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); find(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); replace(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'g') { e.preventDefault(); goTo(); }
    if (e.key === 'Tab') { e.preventDefault(); const st = ta.selectionStart; ta.value = ta.value.slice(0, st) + '\t' + ta.value.slice(ta.selectionEnd); ta.setSelectionRange(st + 1, st + 1); cur.text = ta.value; }
  });
  win.onClose(() => { const dirty = docs.filter((d) => d.text !== d.saved && (d.path || d.text)); if (!dirty.length) return true; env.ui.confirm({ title: 'Save', heading: `Save file "${dirty[0].name()}" ?`, message: '', ok: "Don't save", cancel: 'Cancel' }).then((ok) => { if (ok) { for (const d of docs) d.saved = d.text; win.close(); } }); return false; });
  addDoc(first);
  return win;
}
