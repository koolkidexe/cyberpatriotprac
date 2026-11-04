// Microsoft Management Console snap-ins: Computer Management (compmgmt.msc) and the stand-alone consoles that are
// pieces of it (lusrmgr.msc, services.msc, fsmgmt.msc, taskschd.msc), plus Local Security Policy (secpol.msc).
// Three panes like the real MMC: console tree, result list, Actions. Every change goes through src/win/state.js.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as S from '../win/state.js';

const lc = (s) => String(s ?? '').toLowerCase();
const fmtDate = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };

// ------------------------------------------------------------------ property-sheet dialogs
/** tabs: [{ name, build(): Node }], onOk(): string|void (a string is an error message). Resolves true on OK. */
export function sheet(env, { title, tabs, onOk, onApply, width = 420, okLabel = 'OK', noApply = false }) {
  return env.ui.modal((done0) => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    window.addEventListener('keydown', onKey, true);
    const done = (v) => { window.removeEventListener('keydown', onKey, true); done0(v); };
    let cur = 0;
    const err = h('div', { class: 'wd-err' });
    const tabBar = h('div', { class: 'wd-tabs' });
    const bodies = tabs.map((t) => t.build());
    const body = h('div', { class: 'wd-b' });
    const show = (i) => { cur = i; clear(tabBar); tabs.forEach((t, j) => tabBar.append(h('div', { class: j === i ? 'on' : '', onclick: () => show(j) }, t.name))); clear(body); body.append(bodies[i], err); };
    const ok = () => { const r = onOk?.(); if (typeof r === 'string') { err.textContent = r; return; } done(true); };
    const apply = () => { const r = (onApply || onOk)?.(); err.textContent = typeof r === 'string' ? r : ''; };
    show(0);
    return h('div', { class: 'w-dlg', style: { width: width + 'px' }, onkeydown: (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') ok(); } },
      h('div', { class: 'wd-t' }, h('span', null, title), h('span', { style: { cursor: 'default' }, title: 'Close', onclick: () => done(false) }, '✕')),
      tabs.length > 1 || tabs[0].name ? tabBar : null, body,
      h('div', { class: 'wd-f' }, h('button', { class: 'primary', onclick: ok }, okLabel), h('button', { onclick: () => done(false) }, 'Cancel'), noApply ? null : h('button', { onclick: apply }, 'Apply')));
  });
}
const field = (label, input) => h('label', null, h('span', { style: { width: '120px', flex: 'none' } }, label), input);
const check = (label, on, title) => { const c = h('input', { type: 'checkbox', checked: !!on }); return { el: h('label', { title: title || label }, c, label), get: () => c.checked, set: (v) => { c.checked = v; }, input: c }; };
const text = (v = '', type = 'text', w = '220px') => h('input', { type, value: v ?? '', style: { width: w } });
const num = (v, min, max) => h('input', { type: 'number', value: v, min, max, style: { width: '70px' } });
const errBox = (env, heading, message) => env.ui.alert({ title: 'Local Users and Groups', heading, message, icon: 'w-warn' });

// ------------------------------------------------------------------ consoles
const CONSOLES = {
  compmgmt: { title: 'Computer Management', icon: 'w-compmgmt', root: 'Computer Management (Local)' },
  lusrmgr: { title: 'lusrmgr - [Local Users and Groups (Local)]', icon: 'w-users', root: 'Local Users and Groups (Local)' },
  services: { title: 'Services', icon: 'w-services', root: 'Services (Local)' },
  shares: { title: 'Shared Folders', icon: 'w-share', root: 'Shared Folders (Local)' },
  taskschd: { title: 'Task Scheduler', icon: 'w-taskschd', root: 'Task Scheduler (Local)' },
  secpol: { title: 'Local Security Policy', icon: 'w-secpol', root: 'Security Settings' },
  gpedit: { title: 'Local Group Policy Editor', icon: 'w-gpedit', root: 'Local Computer Policy' },
};

export function open(env, opts = {}) {
  const app = CONSOLES[opts.app] ? opts.app : 'compmgmt';
  if (!opts.elevated) { const { elevated, ...rest } = opts; void elevated; return env.elevate({ ...rest, app }); }
  const C = CONSOLES[app];
  const sys = env.sys;
  const tree = buildTree(app);
  const START = { compmgmt: 'root', lusrmgr: 'users', services: 'svc', shares: 'shares', taskschd: 'lib', secpol: 'root', gpedit: 'lcp' };
  let node = tree.find((n) => n.id === (opts.node || START[app])) || tree[0];
  const collapsed = new Set();
  let selKey = null;
  const treeEl = h('div', { class: 'w-nav', style: { width: app === 'gpedit' ? '330px' : '250px', background: '#fff', fontSize: '12px' } });
  const listEl = h('div', { class: 'w-main' });
  const actEl = h('div', { class: 'w-nav', style: { width: '210px', borderLeft: '1px solid #e5e5e5', borderRight: 0, background: '#fff', fontSize: '12px' } });
  const status = h('div', { class: 'w-status' });
  const menuItem = (n, items) => h('div', { style: { padding: '3px 9px', fontSize: '12px' }, title: `${n} menu`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, n);
  const menubar = h('div', { style: { display: 'flex', borderBottom: '1px solid #e5e5e5', background: '#fff' } },
    menuItem('File', () => [{ label: 'Exit', action: () => win.close() }]), menuItem('Action', () => actions().map(([l, fn]) => ({ label: l, action: fn }))),
    menuItem('View', () => [{ label: 'Refresh', action: render }]), menuItem('Help', () => [{ label: 'About Microsoft Management Console', action: () => env.ui.alert({ title: 'About', heading: 'Microsoft Management Console', message: 'Version 3.0 (simulated)', icon: 'w-info' }) }]));
  const toolbar = h('div', { class: 'w-tb', style: { minHeight: '30px', padding: '2px 6px' } },
    h('button', { title: 'Refresh', onclick: () => render() }, '⟳'), h('button', { title: 'Help', onclick: () => env.ui.alert({ title: C.title, heading: C.title, message: help(), icon: 'w-info' }) }, '?'));
  const root = h('div', { class: 'wapp' }, menubar, toolbar, h('div', { class: 'w-split' }, treeEl, listEl, actEl), status);
  const win = env.wm.open({ title: C.title, icon: C.icon, width: app === 'gpedit' ? 1180 : 1060, height: 620, appId: app, content: root });

  function help() {
    return {
      compmgmt: 'Local Users and Groups: add, remove and edit accounts and group membership.\nServices: change startup type and start/stop services.\nShared Folders: stop sharing folders.\nTask Scheduler: find and delete suspicious tasks.',
      secpol: 'Account Policies: password and lockout policy.\nLocal Policies: audit policy, user rights assignment and security options.\nDouble-click a policy to change it.',
    }[app] || 'Double-click an item to see its properties. Right-click for more actions.';
  }

  // ---------------------------------------------------------------- tree
  function renderTree() {
    clear(treeEl);
    const kids = (id) => tree.filter((n) => n.parent === id);
    const draw = (n, depth) => {
      const has = kids(n.id).length > 0;
      treeEl.append(h('div', { class: 'w-navi' + (n === node ? ' sel' : ''), style: { paddingLeft: 4 + depth * 14 + 'px', height: '24px' }, title: n.name, onclick: () => { node = n; selKey = null; render(); }, ondblclick: () => { if (collapsed.has(n.id)) collapsed.delete(n.id); else collapsed.add(n.id); renderTree(); } },
        h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); if (collapsed.has(n.id)) collapsed.delete(n.id); else collapsed.add(n.id); renderTree(); } }, has ? (collapsed.has(n.id) ? '›' : '⌄') : ''), icon(n.icon || 'w-folder', 16), h('span', null, n.name)));
      if (!collapsed.has(n.id)) for (const k of kids(n.id)) draw(k, depth + 1);
    };
    for (const n of kids(null)) draw(n, 0);
  }

  // ---------------------------------------------------------------- list views
  function table(cols, rows, { onOpen, onCtx, key = (r) => r.key } = {}) {
    const tbody = h('tbody');
    for (const r of rows) {
      const k = key(r);
      tbody.append(h('tr', { class: (selKey === k ? 'sel' : '') + (r.off ? ' off' : ''), title: r.tip || '', onclick: () => { selKey = k; render(); }, ondblclick: () => onOpen?.(r), oncontextmenu: (e) => { e.preventDefault(); selKey = k; render(); onCtx?.(e, r); } },
        cols.map((c, i) => h('td', null, i === 0 && r.icon ? icon(r.icon, 16) : null, String(c.get(r) ?? '')))));
    }
    return h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { style: c.w ? { width: c.w } : null }, c.name)))), tbody);
  }
  const ctxMenu = (e, items) => env.ui.showMenu(e.clientX, e.clientY, items.map((x) => (x === 'sep' ? x : { label: x[0], action: x[1] })));
  let actionsFor = () => [];
  function actions() { return actionsFor(); }

  function render() {
    renderTree();
    clear(listEl); clear(actEl);
    actionsFor = () => [];
    const v = VIEWS[node.view];
    if (!v) {
      const kids = tree.filter((n) => n.parent === node.id);
      listEl.append(table([{ name: 'Name', get: (r) => r.name }], kids.map((k) => ({ ...k, key: k.id })), { onOpen: (r) => { node = r; render(); } }));
      status.textContent = `${kids.length} item(s)`;
    } else v();
    actEl.append(h('div', { style: { padding: '4px 8px', fontWeight: 600, background: '#eef3fa', borderRadius: '3px' } }, 'Actions'), h('div', { style: { padding: '6px 8px 2px', fontWeight: 600 } }, node.name));
    for (const [l, fn] of actionsFor()) actEl.append(h('div', { class: 'w-navi', style: { height: '24px', paddingLeft: '16px' }, title: l, onclick: fn }, l));
    actEl.append(h('div', { class: 'w-navi', style: { height: '24px', paddingLeft: '16px' }, onclick: render }, 'Refresh'));
    win.setTitle(app === 'compmgmt' ? `Computer Management` : C.title);
  }

  const VIEWS = {
    // ===================================================== Local Users and Groups
    users() {
      const list = S.listUsers(sys).slice().sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
      listEl.append(table([{ name: 'Name', get: (u) => u.name, w: '24%' }, { name: 'Full Name', get: (u) => u.full, w: '22%' }, { name: 'Description', get: (u) => u.desc }],
        list.map((u) => ({ ...u, key: u.name, icon: 'w-user', off: !u.enabled, tip: u.enabled ? '' : 'This account is disabled' })),
        { onOpen: (u) => userProps(u.name), onCtx: (e, u) => ctxMenu(e, [['Set Password...', () => setPw(u.name)], 'sep', ['Delete', () => delUser(u.name)], ['Rename', () => renUser(u.name)], 'sep', ['Properties', () => userProps(u.name)]]) }));
      status.textContent = `${list.length} user(s)`;
      actionsFor = () => [['New User...', newUser], ...(selKey ? [['Set Password...', () => setPw(selKey)], ['Delete', () => delUser(selKey)], ['Rename', () => renUser(selKey)], ['Properties', () => userProps(selKey)]] : [])];
    },
    groups() {
      const list = S.listGroups(sys).slice().sort((a, b) => lc(a.name).localeCompare(lc(b.name)));
      listEl.append(table([{ name: 'Name', get: (g) => g.name, w: '30%' }, { name: 'Description', get: (g) => g.desc }], list.map((g) => ({ ...g, key: g.name, icon: 'w-users' })),
        { onOpen: (g) => groupProps(g.name), onCtx: (e, g) => ctxMenu(e, [['Add to Group...', () => groupProps(g.name)], 'sep', ['Delete', () => delGroup(g.name)], ['Properties', () => groupProps(g.name)]]) }));
      status.textContent = `${list.length} group(s)`;
      actionsFor = () => [['New Group...', newGroup], ...(selKey ? [['Properties', () => groupProps(selKey)], ['Delete', () => delGroup(selKey)]] : [])];
    },
    // ===================================================== Services
    services() {
      const list = S.listServices(sys).slice().sort((a, b) => lc(a.display).localeCompare(lc(b.display)));
      listEl.append(table([{ name: 'Name', get: (s) => s.display, w: '28%' }, { name: 'Description', get: (s) => s.desc, w: '32%' }, { name: 'Status', get: (s) => (s.status === 'Running' ? 'Running' : '') }, { name: 'Startup Type', get: (s) => s.startType }, { name: 'Log On As', get: (s) => s.account }],
        list.map((s) => ({ ...s, key: s.name, icon: 'w-services', tip: `${s.display} (${s.name})` })),
        { onOpen: (s) => svcProps(s.name), onCtx: (e, s) => ctxMenu(e, [['Start', () => svcDo(s.name, 'start')], ['Stop', () => svcDo(s.name, 'stop')], ['Restart', () => svcDo(s.name, 'restart')], 'sep', ['Properties', () => svcProps(s.name)]]) }));
      status.textContent = `${list.length} services     Extended  Standard`;
      actionsFor = () => (selKey ? [['Start the service', () => svcDo(selKey, 'start')], ['Stop the service', () => svcDo(selKey, 'stop')], ['Restart the service', () => svcDo(selKey, 'restart')], ['Properties', () => svcProps(selKey)]] : []);
    },
    // ===================================================== Shared Folders
    shares() {
      const list = S.listShares(sys);
      listEl.append(table([{ name: 'Share Name', get: (s) => s.name }, { name: 'Folder Path', get: (s) => s.path }, { name: 'Type', get: () => 'Windows' }, { name: '# Client Connections', get: () => 0 }, { name: 'Description', get: (s) => s.desc }],
        list.map((s) => ({ ...s, key: s.name, icon: 'w-share' })), { onOpen: (s) => shareProps(s.name), onCtx: (e, s) => ctxMenu(e, [['Stop Sharing', () => stopShare(s.name)], 'sep', ['Properties', () => shareProps(s.name)]]) }));
      status.textContent = `${list.length} share(s)`;
      actionsFor = () => [['New Share...', newShare], ...(selKey ? [['Stop Sharing', () => stopShare(selKey)], ['Properties', () => shareProps(selKey)]] : [])];
    },
    sessions() { listEl.append(h('div', { style: { padding: '20px', color: '#666' } }, 'There are no items to show in this view.')); status.textContent = '0 session(s)'; },
    // ===================================================== Task Scheduler
    tasks() {
      const path = node.taskPath || '\\';
      const list = S.listTasks(sys).filter((t) => t.path === path || (node.taskPath == null && true));
      const detail = h('div', { style: { borderTop: '1px solid #e5e5e5', padding: '10px 14px', fontSize: '12px', minHeight: '120px', background: '#fafafa' } });
      const showDetail = (t) => { clear(detail); if (!t) { detail.append(h('div', { class: 'sub' }, 'Select a task to see its details.')); return; } detail.append(h('div', null, h('b', null, 'Name: '), t.name), h('div', null, h('b', null, 'Location: '), t.path), h('div', null, h('b', null, 'Author: '), t.author), h('div', null, h('b', null, 'Description: '), t.desc || ''), h('div', { style: { marginTop: '6px' } }, h('b', null, 'Triggers: '), t.trigger), h('div', null, h('b', null, 'Actions: '), 'Start a program  ', h('code', null, t.action))); };
      const rows = list.map((t) => ({ ...t, key: t.path + t.name, icon: 'w-taskschd' }));
      listEl.append(table([{ name: 'Name', get: (t) => t.name, w: '30%' }, { name: 'Status', get: (t) => (t.enabled ? 'Ready' : 'Disabled') }, { name: 'Triggers', get: (t) => t.trigger, w: '30%' }, { name: 'Author', get: (t) => t.author }],
        rows, { onOpen: (t) => taskProps(t), onCtx: (e, t) => ctxMenu(e, [['Run', () => env.ui.toast({ title: 'Task Scheduler', message: `Ran ${t.name}`, kind: 'info' })], [t.enabled ? 'Disable' : 'Enable', () => { S.setTaskEnabled(sys, t.path + t.name, !t.enabled); render(); }], 'sep', ['Properties', () => taskProps(t)], ['Delete', () => delTask(t)]]) }), detail);
      showDetail(rows.find((r) => r.key === selKey));
      status.textContent = `${list.length} task(s)`;
      actionsFor = () => { const t = rows.find((r) => r.key === selKey); return t ? [['Run', () => {}], [t.enabled ? 'Disable' : 'Enable', () => { S.setTaskEnabled(sys, t.path + t.name, !t.enabled); render(); }], ['Delete', () => delTask(t)], ['Properties', () => taskProps(t)]] : [['Create Basic Task...', () => env.ui.toast({ title: 'Task Scheduler', message: 'Creating tasks is not part of the simulation.', kind: 'info' })]]; };
    },
    events() {
      const ev = [['Information', 'Service Control Manager', 7036, 'The Windows Update service entered the running state.'], ['Information', 'Microsoft-Windows-Security-Auditing', 4624, 'An account was successfully logged on.'], ['Warning', 'DistributedCOM', 10016, 'The application-specific permission settings do not grant Local Activation permission.'], ['Information', 'Microsoft-Windows-Kernel-General', 12, 'The operating system started.']];
      listEl.append(table([{ name: 'Level', get: (e) => e[0] }, { name: 'Date and Time', get: () => fmtDate(sys.now() - 3600000) }, { name: 'Source', get: (e) => e[1] }, { name: 'Event ID', get: (e) => e[2] }, { name: 'General', get: (e) => e[3] }], ev.map((e, i) => Object.assign([...e], { key: i, icon: e[0] === 'Warning' ? 'w-warn' : 'w-info' }))));
      status.textContent = `${ev.length} events`;
    },
    disk() { listEl.append(h('div', { style: { padding: '16px' } }, h('table', { class: 'w-tab' }, h('thead', null, h('tr', null, ['Volume', 'Layout', 'Type', 'File System', 'Status', 'Capacity', 'Free Space'].map((x) => h('th', null, x)))), h('tbody', null, h('tr', null, ['(C:)', 'Simple', 'Basic', 'NTFS', 'Healthy (Boot, Page File, Crash Dump, Primary Partition)', '99.31 GB', '42.08 GB'].map((x) => h('td', null, x))))))); },
    // ===================================================== Local Security Policy
    pwpol() {
      const p = sys.win.policy;
      const rows = [
        ['history', 'Enforce password history', `${p.history} passwords remembered`],
        ['maxAge', 'Maximum password age', p.maxAge === 0 ? 'Password will not expire' : `${p.maxAge} days`],
        ['minAge', 'Minimum password age', `${p.minAge} days`],
        ['minLen', 'Minimum password length', `${p.minLen} characters`],
        ['complexity', 'Password must meet complexity requirements', p.complexity ? 'Enabled' : 'Disabled'],
        ['reversible', 'Store passwords using reversible encryption', p.reversible ? 'Enabled' : 'Disabled'],
      ];
      policyTable(rows);
    },
    lockpol() {
      const p = sys.win.policy;
      const rows = [
        ['lockoutDuration', 'Account lockout duration', p.lockoutThreshold === 0 ? 'Not Applicable' : `${p.lockoutDuration} minutes`],
        ['lockoutThreshold', 'Account lockout threshold', `${p.lockoutThreshold} invalid logon attempts`],
        ['adminLockout', 'Allow Administrator account lockout', p.lockoutThreshold === 0 ? 'Not Applicable' : 'Enabled'],
        ['lockoutWindow', 'Reset account lockout counter after', p.lockoutThreshold === 0 ? 'Not Applicable' : `${p.lockoutWindow} minutes`],
      ];
      policyTable(rows);
    },
    auditpol() {
      const rows = S.AUDIT_LEGACY.map(([n, c]) => { const a = sys.win.audit[c]; return [c, n, a.success && a.failure ? 'Success, Failure' : a.success ? 'Success' : a.failure ? 'Failure' : 'No auditing']; });
      listEl.append(table([{ name: 'Policy', get: (r) => r[1], w: '55%' }, { name: 'Security Setting', get: (r) => r[2] }], rows.map((r) => Object.assign(r, { key: r[0], icon: 'w-secpol' })), { onOpen: (r) => auditDlg(r[0], r[1]) }));
      status.textContent = '';
    },
    advaudit() {
      const cat = node.auditCat;
      const subs = SUBCATS[cat] || [];
      listEl.append(table([{ name: 'Subcategory', get: (r) => `Audit ${r}`, w: '55%' }, { name: 'Audit Events', get: () => { const a = sys.win.audit[cat]; return a.success && a.failure ? 'Success and Failure' : a.success ? 'Success' : a.failure ? 'Failure' : 'Not Configured'; } }],
        subs.map((s) => Object.assign([s], { key: s, icon: 'w-secpol' })), { onOpen: (r) => auditDlg(cat, `Audit ${r[0]}`) }));
      status.textContent = 'Subcategories in the same category share one setting in this simulation.';
    },
    rights() {
      const rows = S.RIGHTS.map(([k, n]) => [k, n, (sys.win.rights[k] || []).join(',')]);
      listEl.append(table([{ name: 'Policy', get: (r) => r[1], w: '45%' }, { name: 'Security Setting', get: (r) => r[2] }], rows.map((r) => Object.assign(r, { key: r[0], icon: 'w-secpol' })), { onOpen: (r) => rightDlg(r[0], r[1]) }));
    },
    secopts() {
      const rows = S.SECOPTS.map((o) => [o.id, o.name, S.secoptValue(sys, o)]);
      listEl.append(table([{ name: 'Policy', get: (r) => r[1], w: '62%' }, { name: 'Security Setting', get: (r) => r[2] }], rows.map((r) => Object.assign(r, { key: r[0], icon: 'w-secpol' })), { onOpen: (r) => secoptDlg(S.SECOPTS.find((o) => o.id === r[0])) }));
    },
    gpo() {
      const here = node.gpoPath || [];
      const kids = tree.filter((n) => n.parent === node.id);
      const pols = S.GPOS.filter((g) => g.path.join('/') === here.join('/'));
      const rows = [...kids.map((k) => ({ key: `f:${k.id}`, folder: k, icon: 'w-folder', name: k.name })), ...pols.map((g) => ({ key: g.id, g, icon: 'w-gpedit', name: g.name }))];
      const help = h('div', { style: { width: '230px', flex: 'none', borderRight: '1px solid #e5e5e5', padding: '12px', fontSize: '12px', overflow: 'auto' } });
      const cur = rows.find((r) => r.key === selKey && r.g);
      help.append(h('h3', { style: { fontSize: '14px', margin: '0 0 8px', fontWeight: 600 } }, node.name), ...(cur ? [h('b', null, cur.g.name), h('p', null, 'Edit ', h('a', { class: 'w-link', onclick: () => gpoDlg(cur.g) }, 'policy setting')), h('p', null, h('b', null, 'Description:'), h('br'), cur.g.help), h('p', { class: 'sub' }, `Registry: ${cur.g.key}\\${cur.g.value}`)] : [h('p', { class: 'sub' }, 'Select an item to view its description.')]));
      listEl.append(h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, help, h('div', { style: { flex: 1, overflow: 'auto' } }, table([{ name: 'Setting', get: (r) => r.name, w: '62%' }, { name: 'State', get: (r) => (r.g ? S.gpoState(sys, r.g) : '') }, { name: 'Comment', get: (r) => (r.g ? 'No' : '') }], rows,
        { onOpen: (r) => (r.folder ? (node = r.folder, selKey = null, render()) : gpoDlg(r.g)), onCtx: (e, r) => r.g && ctxMenu(e, [['Edit', () => gpoDlg(r.g)]]) }))));
      status.textContent = `${pols.length} setting(s)`;
      actionsFor = () => (cur ? [['Edit policy setting', () => gpoDlg(cur.g)]] : []);
    },
    fwpol() {
      listEl.append(h('div', { style: { padding: '16px 20px', fontSize: '13px' } }, h('h3', { style: { margin: '0 0 10px', fontWeight: 600 } }, 'Windows Defender Firewall with Advanced Security'),
        ...Object.entries(sys.win.firewall).map(([k, v]) => h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '6px 0' } }, icon(v.enabled ? 'w-ok' : 'w-bad', 18), `${k} Profile: Windows Defender Firewall is ${v.enabled ? 'on' : 'off'}.`)),
        h('p', null, h('a', { class: 'w-link', onclick: () => env.openApp('firewall', { elevated: true }) }, 'Windows Defender Firewall Properties'))));
    },
  };

  function policyTable(rows) {
    listEl.append(table([{ name: 'Policy', get: (r) => r[1], w: '55%' }, { name: 'Security Setting', get: (r) => r[2] }], rows.map((r) => Object.assign(r, { key: r[0], icon: 'w-secpol' })), { onOpen: (r) => policyDlg(r[0], r[1]) }));
    status.textContent = '';
  }

  // ---------------------------------------------------------------- user dialogs
  function userProps(name) {
    const u = S.getUser(sys, name); if (!u) return;
    const full = text(u.full, 'text', '250px'); const desc = text(u.desc, 'text', '250px');
    const must = check('User must change password at next logon', u.mustChange);
    const cant = check('User cannot change password', u.cannotChange);
    const never = check('Password never expires', u.neverExpires);
    const dis = check('Account is disabled', !u.enabled);
    const locked = check('Account is locked out', u.locked); locked.input.disabled = !u.locked;
    let members = S.userGroups(sys, name).map((g) => g.name);
    const memList = h('div', { class: 'wd-members' });
    let memSel = null;
    const drawMem = () => { clear(memList); for (const g of members) memList.append(h('div', { class: memSel === g ? 'sel' : '', onclick: () => { memSel = g; drawMem(); } }, icon('w-users', 16), g)); };
    drawMem();
    return sheet(env, { title: `${name} Properties`, tabs: [
      { name: 'General', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '6px' } }, icon('w-user', 32), h('b', null, name)), field('Full name:', full), field('Description:', desc), h('hr'), must.el, cant.el, never.el, dis.el, locked.el) },
      { name: 'Member Of', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('div', null, 'Member of:'), memList,
        h('div', { class: 'row2' }, h('button', { onclick: async () => { const g = await pickGroup(); if (g && !members.some((m) => lc(m) === lc(g))) { members.push(g); drawMem(); } } }, 'Add...'), h('button', { onclick: () => { members = members.filter((m) => m !== memSel); memSel = null; drawMem(); } }, 'Remove')),
        h('div', { class: 'sub', style: { fontSize: '11px' } }, 'Changes to a user\'s group membership are not effective until the next time the user logs on.')) },
    ], onOk: () => {
      if (must.get() && (cant.get() || never.get())) return 'You checked "User must change password at next logon" with "Password never expires" or "User cannot change password". The user will not be required to change the password.';
      if (dis.get() && name === env.user) return 'You cannot disable the account you are currently signed in with.';
      S.setUserFlags(sys, name, { full: full.value, desc: desc.value, mustChange: must.get(), cannotChange: cant.get(), neverExpires: never.get(), enabled: !dis.get(), locked: locked.get() && u.locked });
      const before = S.userGroups(sys, name).map((g) => g.name);
      for (const g of before) if (!members.includes(g)) S.removeMember(sys, g, name);
      for (const g of members) if (!before.includes(g)) S.addMember(sys, g, name);
      render();
    } });
  }
  async function pickGroup() {
    const n = await env.ui.prompt({ title: 'Select Groups', message: 'Enter the object names to select (examples: Administrators, Users, Remote Desktop Users):' });
    if (!n) return null;
    const g = S.getGroup(sys, n.trim().replace(/^.*\\/, ''));
    if (!g) { await errBox(env, 'Name Not Found', `An object (Group) with the following name cannot be found: "${n}".\n\nCheck the selected object types and location for accuracy and ensure that you typed the object name correctly.`); return null; }
    return g.name;
  }
  async function pickUser() {
    const n = await env.ui.prompt({ title: 'Select Users', message: 'Enter the object names to select (separate several names with semicolons):' });
    if (!n) return [];
    const out = [];
    for (const x of n.split(/[;,]/).map((y) => y.trim().replace(/^.*\\/, '')).filter(Boolean)) {
      const u = S.getUser(sys, x) || S.getGroup(sys, x);
      if (!u) { await errBox(env, 'Name Not Found', `An object (User or Group) with the following name cannot be found: "${x}".`); continue; }
      out.push(u.name);
    }
    return out;
  }
  async function setPw(name) {
    const ok = await env.ui.confirm({ title: `Set Password for ${name}`, heading: `Resetting this password might cause irreversible loss of information for this user account.`, message: 'For security reasons, Windows protects certain information by making it impossible to access if the user\'s password is reset. This data loss will occur the next time the user logs off.', ok: 'Proceed', icon: 'w-warn' });
    if (!ok) return;
    const p1 = text('', 'password'); const p2 = text('', 'password');
    await sheet(env, { title: `Set Password for ${name}`, noApply: true, tabs: [{ name: '', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, field('New password:', p1), field('Confirm password:', p2)) }], onOk: () => {
      if (p1.value !== p2.value) return 'The passwords you typed do not match. Please retype the new password in both boxes.';
      try { S.setPassword(sys, name, p1.value); } catch (e) { return e.message; }
      env.ui.alert({ title: 'Local Users and Groups', heading: 'The password has been set.', message: '', icon: 'w-info' });
    } });
    render();
  }
  async function delUser(name) {
    if (lc(name) === lc(env.user)) { errBox(env, 'The following error occurred while attempting to delete the user ' + name + ':', 'You cannot delete the account you are signed in with.'); return; }
    const ok = await env.ui.confirm({ title: 'Local Users and Groups', heading: `Each user account has a unique identifier in addition to their user name. Deleting a user account deletes this identifier and it cannot be restored, even if you create an account with an identical name. This can prevent the user from accessing resources they currently have permission to access.`, message: `Are you sure you want to delete the user ${name}?`, ok: 'Yes', cancel: 'No', icon: 'w-warn' });
    if (!ok) return;
    try { S.removeUser(sys, name); } catch (e) { errBox(env, `The following error occurred while attempting to delete the user ${name}:`, e.message); }
    selKey = null; render();
  }
  async function renUser(name) {
    const n = await env.ui.prompt({ title: 'Rename', message: `New name for ${name}:`, value: name });
    if (!n || n === name) return;
    try { S.renameUser(sys, name, n); } catch (e) { errBox(env, 'Rename failed', e.message); }
    selKey = n; render();
  }
  function newUser() {
    const name = text(''); const full = text(''); const desc = text(''); const p1 = text('', 'password'); const p2 = text('', 'password');
    const must = check('User must change password at next logon', true); const cant = check('User cannot change password', false); const never = check('Password never expires', false); const dis = check('Account is disabled', false);
    return sheet(env, { title: 'New User', okLabel: 'Create', noApply: true, tabs: [{ name: '', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, field('User name:', name), field('Full name:', full), field('Description:', desc), h('hr'), field('Password:', p1), field('Confirm password:', p2), must.el, cant.el, never.el, dis.el) }], onOk: () => {
      if (!name.value.trim()) return 'Please enter a user name.';
      if (p1.value !== p2.value) return 'The passwords you typed do not match.';
      try {
        S.addUser(sys, { name: name.value.trim(), full: full.value, desc: desc.value, groups: ['Users'], enabled: !dis.get(), neverExpires: never.get() });
        if (p1.value) S.setPassword(sys, name.value.trim(), p1.value);
        S.setUserFlags(sys, name.value.trim(), { mustChange: must.get(), cannotChange: cant.get() });
      } catch (e) { try { if (S.getUser(sys, name.value.trim()) && e.code === 2245) S.removeUser(sys, name.value.trim()); } catch { /* ignore */ } return `The following error occurred while attempting to create the user ${name.value}:\n\n${e.message}`; }
      render();
    } });
  }
  // ---------------------------------------------------------------- group dialogs
  function groupProps(gname) {
    const g = S.getGroup(sys, gname); if (!g) return;
    const desc = text(g.desc, 'text', '260px');
    let members = g.members.slice();
    let memSel = null;
    const memList = h('div', { class: 'wd-members' });
    const drawMem = () => { clear(memList); for (const m of members) memList.append(h('div', { class: memSel === m ? 'sel' : '', onclick: () => { memSel = m; drawMem(); } }, icon(S.getUser(sys, m) ? 'w-user' : 'w-users', 16), m)); };
    drawMem();
    return sheet(env, { title: `${g.name} Properties`, tabs: [{ name: 'General', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, icon('w-users', 32), h('b', null, g.name)), field('Description:', desc), h('div', null, 'Members:'), memList,
      h('div', { class: 'row2' }, h('button', { onclick: async () => { for (const u of await pickUser()) if (!members.some((m) => lc(m) === lc(u))) members.push(u); drawMem(); } }, 'Add...'), h('button', { onclick: () => { members = members.filter((m) => m !== memSel); memSel = null; drawMem(); } }, 'Remove'))) }],
    onOk: () => {
      if (lc(g.name) === 'administrators' && !members.some((m) => lc(m) === lc(env.user)) && g.members.some((m) => lc(m) === lc(env.user))) { /* allowed, but a penalty if student is the target */ }
      g.desc = desc.value;
      for (const m of g.members.slice()) if (!members.includes(m)) S.removeMember(sys, g.name, m);
      for (const m of members) if (!g.members.some((x) => lc(x) === lc(m))) { try { S.addMember(sys, g.name, m); } catch (e) { return e.message; } }
      sys.touch('win'); render();
    } });
  }
  function newGroup() {
    const name = text(''); const desc = text('', 'text', '260px');
    const members = []; const memList = h('div', { class: 'wd-members' });
    const drawMem = () => { clear(memList); for (const m of members) memList.append(h('div', null, icon('w-user', 16), m)); };
    return sheet(env, { title: 'New Group', okLabel: 'Create', noApply: true, tabs: [{ name: '', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, field('Group name:', name), field('Description:', desc), h('div', null, 'Members:'), memList, h('div', { class: 'row2' }, h('button', { onclick: async () => { for (const u of await pickUser()) if (!members.includes(u)) members.push(u); drawMem(); } }, 'Add...'))) }], onOk: () => {
      if (!name.value.trim()) return 'Please enter a group name.';
      try { S.addGroup(sys, name.value.trim(), desc.value); for (const m of members) S.addMember(sys, name.value.trim(), m); } catch (e) { return `The following error occurred while attempting to create the group ${name.value}:\n\n${e.message}`; }
      render();
    } });
  }
  async function delGroup(gname) {
    const g = S.getGroup(sys, gname); if (!g) return;
    if (g.rid < 1000) { errBox(env, `The following error occurred while attempting to delete the group ${gname}:`, 'Cannot perform this operation on built-in accounts.'); return; }
    if (!(await env.ui.confirm({ title: 'Local Users and Groups', heading: `Each group has a unique identifier in addition to its name. Deleting a group removes this identifier.`, message: `Are you sure you want to delete the group ${gname}?`, ok: 'Yes', cancel: 'No', icon: 'w-warn' }))) return;
    S.removeGroup(sys, gname); selKey = null; render();
  }
  // ---------------------------------------------------------------- services
  function svcDo(name, what) {
    const s = S.getService(sys, name); if (!s) return;
    try {
      if (what === 'start') { if (s.startType === 'Disabled') throw new S.WinError(`Windows could not start the ${s.display} service on Local Computer.\n\nError 1058: The service cannot be started, either because it is disabled or because it has no enabled devices associated with it.`); S.startService(sys, name); }
      else if (what === 'stop') S.stopService(sys, name);
      else { S.stopService(sys, name); S.startService(sys, name); }
    } catch (e) { env.ui.alert({ title: 'Services', heading: e.message.startsWith('Windows could not') ? '' : `Windows could not ${what} the ${s.display} service on Local Computer.`, message: e.message.startsWith('Windows could not') ? e.message : `Error ${e.code}: ${e.message}`, icon: 'w-bad' }); }
    render();
  }
  function svcProps(name) {
    const s = S.getService(sys, name); if (!s) return;
    const sel = h('select', { style: { width: '220px' } }, ['Automatic (Delayed Start)', 'Automatic', 'Manual', 'Disabled'].map((t) => h('option', { selected: t === s.startType }, t)));
    const statusEl = h('span', null, s.status);
    const btn = (l, fn, en) => h('button', { disabled: !en, style: { minWidth: '72px', height: '24px' }, onclick: () => { fn(); statusEl.textContent = S.getService(sys, name).status; drawBtns(); } }, l);
    const btns = h('div', { class: 'row2' });
    const drawBtns = () => { clear(btns); const cur = S.getService(sys, name); btns.append(btn('Start', () => { if (sel.value !== cur.startType) S.setStartType(sys, name, sel.value); svcDo(name, 'start'); }, cur.status !== 'Running'), btn('Stop', () => svcDo(name, 'stop'), cur.status === 'Running' && !cur.critical), btn('Pause', () => {}, false), btn('Resume', () => {}, false)); };
    drawBtns();
    return sheet(env, { title: `${s.display} Properties (Local Computer)`, width: 440, tabs: [
      { name: 'General', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, field('Service name:', h('span', null, s.name)), field('Display name:', h('span', null, s.display)), field('Description:', h('span', { style: { fontSize: '11px' } }, s.desc)), h('div', null, 'Path to executable:'), h('code', { style: { fontSize: '11px', background: '#f3f3f3', padding: '3px' } }, s.cmdline || `C:\\Windows\\System32\\${s.exe}${s.exe === 'svchost.exe' && s.group ? ` -k ${s.group} -p` : ''}`), field('Startup type:', sel), h('hr'), field('Service status:', statusEl), btns) },
      { name: 'Log On', build: () => h('div', null, h('label', null, h('input', { type: 'radio', checked: true }), `Log on as: ${s.account}`)) },
      { name: 'Recovery', build: () => h('div', null, 'First failure: Restart the Service') },
      { name: 'Dependencies', build: () => h('div', { class: 'sub' }, 'No dependencies.') },
    ], onOk: () => { try { if (sel.value !== S.getService(sys, name).startType) S.setStartType(sys, name, sel.value); } catch (e) { return e.message; } render(); } });
  }
  // ---------------------------------------------------------------- shares
  async function stopShare(name) {
    const s = S.listShares(sys).find((x) => x.name === name); if (!s) return;
    const ok = await env.ui.confirm({ title: 'Shared Folders', heading: `Are you sure you wish to stop sharing ${name}?`, message: s.special ? 'This is an administrative share. Windows re-creates administrative shares when the Server service restarts.' : '', ok: 'Yes', cancel: 'No', icon: 'w-warn' });
    if (!ok) return;
    S.removeShare(sys, name); selKey = null; render();
  }
  function shareProps(name) { const s = S.listShares(sys).find((x) => x.name === name); if (!s) return; env.ui.alert({ title: `${name} Properties`, heading: name, message: `Folder path: ${s.path}\nDescription: ${s.desc || ''}\nUser limit: Maximum allowed`, icon: 'w-share' }); }
  async function newShare() {
    const p = await env.ui.prompt({ title: 'Create A Shared Folder Wizard', message: 'Folder path:', value: 'C:\\Users\\Public' });
    if (!p) return;
    const n = await env.ui.prompt({ title: 'Create A Shared Folder Wizard', message: 'Share name:', value: p.split('\\').pop() || 'Share' });
    if (!n) return;
    try { S.addShare(sys, n, p); } catch (e) { env.ui.alert({ title: 'Shared Folders', heading: 'Could not share the folder', message: e.message, icon: 'w-bad' }); }
    render();
  }
  // ---------------------------------------------------------------- tasks
  function taskProps(t) { env.ui.alert({ title: `${t.name} Properties (Local Computer)`, heading: t.name, message: `Location: ${t.path}\nAuthor: ${t.author}\n\nTriggers: ${t.trigger}\nAction: Start a program\n${t.action}\n\nStatus: ${t.enabled ? 'Ready' : 'Disabled'}`, icon: 'w-taskschd' }); }
  async function delTask(t) {
    if (!(await env.ui.confirm({ title: 'Task Scheduler', heading: `Are you sure you want to delete this task?`, message: t.name, ok: 'Yes', cancel: 'No', icon: 'w-warn' }))) return;
    S.removeTask(sys, t.path + t.name); selKey = null; render();
  }
  // ---------------------------------------------------------------- security policy dialogs
  function policyDlg(key, label) {
    const p = sys.win.policy;
    if (key === 'adminLockout') return;
    if (key === 'complexity' || key === 'reversible') {
      const on = h('input', { type: 'radio', name: 'pd', checked: p[key] }); const off = h('input', { type: 'radio', name: 'pd', checked: !p[key] });
      return sheet(env, { title: `${label} Properties`, tabs: [{ name: 'Local Security Setting', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('b', null, label), h('label', null, on, 'Enabled'), h('label', null, off, 'Disabled')) }, { name: 'Explain', build: () => h('div', { style: { fontSize: '11px' } }, EXPLAIN[key] || '') }], onOk: () => { S.setPolicy(sys, { [key]: on.checked }); render(); } });
    }
    const LIM = { history: [0, 24, 'passwords remembered'], maxAge: [0, 999, 'days (0 = never expires)'], minAge: [0, 998, 'days'], minLen: [0, 14, 'characters'], lockoutThreshold: [0, 999, 'invalid logon attempts'], lockoutDuration: [0, 99999, 'minutes'], lockoutWindow: [1, 99999, 'minutes'] };
    const [lo, hi, unit] = LIM[key];
    const n = num(p[key], lo, hi);
    return sheet(env, { title: `${label} Properties`, tabs: [{ name: 'Local Security Setting', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, h('b', null, label), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, key === 'maxAge' ? 'Password will expire in:' : key === 'minLen' ? 'Password must be at least:' : key === 'history' ? 'Keep password history for:' : key === 'lockoutThreshold' ? 'Account will lock out after:' : key === 'lockoutDuration' ? 'Account is locked out for:' : key === 'lockoutWindow' ? 'Reset account lockout counter after:' : 'Password can be changed after:', n, unit)) }, { name: 'Explain', build: () => h('div', { style: { fontSize: '11px' } }, EXPLAIN[key] || '') }],
      onOk: () => {
        const v = Math.round(Number(n.value));
        if (!Number.isFinite(v) || v < lo || v > hi) return `The value must be between ${lo} and ${hi}.`;
        const patch = { [key]: v };
        if (key === 'minAge' && p.maxAge && v >= p.maxAge) return 'The minimum password age must be less than the maximum password age.';
        if (key === 'maxAge' && v && p.minAge >= v) patch.minAge = Math.max(0, v - 1);
        if (key === 'lockoutThreshold' && v > 0 && p.lockoutThreshold === 0) { patch.lockoutDuration = Math.max(p.lockoutDuration, 10); patch.lockoutWindow = Math.max(p.lockoutWindow, 10); env.ui.alert({ title: 'Suggested Value Changes', heading: 'Because the value of Account lockout threshold is now ' + v + ' invalid logon attempts, the settings for the following items will be changed to the suggested values.', message: `Account lockout duration: ${patch.lockoutDuration} minutes\nReset account lockout counter after: ${patch.lockoutWindow} minutes`, icon: 'w-info' }); }
        if (key === 'lockoutWindow' && p.lockoutDuration && v > p.lockoutDuration) return 'The reset counter value must be less than or equal to the lockout duration.';
        if (key === 'lockoutDuration' && v && p.lockoutWindow > v) patch.lockoutWindow = v;
        S.setPolicy(sys, patch); render();
      } });
  }
  function gpoDlg(g) {
    const st = S.gpoState(sys, g);
    const radios = ['Not configured', 'Enabled', 'Disabled'].map((v) => ({ v, el: h('input', { type: 'radio', name: 'gpo', checked: st === v }) }));
    return sheet(env, { title: g.name, width: 620, tabs: [{ name: '', build: () => h('div', { style: { display: 'flex', gap: '14px' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '170px', flex: 'none' } }, radios.map((r) => h('label', null, r.el, r.v === 'Not configured' ? 'Not Configured' : r.v)), h('div', { style: { marginTop: '14px', fontSize: '11px', color: '#555' } }, 'Supported on: At least Windows Vista')),
      h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' } }, h('b', null, 'Help:'), h('div', { style: { border: '1px solid #ccc', padding: '8px', height: '190px', overflow: 'auto', background: '#fff', fontSize: '12px' } }, g.help))) }],
    onOk: () => { S.setGpo(sys, g, radios.find((r) => r.el.checked).v); render(); } });
  }
  function auditDlg(cat, label) {
    const a = sys.win.audit[cat];
    const s = check('Success', a.success); const f = check('Failure', a.failure);
    return sheet(env, { title: `${label} Properties`, tabs: [{ name: 'Local Security Setting', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('b', null, label), h('div', null, 'Audit these attempts:'), s.el, f.el) }], onOk: () => { S.setAudit(sys, cat, { success: s.get(), failure: f.get() }); render(); } });
  }
  function rightDlg(k, label) {
    let list = (sys.win.rights[k] || []).slice();
    let sel = null;
    const box = h('div', { class: 'wd-members', style: { height: '170px' } });
    const draw = () => { clear(box); for (const m of list) box.append(h('div', { class: sel === m ? 'sel' : '', onclick: () => { sel = m; draw(); } }, icon(S.getUser(sys, m) ? 'w-user' : 'w-users', 16), m)); };
    draw();
    return sheet(env, { title: `${label} Properties`, tabs: [{ name: 'Local Security Setting', build: () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('b', null, label), box,
      h('div', { class: 'row2' }, h('button', { onclick: async () => { const n = await env.ui.prompt({ title: 'Select Users or Groups', message: 'Enter the object names to select:' }); if (!n) return; const v = n.trim().replace(/^.*\\/, ''); const known = S.getUser(sys, v) || S.getGroup(sys, v) || /^(Everyone|Authenticated Users|LOCAL SERVICE|NETWORK SERVICE|SERVICE|Guests)$/i.test(v); if (!known) { errBox(env, 'Name Not Found', `An object (User, Group, or Built-in security principal) with the following name cannot be found: "${v}".`); return; } if (!list.includes(v)) list.push(S.getUser(sys, v)?.name || S.getGroup(sys, v)?.name || v); draw(); } }, 'Add User or Group...'), h('button', { onclick: () => { list = list.filter((m) => m !== sel); sel = null; draw(); } }, 'Remove'))) }],
    onOk: () => { S.setRight(sys, k, list); render(); } });
  }
  function secoptDlg(o) {
    const cur = S.secoptValue(sys, o);
    let input;
    let body;
    if (o.kind === 'rename') { input = text(cur); body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('b', null, o.name), input); }
    else if (o.choices) { input = h('select', { style: { width: '100%' } }, o.choices.map(([, l]) => h('option', { selected: l === cur }, l))); body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('b', null, o.name), input); }
    else { const on = h('input', { type: 'radio', name: 'so', checked: cur === 'Enabled' }); const off = h('input', { type: 'radio', name: 'so', checked: cur !== 'Enabled' }); input = { get value() { return on.checked ? 'Enabled' : 'Disabled'; } }; body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('b', null, o.name), h('label', null, on, 'Enabled'), h('label', null, off, 'Disabled')); }
    return sheet(env, { title: `${o.name.split(':')[0]}: Properties`, width: 460, tabs: [{ name: 'Local Security Setting', build: () => body }, { name: 'Explain', build: () => h('div', { style: { fontSize: '11px' } }, `${o.name}\n\nThis security setting is stored in the registry${o.key ? ` at ${o.key}\\${o.value}` : ' in the account database'}.`) }],
      onOk: () => { try { S.setSecopt(sys, o, input.value); } catch (e) { return e.message; } render(); } });
  }

  render();
  return win;
}

