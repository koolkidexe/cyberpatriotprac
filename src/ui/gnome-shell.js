// GNOME Shell (Ubuntu 22.04) desktop: top bar, left dock, Activities app grid.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { Desktop } from './desktop.js';
import { runExec } from '../apps/launch.js';
import { ensureTrash } from '../apps/files-util.js';
import * as users from '../core/users.js';

/** Yaru accent colours: [accent, darker hover shade]. */
export const ACCENTS = {
  orange: ['#e95420', '#c34113'], bark: ['#787859', '#5f5f46'], sage: ['#657b69', '#506253'], olive: ['#4b8501', '#3b6a01'], viridian: ['#03875b', '#02694a'],
  prussian: ['#308280', '#266867'], blue: ['#0073e5', '#005cb8'], purple: ['#7764d8', '#5d4cb5'], magenta: ['#b34cb3', '#8f3c8f'], red: ['#da3450', '#b4283f'],
};
export const DEFAULT_THEME = { style: 'dark', accent: 'red', dock: 'bottom' };
const APPNAME = {
  nemo: 'Files', props: 'Files', terminal: 'Terminal', firefox: 'Firefox Web Browser', chromium: 'Chromium Web Browser', xed: 'Text Editor', users: 'Settings', settings: 'Settings',
  gufw: 'Firewall Configuration', update: 'Software Updater', software: 'Ubuntu Software', swprops: 'Software & Updates', monitor: 'System Monitor', startup: 'Startup Applications', printers: 'Settings',
};

const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n) => String(n).padStart(2, '0');

// dock favourites: [icon, title, app id | exec]
const FAVS = [
  ['firefox', 'Firefox Web Browser', { app: 'firefox' }],
  ['mail', 'Thunderbird Mail', { exec: 'thunderbird' }],
  ['folder', 'Files', { app: 'nemo' }],
  ['music', 'Rhythmbox', { exec: 'rhythmbox' }],
  ['file', 'LibreOffice Writer', { exec: 'libreoffice' }],
  ['bag', 'Ubuntu Software', { app: 'software' }],
  ['terminal', 'Terminal', { app: 'terminal' }],
];

