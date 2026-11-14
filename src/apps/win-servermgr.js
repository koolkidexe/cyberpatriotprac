// Server Manager (Windows Server 2022): Dashboard, Local Server and File and Storage Services > Shares, with the
// Manage and Tools menus that lead to the real management consoles of the simulator.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as S from '../win/state.js';
import { winVer } from '../win/image.js';

const TOOLS = [['Computer Management', 'compmgmt'], ['Local Security Policy', 'secpol'], ['Local Group Policy Editor', 'gpedit'], ['Registry Editor', 'regedit'], ['Services', 'services'], ['Shared Folders', 'shares'], ['Task Scheduler', 'taskschd'],
  ['Windows Defender Firewall with Advanced Security', 'firewall'], ['Windows PowerShell', 'terminal'], ['System Configuration', 'taskmgr']];

export function open(env, opts = {}) {
  const sys = env.sys;
  let page = opts.page || 'dashboard';
  const body = h('div', { class: 'sm-main' });
  const nav = h('div', { class: 'sm-nav' });
  const crumb = h('span');
  const go = (p) => { page = p; render(); };
  const launch = (id, o = {}) => env.openApp(id, o);
  const menu = (label, items) => h('button', { class: 'sm-menu', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.bottom, items()); } }, label);
  const top = h('div', { class: 'sm-top' },
    h('button', { class: 'sm-back', title: 'Back', onclick: () => go('dashboard') }, '←'), h('div', { class: 'sm-title' }, 'Server Manager', h('span', { class: 'sm-sep' }, ' ▸ '), crumb),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'sm-menu', title: 'Refresh', onclick: () => render() }, '⟳'), h('button', { class: 'sm-menu', title: 'Notifications' }, '⚑'),
    menu('Manage', () => [{ label: 'Add Roles and Features', action: () => launch('features') }, { label: 'Remove Roles and Features', action: () => launch('features') }, 'sep', { label: 'Add Servers', disabled: true }, { label: 'Create Server Group', disabled: true }, 'sep', { label: 'Server Manager Properties', disabled: true }]),
    menu('Tools', () => TOOLS.map(([n, id]) => ({ label: n, action: () => launch(id) }))),
    menu('View', () => [{ label: 'Zoom: 100%', disabled: true }]),
    menu('Help', () => [{ label: 'Server Manager Help', disabled: true }, { label: 'About Server Manager', action: () => env.ui.alert({ title: 'About Server Manager', heading: 'Server Manager', message: `Microsoft ${winVer(sys).product}\nVersion ${winVer(sys).display} (OS Build ${winVer(sys).build}.${winVer(sys).ubr})`, icon: 'w-info' }) }]));
  const root = h('div', { class: 'sm' }, top, h('div', { class: 'sm-body' }, nav, body));

  const NAV = [['dashboard', 'Dashboard', '▦'], ['local', 'Local Server', '▮'], ['all', 'All Servers', '▮▮'], ['files', 'File and Storage Services', '🗀']];
  function render() {
    clear(nav); clear(body);
    for (const [id, name, g] of NAV) nav.append(h('div', { class: 'sm-ni' + (page === id || (page === 'shares' && id === 'files') ? ' on' : ''), title: name, onclick: () => go(id) }, h('span', { class: 'sm-g' }, g), name, id === 'files' ? h('span', { style: { marginLeft: 'auto' } }, '▸') : null));
    crumb.textContent = { dashboard: 'Dashboard', local: 'Local Server', all: 'All Servers', files: 'File and Storage Services ▸ Servers', shares: 'File and Storage Services ▸ Shares' }[page];
    ({ dashboard, local, all, files, shares })[page]();
  }
  const tile = (title, n, rows, color, onclick) => h('div', { class: 'sm-tile', onclick }, h('div', { class: 'sm-th', style: { background: color } }, h('span', null, title), h('b', null, String(n))),
    h('div', { class: 'sm-tb' }, rows.map(([t, bad]) => h('div', { class: bad ? 'bad' : '' }, bad ? h('i', null, String(bad)) : null, t))));
  function health() {
    const stopped = S.listServices(sys).filter((s) => /^Automatic/.test(s.startType) && s.status !== 'Running').length;
    return { stopped, fw: !S.firewallAllOn(sys) };
  }
  function dashboard() {
    const hl = health();
    const step = (n, t, fn) => h('div', { class: 'sm-step' + (n === 1 ? ' big' : ''), onclick: fn }, h('b', null, String(n)), h('span', null, t));
    body.append(h('div', { class: 'sm-h' }, 'WELCOME TO SERVER MANAGER'),
      h('div', { class: 'sm-welcome' }, h('div', { class: 'sm-qs' }, h('div', null, 'QUICK START'), h('div', null, "WHAT'S NEW"), h('div', null, 'LEARN MORE')),
        h('div', { class: 'sm-steps' }, step(1, 'Configure this local server', () => go('local')), step(2, 'Add roles and features', () => launch('features')), step(3, 'Add other servers to manage', null), step(4, 'Create a server group', null), step(5, 'Connect this server to cloud services', null))),
      h('div', { class: 'sm-h' }, 'ROLES AND SERVER GROUPS'), h('div', { class: 'sm-sub' }, 'Roles: 1   |   Server groups: 1   |   Servers total: 1'),
      h('div', { class: 'sm-tiles' },
        tile('File and Storage Services', 1, [['Manageability'], ['Events'], ['Services'], ['Performance'], ['BPA results']], '#2f8f46', () => go('files')),
        tile('Local Server', 1, [['Manageability'], ['Events'], ['Services', hl.stopped], ['Performance'], ['BPA results']], hl.stopped ? '#c8382d' : '#2f8f46', () => go('local')),
        tile('All Servers', 1, [['Manageability'], ['Events'], ['Services', hl.stopped], ['Performance'], ['BPA results']], hl.stopped ? '#c8382d' : '#2f8f46', () => go('all'))));
  }
  function local() {
    const V = winVer(sys);
    const link = (t, fn, bad) => h('a', { class: 'sm-link' + (bad ? ' bad' : ''), onclick: fn }, t);
    const fwOn = S.firewallAllOn(sys);
    const P = [
      ['Computer name', link(sys.hostname, () => launch('sysdm'))], ['Workgroup', link('WORKGROUP', () => launch('sysdm'))], null,
      ['Microsoft Defender Firewall', link(fwOn ? 'Public: On' : `${Object.entries(sys.win.firewall).filter(([, p]) => !p.enabled).map(([n]) => n).join(', ')}: Off`, () => launch('firewall'), !fwOn)],
      ['Remote management', link('Enabled', null)], ['Remote Desktop', link(S.rdpEnabled(sys) ? 'Enabled' : 'Disabled', () => launch('sysdm'))], ['NIC Teaming', link('Disabled', null)], ['Ethernet', link('IPv4 address assigned by DHCP, IPv6 enabled', null)], null,
      ['Operating system version', `Microsoft ${V.product}`], ['Hardware information', 'innotek GmbH VirtualBox'],
    ];
    const Q = [
      ['Last installed updates', link(S.pendingUpdates(sys).length ? 'Never' : 'Today', () => launch('settings', { page: 'update' }))],
      ['Windows Update', link(S.autoUpdatesOn(sys) ? 'Download updates only, using Windows Update' : 'Never check for updates', () => launch('settings', { page: 'update' }), !S.autoUpdatesOn(sys))],
      ['Last checked for updates', link('Never', () => launch('settings', { page: 'update' }))], null,
      ['Microsoft Defender Antivirus', link(`Real-Time Protection: ${S.realtimeOn(sys) ? 'On' : 'Off'}`, () => launch('security'), !S.realtimeOn(sys))],
      ['Feedback & Diagnostics', link('Settings', () => launch('settings', { page: 'privacy' }))], ['IE Enhanced Security Configuration', link('On', null)], ['Time zone', link('(UTC) Coordinated Universal Time', null)], ['Product ID', link('Not activated', () => launch('settings', { page: 'activation' }))], null,
      ['Processors', 'Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz'], ['Installed memory (RAM)', '4 GB'], ['Total disk space', '59.4 GB'],
    ];
    const col = (rows) => h('div', { class: 'sm-props' }, rows.map((r) => (r ? h('div', { class: 'sm-pr' }, h('span', null, r[0]), h('span', null, r[1])) : h('div', { class: 'sm-gap' }))));
    const svc = S.listServices(sys).filter((s) => /^Automatic/.test(s.startType) && s.status !== 'Running');
    body.append(h('div', { class: 'sm-panel' }, h('div', { class: 'sm-ph' }, h('b', null, 'PROPERTIES'), h('span', null, `For ${sys.hostname}`), h('span', { class: 'sm-tasks' }, 'TASKS ▾')), h('div', { class: 'sm-cols' }, col(P), col(Q))),
      h('div', { class: 'sm-panel' }, h('div', { class: 'sm-ph' }, h('b', null, 'SERVICES'), h('span', null, `Automatic services that are not running | ${svc.length} total`), h('span', { class: 'sm-tasks', onclick: () => launch('services') }, 'TASKS ▾')),
        table(['Server Name', 'Display Name', 'Service Name', 'Status', 'Start Type'], svc.map((s) => [sys.hostname, s.display, s.name, s.status, s.startType]), () => launch('services'))));
  }
  function all() {
    body.append(h('div', { class: 'sm-panel' }, h('div', { class: 'sm-ph' }, h('b', null, 'SERVERS'), h('span', null, 'All servers | 1 total')),
      table(['Server Name', 'IPv4 Address', 'Manageability', 'Last Update', 'Windows Activation'], [[sys.hostname, '10.0.2.15', 'Online - Performance counters not started', new Date(sys.now()).toLocaleString('en-US'), 'Not activated']], () => go('local'))));
  }
  function files() {
    const sub = h('div', { class: 'sm-subnav' }, ['Servers', 'Volumes', 'Disks', 'Storage Pools', 'Shares', 'iSCSI', 'Work Folders'].map((t) => h('div', { class: t === 'Servers' ? 'on' : '', onclick: () => t === 'Shares' && go('shares') }, t)));
    body.append(h('div', { class: 'sm-split' }, sub, h('div', { style: { flex: 1 } }, h('div', { class: 'sm-panel' }, h('div', { class: 'sm-ph' }, h('b', null, 'SERVERS'), h('span', null, 'All servers | 1 total')),
      table(['Server Name', 'IPv4 Address', 'Manageability'], [[sys.hostname, '10.0.2.15', 'Online']], () => go('shares'))))));
  }
  function shares() {
    const sub = h('div', { class: 'sm-subnav' }, ['Servers', 'Volumes', 'Disks', 'Storage Pools', 'Shares', 'iSCSI', 'Work Folders'].map((t) => h('div', { class: t === 'Shares' ? 'on' : '', onclick: () => t === 'Servers' && go('files') }, t)));
    const rows = S.listShares(sys).filter((s) => !s.special).map((s) => Object.assign([s.name, s.path, 'SMB', 'Not Clustered'], { share: s }));
    const stop = async (s) => {
      const ok = await env.ui.confirm({ title: 'Stop Sharing', heading: `Are you sure you want to stop sharing ${s.name}?`, message: s.path, ok: 'Yes', cancel: 'No', icon: 'w-warn' }); if (!ok) return;
      if (!opts.elevated && !(await env.elevate({ what: 'Server Manager' }))) return;
      try { S.removeShare(sys, s.name); } catch (e) { env.ui.alert({ title: 'Server Manager', heading: 'The share could not be removed', message: e.message, icon: 'w-bad' }); }
      render();
    };
    const t = table(['Share', 'Local Path', 'Protocol', 'Availability Type'], rows, (r) => launch('shares'), (r, e) => env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Stop Sharing', action: () => stop(r.share) }, { label: 'Open Share', action: () => launch('explorer', { path: S.fromWin(r.share.path) }) }, 'sep', { label: 'Properties', action: () => launch('shares') }]));
    body.append(h('div', { class: 'sm-split' }, sub, h('div', { style: { flex: 1 } }, h('div', { class: 'sm-panel' }, h('div', { class: 'sm-ph' }, h('b', null, 'SHARES'), h('span', null, `All shares | ${rows.length} total`),
      h('span', { class: 'sm-tasks', onclick: (e) => env.ui.showMenu(e.clientX - 120, e.clientY + 8, [{ label: 'New Share...', action: () => newShare() }, { label: 'Refresh', action: () => render() }]) }, 'TASKS ▾')), t,
    h('div', { class: 'sm-note' }, 'Right-click a share to stop sharing it. Hidden shares end with $. The administrative shares ADMIN$, C$ and IPC$ are not listed.')))));
  }
  async function newShare() {
    const v = await env.ui.modal((done) => {
      const name = h('input', { class: 'w-in', placeholder: 'Share name' }); const path = h('input', { class: 'w-in', placeholder: 'C:\\Shares\\Folder', style: { width: '100%' } });
      const err = h('div', { style: { color: '#c00', minHeight: '16px', fontSize: '12px' } });
      const ok = () => { const n = name.value.trim(); const p = path.value.trim().replace(/[\\/]+$/, ''); if (!n || !p) { err.textContent = 'Enter a share name and a folder path.'; return; } if (!sys.vfs.isDir(S.resolve(sys, S.fromWin(p)))) { err.textContent = 'The folder does not exist.'; return; } done({ n, p }); };
      return h('div', { class: 'w-dlg', style: { width: '460px' } }, h('div', { class: 'wd-t' }, h('span', null, 'New Share Wizard'), h('span', { onclick: () => done(null) }, '✕')),
        h('div', { style: { padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' } }, h('b', null, 'SMB Share - Quick'), h('label', null, 'Share name:'), name, h('label', null, 'Local path to share:'), path, err),
        h('div', { class: 'wd-f', style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '10px 14px' } }, h('button', { class: 'w-btn primary', onclick: ok }, 'Create'), h('button', { class: 'w-btn', onclick: () => done(null) }, 'Cancel')));
    });
    if (!v) return;
    if (!opts.elevated && !(await env.elevate({ what: 'Server Manager' }))) return;
    try { S.addShare(sys, v.n, v.p, ''); } catch (e) { env.ui.alert({ title: 'New Share Wizard', heading: 'The share was not created', message: e.message, icon: 'w-bad' }); }
    render();
  }
  function table(cols, rows, onOpen, onCtx) {
    return h('table', { class: 'sm-table' }, h('thead', null, h('tr', null, cols.map((c) => h('th', null, c)))),
      h('tbody', null, rows.length ? rows.map((r) => h('tr', { ondblclick: () => onOpen?.(r), oncontextmenu: (e) => { if (onCtx) { e.preventDefault(); onCtx(r, e); } } }, r.map((c) => h('td', null, c)))) : h('tr', null, h('td', { colSpan: cols.length, class: 'sm-none' }, 'There are no items to show.'))));
  }
  const win = env.wm.open({ title: 'Server Manager', icon: 'w-servermgr', width: 1040, height: 640, appId: 'servermgr', content: root });
  let rt = null;
  const off = sys.on('change', () => { clearTimeout(rt); rt = setTimeout(() => { if (!win.closed && !document.querySelector('.ctxmenu, .dropmenu, #overlay.show')) render(); }, 400); });
  win.onClose(() => { if (typeof off === 'function') off(); return true; });
  render();
  void icon;
  return win;
}