const SUBCATS = {
  'Account Logon': ['Credential Validation', 'Kerberos Authentication Service', 'Kerberos Service Ticket Operations', 'Other Account Logon Events'],
  'Account Management': ['Computer Account Management', 'Other Account Management Events', 'Security Group Management', 'User Account Management'],
  'Detailed Tracking': ['DPAPI Activity', 'Process Creation', 'Process Termination', 'RPC Events'],
  'DS Access': ['Directory Service Access', 'Directory Service Changes'],
  'Logon/Logoff': ['Account Lockout', 'Logoff', 'Logon', 'Other Logon/Logoff Events', 'Special Logon'],
  'Object Access': ['Detailed File Share', 'File Share', 'File System', 'Registry', 'Removable Storage', 'SAM'],
  'Policy Change': ['Audit Policy Change', 'Authentication Policy Change', 'Authorization Policy Change'],
  'Privilege Use': ['Non Sensitive Privilege Use', 'Sensitive Privilege Use'],
  System: ['IPsec Driver', 'Other System Events', 'Security State Change', 'Security System Extension', 'System Integrity'],
};
const EXPLAIN = {
  history: 'Enforce password history\n\nThis security setting determines the number of unique new passwords that have to be associated with a user account before an old password can be reused. The value must be between 0 and 24 passwords.',
  maxAge: 'Maximum password age\n\nThis security setting determines the period of time (in days) that a password can be used before the system requires the user to change it. Setting the number of days to 0 specifies that passwords never expire.',
  minAge: 'Minimum password age\n\nThis security setting determines the period of time (in days) that a password must be used before the user can change it.',
  minLen: 'Minimum password length\n\nThis security setting determines the least number of characters that a password for a user account may contain. You can set a value of between 1 and 14 characters.',
  complexity: 'Password must meet complexity requirements\n\nPasswords must not contain the user\'s account name, must be at least six characters, and must contain characters from three of: uppercase letters, lowercase letters, digits, non-alphanumeric characters.',
  reversible: 'Store passwords using reversible encryption\n\nStoring passwords using reversible encryption is essentially the same as storing plaintext versions of the passwords. This policy should never be enabled.',
  lockoutThreshold: 'Account lockout threshold\n\nThis security setting determines the number of failed logon attempts that causes a user account to be locked out. A value of 0 means the account will never be locked out.',
  lockoutDuration: 'Account lockout duration\n\nThis security setting determines the number of minutes a locked-out account remains locked out before automatically becoming unlocked.',
  lockoutWindow: 'Reset account lockout counter after\n\nThis security setting determines the number of minutes that must elapse after a failed logon attempt before the failed logon attempt counter is reset to 0.',
};

