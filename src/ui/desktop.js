// Cinnamon-style desktop: wallpaper icons, bottom panel, menu, tray popups.
import { h, clear, parseDesktop } from './dom.js';
import { icon, fileIconName } from './icons.js';
import { runExec } from '../apps/launch.js';
import { trashPath } from '../apps/files-util.js';
import * as users from '../core/users.js';

const MENU_CATS = [
  ['All Applications', 'app', () => true],
  ['Accessories', 'text', (c) => /Utility|Accessories/.test(c)],
  ['Graphics', 'image', (c) => /Graphics/.test(c)],
  ['Internet', 'firefox', (c) => /Network/.test(c)],
  ['Office', 'file', (c) => /Office/.test(c)],
  ['Sound and video', 'music', (c) => /AudioVideo/.test(c)],
  ['Administration', 'gear', (c) => /System/.test(c) && !/Settings/.test(c)],
  ['Preferences', 'gear', (c) => /Settings/.test(c)],
];

const pad2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class Desktop {
  constructor(env) {
    this.env = env;
    this.screen = document.getElementById('screen');
    this.desk = document.getElementById('desktop');
    this.iconsEl = document.getElementById('icons');
    this.panel = document.getElementById('panel');
    this.menuEl = document.getElementById('menu');
    this.selected = null;
    this.build();
    env.wm.onChange(() => this.renderTasks());
    this.desk.addEventListener('mousedown', (e) => { if (e.target === this.desk || e.target === this.iconsEl) { this.select(null); this.closeMenu(); this.closePopup(); } });
    this.desk.addEventListener('contextmenu', (e) => { e.preventDefault(); this.deskMenu(e); });
    document.addEventListener('mousedown', (e) => { if (!this.menuEl.contains(e.target) && !this.menuBtn.contains(e.target)) this.closeMenu(); if (this.popup && !this.popup.contains(e.target) && !e.target.closest('.ti')) this.closePopup(); }, true);
    env.sys.on('change', (kind) => { if (kind === 'fs' || kind === 'users' || kind === 'packages') { clearTimeout(this._t); this._t = setTimeout(() => { this.renderIcons(); this.menuDirty = true; }, 300); } });
    setInterval(() => this.tickClock(), 1000);
  }

  // ---------------------------------------------------------------- panel
  build() {
    const env = this.env;
    this.menuBtn = h('div', { id: 'menu-btn', onclick: () => this.toggleMenu() }, h('div', { class: 'logo', html: '<svg viewBox="0 0 24 24"><path d="M5 18V8c0-1 .6-1.700 1.600-1.700.7 0 1.200.4 1.600 1L12 12.500l3.800-5.200c.4-.6.900-1 1.600-1C18.400 6.300 19 7 19 8v10" fill="none" stroke="#fff" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
    const lb = (ic, title, fn) => h('div', { class: 'lb', title, onclick: fn }, icon(ic, 24));
    const launchers = h('div', { id: 'launchers' },
      lb('firefox', 'Firefox Web Browser', () => env.openApp('firefox')),
      lb('terminal', 'Terminal', () => env.openApp('terminal')),
      lb('folder', 'Files', () => env.openApp('nemo')));
    this.tasksEl = h('div', { id: 'tasks' });
    this.trayEl = h('div', { id: 'tray' });
    const ti = (ic, title, fn) => h('div', { class: 'ti', title, onclick: (e) => fn(e) }, icon(ic, 20));
    this.scoreTi = ti('score', 'Simulator menu', (e) => this.simPopup(e));
    this.trayEl.append(this.scoreTi, ti('net', 'Network: Wired connection 1 (connected)', (e) => this.netPopup(e)), ti('volume', 'Volume', () => { env.ui.soundOn = !env.ui.soundOn; env.ui.toast({ title: env.ui.soundOn ? 'Sound on' : 'Sound off', message: 'Score notification sounds', kind: 'info', ms: 1800 }); }));
    this.clockEl = h('div', { id: 'clock', onclick: (e) => this.clockPopup(e) });
    this.panel.append(this.menuBtn, launchers, this.tasksEl, this.trayEl, this.clockEl, h('div', { id: 'showdesk', title: 'Show desktop', onclick: () => env.wm.showDesktop() }));
    this.tickClock();
    this.renderIcons();
  }
  tickClock() {
    const d = new Date(this.env.sys.now());
    this.clockEl.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    this.clockEl.title = `${DAYS[d.getDay()]}, ${MONS[d.getMonth()]} ${d.getDate()}`;
  }
  renderTasks() {
    const wm = this.env.wm;
    clear(this.tasksEl);
    for (const w of wm.wins) {
      this.tasksEl.append(h('div', { class: 'task' + (wm.active === w && !w.minimized ? ' active' : '') + (w.minimized ? ' min' : ''), title: w.title, onclick: () => { if (w.minimized) w.restore(); else if (wm.active === w) w.minimize(); else w.focus(); } }, icon(w.iconName, 18), h('span', { class: 't' }, w.title)));
    }
  }

  // ---------------------------------------------------------------- popups
  closePopup() { if (this.popup) { this.popup.remove(); this.popup = null; } }
  showPopup(e, content, right = 8) {
    this.closePopup();
    const p = h('div', { class: 'popup', style: { right: right + 'px' } }, content);
    this.screen.append(p);
    this.popup = p;
  }
  netPopup() {
    const f = (a, b) => h('div', { class: 'row' }, h('span', null, a), h('span', { style: { color: '#9fb08a' } }, b));
    this.showPopup(null, [h('h4', null, 'Network'), f('Wired connection 1', 'Connected'), f('IP address', '10.0.2.15'), f('Gateway', '10.0.2.2'), f('DNS', '127.0.0.53')], 60);
  }
  clockPopup() {
    const d = new Date(this.env.sys.now());
    this.showPopup(null, [h('h4', null, d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })), h('div', { style: { fontSize: '28px', padding: '4px 0 6px' } }, `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`)], 0);
  }
  simPopup() {
    const env = this.env;
    const eng = env.engine;
    const row = (label, ctl) => h('div', { class: 'row' }, h('span', null, label), ctl);
    const sel = h('select', { class: 'in', style: { minHeight: '22px', padding: '1px 4px' }, onchange: () => { eng.setMode(sel.value); env.settings.mode = sel.value; env.saveSettings(); } },
      h('option', { value: 'instant', selected: eng.mode === 'instant' }, 'Instant (~1 s)'), h('option', { value: 'realistic', selected: eng.mode === 'realistic' }, 'Realistic (60 s)'));
    const snd = h('input', { type: 'checkbox', checked: env.ui.soundOn, onchange: () => { env.ui.soundOn = snd.checked; env.settings.sound = snd.checked; env.saveSettings(); } });
    this.showPopup(null, [h('h4', null, 'CyberPatriot Simulator'),
      row('Scoring updates', sel), row('Sounds', snd),
      row('Hint', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.hint(); } }, 'Show hint')),
      row('Score report', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.openApp(env.browser || 'chromium', { args: ['file:///opt/CyberPatriot/ScoringReport.html'] }); } }, 'Open')),
      row('Image', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.switchOs(); } }, 'Switch OS…')),
      row('Start over', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.reset(); } }, 'Reset image…')),
      h('div', { style: { fontSize: '11px', color: '#9aa0a4', marginTop: '6px' } }, 'Practice tool — not the real scoring engine.')], 104);
  }

  // ---------------------------------------------------------------- start menu
  toggleMenu() { if (this.menuEl.classList.contains('open')) this.closeMenu(); else this.openMenu(); }
  closeMenu() { this.menuEl.classList.remove('open'); this.menuBtn.classList.remove('open'); }
  loadApps() {
    const sys = this.env.sys; const out = [];
    const dir = '/usr/share/applications';
    if (!sys.vfs.isDir(dir)) return out;
    for (const n of sys.vfs.readdir(dir)) {
      if (!n.endsWith('.desktop')) continue;
      const d = parseDesktop(sys.vfs.readFile(`${dir}/${n}`));
      if (!d.Name || d.NoDisplay === 'true') continue;
      out.push({ file: n, name: d.Name, comment: d.Comment || '', exec: d.Exec || '', icon: d.Icon || n.replace('.desktop', ''), cats: d.Categories || '' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  openMenu() {
    this.closePopup();
    if (!this.menuBuilt || this.menuDirty) { this.buildMenu(); this.menuDirty = false; }
    this.menuEl.classList.add('open'); this.menuBtn.classList.add('open');
    this.search.value = ''; this.catIdx = 0; this.renderCats(); this.renderApps();
    setTimeout(() => this.search.focus(), 0);
  }
  buildMenu() {
    const env = this.env;
    this.menuBuilt = true;
    clear(this.menuEl);
    this.search = h('input', { placeholder: 'Search applications…', oninput: () => this.renderApps(), onkeydown: (e) => {
      if (e.key === 'Enter') { const first = this.appsEl.querySelector('.app'); first?.click(); }
      if (e.key === 'Escape') this.closeMenu();
    } });
    const fav = (ic, title, fn) => h('div', { class: 'fb', title, onclick: () => { this.closeMenu(); fn(); } }, icon(ic, 28));
    const favs = h('div', { class: 'fav' },
      fav('firefox', 'Firefox Web Browser', () => env.openApp('firefox')), fav('bag', 'Software Manager', () => env.openApp('software')), fav('gear', 'System Settings', () => env.openApp('settings')),
      fav('terminal', 'Terminal', () => env.openApp('terminal')), fav('folder', 'Files', () => env.openApp('nemo')),
      h('div', { style: { flex: 1 } }), fav('lock', 'Lock Screen', () => env.lock()), fav('logout', 'Log Out', () => env.logout()), fav('power', 'Quit', () => env.power('poweroff')));
    this.catsEl = h('div', { class: 'cats' });
    this.appsEl = h('div', { class: 'apps' });
    this.menuEl.append(h('div', { class: 'body' }, favs, h('div', { class: 'right' }, h('div', { class: 'search' }, this.search), h('div', { class: 'cols' }, this.catsEl, this.appsEl))));
  }
  renderCats() {
    clear(this.catsEl);
    MENU_CATS.forEach(([name, ic], i) => this.catsEl.append(h('div', { class: 'cat' + (i === this.catIdx ? ' sel' : ''), onmouseenter: () => { if (!this.search.value) { this.catIdx = i; this.renderCats(); this.renderApps(); } } }, icon(ic, 20), name)));
  }
  renderApps() {
    clear(this.appsEl);
    const q = this.search.value.trim().toLowerCase();
    const apps = this.loadApps();
    const filt = q ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q)) : apps.filter((a) => MENU_CATS[this.catIdx][2](a.cats));
    if (!filt.length) { this.appsEl.append(h('div', { class: 'empty' }, q ? 'No matching applications' : 'Empty category')); return; }
    for (const a of filt) {
      this.appsEl.append(h('div', { class: 'app', onclick: () => { this.closeMenu(); runExec(this.env, a.exec); }, oncontextmenu: (e) => { e.preventDefault(); this.env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Add to desktop', action: () => this.addToDesktop(a) }]); } },
        icon(a.icon, 32), h('div', null, h('div', { class: 'nm' }, a.name), h('div', { class: 'cm' }, a.comment))));
    }
  }
  addToDesktop(a) {
    const sys = this.env.sys; const home = users.getUser(sys, this.env.user).home;
    const u = users.getUser(sys, this.env.user);
    sys.vfs.writeFile(`${home}/Desktop/${a.file}`, sys.vfs.readFile(`/usr/share/applications/${a.file}`), { uid: u.uid, gid: u.gid, mode: 0o755 });
  }

  // ---------------------------------------------------------------- desktop icons
  select(el) {
    for (const i of this.iconsEl.children) i.classList.remove('sel');
    this.selected = el; el?.classList.add('sel');
  }
  desktopDir() { const u = users.getUser(this.env.sys, this.env.user); return u ? `${u.home}/Desktop` : '/'; }
  renderIcons() {
    const env = this.env; const sys = env.sys;
    clear(this.iconsEl);
    const mk = (name, ic, open, extra) => {
      const el = h('div', { class: 'dicon', onmousedown: (e) => { e.stopPropagation(); this.select(el); }, ondblclick: open, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.select(el); env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Open', action: open }, ...(extra || [])]); } }, icon(ic, 48), h('span', { class: 'lbl' }, name));
      this.iconsEl.append(el);
    };
    const u = users.getUser(sys, env.user);
    if (env.os !== 'ubuntu') mk('Computer', 'computer', () => env.openApp('nemo', { path: '/' }));
    mk('Home', 'home', () => env.openApp('nemo', { path: u.home }));
    const dir = this.desktopDir();
    let names = [];
    try { names = sys.vfs.readdir(dir).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b)); } catch { names = []; }
    for (const n of names) {
      const path = `${dir}/${n}`;
      let isDir = false; try { isDir = sys.vfs.isDir(path); } catch { /* ignore */ }
      if (n.endsWith('.desktop')) {
        const d = parseDesktop(sys.vfs.readFile(path));
        mk(d.Name || n.replace(/\.desktop$/, ''), d.Icon || 'app', () => runExec(env, d.Exec || '', { cwd: dir }), [{ label: 'Move to Trash', action: () => this.trash(path) }]);
      } else {
        mk(n, fileIconName(n, isDir), () => env.openPath(path), [{ label: 'Move to Trash', action: () => this.trash(path) }]);
      }
    }
  }
  trash(path) {
    try { trashPath(this.env.sys, users.credFor(this.env.sys, this.env.user), this.env.user, path); } catch (e) { this.env.ui.alert({ title: 'Error', heading: 'Could not move to trash', message: e.text || e.message, icon: 'error' }); }
    this.renderIcons();
  }
  deskMenu(e) {
    const env = this.env;
    env.ui.showMenu(e.clientX, e.clientY, [
      { label: 'New Folder', action: async () => { const n = await env.ui.prompt({ title: 'New Folder', message: 'Folder name:', value: 'Untitled Folder' }); if (n) { try { env.userFs().mkdir(`${this.desktopDir()}/${n}`); } catch (er) { env.ui.alert({ title: 'Error', message: er.text || er.message, icon: 'error' }); } this.renderIcons(); } } },
      { label: 'Open Terminal Here', action: () => env.openApp('terminal', { cwd: this.desktopDir() }) },
      'sep', { label: 'Refresh Desktop', action: () => this.renderIcons() }, { label: 'Change Desktop Background…', action: () => env.openApp('settings') },
    ]);
  }
}
