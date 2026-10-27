// Nemo-style file manager.
import { h, clear } from '../ui/dom.js';
import { icon, fileIconName } from '../ui/icons.js';
import { FsView, FsError } from '../core/vfs.js';
import * as users from '../core/users.js';
import { posix, fmtLsDate, humanSize } from '../core/util.js';
import { trashPath, uniqueName, modeString, ensureTrash } from './files-util.js';

const PLACES_UBUNTU = [['Recent', 'info', (h0) => h0], ['Starred', 'info', (h0) => h0], ['Home', 'home', (h0) => h0], ['Desktop', 'folder', (h0) => `${h0}/Desktop`], ['Documents', 'folder', (h0) => `${h0}/Documents`], ['Downloads', 'folder', (h0) => `${h0}/Downloads`], ['Music', 'music', (h0) => `${h0}/Music`], ['Pictures', 'image', (h0) => `${h0}/Pictures`], ['Videos', 'video', (h0) => `${h0}/Videos`], ['Trash', 'trash', (h0) => `${h0}/.local/share/Trash/files`], ['Other Locations', 'disk', () => '/']];
const PLACES = [['Home', 'home', (h0) => h0], ['Desktop', 'folder', (h0) => `${h0}/Desktop`], ['Documents', 'folder', (h0) => `${h0}/Documents`], ['Downloads', 'folder', (h0) => `${h0}/Downloads`], ['Music', 'music', (h0) => `${h0}/Music`], ['Pictures', 'image', (h0) => `${h0}/Pictures`], ['Videos', 'video', (h0) => `${h0}/Videos`], ['Trash', 'trash', (h0) => `${h0}/.local/share/Trash/files`], ['File System', 'disk', () => '/']];