export class UbuntuDesktop extends Desktop {
  // ---------------------------------------------------------------- top bar + dock
  build() {
    const env = this.env;
    this.menuBtn = h('div', { id: 'menu-btn', onclick: () => this.toggleMenu() }, 'Activities');
    this.appNameEl = h('div', { id: 'appname' });
    this.clockEl = h('div', { id: 'clock', onclick: (e) => this.clockPopup(e) });
    this.trayEl = h('div', { id: 'tray' });
    const ti = (ic, title, fn) => h('div', { class: 'ti', title, onclick: (e) => fn(e) }, icon(ic, 16));
    this.scoreTi = ti('score', 'Simulator menu', (e) => this.simPopup(e));
    this.sysTi = h('div', { class: 'ti sys', title: 'System menu', onclick: () => this.sysPopup() }, icon('net', 16), icon('volume', 16), icon('power', 16));
    this.trayEl.append(this.scoreTi, this.sysTi);
    this.panel.append(this.menuBtn, this.appNameEl, this.clockEl, this.trayEl);
    this.dockEl = h('div', { id: 'dock' });
    this.screen.append(this.dockEl);
    this.tasksEl = h('div', { id: 'tasks' });
    // Settings → Appearance drives these (stored with the other simulator settings)
    env.theme = () => ({ ...DEFAULT_THEME, ...(env.settings.ubuntuTheme || {}) });
    env.setTheme = (patch) => { env.settings.ubuntuTheme = { ...env.theme(), ...patch }; env.saveSettings(); this.applyTheme(); };
    this.applyTheme();
    this.tickClock();
    this.renderIcons();
    this.renderTasks();
    void env;
  }
  applyTheme() {
    const t = this.env.theme();
    const a = ACCENTS[t.accent] || ACCENTS.orange;
    const b = document.body;
    b.style.setProperty('--accent', a[0]);
    b.style.setProperty('--accent-dark', a[1]);
    b.classList.toggle('ub-dark', t.style === 'dark');
    for (const d of ['left', 'bottom', 'right']) b.classList.toggle(`dock-${d}`, t.dock === d);
  }
  updateAppName() {
    const w = this.env.wm.active;
    const ok = w && !w.closed && !w.minimized;
    this.appNameEl.textContent = ok ? `${APPNAME[w.appId] || w.title}  ▾` : '';
  }
  tickClock() {
    const d = new Date(this.env.sys.now());
    this.clockEl.textContent = `${MONS[d.getMonth()]} ${d.getDate()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  renderTasks() {
    const env = this.env; const wm = env.wm;
    if (!this.dockEl) return;
    this.updateAppName();
    clear(this.dockEl);
    const wins = wm.wins.filter((w) => !w.closed);
    const ofApp = (ids) => wins.filter((w) => ids.includes(w.appId));
    const used = new Set();
    const item = (ic, title, onclick, ws, active) => h('div', { class: 'di' + (active ? ' active' : ''), title, onclick }, icon(ic, 40), ws.length ? h('div', { class: 'dots' }, ...ws.slice(0, 3).map(() => h('i'))) : null);
    for (const [ic, title, how] of FAVS) {
      const appIds = how.app ? (how.app === 'nemo' ? ['nemo', 'props'] : [how.app]) : [];
      const ws = how.app ? ofApp(appIds) : [];
      ws.forEach((w) => used.add(w));
      const act = how.app && ws.some((w) => wm.active === w && !w.minimized);
      this.dockEl.append(item(ic, title, () => {
        if (ws.length) { const w = ws.find((x) => x.minimized) || ws[ws.length - 1]; if (act) w.minimize(); else { if (w.minimized) w.restore(); else w.focus(); } } else if (how.app) env.openApp(how.app); else runExec(env, how.exec);
      }, ws, act));
    }
    const others = wins.filter((w) => !used.has(w));
    if (others.length) this.dockEl.append(h('div', { class: 'dsep' }));
    for (const w of others) this.dockEl.append(item(w.iconName, w.title, () => { if (w.minimized) w.restore(); else if (wm.active === w) w.minimize(); else w.focus(); }, [w], wm.active === w && !w.minimized));
    const openTrash = () => {
      try { const u = env.user; const cred = users.credFor(env.sys, u); env.openApp('nemo', { path: ensureTrash(env.sys, cred, u) }); } catch (e) { console.error(e); }
    };
    this.dockEl.append(h('div', { class: 'dsp' }), h('div', { class: 'di trash', title: 'Trash', onclick: openTrash }, icon('trash', 40)),
      h('div', { class: 'di showapps', title: 'Show Applications', onclick: () => this.toggleMenu() }, icon('app', 36)));
  }

  // ---------------------------------------------------------------- popups (drop from the top bar)
  showPopup(e, content, right = 8) {
    this.closePopup();
    const p = h('div', { class: 'popup top', style: right === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : { right: right + 'px' } }, content);
    this.screen.append(p);
    this.popup = p;
  }
  clockPopup() {
    const d = new Date(this.env.sys.now());
    this.showPopup(null, [h('h4', null, d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })), h('div', { style: { fontSize: '28px', padding: '4px 0 6px' } }, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`)], 'center');
  }
  netPopup() { this.sysPopup(); }
  sysPopup() {
    const env = this.env;
    const row = (ic, label, fn) => h('div', { class: 'row clk', onclick: () => { this.closePopup(); fn?.(); } }, h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, icon(ic, 16), label));
    this.showPopup(null, [
      h('div', { class: 'row' }, h('span', null, 'Wired Connected'), h('span', { style: { color: '#9fb08a' } }, '10.0.2.15')),
      h('div', { class: 'row' }, h('span', null, `Volume ${env.ui.soundOn ? 'on' : 'muted'}`), h('button', { class: 'btn', onclick: () => { env.ui.soundOn = !env.ui.soundOn; env.settings.sound = env.ui.soundOn; env.saveSettings(); this.closePopup(); } }, env.ui.soundOn ? 'Mute' : 'Unmute')),
      h('hr'),
      row('gear', 'Settings', () => env.openApp('settings')), row('lock', 'Lock', () => env.lock()), row('logout', 'Log Out…', () => env.logout()),
      row('power', 'Restart…', () => env.power('reboot')), row('power', 'Power Off…', () => env.power('poweroff')),
    ], 8);
  }

  // ---------------------------------------------------------------- Activities: application grid
  closeMenu() { this.menuEl.classList.remove('open'); this.menuBtn.classList.remove('open'); }
  buildMenu() {
    this.menuBuilt = true;
    clear(this.menuEl);
    this.search = h('input', { placeholder: 'Type to search…', oninput: () => this.renderApps(), onkeydown: (e) => {
      if (e.key === 'Enter') this.appsEl.querySelector('.app')?.click();
      if (e.key === 'Escape') this.closeMenu();
    } });
    this.appsEl = h('div', { class: 'grid' });
    this.menuEl.append(h('div', { class: 'search' }, this.search), this.appsEl);
  }
  renderCats() { /* no categories in the GNOME overview */ }
  renderApps() {
    clear(this.appsEl);
    const q = this.search.value.trim().toLowerCase();
    const apps = this.loadApps().filter((a) => !q || a.name.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q));
    if (!apps.length) { this.appsEl.append(h('div', { class: 'empty' }, 'No results')); return; }
    for (const a of apps) {
      this.appsEl.append(h('div', { class: 'app', onclick: () => { this.closeMenu(); runExec(this.env, a.exec); }, oncontextmenu: (e) => { e.preventDefault(); this.env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Add to Desktop', action: () => this.addToDesktop(a) }]); } },
        icon(a.icon, 56), h('div', { class: 'nm' }, a.name)));
    }
  }
}
