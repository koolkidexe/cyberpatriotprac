// File Explorer (Windows 11): navigation pane, breadcrumb address bar, command bar, Details view, Recycle Bin.
// "Show hidden items" and "File name extensions" are the real Explorer registry values (HKCU ...\Explorer\Advanced).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { winFileIcon, elevate } from '../ui/win-shell.js';
import * as S from '../win/state.js';

const ADV = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const BIN = '/$Recycle.Bin';
const lc = (s) => String(s).toLowerCase();
const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };
const kb = (n) => (n == null ? '' : `${Math.max(1, Math.ceil(n / 1024)).toLocaleString('en-US')} KB`);
const TYPES = { txt: 'Text Document', url: 'Internet Shortcut', lnk: 'Shortcut', exe: 'Application', html: 'Microsoft Edge HTML Document', htm: 'Microsoft Edge HTML Document', mp3: 'MP3 File', mp4: 'MP4 File', flac: 'FLAC File', png: 'PNG File', jpg: 'JPG File', csv: 'Microsoft Excel Comma Separated Values File', dll: 'Application extension', sys: 'System file', ini: 'Configuration settings', log: 'Text Document', md: 'MD File', zip: 'Compressed (zipped) Folder', msc: 'Microsoft Common Console Document', ps1: 'Windows PowerShell Script', bat: 'Windows Batch File', cfg: 'CFG File', inf: 'Setup Information', dat: 'DAT File' };
const typeOf = (n, isDir) => (isDir ? 'File folder' : TYPES[lc((/\.([^.]+)$/.exec(n) || [])[1] || '')] || ((/\.([^.]+)$/.exec(n) || [])[1] ? `${(/\.([^.]+)$/.exec(n))[1].toUpperCase()} File` : 'File'));

