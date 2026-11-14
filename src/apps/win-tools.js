// Task Manager (Processes, Performance, Startup apps, Users, Details, Services) and Registry Editor.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { elevate } from '../ui/win-shell.js';
import * as S from '../win/state.js';

const lc = (s) => String(s ?? '').toLowerCase();
const CRITICAL = new Set(['system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'services.exe', 'lsass.exe', 'winlogon.exe']);
const STARTUP_KEYS = [[S.KEYS.run, 'Registry (HKLM Run)'], [S.KEYS.runUser, 'Registry (HKCU Run)']];

export function open(env, opts = {}) {
  if (opts.app === 'regedit') return regedit(env, opts);
  return taskmgr(env, opts);
}

// ============================================================================ Task Manager
function taskmgr(env, opts) {
  const sys = env.sys;
  let tab = opts.tab || 'processes';
  let sel = null;
  let elevated = !!opts.elevated;
  const tabs = h('div', { class: 'wtm-tabs' });
  const main = h('div', { class: 'w-main' });
  const root = h('div', { class: 'wapp' }, h('div', { class: 'w-split' }, tabs, main));
  const win = env.wm.open({ title: 'Task Manager', icon: 'w-taskmgr', width: 920, height: 600, appId: 'taskmgr', content: root });
  const TABS = [['processes', 'Processes', 'w-exe'], ['performance', 'Performance', 'w-taskmgr'], ['startup', 'Startup apps', 'w-update'], ['users', 'Users', 'w-users'], ['details', 'Details', 'w-txt'], ['services', 'Services', 'w-services']];
  const needAdmin = async () => { if (elevated) return true; const ok = await elevate(env, { what: 'Task Manager' }); if (ok) elevated = true; return ok; };
  const startupDisabled = () => (sys.win.startupDisabled ||= []);
  function head(t, ...right) { return h('div', { class: 'wtm-h' }, h('h2', null, t), ...right); }
  function render() {
    clear(tabs); clear(main);
    for (const [id, n, ic] of TABS) tabs.append(h('button', { class: tab === id ? 'sel' : '', title: n, onclick: () => { tab = id; sel = null; render(); } }, icon(ic, 20)));
    ({ processes, performance, startup, users, details, services }[tab])();
  }
  const table = (cols, rows, { onSel, onCtx } = {}) => h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { style: c.r ? { textAlign: 'right' } : null }, c.n)))),
    h('tbody', null, rows.map((r) => h('tr', { class: sel === r.key ? 'sel' : '', onclick: () => { sel = r.key; onSel?.(r); render(); }, oncontextmenu: (e) => { e.preventDefault(); sel = r.key; render(); onCtx?.(e, r); } }, cols.map((c, i) => h('td', { style: c.r ? { textAlign: 'right' } : null }, i === 0 && r.icon ? icon(r.icon, 16) : null, String(c.g(r) ?? '')))))));
  async function endTask(p) {
    if (!p) return;
    if (CRITICAL.has(lc(p.comm))) { env.ui.alert({ title: 'Task Manager', heading: 'Access is denied', message: `Unable to terminate ${p.comm}. Ending this process would make Windows unusable.`, icon: 'w-bad' }); return; }
    if (p.user !== env.user && !(await needAdmin())) return;
    sys.killProc(p.pid); sys.touch('proc'); sel = null; render();
  }
  function processes() {
    const apps = env.wm.wins.map((w) => ({ key: `win${w.id}`, name: w.title, icon: w.iconName, cpu: '0.1%', mem: '42.3 MB', win: w }));
    const bg = sys.processes.filter((p) => p.user === env.user || p.respawnId).map((p) => ({ key: p.pid, name: p.comm.replace(/\.exe$/i, ''), icon: 'w-exe', cpu: `${(p.pid % 7) / 10}%`, mem: `${((p.rss || 4000) / 1024).toFixed(1)} MB`, p }));
    const win2 = sys.processes.filter((p) => p.user !== env.user && !p.respawnId).map((p) => ({ key: p.pid, name: p.svc ? `Service Host: ${S.listServices(sys).find((s) => `win:${s.name}` === p.svc)?.display || p.comm}` : p.comm.replace(/\.exe$/i, ''), icon: p.svc ? 'w-services' : 'w-exe', cpu: '0%', mem: `${((p.rss || 4000) / 1024).toFixed(1)} MB`, p }));
    const cols = [{ n: 'Name', g: (r) => r.name }, { n: 'Status', g: () => '' }, { n: 'CPU', g: (r) => r.cpu, r: 1 }, { n: 'Memory', g: (r) => r.mem, r: 1 }];
    const ctx = (e, r) => env.ui.showMenu(e.clientX, e.clientY, [{ label: 'End task', action: () => (r.win ? r.win.close() : endTask(r.p)) }, ...(r.p ? [{ label: 'Go to details', action: () => { tab = 'details'; sel = r.p.pid; render(); } }, { label: 'Open file location', action: () => { const path = S.resolve(sys, S.fromWin(r.p.cmd.replace(/^"([^"]+)".*$/, '$1').split(' ')[0])); env.openApp('explorer', { path: path.slice(0, path.lastIndexOf('/')) || '/' }); } }] : [])]);
    const cur = [...apps, ...bg, ...win2].find((r) => r.key === sel);
    main.append(head('Processes', h('button', { class: 'w-btn', disabled: !cur, onclick: () => (cur?.win ? cur.win.close() : endTask(cur?.p)) }, 'End task')),
      h('div', { style: { padding: '4px 16px', fontWeight: 600, fontSize: '13px' } }, `Apps (${apps.length})`), table(cols, apps, { onCtx: ctx }),
      h('div', { style: { padding: '10px 16px 4px', fontWeight: 600, fontSize: '13px' } }, `Background processes (${bg.length})`), table(cols, bg, { onCtx: ctx }),
      h('div', { style: { padding: '10px 16px 4px', fontWeight: 600, fontSize: '13px' } }, `Windows processes (${win2.length})`), table(cols, win2, { onCtx: ctx }));
  }
  function performance() {
    const box = (t, v, s) => h('div', { class: 'wcard', style: { flexDirection: 'column', alignItems: 'flex-start', width: '200px', display: 'inline-flex', margin: '8px' } }, h('b', null, t), h('div', { style: { fontSize: '24px' } }, v), h('div', { class: 'sub' }, s));
    main.append(head('Performance'), h('div', { style: { padding: '0 10px' } }, box('CPU', '7%', '2.40 GHz'), box('Memory', '4.1/7.8 GB (53%)', 'In use'), box('Disk 0 (C:)', '1%', 'SSD'), box('Ethernet', 'S: 0  R: 8.0 Kbps', 'Ethernet'), h('div', { class: 'sub', style: { padding: '8px' } }, `Processes: ${sys.processes.length}    Up time: 0:02:14:${String(new Date(sys.now()).getSeconds()).padStart(2, '0')}`)));
  }
  function startup() {
    const rows = [];
    for (const [k, src] of STARTUP_KEYS) { const n = S.regFind(sys, k); if (n) for (const [name, v] of Object.entries(n.values)) rows.push({ key: `${k}|${name}`, name, cmd: String(v.data), src, k, icon: 'w-exe', pub: /SecurityHealth/.test(name) ? 'Microsoft Corporation' : /OneDrive/.test(name) ? 'Microsoft Corporation' : '' }); }
    for (const dir of ['/ProgramData/Microsoft/Windows/Start Menu/Programs/Startup', `/Users/${env.user}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`]) { try { for (const n of sys.vfs.readdir(dir)) rows.push({ key: `${dir}/${n}`, name: n, cmd: S.toWin(`${dir}/${n}`), src: 'Startup folder', file: `${dir}/${n}`, icon: 'w-lnk', pub: '' }); } catch { /* none */ } }
    const cur = rows.find((r) => r.key === sel);
    const dis = (r) => startupDisabled().includes(r.name);
    main.append(head('Startup apps', h('button', { class: 'w-btn', disabled: !cur, onclick: async () => { if (!cur) return; if (cur.k === S.KEYS.run && !(await needAdmin())) return; const l = startupDisabled(); if (dis(cur)) l.splice(l.indexOf(cur.name), 1); else l.push(cur.name); sys.touch('win'); render(); } }, cur && dis(cur) ? 'Enable' : 'Disable')),
      table([{ n: 'Name', g: (r) => r.name }, { n: 'Publisher', g: (r) => r.pub }, { n: 'Status', g: (r) => (dis(r) ? 'Disabled' : 'Enabled') }, { n: 'Startup impact', g: () => 'Not measured' }, { n: 'Command', g: (r) => r.cmd }, { n: 'Source', g: (r) => r.src }], rows,
        { onCtx: (e, r) => env.ui.showMenu(e.clientX, e.clientY, [{ label: dis(r) ? 'Enable' : 'Disable', action: () => { const l = startupDisabled(); if (dis(r)) l.splice(l.indexOf(r.name), 1); else l.push(r.name); sys.touch('win'); render(); } }, { label: 'Open file location', action: () => { const p = S.resolve(sys, S.fromWin(r.cmd.replace(/^"([^"]+)".*$/, '$1').split(' /')[0])); env.openApp('explorer', { path: p.slice(0, p.lastIndexOf('/')) || '/' }); } }]) }),
      h('div', { class: 'sub', style: { padding: '10px 16px' } }, 'Disabling a startup app stops it from starting at sign-in. Remove the registry value (Registry Editor or Remove-ItemProperty) to delete the entry.'));
  }
  function users() { main.append(head('Users'), table([{ n: 'User', g: (r) => r.name }, { n: 'Status', g: () => '' }, { n: 'CPU', g: () => '2.1%' }, { n: 'Memory', g: () => '612.4 MB' }], [{ key: 'u', name: `${S.getUser(sys, env.user)?.full || env.user} (${sys.processes.filter((p) => p.user === env.user).length})`, icon: 'w-user' }])); }
  function details() {
    const rows = sys.processes.slice().sort((a, b) => lc(a.comm).localeCompare(lc(b.comm))).map((p) => ({ key: p.pid, p, icon: 'w-exe' }));
    const cur = rows.find((r) => r.key === sel);
    main.append(head('Details', h('button', { class: 'w-btn', disabled: !cur, onclick: () => endTask(cur?.p) }, 'End task')),
      table([{ n: 'Name', g: (r) => r.p.comm }, { n: 'PID', g: (r) => r.p.pid, r: 1 }, { n: 'Status', g: () => 'Running' }, { n: 'User name', g: (r) => r.p.user }, { n: 'Memory (active private working set)', g: (r) => `${(r.p.rss || 4000).toLocaleString('en-US')} K`, r: 1 }, { n: 'Command line', g: (r) => r.p.cmd }], rows,
        { onCtx: (e, r) => env.ui.showMenu(e.clientX, e.clientY, [{ label: 'End task', action: () => endTask(r.p) }, { label: 'End process tree', action: () => endTask(r.p) }, 'sep', { label: 'Open file location', action: () => { const path = S.resolve(sys, S.fromWin(r.p.cmd.replace(/^"([^"]+)".*$/, '$1').split(' ')[0])); env.openApp('explorer', { path: path.slice(0, path.lastIndexOf('/')) || '/' }); } }]) }));
  }
  function services() {
    const rows = S.listServices(sys).slice().sort((a, b) => lc(a.name).localeCompare(lc(b.name))).map((s) => ({ key: s.name, s, icon: 'w-services' }));
    const act = async (s, start) => { if (!(await needAdmin())) return; try { if (start) S.startService(sys, s.name); else S.stopService(sys, s.name); } catch (e) { env.ui.alert({ title: 'Task Manager', heading: `Unable to ${start ? 'start' : 'stop'} the service`, message: e.message, icon: 'w-bad' }); } render(); };
    main.append(head('Services', h('a', { class: 'w-link', style: { fontSize: '13px' }, onclick: () => env.elevate({ app: 'services' }) }, 'Open Services')),
      table([{ n: 'Name', g: (r) => r.s.name }, { n: 'PID', g: (r) => sys.processes.find((p) => p.svc === `win:${r.s.name}`)?.pid || '', r: 1 }, { n: 'Description', g: (r) => r.s.display }, { n: 'Status', g: (r) => r.s.status }, { n: 'Group', g: (r) => r.s.group }], rows,
        { onCtx: (e, r) => env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Start', disabled: r.s.status === 'Running', action: () => act(r.s, true) }, { label: 'Stop', disabled: r.s.status !== 'Running', action: () => act(r.s, false) }, { label: 'Restart', action: async () => { await act(r.s, false); await act(r.s, true); } }, 'sep', { label: 'Open Services', action: () => env.elevate({ app: 'services' }) }]) }));
  }
  render();
  const t = setInterval(() => { if (win.closed) clearInterval(t); else if (tab === 'performance') render(); }, 3000);
  return win;
}

// ============================================================================ Registry Editor
function regedit(env, opts) {
  if (!opts.elevated) { const { elevated, ...rest } = opts; void elevated; return elevate(env, { ...rest, app: 'regedit' }); }
  const sys = env.sys;
  const LONG = S.HIVE_LONG;
  let cur = opts.key ? S.regKey(opts.key) : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion';
  const opened = new Set(['', 'HKLM', 'HKCU']);
  // expand the path to the current key
  const expandTo = (k) => { const parts = k.split('\\'); for (let i = 1; i <= parts.length; i++) opened.add(parts.slice(0, i).join('\\')); };
  expandTo(cur);
  let selVal = null;
  const treeEl = h('div', { class: 'w-nav wre-tree', style: { width: '320px', background: '#fff' } });
  const listEl = h('div', { class: 'w-main' });
  const addrIn = h('input', { title: 'Address', onkeydown: (e) => { if (e.key === 'Enter') { const k = S.regKey(addrIn.value.replace(/^Computer\\/i, '')); if (k && S.regFind(sys, k)) { cur = S.regFind(sys, k).path; expandTo(cur); render(); } else env.ui.alert({ title: 'Registry Editor', heading: 'Cannot find the key.', message: addrIn.value, icon: 'w-warn' }); } } });
  const menuItem = (n, items) => h('div', { style: { padding: '3px 9px', fontSize: '12px' }, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, n);
  const root = h('div', { class: 'wapp', style: { background: '#fff' } },
    h('div', { style: { display: 'flex', borderBottom: '1px solid #e5e5e5' } }, menuItem('File', () => [{ label: 'Exit', action: () => win.close() }]), menuItem('Edit', () => editMenu()), menuItem('View', () => [{ label: 'Refresh', action: render }]), menuItem('Favorites', () => [{ label: 'Run (HKLM)', action: () => goto(S.KEYS.run) }, { label: 'Winlogon', action: () => goto(S.KEYS.winlogon) }, { label: 'Lsa', action: () => goto(S.KEYS.lsa) }, { label: 'Policies\\System', action: () => goto(S.KEYS.sysPol) }, { label: 'Terminal Server', action: () => goto(S.KEYS.ts) }]), menuItem('Help', () => [])),
    h('div', { class: 'wre-addr' }, addrIn), h('div', { class: 'w-split' }, treeEl, listEl));
  const win = env.wm.open({ title: 'Registry Editor', icon: 'w-regedit', width: 980, height: 600, appId: 'regedit', content: root });
  function goto(k) { cur = S.regFind(sys, k)?.path || S.regKey(k); expandTo(cur); render(); }
  function children(k) { if (k === '') return ['HKCR', 'HKCU', 'HKLM', 'HKU', 'HKCC']; return S.regSubkeys(sys, k); }
  function renderTree() {
    clear(treeEl);
    const draw = (k, name, depth) => {
      const kids = children(k);
      treeEl.append(h('div', { class: 'w-navi' + (k === cur ? ' sel' : ''), style: { paddingLeft: 4 + depth * 14 + 'px' }, title: k ? `Computer\\${LONG[k.slice(0, 4)] || k}${k.length > 4 ? k.slice(4) : ''}` : 'Computer', onclick: () => { cur = k; selVal = null; render(); }, oncontextmenu: (e) => { e.preventDefault(); cur = k; render(); env.ui.showMenu(e.clientX, e.clientY, keyMenu()); } },
        h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); if (opened.has(k)) opened.delete(k); else opened.add(k); renderTree(); } }, kids.length ? (opened.has(k) ? '⌄' : '›') : ''), icon(k ? 'w-folder' : 'w-thispc', 14), h('span', null, name)));
      if (opened.has(k)) for (const c of kids) draw(k ? `${k}\\${c}` : c, k ? c : LONG[c] || c, depth + 1);
    };
    draw('', 'Computer', 0);
  }
  function render() {
    renderTree(); clear(listEl);
    addrIn.value = cur ? `Computer\\${LONG[cur.slice(0, 4)] || cur}${cur.length > 4 ? cur.slice(4) : ''}` : 'Computer';
    const n = cur ? S.regFind(sys, cur) : null;
    const vals = n ? Object.entries(n.values).map(([k, v]) => ({ k, ...v })) : [];
    const rows = [{ k: '(Default)', type: 'REG_SZ', data: '(value not set)', dflt: true }, ...vals.sort((a, b) => lc(a.k).localeCompare(lc(b.k)))];
    const fmt = (v) => (v.type === 'REG_DWORD' ? `0x${Number(v.data).toString(16).padStart(8, '0')} (${v.data})` : String(v.data));
    listEl.append(h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, h('th', { style: { width: '32%' } }, 'Name'), h('th', { style: { width: '16%' } }, 'Type'), h('th', null, 'Data'))),
      h('tbody', null, rows.map((v) => h('tr', { class: selVal === v.k ? 'sel' : '', onclick: () => { selVal = v.k; render(); }, ondblclick: () => !v.dflt && modify(v.k), oncontextmenu: (e) => { e.preventDefault(); selVal = v.k; render(); env.ui.showMenu(e.clientX, e.clientY, v.dflt ? keyMenu() : [{ label: 'Modify...', action: () => modify(v.k) }, 'sep', { label: 'Delete', action: () => delVal(v.k) }, { label: 'Rename', action: () => renVal(v.k) }]); } },
        h('td', null, icon(/SZ/.test(v.type) ? 'w-txt' : 'w-regedit', 14), v.k), h('td', null, v.type), h('td', null, fmt(v)))))));
    listEl.oncontextmenu = (e) => { if (e.target === listEl) { e.preventDefault(); env.ui.showMenu(e.clientX, e.clientY, keyMenu()); } };
  }
  const editMenu = () => [{ label: 'Modify...', disabled: !selVal || selVal === '(Default)', action: () => modify(selVal) }, 'sep', ...keyMenu(), 'sep', { label: 'Delete', disabled: !selVal && !cur, action: () => (selVal && selVal !== '(Default)' ? delVal(selVal) : delKey()) }, { label: 'Find...', action: find }];
  const keyMenu = () => (cur && cur.length > 4 || cur && cur.length === 4 ? [{ label: 'New › Key', action: newKey }, { label: 'New › String Value', action: () => newVal('REG_SZ') }, { label: 'New › DWORD (32-bit) Value', action: () => newVal('REG_DWORD') }, 'sep', { label: 'Delete key', action: delKey }, { label: 'Copy Key Name', action: () => navigator.clipboard?.writeText(addrIn.value.replace(/^Computer\\/, '')).catch(() => {}) }] : []);
  async function modify(name) {
    const n = S.regFind(sys, cur); const v = n?.values[name]; if (!v) return;
    const isD = v.type === 'REG_DWORD' || v.type === 'REG_QWORD';
    const val = await env.ui.prompt({ title: isD ? 'Edit DWORD (32-bit) Value' : 'Edit String', message: `Value name: ${name}\n\nValue data${isD ? ' (decimal)' : ''}:`, value: String(v.data) });
    if (val == null) return;
    if (isD && !/^\d+$/.test(val.trim())) { env.ui.alert({ title: 'Registry Editor', heading: 'Invalid DWORD value', message: 'Enter a decimal number.', icon: 'w-warn' }); return; }
    S.regSet(sys, cur, name, isD ? Number(val.trim()) : val, v.type); render();
  }
  async function newVal(type) {
    const name = await env.ui.prompt({ title: 'New Value', message: 'Value name:', value: 'New Value #1' }); if (!name) return;
    S.regSet(sys, cur, name, type === 'REG_DWORD' ? 0 : '', type); selVal = name; render(); modify(name);
  }
  async function newKey() { const name = await env.ui.prompt({ title: 'New Key', message: 'Key name:', value: 'New Key #1' }); if (!name) return; S.regEnsure(sys, `${cur}\\${name}`); sys.touch('win'); opened.add(cur); cur = `${cur}\\${name}`; render(); }
  async function delVal(name) { if (!(await env.ui.confirm({ title: 'Confirm Value Delete', heading: 'Deleting certain registry values could cause system instability. Are you sure you want to permanently delete this value?', message: name, ok: 'Yes', cancel: 'No', icon: 'w-warn' }))) return; S.regDeleteValue(sys, cur, name); selVal = null; render(); }
  async function renVal(name) { const to = await env.ui.prompt({ title: 'Rename', message: 'New name:', value: name }); if (!to || to === name) return; const v = S.regFind(sys, cur).values[name]; S.regSet(sys, cur, to, v.data, v.type, { noTouch: true }); S.regDeleteValue(sys, cur, name); selVal = to; render(); }
  async function delKey() { if (!cur || cur.length <= 4) return; if (!(await env.ui.confirm({ title: 'Confirm Key Delete', heading: 'Are you sure you want to permanently delete this key and all of its subkeys?', message: cur, ok: 'Yes', cancel: 'No', icon: 'w-warn' }))) return; S.regDeleteKey(sys, cur); cur = cur.slice(0, cur.lastIndexOf('\\')); render(); }
  async function find() {
    const q = await env.ui.prompt({ title: 'Find', message: 'Find what (key, value name or data):' }); if (!q) return;
    for (const n of Object.values(sys.win.reg)) { if (lc(n.path).includes(lc(q)) || Object.entries(n.values).some(([k, v]) => lc(k).includes(lc(q)) || lc(v.data).includes(lc(q)))) { cur = n.path; expandTo(cur); selVal = Object.keys(n.values).find((k) => lc(k).includes(lc(q)) || lc(n.values[k].data).includes(lc(q))) || null; render(); return; } }
    env.ui.alert({ title: 'Registry Editor', heading: 'Finished searching through the registry.', message: '', icon: 'w-info' });
  }
  render();
  return win;
}