function buildTree(app) {
  const N = (id, name, parent, ic, view, extra = {}) => ({ id, name, parent, icon: ic, view, ...extra });
  if (app === 'gpedit') {
    const sec = buildTree('secpol').map((n) => (n.parent === null ? { ...n, parent: 'ws', name: 'Security Settings' } : n));
    const at = [];
    const seen = new Set();
    for (const g of S.GPOS) for (let i = 1; i <= g.path.length; i++) { const p = g.path.slice(0, i); const id = `at:${p.join('/')}`; if (seen.has(id)) continue; seen.add(id); at.push(N(id, p[i - 1], i === 1 ? 'at' : `at:${p.slice(0, -1).join('/')}`, 'w-folder', 'gpo', { gpoPath: p })); }
    return [N('lcp', 'Local Computer Policy', null, 'w-gpedit'), N('cc', 'Computer Configuration', 'lcp', 'w-thispc'), N('sws', 'Software Settings', 'cc', 'w-folder'), N('ws', 'Windows Settings', 'cc', 'w-folder'), ...sec,
      N('at', 'Administrative Templates', 'cc', 'w-folder', 'gpo', { gpoPath: [] }), ...at.sort((a, b) => a.gpoPath.join('/').localeCompare(b.gpoPath.join('/'))),
      N('uc', 'User Configuration', 'lcp', 'w-users'), N('uat', 'Administrative Templates', 'uc', 'w-folder')];
  }
  if (app === 'secpol') {
    return [
      N('root', 'Security Settings', null, 'w-secpol'),
      N('acct', 'Account Policies', 'root', 'w-folder'), N('pw', 'Password Policy', 'acct', 'w-folder', 'pwpol'), N('lock', 'Account Lockout Policy', 'acct', 'w-folder', 'lockpol'),
      N('local', 'Local Policies', 'root', 'w-folder'), N('audit', 'Audit Policy', 'local', 'w-folder', 'auditpol'), N('rights', 'User Rights Assignment', 'local', 'w-folder', 'rights'), N('secopts', 'Security Options', 'local', 'w-folder', 'secopts'),
      N('fw', 'Windows Defender Firewall with Advanced Security', 'root', 'w-firewall', 'fwpol'),
      N('adv', 'Advanced Audit Policy Configuration', 'root', 'w-folder'), N('sap', 'System Audit Policies - Local Group Policy Object', 'adv', 'w-folder'),
      ...Object.keys(SUBCATS).map((c) => N(`aa-${c}`, c, 'sap', 'w-folder', 'advaudit', { auditCat: c })),
    ];
  }
  const lusr = (parent) => [N('lusr', 'Local Users and Groups', parent, 'w-users'), N('users', 'Users', 'lusr', 'w-folder', 'users'), N('groups', 'Groups', 'lusr', 'w-folder', 'groups')];
  if (app === 'lusrmgr') return [N('root', 'Local Users and Groups (Local)', null, 'w-users'), N('users', 'Users', 'root', 'w-folder', 'users'), N('groups', 'Groups', 'root', 'w-folder', 'groups')];
  if (app === 'services') return [N('svc', 'Services (Local)', null, 'w-services', 'services')];
  if (app === 'shares') return [N('sf', 'Shared Folders (Local)', null, 'w-share'), N('shares', 'Shares', 'sf', 'w-folder', 'shares'), N('sess', 'Sessions', 'sf', 'w-folder', 'sessions'), N('of', 'Open Files', 'sf', 'w-folder', 'sessions')];
  if (app === 'taskschd') return [N('ts', 'Task Scheduler (Local)', null, 'w-taskschd'), N('lib', 'Task Scheduler Library', 'ts', 'w-folder', 'tasks', { taskPath: '\\' }), N('ms', 'Microsoft', 'lib', 'w-folder'), N('msw', 'Windows', 'ms', 'w-folder'), N('defrag', 'Defrag', 'msw', 'w-folder', 'tasks', { taskPath: '\\Microsoft\\Windows\\Defrag\\' }), N('wu', 'WindowsUpdate', 'msw', 'w-folder', 'tasks', { taskPath: '\\Microsoft\\Windows\\WindowsUpdate\\' })];
  return [
    N('root', 'Computer Management (Local)', null, 'w-compmgmt'),
    N('sys', 'System Tools', 'root', 'w-folder'),
    N('ts', 'Task Scheduler', 'sys', 'w-taskschd'), N('lib', 'Task Scheduler Library', 'ts', 'w-folder', 'tasks', { taskPath: '\\' }),
    N('ev', 'Event Viewer', 'sys', 'w-eventvwr', 'events'),
    N('sf', 'Shared Folders', 'sys', 'w-share'), N('shares', 'Shares', 'sf', 'w-folder', 'shares'), N('sess', 'Sessions', 'sf', 'w-folder', 'sessions'), N('of', 'Open Files', 'sf', 'w-folder', 'sessions'),
    ...lusr('sys'),
    N('stor', 'Storage', 'root', 'w-folder'), N('disk', 'Disk Management', 'stor', 'w-drive', 'disk'),
    N('sa', 'Services and Applications', 'root', 'w-folder'), N('svc', 'Services', 'sa', 'w-services', 'services'),
  ];
}
