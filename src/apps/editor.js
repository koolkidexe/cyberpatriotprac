// xed-style text editor. Reads/writes through the invoking user's permissions.
import { h } from '../ui/dom.js';
import { FsView, FsError } from '../core/vfs.js';
import * as users from '../core/users.js';
import { posix } from '../core/util.js';

export function open(env, opts = {}) {
  const sys = env.sys;
  const user = opts.user || env.user;
  const cred = user === 'root' ? { name: 'root', uid: 0, gid: 0, gids: [0] } : users.credFor(sys, user);
  const fs = new FsView(sys.vfs, cred);
  let path = opts.args?.[0] ? posix.normalize(opts.args[0], opts.cwd || users.getUser(sys, user)?.home || '/') : null;
  let dirty = false;
  let readOnly = false;

  let text = '';
  if (path) {
    try { text = fs.readFile(path); }
    catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT') text = '';
      else if (e instanceof FsError) {
        env.ui.alert({ title: env.os === 'ubuntu' ? 'gedit' : 'xed', heading: `Could not open the file ${path}`, message: e.code === 'EACCES' ? 'You do not have the permissions necessary to open the file.' : e.text, icon: 'error' });
        return null;
      } else throw e;
    }
    try { fs.vfs.writeFile; readOnly = !canWrite(); } catch { /* ignore */ }
  }
  function canWrite() {
    if (!path) return true;
    if (!fs.exists(path)) { try { return fs.stat(posix.dirname(path)) && true; } catch { return false; } }
    const st = fs.stat(path);
    if (cred.uid === 0) return true;
    const bit = st.uid === cred.uid ? 0o200 : cred.gids.includes(st.gid) ? 0o020 : 0o002;
    return !!(st.mode & bit);
  }

  function titleOf() { return `${dirty ? '*' : ''}${path ? posix.basename(path) : 'Unsaved Document 1'}${path ? ` (${posix.dirname(path)})` : ''} - ${appName}${user === 'root' ? ' (as root)' : ''}`; }
  const gedit = env.os === 'ubuntu';
  const appName = gedit ? 'gedit' : 'xed';
  const ta = h('textarea', { class: 'xed-ta', spellcheck: false, value: text, oninput: () => { if (!dirty) { dirty = true; retitle(); } drawGutter(); } });
  const gutter = h('div', { class: 'xed-gutter' });
  const drawGutter = () => {
    const n = ta.value.split('\n').length;
    if (gutter.childElementCount !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    gutter.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  const pos = h('span', { class: 'sb-seg', title: 'Cursor position' }, 'Ln 1, Col 1');
  const upd = () => { const v = ta.value.slice(0, ta.selectionStart); const l = v.split('\n'); pos.textContent = `Ln ${l.length}, Col ${l[l.length - 1].length + 1}`; };
  ta.addEventListener('keyup', upd); ta.addEventListener('click', upd);

  // ---- find bar (Ctrl+F)
  const findIn = h('input', { class: 'in', placeholder: 'Find', title: 'Text to find (Enter = next match)', onkeydown: (e) => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') { findBar.style.display = 'none'; ta.focus(); } } });
  const findBar = h('div', { class: 'xed-find', style: { display: 'none' } }, findIn, h('button', { class: 'btn', title: 'Find the next match', onclick: () => findNext() }, 'Find Next'), h('button', { class: 'btn', title: 'Close the find bar', onclick: () => { findBar.style.display = 'none'; } }, '✕'));
  function showFind() { findBar.style.display = ''; findIn.focus(); findIn.select(); }
  function findNext() {
    const q = findIn.value; if (!q) return;
    const v = ta.value.toLowerCase(); let i = v.indexOf(q.toLowerCase(), ta.selectionEnd);
    if (i < 0) i = v.indexOf(q.toLowerCase());
    if (i < 0) { findIn.classList.add('notfound'); return; }
    findIn.classList.remove('notfound'); ta.focus(); ta.setSelectionRange(i, i + q.length); upd();
  }
  const cmd = (c) => () => { ta.focus(); try { document.execCommand(c); } catch { /* ignore */ } };
  const paste = async () => { ta.focus(); try { const t = await navigator.clipboard.readText(); document.execCommand('insertText', false, t); } catch { env.ui.toast({ title: appName, message: 'Use Ctrl+V to paste.', kind: 'info' }); } };
  ta.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 's') { e.preventDefault(); save(); } else if (e.ctrlKey && k === 'f') { e.preventDefault(); showFind(); } else if (e.ctrlKey && k === 'i') { e.preventDefault(); gotoLine(); }
    else if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '\t'); }
  });

  const fileMenu = () => [{ label: 'New    Ctrl+N', action: () => open(env, { user }) }, { label: 'Open…    Ctrl+O', action: openDlg }, 'sep', { label: 'Save    Ctrl+S', action: save }, { label: 'Save As…    Shift+Ctrl+S', action: saveAs }, { label: 'Revert', action: revert }, 'sep', { label: 'Close    Ctrl+W', action: () => win.close() }];
  const editMenu = () => [{ label: 'Undo    Ctrl+Z', action: cmd('undo') }, { label: 'Redo    Shift+Ctrl+Z', action: cmd('redo') }, 'sep', { label: 'Cut', action: cmd('cut') }, { label: 'Copy', action: cmd('copy') }, { label: 'Paste', action: paste }, 'sep', { label: 'Select All    Ctrl+A', action: () => ta.select() }];
  const searchMenu = () => [{ label: 'Find…    Ctrl+F', action: showFind }, { label: 'Find Next', action: findNext }, { label: 'Go to Line…    Ctrl+I', action: gotoLine }];
  const drop = (items) => (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); };
  const status = h('div', { class: 'statusbar xed-status' },
    h('span', { style: { flex: 1 } }),
    h('span', { class: 'sb-seg dd', title: 'Highlight mode' }, 'Plain Text ▾'),
    h('span', { class: 'sb-seg dd', title: 'Tab width' }, `Tab Width: ${gedit ? 8 : 4} ▾`),
    pos, h('span', { class: 'sb-seg', title: 'Insert mode (press Insert to toggle overwrite)' }, 'INS'));
  const editorBox = h('div', { class: 'xed-edit' }, gedit ? null : gutter, ta);
  let content; let win;
  const tabLabel = h('span', null);
  if (gedit) {
    const ttl = h('div', { class: 'gh-title' }, h('div', { class: 'gh-t1' }), h('div', { class: 'gh-t2' }));
    const bar = h('div', { class: 'gh-bar' },
      h('div', { class: 'gh-split' }, h('button', { class: 'gh-btn', title: 'Open a file (Ctrl+O)', onclick: openDlg }, 'Open'), h('button', { class: 'gh-btn', title: 'Recent files', onclick: drop(() => [{ label: 'Open…', action: openDlg }]) }, '▾')),
      h('button', { class: 'gh-btn icon', title: 'Create a new document (Ctrl+N)', onclick: () => open(env, { user }) }, '＋'),
      ttl,
      h('button', { class: 'gh-btn', title: 'Save the current file (Ctrl+S)', onclick: save }, 'Save'),
      h('button', { class: 'gh-btn icon', title: 'Main menu', onclick: drop(() => [{ label: 'Save As…', action: saveAs }, { label: 'Revert', action: revert }, 'sep', ...searchMenu(), 'sep', ...editMenu()]) }, '≡'));
    content = h('div', { class: 'xed gedit' }, bar, findBar, editorBox, status);
    win = env.wm.open({ title: titleOf(), icon: 'gedit', width: 720, height: 500, appId: 'xed', content, frameless: true });
    bar.append(win.controls()); win.makeDraggable(bar);
    content._ttl = ttl;
  } else {
    const menu = h('div', { class: 'menubar' }, [['File', fileMenu], ['Edit', editMenu], ['View', () => [{ label: 'Toolbar', action: () => tb.classList.toggle('hide') }, { label: 'Statusbar', action: () => status.classList.toggle('hide') }, { label: 'Line numbers', action: () => gutter.classList.toggle('hide') }]], ['Search', searchMenu], ['Tools', () => [{ label: 'Check Spelling (not simulated)', action: () => {} }]], ['Documents', () => [{ label: 'Save All', action: save }, { label: 'Close All', action: () => win.close() }]], ['Help', () => [{ label: 'About', action: () => env.ui.alert({ title: 'About Xed', heading: 'Xed 3.4.5', message: 'A small and lightweight text editor (simulated).', icon: 'text' }) }]]]
      .map(([n, f]) => h('div', { class: 'mi', title: `${n} menu`, onclick: drop(f) }, n)));
    const b = (glyph, title, fn) => h('button', { class: 'tbi', title, onclick: fn }, glyph);
    const tb = h('div', { class: 'toolbar xed-tb' }, b('🗋', 'Create a new document', () => open(env, { user })), b('📂', 'Open a file', openDlg), b('💾', 'Save the current file', save), h('i', { class: 'tsep' }),
      b('↶', 'Undo the last action', cmd('undo')), b('↷', 'Redo the last undone action', cmd('redo')), h('i', { class: 'tsep' }),
      b('✂', 'Cut the selection', cmd('cut')), b('⧉', 'Copy the selection', cmd('copy')), b('📋', 'Paste the clipboard', paste), h('i', { class: 'tsep' }),
      b('🔍', 'Search for text', showFind), b('⇄', 'Go to a specific line', gotoLine));
    const tabs = h('div', { class: 'xed-tabs' }, h('div', { class: 'xed-tab on', title: path || 'Unsaved document' }, tabLabel, h('button', { class: 'bx-tx', title: 'Close document', onclick: () => win.close() }, '✕')));
    content = h('div', { class: 'xed' }, menu, tb, tabs, findBar, editorBox, status);
    win = env.wm.open({ title: titleOf(), icon: 'xed', width: 760, height: 520, appId: 'xed', content });
  }
  function retitle() {
    win.setTitle(titleOf());
    tabLabel.textContent = `${dirty ? '*' : ''}${path ? posix.basename(path) : 'Unsaved Document 1'}`;
    if (content._ttl) { content._ttl.firstChild.textContent = `${dirty ? '*' : ''}${path ? posix.basename(path) : 'Untitled Document 1'}${readOnly ? ' [Read-Only]' : ''}`; content._ttl.lastChild.textContent = path ? posix.dirname(path).replace(users.getUser(sys, user)?.home || '\u0000', '~') : ''; }
  }
  retitle(); drawGutter();
  win.onClose(() => {});
  async function revert() { try { ta.value = fs.readFile(path); dirty = false; retitle(); drawGutter(); } catch { /* ignore */ } }

  async function gotoLine() {
    const n = await env.ui.prompt({ title: 'Go to Line', message: 'Line number:' });
    const k = parseInt(n, 10); if (!k) return;
    const lines = ta.value.split('\n'); let off = 0; for (let i = 0; i < Math.min(k - 1, lines.length - 1); i++) off += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(off, off); upd();
  }
  async function openDlg() {
    const p = await env.ui.prompt({ title: 'Open File', message: 'File to open (path):', value: path ? posix.dirname(path) + '/' : (users.getUser(sys, user)?.home || '/') + '/' });
    if (p) open(env, { user, args: [p] });
  }
  async function saveAs() {
    const p = await env.ui.prompt({ title: 'Save As', message: 'Save as (path):', value: path || (users.getUser(sys, user)?.home || '/') + '/Untitled.txt' });
    if (!p) return;
    path = posix.normalize(p, '/'); await save();
  }
  async function save() {
    if (!path) return saveAs();
    try {
      let data = ta.value; if (data && !data.endsWith('\n')) data += '\n';
      const existed = fs.exists(path);
      if (existed) fs.writeFile(path, data); else fs.writeFile(path, data, { mode: 0o644, uid: cred.uid, gid: cred.gid });
      dirty = false; retitle();
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      env.ui.alert({ title: env.os === 'ubuntu' ? 'gedit' : 'xed', heading: `Could not save the file “${path}”.`, message: e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS' ? 'You do not have the permissions necessary to save the file. Please check that you typed the location correctly and try again.' : `${e.text}. Please check that you typed the location correctly and try again.`, icon: 'error' });
    }
  }
  setTimeout(() => ta.focus(), 30);
  return win;
}
