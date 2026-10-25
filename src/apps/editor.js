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
        env.ui.alert({ title: 'xed', heading: `Could not open the file ${path}`, message: e.code === 'EACCES' ? 'You do not have the permissions necessary to open the file.' : e.text, icon: 'error' });
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

  const ta = h('textarea', { class: 'xed-ta', spellcheck: false, value: text, oninput: () => { if (!dirty) { dirty = true; retitle(); } } });
  const pos = h('span', null, 'Ln 1, Col 1');
  const upd = () => { const v = ta.value.slice(0, ta.selectionStart); const l = v.split('\n'); pos.textContent = `Ln ${l.length}, Col ${l[l.length - 1].length + 1}`; };
  ta.addEventListener('keyup', upd); ta.addEventListener('click', upd);
  ta.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });

  const menu = h('div', { class: 'menubar' },
    h('div', { class: 'mi', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, [{ label: 'New', action: () => open(env, { user }) }, { label: 'Open…', action: openDlg }, { label: 'Save    Ctrl+S', action: save }, { label: 'Save As…', action: saveAs }, 'sep', { label: 'Close', action: () => win.close() }]); } }, 'File'),
    h('div', { class: 'mi', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, [{ label: 'Select All', action: () => ta.select() }, { label: 'Go to Line…', action: gotoLine }]); } }, 'Edit'));
  const tb = h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: openDlg }, 'Open'), h('button', { class: 'btn', onclick: save }, 'Save'));
  const status = h('div', { class: 'statusbar', style: { display: 'flex', justifyContent: 'space-between' } }, pos, h('span', null, 'Plain Text   Tab Width: 8   INS'));
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, menu, tb, ta, status);
  const titleOf = () => `${dirty ? '*' : ''}${path ? posix.basename(path) : 'Unsaved Document 1'}${path ? ` (${posix.dirname(path)})` : ''} - xed${user === 'root' ? ' (as root)' : ''}`;
  const win = env.wm.open({ title: titleOf(), icon: 'text', width: 700, height: 480, appId: 'xed', content });
  const retitle = () => win.setTitle(titleOf());
  win.onClose(() => {});

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
      env.ui.alert({ title: 'xed', heading: `Could not save the file “${path}”.`, message: e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS' ? 'You do not have the permissions necessary to save the file. Please check that you typed the location correctly and try again.' : `${e.text}. Please check that you typed the location correctly and try again.`, icon: 'error' });
    }
  }
  setTimeout(() => ta.focus(), 30);
  return win;
}
