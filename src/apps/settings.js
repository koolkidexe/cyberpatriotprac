// System Settings. Mint: cinnamon-settings tile grid. Ubuntu: GNOME Settings sidebar.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ACCENTS } from '../ui/gnome-shell.js';

// cinnamon-settings (Mint 21.3): four sections of modules. A module with an app id opens a working app; the rest open an
// informational stub, like modules that are not part of the competition surface.
const SECTIONS = [
  ['Appearance', [['Backgrounds', 'image'], ['Desklets', 'app'], ['Effects', 'cat-graphics'], ['Extensions', 'app'], ['Font Selection', 'text'], ['Themes', 'cat-prefs']]],
  ['Preferences', [['Accessibility', 'users'], ['Account Details', 'users', 'users'], ['Applets', 'app'], ['Date & Time', 'calendar'], ['Desktop', 'computer'], ['General', 'gear'], ['Hot Corners', 'show-desktop'],
    ['Languages', 'info'], ['Notifications', 'info'], ['Panel', 'show-desktop'], ['Preferred Applications', 'cat-prefs'], ['Privacy', 'lock'], ['Screensaver', 'lock', 'lock'], ['Startup Applications', 'startup', 'startup'], ['Window Tiling', 'app'], ['Windows', 'app'], ['Workspaces', 'app']]],
  ['Hardware', [['Color', 'cat-graphics'], ['Display', 'computer'], ['Keyboard', 'key'], ['Mouse and Touchpad', 'app'], ['Network', 'net'], ['Power Management', 'power'], ['Printers', 'printer', 'printers'], ['Sound', 'volume'], ['System Info', 'info', 'sysinfo'], ['System Monitor', 'pulse', 'monitor']]],
  ['Administration', [['Driver Manager', 'disk'], ['Firewall', 'shield', 'gufw'], ['Login Window', 'login', 'login'], ['Software Sources', 'refresh', 'sources'], ['Update Manager', 'update', 'update'], ['Users and Groups', 'users', 'users']]],
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

function sysInfo(env) {
  const sys = env.sys;
  const os = (sys.vfs.readFile('/etc/os-release').match(/PRETTY_NAME="(.*)"/) || [])[1] || 'Linux Mint';
  const kv = [['Operating System', `${os} Cinnamon 64-bit`], ['Cinnamon Version', '6.0.4'], ['Linux Kernel', (sys.vfs.isFile('/proc/version') ? sys.vfs.readFile('/proc/version').split(' ')[2] : '5.15.0-91-generic')], ['Processor', 'Intel© Core™ i5-8250U CPU @ 1.60GHz × 2'], ['Memory', '3.8 GiB'], ['Hard Drives', '32.2 GB'], ['Graphics Card', 'VMware SVGA II Adapter']];
  return env.wm.open({ title: 'System Info', icon: 'info', width: 560, height: 380, appId: 'settings', content: h('div', { class: 'app-body', style: { padding: '24px' } }, h('div', { style: { textAlign: 'center', marginBottom: '16px' } }, icon('mint-logo', 64)),
    h('div', { class: 'kv', style: { gridTemplateColumns: '170px 1fr' } }, kv.flatMap(([a, b]) => [h('div', { class: 'k' }, a), h('div', null, b)]))) });
}

export function open(env, opts = {}) {
  if (env.os === 'ubuntu') return gnomeSettings(env);
  const body = h('div', { class: 'cs-body' });
  const launch = ([n, ic, app]) => {
    if (app === 'sysinfo') return sysInfo(env);
    if (app === 'lock') return env.ui.alert({ title: 'Screensaver', heading: 'Lock settings', message: 'Lock the computer when the screen saver is active: on.\nDelay before starting the screensaver: 15 minutes.\n(Use the menu → Lock Screen to try the lock screen.)', icon: 'lock' });
    if (app) return env.openApp(app);
    return env.openApp('generic', { title: n, icon: ic });
  };
  const draw = (q = '') => {
    clear(body);
    for (const [sec, mods] of SECTIONS) {
      const m = mods.filter(([n]) => n.toLowerCase().includes(q.toLowerCase()));
      if (!m.length) continue;
      body.append(h('div', { class: 'cs-sec' }, sec), h('div', { class: 'cs-grid' }, m.map((mod) => h('div', { class: 'cs-mod' + (mod[2] ? ' live' : ''), title: mod[2] ? `Open ${mod[0]}` : `${mod[0]} (not part of the simulation)`, onclick: () => launch(mod) }, icon(mod[1], 48), h('div', null, mod[0])))));
    }
  };
  const search = h('input', { class: 'in cs-search', placeholder: 'Search', title: 'Search settings modules', oninput: () => draw(search.value) });
  draw();
  setTimeout(() => search.focus(), 30);
  void opts;
  return env.wm.open({ title: 'System Settings', icon: 'gear', width: 820, height: 600, appId: 'settings', content: h('div', { class: 'cs' }, h('div', { class: 'cs-top' }, search), body) });
}
