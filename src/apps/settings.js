// System Settings. Mint: cinnamon-settings tile grid. Ubuntu: GNOME Settings sidebar.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ACCENTS } from '../ui/gnome-shell.js';

const TILES = [
  ['Users and Groups', 'users', 'users'], ['Login Window', 'login', 'login'], ['Startup Applications', 'startup', 'startup'],
  ['Firewall', 'shield', 'gufw'], ['Update Manager', 'update', 'update'], ['Software Sources', 'refresh', 'sources'],
  ['Printers', 'printer', 'printers'], ['System Monitor', 'pulse', 'monitor'], ['Terminal', 'terminal', 'terminal'],
];

function gnomeSettings(env) {
  const sys = env.sys;
  const pane = h('div', { style: { flex: 1, overflow: 'auto', padding: '18px 24px', background: 'var(--surface)' } });
  const rows = (pairs) => h('div', { class: 'kv', style: { gridTemplateColumns: '180px 1fr' } }, pairs.flatMap(([a, b]) => [h('div', { class: 'k' }, a), h('div', null, b)]));
  const about = () => {
    const os = (sys.vfs.readFile('/etc/os-release').match(/PRETTY_NAME="(.*)"/) || [])[1] || 'Ubuntu';
    return [h('h2', { style: { marginTop: 0 } }, 'About'), rows([['Device name', sys.hostname], ['Memory', '3.8 GiB'], ['Processor', 'Intel® Core™ i5-8250U × 2'], ['OS Name', os], ['OS Type', '64-bit'], ['GNOME Version', '42.9'], ['Windowing System', 'X11'], ['Disk Capacity', '52.4 GB']])];
  };
  const info = (title, text) => () => [h('h2', { style: { marginTop: 0 } }, title), h('p', { style: { color: 'var(--text-dim)', lineHeight: 1.5 } }, text)];
  const appearance = () => {
    const t = env.theme();
    const set = (patch) => { env.setTheme(patch); draw(); };
    const style = (id, label) => h('div', { class: 'opt' + (t.style === id ? ' on' : ''), onclick: () => set({ style: id }) }, h('div', { class: 'prev ' + id }, h('i'), h('b')), h('div', null, label));
    const dots = h('div', { class: 'accent-dots' }, Object.entries(ACCENTS).map(([id, [c]]) => h('div', { class: 'dot' + (t.accent === id ? ' on' : ''), title: id[0].toUpperCase() + id.slice(1), style: { background: c }, onclick: () => set({ accent: id }) }, t.accent === id ? '✓' : '')));
    const pos = h('select', { class: 'in', onchange: (e) => set({ dock: e.target.value }) }, ['left', 'bottom', 'right'].map((d) => h('option', { value: d, selected: t.dock === d }, d[0].toUpperCase() + d.slice(1))));
    return [h('h2', { style: { marginTop: 0 } }, 'Appearance'),
      h('h3', { class: 'sh' }, 'Style'), h('div', { class: 'style-pick' }, style('light', 'Light'), style('dark', 'Dark')),
      h('h3', { class: 'sh' }, 'Accent colour'), dots,
      h('h3', { class: 'sh' }, 'Dock'), h('div', { class: 'opt-row' }, h('div', null, 'Position on screen'), pos)];
  };
  const ITEMS = [
    ['Appearance', 'gear', appearance],
    ['Network', 'net', info('Network', 'Wired: connected (10.0.2.15). VPN and proxy are not configured.')],
    ['Privacy', 'lock', info('Privacy', 'Screen Lock: on. Location Services: off. Automatic Problem Reporting: off.')],
    ['Users', 'users', () => { env.openApp('users'); return [h('h2', { style: { marginTop: 0 } }, 'Users'), h('p', null, 'The Users panel opened in its own window.')]; }],
    ['Software & Updates', 'refresh', () => { env.openApp('swprops'); return [h('h2', { style: { marginTop: 0 } }, 'Software & Updates'), h('p', null, 'Opened in its own window.')]; }],
    ['Startup Applications', 'startup', () => { env.openApp('startup'); return [h('h2', { style: { marginTop: 0 } }, 'Startup Applications'), h('p', null, 'Opened in its own window.')]; }],
    ['Printers', 'printer', () => { env.openApp('printers'); return [h('h2', { style: { marginTop: 0 } }, 'Printers'), h('p', null, 'Opened in its own window.')]; }],
    ['About', 'info', about],
  ];
  const side = h('div', { style: { width: '200px', background: 'var(--surface-2)', borderRight: '1px solid var(--line)', overflow: 'auto' } });
  let sel = 'Appearance';
  const draw = () => {
    clear(side); clear(pane);
    for (const [n, ic, fn] of ITEMS) side.append(h('div', { class: 'pl' + (n === sel ? ' on' : ''), style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '9px 14px', background: n === sel ? 'var(--accent)' : '', color: n === sel ? '#fff' : '' }, onclick: () => { sel = n; draw(); } }, icon(ic, 18), n));
    pane.append(...ITEMS.find((i) => i[0] === sel)[2]());
  };
  draw();
  return env.wm.open({ title: 'Settings', icon: 'gear', width: 760, height: 480, appId: 'settings', content: h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, side, pane) });
}

export function open(env) {
  if (env.os === 'ubuntu') return gnomeSettings(env);
  const grid = h('div', { class: 'tiles' }, TILES.map(([n, ic, app]) => h('div', { class: 'tile', ondblclick: () => env.openApp(app), onclick: () => env.openApp(app) }, icon(ic, 40), n)));
  return env.wm.open({ title: 'System Settings', icon: 'gear', width: 620, height: 400, appId: 'settings', content: h('div', { class: 'app-body' }, grid) });
}