export function open(env, opts = {}) {
  const sys = env.sys;
  const user = opts.user || env.user;
  const asRoot = user === 'root';
  const cred = users.credFor(sys, user) || { name: 'root', uid: 0, gid: 0, gids: [0] };
  const fs = new FsView(sys.vfs, asRoot ? { name: 'root', uid: 0, gid: 0, gids: [0] } : cred);
  const home = users.getUser(sys, user)?.home || '/root';
  let cwd = opts.path || home;
  const hist = []; let hpos = -1;
  let showHidden = false;
  let view = 'grid';
  let sel = new Set();
  let items = [];

  const ub = env.os === 'ubuntu';
  const titleOf = (path) => (path === `${home}/.local/share/Trash/files` ? 'Trash' : posix.basename(path) || 'File System');
  const addr = h('input', { class: 'in', style: { flex: 1 }, onkeydown: (e) => { if (e.key === 'Enter') { go(addr.value.replace(/^~/, home)); endEdit(); } else if (e.key === 'Escape') { addr.value = cwd; endEdit(); } }, onblur: () => endEdit() });
  // Nautilus-style breadcrumb path bar (Ubuntu); clicking the empty part or Ctrl+L switches to a text location entry
  const pathbar = ub ? h('div', { class: 'pathbar', onclick: (e) => { if (e.target === pathbar) editAddr(); } }) : null;
  const editAddr = () => { if (!ub) return; pathbar.style.display = 'none'; addr.style.display = ''; addr.focus(); addr.select(); };
  const endEdit = () => { if (!ub) return; addr.style.display = 'none'; pathbar.style.display = ''; };
  const renderPath = () => {
    if (!ub) return;
    clear(pathbar);
    const inHome = cwd === home || cwd.startsWith(home + '/');
    const segs = [];
    if (inHome) { segs.push(['Home', home, 'home']); let acc = home; for (const part of cwd.slice(home.length).split('/').filter(Boolean)) { acc += '/' + part; segs.push([part, acc]); } }
    else { segs.push(['', '/', 'disk']); let acc = ''; for (const part of cwd.split('/').filter(Boolean)) { acc += '/' + part; segs.push([part, acc]); } }
    segs.forEach(([label, path, ic], i) => {
      if (i) pathbar.append(h('span', { class: 'sep' }, '›'));
      pathbar.append(h('div', { class: 'seg' + (i === segs.length - 1 ? ' cur' : ''), onclick: () => go(path) }, ic ? icon(ic, 16) : null, label || null));
    });
  };
  const mkBtn = (txt, title, fn) => h('button', { class: 'btn', title, style: { minWidth: '30px', padding: '2px 8px' }, onclick: fn }, txt);
  const back = mkBtn('◀', 'Back', () => { if (hpos > 0) { hpos--; show(hist[hpos], false); } });
  const fwd = mkBtn('▶', 'Forward', () => { if (hpos < hist.length - 1) { hpos++; show(hist[hpos], false); } });
  const up = mkBtn('▲', 'Up', () => go(posix.dirname(cwd) || '/'));
  const viewBtn = mkBtn('☰', 'List view', () => { view = view === 'grid' ? 'list' : 'grid'; viewBtn.textContent = view === 'grid' ? '☰' : '▦'; viewBtn.title = view === 'grid' ? 'List view' : 'Icon view'; render(); });
  const tb = h('div', { class: 'toolbar' }, back, fwd, ...(ub ? [] : [up]), ...(ub ? [pathbar] : []), addr, mkBtn('⟳', 'Reload', () => render()), viewBtn);
  if (ub) addr.style.display = 'none';
  const side = h('div', { class: 'fm-side' }, (env.os === 'ubuntu' ? PLACES_UBUNTU : PLACES).map(([n, ic, f]) => h('div', { class: 'pl', onclick: () => { if (n === 'Trash' && !asRoot) { try { ensureTrash(sys, cred, user); } catch { /* ignore */ } } go(f(home)); } }, icon(ic, 18), n)));
  const tbody = h('tbody');
  const table = h('table', { class: 'grid fm-table' }, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', { style: { width: '90px' } }, 'Size'), h('th', { style: { width: '130px' } }, 'Type'), h('th', { style: { width: '150px' } }, 'Modified'))), tbody);
  const gridEl = h('div', { class: 'fm-grid' });
  const list = h('div', { class: 'fm-list scroll', tabindex: 0, oncontextmenu: (e) => { if (e.target.closest('[data-n]')) return; e.preventDefault(); sel.clear(); renderSel(); ctxMenu(e, null); }, onmousedown: (e) => { if (!e.target.closest('[data-n]')) { sel.clear(); renderSel(); list.focus(); } } }, table, gridEl);
  const status = h('div', { class: 'statusbar' });
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, side, list), status);
  const win = env.wm.open({ title: `${titleOf(cwd)}${asRoot ? ' (as root)' : ''}`, icon: 'folder', width: 780, height: 500, appId: 'nemo', content });
  if (asRoot) addr.style.background = '#f3d7d5';
  if (ub) { content.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); editAddr(); } }); }

  const err = (e, what = 'Error') => env.ui.alert({ title: what, heading: what, message: e instanceof FsError ? `${e.text}` : String(e.message || e), icon: 'error' });
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof FsError) { err(e, 'Error'); return undefined; } throw e; } };

  function go(path) { show(posix.normalize(path || '/', '/'), true); }
  function show(path, push) {
    try {
      if (!fs.isDir(path)) { if (fs.exists(path)) { env.openPath(path); addr.value = cwd; return; } throw new FsError('ENOENT', path); }
      fs.readdir(path);
    } catch (e) {
      if (e instanceof FsError) { env.ui.alert({ title: 'Files', heading: `Unable to access “${posix.basename(path) || path}”`, message: e.code === 'EACCES' ? 'Error: Permission denied\nUnable to access location' : `Error: ${e.text}`, icon: 'error' }); addr.value = cwd; return; }
      throw e;
    }
    cwd = path;
    if (push) { hist.length = hpos + 1; hist.push(path); hpos = hist.length - 1; }
    sel.clear();
    win.setTitle(`${titleOf(path)}${asRoot ? ' (as root)' : ''}`);
    render();
  }
  function entries() {
    let names = [];
    try { names = fs.readdir(cwd); } catch { names = []; }
    const out = [];
    for (const n of names) {
      if (!showHidden && n.startsWith('.')) continue;
      const p = posix.join(cwd, n);
      let st; try { st = fs.lstat(p); } catch { continue; }
      let isDir = st.t === 'd';
      if (st.t === 'l') { try { isDir = fs.isDir(p); } catch { isDir = false; } }
      out.push({ n, p, st, isDir });
    }
    out.sort((a, b) => (a.isDir === b.isDir ? a.n.toLowerCase().localeCompare(b.n.toLowerCase()) : a.isDir ? -1 : 1));
    return out;
  }
  function typeOf(it) {
    if (it.isDir) return 'Folder';
    if (it.st.t === 'l') return 'Link';
    if (/\.(txt|md|conf|log)$/i.test(it.n)) return 'Text document';
    if (/\.html?$/i.test(it.n)) return 'HTML document';
    if (/\.desktop$/i.test(it.n)) return 'Desktop entry';
    if (/\.mp3$/i.test(it.n)) return 'MP3 audio';
    if (/\.mp4$/i.test(it.n)) return 'MPEG-4 video';
    return 'Document';
  }
  function render() {
    items = entries();
    addr.value = cwd;
    renderPath();
    clear(tbody);
    clear(gridEl);
    table.style.display = view === 'list' ? '' : 'none';
    gridEl.style.display = view === 'grid' ? '' : 'none';
    const hand = (it) => ({
      dataset: { n: it.n },
      onmousedown: (e) => { if (e.button === 2 && sel.has(it.n)) return; if (e.ctrlKey) { sel.has(it.n) ? sel.delete(it.n) : sel.add(it.n); } else sel = new Set([it.n]); renderSel(); list.focus(); },
      ondblclick: () => openItem(it),
      oncontextmenu: (e) => { e.preventDefault(); if (!sel.has(it.n)) { sel = new Set([it.n]); renderSel(); } ctxMenu(e, it); },
    });
    for (const it of items) {
      if (view === 'grid') {
        gridEl.append(h('div', { class: 'gi', ...hand(it) }, icon(fileIconName(it.n, it.isDir), 56), h('div', { class: 'gn' }, it.n)));
        continue;
      }
      const tr = h('tr', hand(it),
        h('td', null, icon(fileIconName(it.n, it.isDir), 20), ' ', it.n, it.st.t === 'l' ? h('span', { style: { color: '#888' } }, ` → ${it.st.target}`) : null),
        h('td', null, it.isDir ? `${childCount(it.p)} items` : humanSize(it.st.size)), h('td', null, typeOf(it)), h('td', null, fmtLsDate(it.st.mtime, sys.now()).replace(/\s+/g, ' ')));
      tbody.append(tr);
    }
    renderSel();
    back.disabled = hpos <= 0; fwd.disabled = hpos >= hist.length - 1;
  }
  function childCount(p) { try { return fs.readdir(p).filter((n) => showHidden || !n.startsWith('.')).length; } catch { return '?'; } }
  function renderSel() {
    for (const tr of tbody.children) tr.classList.toggle('sel', sel.has(tr.dataset.n));
    for (const g of gridEl.children) g.classList.toggle('sel', sel.has(g.dataset.n));
    status.textContent = sel.size ? `${sel.size} item${sel.size === 1 ? '' : 's'} selected` : `${items.length} items`;
  }
  function openItem(it) {
    if (it.isDir) { go(it.p); return; }
    if (asRoot && !/\.desktop$/.test(it.n)) { env.openApp('xed', { args: [it.p], user: 'root' }); return; }
    env.openPath(it.p);
  }
  const selItems = () => items.filter((i) => sel.has(i.n));

  function clip() { return (env.clipboard = env.clipboard || { op: null, paths: [] }); }
  function doPaste() {
    const c = clip();
    if (!c.paths.length) return;
    guard(() => {
      for (const src of c.paths) {
        const name = uniqueName(fs, cwd, posix.basename(src));
        const dst = posix.join(cwd, name);
        if (c.op === 'cut') fs.rename(src, dst); else fs.copy(src, dst, { recursive: true });
      }
    });
    if (c.op === 'cut') c.paths = [];
    render();
  }
  async function rename(it) {
    const n = await env.ui.prompt({ title: 'Rename', message: 'Enter a new name:', value: it.n });
    if (!n || n === it.n) return;
    guard(() => fs.rename(it.p, posix.join(cwd, n)));
    render();
  }
  function toTrash(list) {
    for (const it of list) { try { trashPath(sys, asRoot ? { name: 'root', uid: 0, gid: 0, gids: [0] } : cred, user, it.p); } catch (e) { if (e instanceof FsError) { env.ui.alert({ title: 'Error', heading: `Error while moving “${it.n}” to the trash`, message: e.code === 'EACCES' || e.code === 'EPERM' ? 'Permission denied' : e.text, icon: 'error' }); return; } throw e; } }
    render();
  }
  async function delPerm(list) {
    const ok = await env.ui.confirm({ title: 'Delete', heading: `Are you sure you want to permanently delete ${list.length === 1 ? `“${list[0].n}”` : `${list.length} selected items`}?`, message: 'If you delete an item, it will be permanently lost.', ok: 'Delete', danger: true, icon: 'warn' });
    if (!ok) return;
    guard(() => { for (const it of list) { if (it.isDir && it.st.t !== 'l') fs.rmrf(it.p); else fs.unlink(it.p); } });
    render();
  }
  async function newThing(dir) {
    const n = await env.ui.prompt({ title: dir ? 'New Folder' : 'New Document', message: dir ? 'Folder name:' : 'File name:', value: dir ? 'Untitled Folder' : 'Untitled Document' });
    if (!n) return;
    guard(() => { if (dir) fs.mkdir(posix.join(cwd, n)); else fs.writeFile(posix.join(cwd, n), ''); });
    render();
  }
  async function openAsRoot(it) {
    const ok = await env.ui.authenticate({ message: 'Authentication is required to run Files as root', action: 'com.linuxmint.nemo.root', asUser: env.user });
    if (ok) open(env, { ...opts, user: 'root', path: it ? (it.isDir ? it.p : cwd) : cwd });
  }
  function ctxMenu(e, it) {
    const items_ = [];
    const s = selItems();
    if (it) {
      items_.push({ label: 'Open', action: () => openItem(it) });
      if (!it.isDir) items_.push({ label: 'Open With Text Editor', action: () => env.openApp('xed', { args: [it.p], user }) });
      if (it.isDir) items_.push({ label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd: it.p, user }) });
      if (!asRoot) items_.push({ label: it.isDir ? 'Open as Root' : 'Open as Root', action: () => openAsRoot(it) });
      items_.push('sep', { label: 'Cut', action: () => { Object.assign(clip(), { op: 'cut', paths: s.map((i) => i.p) }); } }, { label: 'Copy', action: () => { Object.assign(clip(), { op: 'copy', paths: s.map((i) => i.p) }); } });
      items_.push({ label: 'Paste Into Folder', disabled: !it.isDir || !clip().paths.length, action: () => { go(it.p); doPaste(); } });
      items_.push('sep', { label: 'Rename…', disabled: s.length !== 1, action: () => rename(it) }, { label: 'Move to Trash', action: () => toTrash(s) }, { label: 'Delete', hint: 'Shift+Del', action: () => delPerm(s) }, 'sep', { label: 'Properties', action: () => props(it) });
    } else {
      items_.push({ label: 'New Folder', action: () => newThing(true) }, { label: 'New Document', action: () => newThing(false) }, 'sep', { label: 'Paste', disabled: !clip().paths.length, action: doPaste }, { label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd, user }) });
      if (!asRoot) items_.push({ label: 'Open as Root', action: () => openAsRoot(null) });
      items_.push('sep', { label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', hint: 'Ctrl+H', action: () => { showHidden = !showHidden; render(); } }, { label: 'Properties', action: () => props({ n: posix.basename(cwd) || '/', p: cwd, isDir: true, st: fs.lstat(cwd) }) });
    }
    env.ui.showMenu(e.clientX, e.clientY, items_);
  }

  // ---------------------------------------------------------------- properties dialog (Basic + Permissions)
  function props(it) {
    let st;
    try { st = fs.lstat(it.p); } catch (e) { err(e); return; }
    const owner = users.getUserByUid(sys, st.uid)?.name ?? String(st.uid);
    const group = users.getGroupByGid(sys, st.gid)?.name ?? String(st.gid);
    const iAmOwner = asRoot || st.uid === cred.uid;
    const canChown = asRoot;
    const body = h('div', { style: { flex: 1, overflow: 'auto' } });
    const row = (a, b) => h('div', { style: { display: 'flex', padding: '3px 0' } }, h('div', { style: { width: '130px', textAlign: 'right', paddingRight: '14px', color: 'var(--text-dim)' } }, a), h('div', { style: { flex: 1, userSelect: 'text' } }, b));
    const tabs = h('div', { class: 'tabs' });
    const pw = env.wm.open({ title: `${it.n} Properties`, icon: 'folder', width: 420, height: 440, appId: 'props', content: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1 } }, tabs, body), noMax: true, resizable: false });
    const basic = () => {
      clear(body); body.style.padding = '14px';
      body.append(h('div', { style: { textAlign: 'center', marginBottom: '10px' } }, icon(fileIconName(it.n, it.isDir), 56)), row('Name:', it.n), row('Type:', typeOf(it)), row('Size:', it.isDir ? `${childCount(it.p)} items` : `${humanSize(st.size)} (${st.size} bytes)`), row('Location:', posix.dirname(it.p)), row('Modified:', new Date(st.mtime).toLocaleString()), row('Owner:', owner), row('Group:', group));
    };
    const perms = () => {
      clear(body); body.style.padding = '14px';
      const levels = [['None', 0], ['Read-only', 4], ['Read and write', 6]];
      const bits = (shift) => (st.mode >> shift) & 6;
      const sel = (shift, enabled) => {
        const cur = bits(shift);
        const sv = [0, 4, 6].includes(cur) ? cur : (cur & 4 ? 4 : 0);
        const s = h('select', { class: 'in', disabled: !enabled, onchange: () => apply((st.mode & ~(6 << shift)) | (Number(s.value) << shift)) }, levels.map(([l, v]) => h('option', { value: v, selected: v === sv }, l)));
        return s;
      };
      const en = iAmOwner;
      if (!en) body.append(h('div', { style: { color: '#a15a00', marginBottom: '8px' } }, 'You are not the owner, so you cannot change these permissions.'));
      body.append(h('div', { style: { fontWeight: 600, margin: '4px 0' } }, 'Owner'), row('Owner:', owner), row('Access:', sel(6, en)),
        h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, 'Group'), row('Group:', (() => { const gsel = h('select', { class: 'in', disabled: !en, onchange: () => { guard(() => fs.chown(it.p, -1, users.getGroup(sys, gsel.value).gid)); st = fs.lstat(it.p); } }, users.readGroups(sys).filter((g) => asRoot || users.userGroups(sys, user).some((x) => x.name === g.name)).map((g) => h('option', { value: g.name, selected: g.gid === st.gid }, g.name))); return gsel; })()), row('Access:', sel(3, en)),
        h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, 'Others'), row('Access:', sel(0, en)));
      if (!it.isDir) {
        const x = h('input', { type: 'checkbox', disabled: !en, checked: !!(st.mode & 0o111), onchange: () => apply(x.checked ? st.mode | 0o111 : st.mode & ~0o111) });
        body.append(h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, 'Execute'), row('', h('label', null, x, ' Allow executing file as program')));
      }
      body.append(h('div', { style: { marginTop: '10px', color: 'var(--text-dim)', fontFamily: 'var(--mono)' } }, `${modeString(st.mode & 0o7777, st.t)}  (${(st.mode & 0o7777).toString(8).padStart(4, '0')})`));
      if (it.isDir && en) body.append(h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: () => { guard(() => { const walk = (p) => { for (const n of fs.readdir(p)) { const q = posix.join(p, n); const s2 = fs.lstat(q); fs.chmod(q, s2.t === 'd' ? st.mode & 0o7777 : (st.mode & 0o7777) & ~0o111 | (s2.mode & 0o111 && s2.t !== 'd' ? 0 : 0)); if (s2.t === 'd') walk(q); } }; walk(it.p); }); } }, 'Apply Permissions to Enclosed Files')));
    };
    const apply = (mode) => {
      try { fs.chmod(it.p, mode & 0o7777); st = fs.lstat(it.p); } catch (e) { if (e instanceof FsError) { env.ui.alert({ title: 'Error', heading: 'Error', message: e.text, icon: 'error' }); st = fs.lstat(it.p); } else throw e; }
      perms();
    };
    const tabBasic = h('div', { class: 'tab on', onclick: () => { tabBasic.classList.add('on'); tabPerm.classList.remove('on'); basic(); } }, 'Basic');
    const tabPerm = h('div', { class: 'tab', onclick: () => { tabPerm.classList.add('on'); tabBasic.classList.remove('on'); perms(); } }, 'Permissions');
    tabs.append(tabBasic, tabPerm);
    basic();
    void canChown;
    return pw;
  }

  list.addEventListener('keydown', (e) => {
    const s = selItems();
    if (e.key === 'Enter' && s.length === 1) openItem(s[0]);
    else if (e.key === 'F2' && s.length === 1) rename(s[0]);
    else if (e.key === 'Delete') { if (e.shiftKey) delPerm(s); else toTrash(s); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); showHidden = !showHidden; render(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'c') Object.assign(clip(), { op: 'copy', paths: s.map((i) => i.p) });
    else if (e.ctrlKey && e.key.toLowerCase() === 'x') Object.assign(clip(), { op: 'cut', paths: s.map((i) => i.p) });
    else if (e.ctrlKey && e.key.toLowerCase() === 'v') doPaste();
    else if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(items.map((i) => i.n)); renderSel(); }
    else if (e.key === 'Backspace') up.click();
  });
  const unsub = sys.on('change', (k) => { if (k === 'fs') { clearTimeout(win._t); win._t = setTimeout(() => { if (!win.closed) render(); }, 200); } });
  win.onClose(() => unsub());
  show(cwd, true);
  return win;
}
