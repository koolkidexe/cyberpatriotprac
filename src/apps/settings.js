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

// GNOME 42 Settings (Ubuntu 22.04): libadwaita header bar split over a sidebar of panels and a page of boxed lists.
const SYM = {
  network: '<path d="M2 6a9 9 0 0 1 12 0M4.3 8.5a5.6 5.6 0 0 1 7.4 0M6.6 11a2.2 2.2 0 0 1 2.8 0"/>', bluetooth: '<path d="M4.5 5l7 6L8 14V2l3.5 3-7 6"/>',
  background: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 11l4-4 3 3 2-2 4 4"/>', appearance: '<circle cx="8" cy="8" r="6"/><path d="M8 2v12A6 6 0 0 0 8 2z" fill="currentColor"/>',
  notifications: '<path d="M4 11V7a4 4 0 0 1 8 0v4l1.3 1.5H2.7zM6.5 14h3"/>', search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3L14 14"/>', multitasking: '<rect x="1.5" y="3" width="8" height="7" rx="1"/><rect x="6.5" y="6" width="8" height="7" rx="1"/>',
  applications: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  privacy: '<rect x="3.5" y="7" width="9" height="7" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>', online: '<circle cx="5" cy="8" r="2.5"/><circle cx="11.5" cy="4.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M7.2 7l2.5-1.5M7.2 9l2.5 1.5"/>',
  sharing: '<circle cx="11.5" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="11.5" cy="12.5" r="2"/><path d="M5.8 7l4-2.5M5.8 9l4 2.5"/>', sound: '<path d="M2 6h3l4-3v10l-4-3H2zM11.5 5.5a3.5 3.5 0 0 1 0 5"/>',
  power: '<path d="M8 1.5v6M4.5 3.8a5.5 5.5 0 1 0 7 0"/>', displays: '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M5.5 14h5M8 11v3"/>', mouse: '<rect x="4" y="1.5" width="8" height="13" rx="4"/><path d="M8 1.5v5"/>',
  keyboard: '<rect x="1" y="4" width="14" height="8" rx="1.5"/><path d="M4 9.5h8M3.5 6.5h1M6 6.5h1M8.5 6.5h1M11 6.5h1"/>', printers: '<path d="M4 6V2h8v4M4 12H2.5V6.5h11V12H12M4 10h8v4H4z"/>',
  removable: '<rect x="3" y="5" width="10" height="9" rx="1.5"/><path d="M5.5 5V2h5v3"/>', color: '<circle cx="8" cy="5.5" r="3.5"/><circle cx="5.5" cy="10" r="3.5"/><circle cx="10.5" cy="10" r="3.5"/>',
  region: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>', accessibility: '<circle cx="8" cy="3" r="1.4"/><path d="M3 5.5l5 1 5-1M8 6.5V10l-2.5 4.5M8 10l2.5 4.5"/>',
  users: '<circle cx="8" cy="5.5" r="3"/><path d="M2.5 14.5c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/>', defaults: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  datetime: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>', about: '<circle cx="8" cy="8" r="6"/><path d="M8 7v4.5M8 4.6v.1"/>',
};
const sym = (k) => h('span', { class: 'gs-sym', html: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${SYM[k] || SYM.about}</svg>` });

function gnomeSettings(env, opts = {}) {
  const sys = env.sys;
  const osName = () => (sys.vfs.readFile('/etc/os-release').match(/PRETTY_NAME="(.*)"/) || [])[1] || 'Ubuntu 22.04.3 LTS';
  const page = h('div', { class: 'gs-page' });
  const side = h('div', { class: 'gs-side' });
  const pageTitle = h('div', { class: 'gs-ht' });
  // boxed-list helpers
  const group = (title, ...rows) => h('div', { class: 'gs-group' }, title ? h('div', { class: 'gs-gt' }, title) : null, h('div', { class: 'gs-box' }, ...rows.filter(Boolean)));
  const row = (label, right, sub, onclick) => h('div', { class: 'gs-row' + (onclick ? ' act' : ''), onclick }, h('div', { class: 'gs-rl' }, h('div', null, label), sub ? h('div', { class: 'gs-sub' }, sub) : null), right ?? null);
  const sw = (on, onchange, disabled) => { const c = h('input', { type: 'checkbox', class: 'gs-sw', checked: !!on, disabled: !!disabled, onchange: (e) => onchange?.(e.target.checked) }); return c; };
  const dim = (t) => h('span', { class: 'gs-dim' }, t);
  const chev = () => h('span', { class: 'gs-dim' }, '›');
  const local = (k, d) => (env.settings.gnome?.[k] ?? d);
  const setLocal = (k, v) => { env.settings.gnome = { ...(env.settings.gnome || {}), [k]: v }; env.saveSettings(); };
  const tog = (k, d) => sw(local(k, d), (v) => setLocal(k, v));
  let embed = null;

  const P = {
    Network: () => [group('Wired', row('Connected - 1000 Mb/s', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, sw(true), h('button', { class: 'gs-ib', title: 'Wired settings' }, '⚙')))),
      group('VPN', row('Not set up', h('button', { class: 'gs-ib', title: 'Add a VPN' }, '+'))), group(null, row('Network Proxy', dim('Off'), null, () => {}))],
    Bluetooth: () => [h('div', { class: 'gs-empty' }, sym('bluetooth'), h('h2', null, 'No Bluetooth Found'), h('p', null, 'Plug in a dongle to use Bluetooth.'))],
    Background: () => [h('div', { class: 'gs-bgprev' }, h('div', { class: 'gs-bg a' }), h('div', { class: 'gs-bg b' })), group(null, row('Add Picture…', chev()))],
    Appearance: () => {
      const t = env.theme();
      const set = (patch) => { env.setTheme(patch); draw(); };
      const style = (id, label) => h('div', { class: 'opt' + (t.style === id ? ' on' : ''), onclick: () => set({ style: id }) }, h('div', { class: 'prev ' + id }, h('i'), h('b')), h('div', null, label));
      const dots = h('div', { class: 'accent-dots' }, Object.entries(ACCENTS).map(([id, [c]]) => h('div', { class: 'dot' + (t.accent === id ? ' on' : ''), title: id[0].toUpperCase() + id.slice(1), style: { background: c }, onclick: () => set({ accent: id }) }, t.accent === id ? '✓' : '')));
      const pos = h('select', { class: 'gs-sel', onchange: (e) => set({ dock: e.target.value }) }, ['left', 'bottom', 'right'].map((d) => h('option', { value: d, selected: t.dock === d }, d[0].toUpperCase() + d.slice(1))));
      return [group('Style', h('div', { class: 'gs-pad' }, h('div', { class: 'style-pick' }, style('light', 'Light'), style('dark', 'Dark')), h('div', { class: 'gs-gt', style: { margin: '14px 0 6px' } }, 'Color'), dots)),
        group('Desktop Icons', row('Size', dim('Normal')), row('Position of New Icons', dim('Top Right')), row('Show Personal folder', tog('homeIcon', true))),
        group('Dock', row('Auto-hide the Dock', tog('dockAutohide', false), 'The dock hides when any windows overlap with it.'), row('Panel mode', tog('dockPanel', false), 'The dock extends to the screen edge.'), row('Icon size', dim('48')), row('Position on screen', pos))];
    },
    Notifications: () => [group(null, row('Do Not Disturb', tog('dnd', false)), row('Lock Screen Notifications', tog('lockNotif', true))), group('Applications', ...['Firefox', 'Files', 'Software', 'Software Updater', 'Terminal'].map((a) => row(a, dim('On'))))],
    Search: () => [group(null, row('Search', sw(true), 'Searching with the Activities overview')), group('Search Locations', row('Files', sw(true)), row('Settings', sw(true)), row('Software', sw(true)), row('Terminal', sw(true)))],
    Multitasking: () => [group('General', row('Hot Corner', tog('hotCorner', false), 'Touch the top-left corner to open the Activities Overview.'), row('Active Screen Edges', tog('edges', true))), group('Workspaces', row('Dynamic workspaces', sw(true)), row('Fixed number of workspaces', sw(false)))],
    Applications: () => [group(null, ...['Firefox Web Browser', 'Files', 'Terminal', 'Text Editor', 'Thunderbird Mail', env.osId === 'debian' ? 'Software' : 'Ubuntu Software'].map((a) => row(a, chev(), null, () => {})))],
    Privacy: () => [group(null, row('Connectivity', chev(), 'Connectivity checking'), row('Location Services', chev(), 'Off'), row('File History & Trash', chev()), row('Screen', chev(), 'Screen lock'), row('Diagnostics', chev(), 'Problem reporting')),
      group('Screen', row('Blank Screen Delay', dim('5 minutes')), row('Automatic Screen Lock', tog('autoLock', true)), row('Automatic Screen Lock Delay', dim('Screen Turns Off')), row('Lock Screen on Suspend', tog('lockSuspend', true)), row('Show Notifications on Lock Screen', tog('lockNotif', true)))],
    'Online Accounts': () => [group('Connect an Account', ...['Ubuntu Single Sign-On', 'Google', 'Nextcloud', 'Microsoft', 'Microsoft Exchange', 'Fedora', 'IMAP and SMTP', 'Enterprise Login (Kerberos)'].map((a) => row(a, null, null, () => env.ui.alert({ title: 'Online Accounts', heading: 'No network', message: 'This practice computer is not connected to the internet.', icon: 'info' }))))],
    Sharing: () => [group(null, row('Device Name', dim(sys.hostname))), group(null, row('Remote Desktop', dim('Off')), row('Media Sharing', dim('Off'))), h('p', { class: 'gs-note' }, 'Sharing is off. Turn services on here only when the README says they are needed.')],
    Sound: () => [group('Output', row('Output Device', dim('Speakers - Built-in Audio')), row('Volume', h('input', { type: 'range', value: 64 }))), group('Input', row('Input Device', dim('Microphone - Built-in Audio')))],
    Power: () => [group('Power Mode', row('Balanced', h('input', { type: 'radio', name: 'pm', checked: true }), 'Standard performance and power usage.'), row('Power Saver', h('input', { type: 'radio', name: 'pm' }), 'Reduced performance and power usage.')), group('Power Saving Options', row('Screen Blank', dim('5 minutes')), row('Automatic Suspend', dim('Off')))],
    Displays: () => [group(null, row('Orientation', dim('Landscape')), row('Resolution', dim('1440 × 900 (16∶10)')), row('Refresh Rate', dim('60.00 Hz')), row('Fractional Scaling', sw(false)))],
    'Mouse & Touchpad': () => [group('General', row('Primary Button', dim('Left'))), group('Mouse', row('Mouse Speed', h('input', { type: 'range' })), row('Natural Scrolling', sw(false)))],
    Keyboard: () => [group('Input Sources', row('English (US)', dim('⋮'))), group('Special Character Entry', row('Alternate Characters Key', dim('Layout default')), row('Compose Key', dim('Off'))), group(null, row('View and Customize Shortcuts', chev(), null, () => env.ui.alert({ title: 'Keyboard Shortcuts', heading: 'A few useful shortcuts', message: 'Ctrl+Alt+T  Open Terminal\nSuper  Activities overview\nSuper+A  Show Applications\nAlt+F4  Close window', icon: 'info' })))],
    Printers: () => { env.openApp('printers'); return [h('div', { class: 'gs-empty' }, sym('printers'), h('h2', null, 'Printers'), h('p', null, 'The printer list opened in its own window.'))]; },
    'Removable Media': () => [group(null, row('CD audio', dim('Ask what to do')), row('DVD video', dim('Ask what to do')), row('Music player', dim('Ask what to do')), row('Photos', dim('Ask what to do')), row('Software', dim('Run Software'))), group(null, row('Never prompt or start programs on media insertion', tog('noAutorun', false)))],
    Color: () => [group(null, row('Built-in display', dim('Default')))],
    'Region & Language': () => [group(null, row('Language', dim('English (United States)')), row('Formats', dim('United States'))), group(null, row('Manage Installed Languages', chev()))],
    Accessibility: () => [group('Seeing', row('High Contrast', sw(false)), row('Large Text', sw(false)), row('Cursor Size', dim('Default'))), group('Typing', row('Screen Keyboard', sw(false)))],
    Users: () => {
      embed = { content: null };
      import('./users-app.js').then((m) => { if (sel !== 'Users') return; m.open(env, { embed }); clear(page); page.append(h('div', { class: 'gs-users' }, embed.content)); });
      return [h('div', { class: 'gs-empty' }, 'Loading…')];
    },
    'Default Applications': () => [group(null, row('Web', dim('Firefox Web Browser')), row('Mail', dim('Thunderbird Mail')), row('Calendar', dim('Calendar')), row('Music', dim('Rhythmbox')), row('Video', dim('Videos')), row('Photos', dim('Image Viewer')))],
    'Date & Time': () => [group(null, row('Automatic Date & Time', tog('autoTime', true), 'Requires internet access'), row('Automatic Time Zone', tog('autoTz', false)), row('Date & Time', dim(new Date(sys.now()).toLocaleString('en-US', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))), row('Time Zone', dim('UTC (UTC, +0000)'))), group(null, row('Time Format', dim('24-hour')))],
    About: () => [h('div', { class: 'gs-about-logo' }, env.osId === 'debian' ? 'debian' : 'ubuntu'),
      group(null, row('Device Name', dim(sys.hostname)), row('Hardware Model', dim('innotek GmbH VirtualBox')), row('Memory', dim('3.8 GiB')), row('Processor', dim('Intel® Core™ i5-8250U × 2')), row('Graphics', dim('SVGA3D; build: RELEASE; LLVM;')), row('Disk Capacity', dim('52.4 GB'))),
      group(null, row('OS Name', dim(osName())), row('OS Type', dim('64-bit')), row('GNOME Version', dim(env.osId === 'debian' ? '43.9' : '42.9')), row('Windowing System', dim('X11')), row('Software Updates', chev(), null, () => env.openApp('update')))],
  };
  const LIST = [['Network', 'network'], ['Bluetooth', 'bluetooth'], ['Background', 'background'], ['Appearance', 'appearance'], ['Notifications', 'notifications'], ['Search', 'search'], ['Multitasking', 'multitasking'], ['Applications', 'applications', true],
    ['Privacy', 'privacy', true], ['Online Accounts', 'online'], ['Sharing', 'sharing'], ['Sound', 'sound'], ['Power', 'power'], ['Displays', 'displays'], ['Mouse & Touchpad', 'mouse'], ['Keyboard', 'keyboard'], ['Printers', 'printers'], ['Removable Media', 'removable'], ['Color', 'color'], ['Region & Language', 'region'], ['Accessibility', 'accessibility'],
    ['Users', 'users'], ['Default Applications', 'defaults'], ['Date & Time', 'datetime'], ['About', 'about']];
  let sel = LIST.some(([n]) => n === opts.panel) ? opts.panel : opts.panel === 'Wi-Fi' ? 'Network' : 'Appearance';
  const q = h('input', { class: 'gs-search', placeholder: 'Search', style: { display: 'none' }, oninput: () => drawSide() });
  const drawSide = () => {
    clear(side);
    const f = q.value.trim().toLowerCase();
    for (const [n, k, more] of LIST) {
      if (f && !n.toLowerCase().includes(f)) continue;
      side.append(h('div', { class: 'gs-si' + (n === sel ? ' on' : ''), title: n, onclick: () => { sel = n; draw(); } }, sym(k), h('span', { style: { flex: 1 } }, n), more ? h('span', { class: 'gs-dim' }, '›') : null));
      if (['Applications', 'Sound', 'Removable Media', 'Accessibility', 'Users'].includes(n) && !f) side.append(h('div', { class: 'gs-sep' }));
    }
  };
  const draw = () => {
    if (embed?.win) { embed.win.closed = true; embed.onClose?.(); embed = null; }
    drawSide(); clear(page);
    pageTitle.textContent = sel;
    page.append(h('div', { class: 'gs-clamp' }, ...P[sel]()));
  };
  const header = h('div', { class: 'gs-hb' },
    h('div', { class: 'gs-hl' }, h('button', { class: 'gs-ib', title: 'Search', onclick: () => { q.style.display = q.style.display === 'none' ? '' : 'none'; if (q.style.display === '') q.focus(); else { q.value = ''; drawSide(); } } }, sym('search')), h('div', { class: 'gs-ht' }, 'Settings'), h('button', { class: 'gs-ib', title: 'Main menu' }, '☰')),
    h('div', { class: 'gs-hr' }, pageTitle));
  const root = h('div', { class: 'gs' }, header, h('div', { class: 'gs-body' }, h('div', { class: 'gs-left' }, q, side), page));
  draw();
  const win = env.wm.open({ title: 'Settings', icon: 'gear', width: 940, height: 620, appId: 'settings', content: root, cls: 'gs-win', frameless: true });
  win.makeDraggable(header);
  header.querySelector('.gs-hr').append(win.controls());
  win.onClose(() => { if (embed?.win) { embed.win.closed = true; embed.onClose?.(); } });
  return win;
}

function sysInfo(env) {
  const sys = env.sys;
  const os = (sys.vfs.readFile('/etc/os-release').match(/PRETTY_NAME="(.*)"/) || [])[1] || 'Linux Mint';
  const kv = [['Operating System', `${os} Cinnamon 64-bit`], ['Cinnamon Version', '6.0.4'], ['Linux Kernel', (sys.vfs.isFile('/proc/version') ? sys.vfs.readFile('/proc/version').split(' ')[2] : '5.15.0-91-generic')], ['Processor', 'Intel© Core™ i5-8250U CPU @ 1.60GHz × 2'], ['Memory', '3.8 GiB'], ['Hard Drives', '32.2 GB'], ['Graphics Card', 'VMware SVGA II Adapter']];
  return env.wm.open({ title: 'System Info', icon: 'info', width: 560, height: 380, appId: 'settings', content: h('div', { class: 'app-body', style: { padding: '24px' } }, h('div', { style: { textAlign: 'center', marginBottom: '16px' } }, icon('mint-logo', 64)),
    h('div', { class: 'kv', style: { gridTemplateColumns: '170px 1fr' } }, kv.flatMap(([a, b]) => [h('div', { class: 'k' }, a), h('div', null, b)]))) });
}

export function open(env, opts = {}) {
  if (env.os === 'ubuntu') return gnomeSettings(env, opts);
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