export function open(env, opts = {}) {
  const sys = env.sys;
  const home = `/Users/${env.user}`;
  // other users' profiles and system folders need administrator approval (NTFS permissions)
  const protectedPath = (p) => /^\/(Windows|Program Files|Program Files \(x86\)|ProgramData|CyberPatriot)(\/|$)/i.test(p) || /^\/Users\/Public\/Desktop/i.test(p) || (/^\/Users\/([^/]+)\//.test(p) && !new RegExp(`^/Users/(${env.user}|Public)/`, 'i').test(p));
  let cwd = opts.path ? S.resolve(sys, opts.path) : 'home';
  const back = []; const fwd = [];
  let sel = null;
  let query = '';
  const showHidden = () => Number(S.regGet(sys, ADV, 'Hidden') ?? 2) === 1;
  const showExt = () => Number(S.regGet(sys, ADV, 'HideFileExt') ?? 1) === 0;
  const isHidden = (p) => (sys.win.hidden || []).includes(lc(p)) || /\/(AppData|NTUSER\.DAT.*|\$Recycle\.Bin|System Volume Information|desktop\.ini)$/i.test(p) || p === '/ProgramData';

  const nav = h('div', { class: 'w-nav' });
  const main = h('div', { class: 'w-main' });
  const status = h('div', { class: 'w-status' });
  const crumbs = h('div', { class: 'wex-path', title: 'Address (click to type a path)', onclick: (e) => { if (e.target === crumbs) editPath(); } });
  const q = h('input', { class: 'w-in wex-q', placeholder: 'Search', title: 'Search this folder (and below)', oninput: () => { query = q.value.trim(); render(); } });
  const bBack = h('button', { title: 'Back (Alt+Left)', onclick: () => { if (back.length) { fwd.push(cwd); go(back.pop(), false); } } }, '←');
  const bFwd = h('button', { title: 'Forward (Alt+Right)', onclick: () => { if (fwd.length) { back.push(cwd); go(fwd.pop(), false); } } }, '→');
  const bUp = h('button', { title: 'Up to the parent folder (Alt+Up)', onclick: () => { if (typeof cwd === 'string' && cwd !== 'home' && cwd !== 'pc') go(cwd === '/' ? 'pc' : cwd.slice(0, cwd.lastIndexOf('/')) || '/'); } }, '↑');
  const bRef = h('button', { title: 'Refresh (F5)', onclick: () => render() }, '⟳');
  const cmd = (ic, label, fn, title) => h('button', { title: title || label, onclick: fn }, ic ? icon(ic, 18) : null, label);
  const tb = h('div', { class: 'w-tb' },
    cmd(null, '＋ New', (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, [{ label: 'Folder', action: () => newItem(true) }, { label: 'Text Document', action: () => newItem(false) }]); }, 'Create a new item'),
    h('div', { class: 'sep' }),
    cmd(null, '✎ Rename', () => sel && rename(sel), 'Rename (F2)'),
    cmd(null, '🗑 Delete', () => sel && del(sel), 'Delete (Del)'),
    h('div', { class: 'sep' }),
    cmd(null, '⇅ Sort', (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, [['Name', 'name'], ['Date modified', 'date'], ['Type', 'type'], ['Size', 'size']].map(([l, k]) => ({ label: l, action: () => { sortKey = k; render(); } }))); }),
    cmd(null, '☰ View', (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, [{ label: `${view === 'details' ? '● ' : ''}Details`, action: () => { view = 'details'; render(); } }, { label: `${view === 'icons' ? '● ' : ''}Large icons`, action: () => { view = 'icons'; render(); } }, 'sep', { label: `${showHidden() ? '☑' : '☐'} Hidden items`, action: () => toggleReg('Hidden', showHidden() ? 2 : 1) }, { label: `${showExt() ? '☑' : '☐'} File name extensions`, action: () => toggleReg('HideFileExt', showExt() ? 1 : 0) }]); }),
    h('span', { style: { flex: 1 } }),
    cmd(null, '⋯', (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left - 120, r.bottom, [{ label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd: typeof cwd === 'string' && cwd.startsWith('/') ? cwd : home }) }, { label: 'Properties', action: () => sel && props(sel) }, ...(cwd === BIN ? [{ label: 'Empty Recycle Bin', action: emptyBin }] : [])]); }, 'See more'));
  const root = h('div', { class: 'wapp' },
    h('div', { class: 'wex-addr' }, bBack, bFwd, bUp, bRef, crumbs, q), tb, h('div', { class: 'w-split' }, nav, main), status);
  const win = env.wm.open({ title: 'File Explorer', icon: 'w-explorer', width: 960, height: 600, appId: 'explorer', content: root });
  let view = 'details'; let sortKey = 'name';

  function toggleReg(name, v) { S.regSet(sys, ADV, name, v); render(); }
  function label(p) { if (p === 'home') return 'Home'; if (p === 'pc') return 'This PC'; if (p === '/') return 'Local Disk (C:)'; if (p === BIN) return 'Recycle Bin'; return p.split('/').pop(); }
  function go(p, push = true) { if (push && p !== cwd) { back.push(cwd); fwd.length = 0; } cwd = p; sel = null; q.value = ''; query = ''; render(); }

  function navTree() {
    clear(nav);
    const item = (p, ic, text, depth = 0) => h('div', { class: 'w-navi' + (cwd === p ? ' sel' : ''), style: { paddingLeft: 8 + depth * 14 + 'px' }, title: typeof p === 'string' && p.startsWith('/') ? S.toWin(p) : text, onclick: () => go(p) }, icon(ic, 18), h('span', null, text));
    nav.append(item('home', 'w-folder', 'Home'), h('div', { style: { height: '8px' } }));
    for (const [n, ic] of [['Desktop', 'w-folder-desktop'], ['Downloads', 'w-folder-downloads'], ['Documents', 'w-folder-docs'], ['Pictures', 'w-folder-pictures'], ['Music', 'w-folder-music'], ['Videos', 'w-folder-videos']]) nav.append(item(`${home}/${n}`, ic, n));
    nav.append(h('div', { style: { height: '1px', background: '#e5e5e5', margin: '8px 6px' } }), item('pc', 'w-thispc', 'This PC'), item('/', 'w-drive', 'Local Disk (C:)', 1), item('/Users', 'w-folder', 'Users', 2), item('/Program Files', 'w-folder', 'Program Files', 2), item('/Windows', 'w-folder', 'Windows', 2), item(BIN, 'w-recycle', 'Recycle Bin'));
  }
  function breadcrumbs() {
    clear(crumbs);
    const parts = cwd === 'home' ? [['home', 'Home']] : cwd === 'pc' ? [['pc', 'This PC']] : (() => { const out = [['pc', 'This PC'], ['/', 'Local Disk (C:)']]; let acc = ''; for (const seg of cwd.split('/').filter(Boolean)) { acc += '/' + seg; out.push([acc, seg === '$Recycle.Bin' ? 'Recycle Bin' : seg]); } return out; })();
    crumbs.append(icon(cwd === 'pc' ? 'w-thispc' : cwd === BIN ? 'w-recycle' : 'w-folder', 16));
    parts.forEach(([p, t], i) => { if (i) crumbs.append(h('span', { style: { color: '#888' } }, '›')); crumbs.append(h('span', { class: 'cr', title: typeof p === 'string' && p.startsWith('/') ? S.toWin(p) : t, onclick: (e) => { e.stopPropagation(); go(p); } }, t)); });
  }
  function editPath() {
    clear(crumbs);
    const inp = h('input', { value: typeof cwd === 'string' && cwd.startsWith('/') ? S.toWin(cwd) : label(cwd), onkeydown: (e) => {
      if (e.key === 'Escape') { breadcrumbs(); return; }
      if (e.key !== 'Enter') return;
      const v = inp.value.trim();
      if (/^this pc$/i.test(v)) return go('pc');
      if (/^(home|quick access)$/i.test(v)) return go('home');
      if (/^(cmd|powershell|wt)$/i.test(v)) { breadcrumbs(); return env.openApp('terminal', { mode: /cmd/i.test(v) ? 'cmd' : 'ps', cwd: typeof cwd === 'string' && cwd.startsWith('/') ? cwd : home }); }
      const p = S.resolve(sys, S.fromWin(v, typeof cwd === 'string' && cwd.startsWith('/') ? cwd : home, { USERPROFILE: `C:\\Users\\${env.user}`, APPDATA: `C:\\Users\\${env.user}\\AppData\\Roaming`, LOCALAPPDATA: `C:\\Users\\${env.user}\\AppData\\Local`, WINDIR: 'C:\\Windows', PROGRAMDATA: 'C:\\ProgramData', TEMP: `C:\\Users\\${env.user}\\AppData\\Local\\Temp` }));
      if (sys.vfs.isDir(p)) go(p); else if (sys.vfs.isFile(p)) { breadcrumbs(); env.openPath(p); } else env.ui.alert({ title: 'File Explorer', heading: `Windows can't find '${v}'.`, message: 'Check the spelling and try again.', icon: 'w-warn' }).then(breadcrumbs);
    }, onblur: () => setTimeout(breadcrumbs, 100) });
    crumbs.append(inp); inp.focus(); inp.select();
  }
  function entries() {
    if (cwd === 'home') return ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos'].map((n) => `${home}/${n}`).filter((p) => sys.vfs.isDir(p));
    let names = [];
    try { names = sys.vfs.readdir(cwd); } catch { return null; }
    const list = names.map((n) => (cwd === '/' ? `/${n}` : `${cwd}/${n}`)).filter((p) => showHidden() || !isHidden(p) || cwd === BIN);
    if (!query) return list;
    const out = [];
    const walk = (dir, d) => { if (d > 6 || out.length > 300) return; let ns = []; try { ns = sys.vfs.readdir(dir); } catch { return; } for (const n of ns) { const p = dir === '/' ? `/${n}` : `${dir}/${n}`; if (!showHidden() && isHidden(p)) continue; if (lc(n).includes(lc(query))) out.push(p); if (sys.vfs.isDir(p)) walk(p, d + 1); } };
    walk(cwd, 0);
    return out;
  }
  const shown = (n, isDir) => (isDir || showExt() ? n : n.replace(/\.[^.]+$/, '') || n);
  function render() {
    navTree(); breadcrumbs();
    bBack.disabled = !back.length; bFwd.disabled = !fwd.length; bUp.disabled = cwd === 'home' || cwd === 'pc';
    win.setTitle(`${label(cwd)} - File Explorer`);
    clear(main);
    if (cwd === 'pc') {
      main.append(h('div', { class: 'wex-drives' }, h('h3', { style: { fontWeight: 600, fontSize: '14px' } }, 'Devices and drives'),
        h('div', { class: 'wex-drive', title: 'Local Disk (C:)', ondblclick: () => go('/') }, icon('w-drive', 44), h('div', { style: { flex: 1 } }, h('div', null, 'Local Disk (C:)'), h('div', { class: 'wex-bar' }, h('i', { style: { width: '57%' } })), h('div', { class: 'sub' }, '42.1 GB free of 99.3 GB')))));
      status.textContent = '1 item';
      return;
    }
    const list = entries();
    if (!list) { main.append(h('div', { style: { padding: '40px', color: '#666' } }, 'This folder is empty.')); status.textContent = '0 items'; return; }
    const rows = list.map((p) => { const isDir = sys.vfs.isDir(p); const st = sys.vfs.stat(p); return { p, n: p.split('/').pop(), isDir, t: st.mtime, size: isDir ? null : st.size }; });
    rows.sort((a, b) => (b.isDir - a.isDir) || (sortKey === 'date' ? b.t - a.t : sortKey === 'size' ? (b.size || 0) - (a.size || 0) : sortKey === 'type' ? typeOf(a.n, a.isDir).localeCompare(typeOf(b.n, b.isDir)) : a.n.localeCompare(b.n, undefined, { sensitivity: 'base' })));
    if (!rows.length) main.append(h('div', { style: { padding: '40px', color: '#666', textAlign: 'center' } }, query ? 'No items match your search.' : 'This folder is empty.'));
    else if (view === 'icons') {
      main.append(h('div', { class: 'wex-grid' }, rows.map((r) => { const el = h('div', { class: 'wex-ic' + (sel === r.p ? ' sel' : '') + (isHidden(r.p) ? ' hid' : ''), title: S.toWin(r.p), onclick: () => { sel = r.p; render(); }, ondblclick: () => openItem(r), oncontextmenu: (e) => ctx(e, r) }, icon(winFileIcon(r.n, r.isDir), 48), h('span', null, shown(r.n, r.isDir))); return el; })));
    } else {
      const tbody = h('tbody');
      for (const r of rows) tbody.append(h('tr', { class: (sel === r.p ? 'sel' : '') + (isHidden(r.p) ? ' off' : ''), title: S.toWin(r.p), onclick: () => { sel = r.p; render(); }, ondblclick: () => openItem(r), oncontextmenu: (e) => ctx(e, r) },
        h('td', null, icon(winFileIcon(r.n, r.isDir), 18), query ? `${shown(r.n, r.isDir)}  ` : shown(r.n, r.isDir), query ? h('span', { class: 'sub' }, S.toWin(r.p.slice(0, r.p.lastIndexOf('/')) || '/')) : null), h('td', null, fmtDate(r.t)), h('td', null, typeOf(r.n, r.isDir)), h('td', { style: { textAlign: 'right' } }, kb(r.size))));
      main.append(h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, h('th', { style: { width: '44%' } }, 'Name'), h('th', null, 'Date modified'), h('th', null, 'Type'), h('th', { style: { textAlign: 'right' } }, 'Size'))), tbody));
    }
    main.oncontextmenu = (e) => { if (e.target === main || e.target.closest('table') === null) { e.preventDefault(); env.ui.showMenu(e.clientX, e.clientY, [{ label: 'New folder', action: () => newItem(true) }, { label: 'New text document', action: () => newItem(false) }, 'sep', { label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd: cwd.startsWith('/') ? cwd : home }) }, { label: 'Refresh', action: render }]); } };
    status.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}${sel ? '    1 item selected' : ''}`;
  }
  function openItem(r) { if (r.isDir) go(r.p); else env.openPath(r.p); }
  function ctx(e, r) {
    e.preventDefault(); sel = r.p; render();
    env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Open', action: () => openItem(r) }, ...(!r.isDir ? [{ label: 'Open with › Notepad', action: () => env.openApp('notepad', { path: r.p }) }, ...(S.listPrograms(sys).some((x) => x.id === 'Notepad++.Notepad++') ? [{ label: 'Edit with Notepad++', action: () => env.openApp('notepadpp', { path: r.p }) }] : [])] : []), ...(r.isDir ? [{ label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd: r.p }) }] : []),
      'sep', { label: 'Copy as path', action: () => navigator.clipboard?.writeText(`"${S.toWin(r.p)}"`).catch(() => {}) }, { label: 'Rename', action: () => rename(r.p) }, { label: cwd === BIN ? 'Delete permanently' : 'Delete', action: () => del(r.p) }, ...(cwd === BIN ? [{ label: 'Restore', action: () => restore(r.p) }] : []), 'sep', { label: 'Properties', action: () => props(r.p) }]);
  }
  async function needAdmin(p) { if (!protectedPath(p) || opts.elevated) return true; return elevate(env, { what: 'File Explorer' }); }
  async function del(p) {
    if (!(await needAdmin(p))) return;
    try {
      if (p.startsWith(BIN + '/') || cwd === BIN) { sys.vfs.isDir(p) ? sys.vfs.rmrf(p) : sys.vfs.unlink(p); }
      else {
        if (!sys.vfs.isDir(BIN)) sys.vfs.mkdir(BIN, { parents: true, mode: 0o777 });
        let dest = `${BIN}/${p.split('/').pop()}`; let i = 1; while (sys.vfs.exists(dest)) dest = `${BIN}/${p.split('/').pop()} (${++i})`;
        sys.vfs.rename(p, dest);
        (sys.win.binOrigin ||= {})[dest] = p;
      }
      if (sys.win.hidden) sys.win.hidden = sys.win.hidden.filter((x) => !x.startsWith(lc(p)));
      sys.touch('fs'); sel = null; render(); env.desktop?.renderIcons?.();
    } catch (err) { env.ui.alert({ title: 'File Explorer', heading: 'Could not delete the item', message: err.message, icon: 'w-bad' }); }
  }
  function restore(p) { const to = sys.win.binOrigin?.[p]; if (!to) return; try { sys.vfs.rename(p, to); delete sys.win.binOrigin[p]; sys.touch('fs'); render(); env.desktop?.renderIcons?.(); } catch (err) { env.ui.alert({ title: 'Restore', heading: 'Could not restore', message: err.message, icon: 'w-bad' }); } }
  async function emptyBin() {
    if (!sys.vfs.isDir(BIN)) return;
    const ok = await env.ui.confirm({ title: 'Delete Multiple Items', heading: 'Are you sure you want to permanently delete these items?', message: '', ok: 'Yes', cancel: 'No', icon: 'w-warn' });
    if (!ok) return;
    for (const n of sys.vfs.readdir(BIN)) { const p = `${BIN}/${n}`; sys.vfs.isDir(p) ? sys.vfs.rmrf(p) : sys.vfs.unlink(p); }
    sys.win.binOrigin = {}; sys.touch('fs'); render();
  }
  async function rename(p) {
    if (!(await needAdmin(p))) return;
    const n = await env.ui.prompt({ title: 'Rename', message: 'New name:', value: p.split('/').pop() });
    if (!n || n === p.split('/').pop()) return;
    if (/[\\/:*?"<>|]/.test(n)) { env.ui.alert({ title: 'Rename', heading: 'A file name can\'t contain any of the following characters:', message: '\\ / : * ? " < > |', icon: 'w-warn' }); return; }
    try { sys.vfs.rename(p, `${p.slice(0, p.lastIndexOf('/'))}/${n}`); sys.touch('fs'); render(); env.desktop?.renderIcons?.(); } catch (err) { env.ui.alert({ title: 'Rename', heading: 'Could not rename', message: err.message, icon: 'w-bad' }); }
  }
  async function newItem(dir) {
    const base = typeof cwd === 'string' && cwd.startsWith('/') ? cwd : `${home}/Desktop`;
    if (!(await needAdmin(base))) return;
    const n = await env.ui.prompt({ title: dir ? 'New folder' : 'New text document', message: 'Name:', value: dir ? 'New folder' : 'New Text Document.txt' });
    if (!n) return;
    const p = `${base === '/' ? '' : base}/${n}`;
    if (sys.vfs.exists(p)) { env.ui.alert({ title: 'File Explorer', heading: 'There is already an item with that name.', message: S.toWin(p), icon: 'w-warn' }); return; }
    if (dir) sys.vfs.mkdir(p, { mode: 0o777 }); else sys.vfs.writeFile(p, '', { mode: 0o666, uid: 0, gid: 0 });
    sys.touch('fs'); render(); env.desktop?.renderIcons?.();
  }
  function props(p) {
    const st = sys.vfs.stat(p); const isDir = sys.vfs.isDir(p);
    let count = 0; let bytes = 0;
    if (isDir) { const walk = (d) => { for (const n of sys.vfs.readdir(d)) { const x = `${d}/${n}`; if (sys.vfs.isDir(x)) walk(x); else { count++; bytes += sys.vfs.stat(x).size; } } }; try { walk(p); } catch { /* ignore */ } }
    env.ui.alert({ title: `${p.split('/').pop()} Properties`, heading: p.split('/').pop(), icon: winFileIcon(p.split('/').pop(), isDir), message: `Type: ${typeOf(p, isDir)}\nLocation: ${S.toWin(p.slice(0, p.lastIndexOf('/')) || '/')}\nSize: ${isDir ? `${bytes.toLocaleString('en-US')} bytes (${count} files)` : `${st.size.toLocaleString('en-US')} bytes`}\nModified: ${fmtDate(st.mtime)}\nAttributes: ${isHidden(p) ? 'Hidden' : 'Normal'}` });
  }
  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Delete' && sel) del(sel);
    if (e.key === 'F2' && sel) rename(sel);
    if (e.key === 'F5') { e.preventDefault(); render(); }
    if (e.altKey && e.key === 'ArrowLeft') bBack.click();
    if (e.altKey && e.key === 'ArrowUp') bUp.click();
  });
  root.tabIndex = 0;
  render();
  return win;
}
