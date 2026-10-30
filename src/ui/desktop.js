// Cinnamon-style desktop: wallpaper icons, bottom panel, menu, tray popups.
import { osSwitchContent } from './os-switch.js';
import { h, clear, parseDesktop } from './dom.js';
import { icon, fileIconName } from './icons.js';
import { runExec } from '../apps/launch.js';
import { trashPath } from '../apps/files-util.js';
import * as users from '../core/users.js';

// [name, icon, filter, tooltip]. "Places" and "Recent Files" are special (see renderApps).
const MENU_CATS = [
  ['All Applications', 'cat-all', () => true, 'Show all applications'],
  ['Accessories', 'cat-accessories', (c) => /Utility|Accessories/.test(c), 'Common desktop tools and applications'],
  ['Graphics', 'cat-graphics', (c) => /Graphics/.test(c), 'Graphics applications'],
  ['Internet', 'cat-internet', (c) => /Network/.test(c), 'Programs for Internet access such as web and email'],
  ['Office', 'cat-office', (c) => /Office/.test(c), 'Office applications'],
  ['Sound & Video', 'cat-sound-video', (c) => /AudioVideo/.test(c), 'Multimedia menu'],
  ['Administration', 'cat-admin', (c) => /System/.test(c) && !/Settings/.test(c), 'Change system settings'],
  ['Preferences', 'cat-prefs', (c) => /Settings/.test(c), 'Personal preferences'],
  ['Places', 'cat-places', null, 'Quick access to places on the computer'],
  ['Recent Files', 'cat-recent', null, 'Recently opened files'],
];

// Cinnamon panel glyphs (monochrome, drawn inline so they never depend on the icon theme)
const MINT_LOGO = '<svg viewBox="0 0 32 32" width="30" height="30"><circle cx="16" cy="16" r="13" fill="none" stroke="#fff" stroke-width="3"/><path d="M9.2 21V11.3c0-.8.5-1.4 1.300-1.400.5 0 .9.2 1.200.7L16 17l4.300-6c.3-.5.7-.7 1.200-.7.8 0 1.300.6 1.300 1.400V21" fill="none" stroke="#fff" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SYM = {
  net: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#e8e8e8"><rect x="9" y="3" width="6" height="5"/><rect x="2" y="16" width="6" height="5"/><rect x="16" y="16" width="6" height="5"/><path d="M11 8h2v4h6v4h-2v-2H7v2H5v-4h6z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#e8e8e8"><path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15 8.500c1.800 1.800 1.800 5.200 0 7M17.500 6c3 3 3 9 0 12" fill="none" stroke="#e8e8e8" stroke-width="1.700" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#e8e8e8"><path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15 9l6 6M21 9l-6 6" stroke="#e8e8e8" stroke-width="1.800" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6.500" cy="6.500" r="4.500" fill="none" stroke="#dcdcdc" stroke-width="1.800"/><path d="M10 10l4.500 4.500" stroke="#dcdcdc" stroke-width="2" stroke-linecap="round"/></svg>',
};

const pad2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULLDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULLMONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class Desktop {
  constructor(env) {
    this.env = env;
    this.screen = document.getElementById('screen');
    this.desk = document.getElementById('desktop');
    this.iconsEl = document.getElementById('icons');
    this.panel = document.getElementById('panel');
    this.menuEl = document.getElementById('menu');
    this.selected = null;
    // remember files opened through env.openPath for the menu's "Recent Files"
    if (!env._recentWrapped) {
      env._recentWrapped = true;
      const op = env.openPath.bind(env);
      env.openPath = (path, o) => {
        try { if (!env.sys.vfs.isDir(path) && !/\.desktop$/.test(path)) { env.settings.recent = [path, ...(env.settings.recent || []).filter((x) => x !== path)].slice(0, 10); env.saveSettings(); } } catch { /* ignore */ }
        return op(path, o);
      };
    }
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
    this.menuBtn = h('div', { id: 'menu-btn', title: 'Menu: browse applications, places and system settings', onclick: () => this.toggleMenu() }, h('img', { class: 'logo mint-logo-img', src: 'assets/logo-mint.png', alt: 'Menu', draggable: false }));
    const lb = (ic, title, fn) => h('div', { class: 'lb', title, onclick: fn }, icon(ic, 30));
    const launchers = h('div', { id: 'launchers' },
      lb('chromium', 'Chromium Web Browser\nAccess the Internet', () => env.openApp('chromium')),
      lb('show-desktop', 'Show Desktop\nHide all windows and show the desktop', () => env.wm.showDesktop()),
      lb('folder', 'Files\nAccess and organize files', () => env.openApp('nemo')),
      lb('terminal', 'Terminal\nUse the command line', () => env.openApp('terminal')));
    this.tasksEl = h('div', { id: 'tasks' });
    this.trayEl = h('div', { id: 'tray' });
    const ti = (ic, title, fn, cls = '') => h('div', { class: 'ti ' + cls, title, onclick: (e) => fn(e) }, typeof ic === 'string' && ic.startsWith('<') ? h('span', { class: 'ico', html: ic }) : icon(ic, 20));
    this.scoreTi = ti('score', 'CyberPatriot Simulator menu\nScoring mode, hints, sounds and reset', (e) => this.simPopup(e), 'sim');
    this.osTi = ti('swap', 'Switch operating system\nLinux Mint \u21c4 Ubuntu (each keeps its own progress)', (e) => this.osPopup(e), 'sim');
    this.shuffleTi = ti('reshuffle', 'Reshuffle\nDeal a new random round of tasks', () => env.reshuffle(), 'sim');
    this.netTi = ti(SYM.net, 'Network: Wired connection 1 (connected)', (e) => this.netPopup(e));
    this.volTi = ti(env.ui.soundOn ? SYM.vol : SYM.mute, `Volume: ${env.ui.soundOn ? '75%' : 'muted'}\nClick to adjust`, (e) => this.volPopup(e));
    this.trayEl.append(this.scoreTi, this.shuffleTi, this.osTi, this.netTi, this.volTi);
    this.clockEl = h('div', { id: 'clock', onclick: (e) => this.clockPopup(e) });
    this.panel.append(this.menuBtn, launchers, this.tasksEl, this.trayEl, this.clockEl, h('div', { id: 'showdesk', title: 'Show desktop', onclick: () => env.wm.showDesktop() }));
    this.tickClock();
    this.renderIcons();
  }
  tickClock() {
    const d = new Date(this.env.sys.now());
    this.clockEl.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const tip = `${FULLDAYS[d.getDay()]}, ${FULLMONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}\nClick to show the calendar`;
    if (this.clockEl.hasAttribute('data-tip')) this.clockEl.setAttribute('data-tip', tip); else this.clockEl.title = tip;
  }
  renderTasks() {
    const wm = this.env.wm;
    clear(this.tasksEl);
    for (const w of wm.wins) {
      this.tasksEl.append(h('div', { class: 'task' + (wm.active === w && !w.minimized ? ' active' : '') + (w.minimized ? ' min' : ''), title: `${w.title}\n${w.minimized ? 'Click to restore this window' : wm.active === w ? 'Click to minimize this window' : 'Click to bring this window to the front'}`, onclick: () => { if (w.minimized) w.restore(); else if (wm.active === w) w.minimize(); else w.focus(); } }, icon(w.iconName, 18), h('span', { class: 't' }, w.title)));
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
    this.showPopup(null, [h('h4', null, 'Network'), h('div', { class: 'row' }, h('span', null, '\u2714 Wired connection 1'), h('span', { style: { color: '#9fb08a' } }, 'Connected')), f('IP address', '10.0.2.15'), f('Gateway', '10.0.2.2'), f('DNS', '127.0.0.53'),
      h('hr'), h('div', { class: 'row clk', title: 'Open network settings (not simulated)', onclick: () => this.closePopup() }, 'Network Settings')], 60);
  }
  volPopup() {
    const env = this.env;
    const level = this._vol ?? 75;
    const sl = h('input', { type: 'range', min: 0, max: 100, value: level, title: 'Output volume', style: { width: '180px', accentColor: '#8fa876' }, oninput: () => { this._vol = Number(sl.value); out.textContent = `${sl.value}%`; } });
    const out = h('span', { style: { width: '36px', textAlign: 'right' } }, `${level}%`);
    const mute = h('button', { class: 'btn', title: 'Toggle the simulator\u2019s score notification sounds', onclick: () => { env.ui.soundOn = !env.ui.soundOn; if (!env.ui.soundOn) env.ui.stopSounds(); env.settings.sound = env.ui.soundOn; env.saveSettings(); this.closePopup(); this.refreshVol(); env.ui.toast({ title: env.ui.soundOn ? 'Sound on' : 'Sound off', message: 'Score notification sounds', kind: 'info', ms: 1800 }); } }, env.ui.soundOn ? 'Mute' : 'Unmute');
    this.showPopup(null, [h('h4', null, 'Volume'), h('div', { class: 'row' }, sl, out), h('div', { class: 'row' }, h('span', null, 'Output: Built-in Audio'), mute)], 30);
  }
  refreshVol() {
    const on = this.env.ui.soundOn;
    this.volTi.firstChild.innerHTML = on ? SYM.vol : SYM.mute;
    const tip = `Volume: ${on ? `${this._vol ?? 75}%` : 'muted'}\nClick to adjust`;
    if (this.volTi.hasAttribute('data-tip')) this.volTi.setAttribute('data-tip', tip); else this.volTi.title = tip;
  }
  clockPopup() {
    const d = new Date(this.env.sys.now());
    const y = d.getFullYear(); const m = d.getMonth();
    const first = new Date(y, m, 1).getDay(); const days = new Date(y, m + 1, 0).getDate();
    const cells = [...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((n) => h('div', { class: 'cd hd' }, n))];
    for (let i = 0; i < first; i++) cells.push(h('div', { class: 'cd' }));
    for (let n = 1; n <= days; n++) cells.push(h('div', { class: 'cd' + (n === d.getDate() ? ' today' : ''), title: `${FULLMONS[m]} ${n}, ${y}` }, String(n)));
    this.showPopup(null, [h('div', { style: { textAlign: 'center', fontSize: '30px', fontWeight: 300 } }, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`),
      h('div', { style: { textAlign: 'center', marginBottom: '8px', opacity: 0.85 } }, `${FULLDAYS[d.getDay()]}, ${FULLMONS[m]} ${d.getDate()}, ${y}`),
      h('div', { style: { textAlign: 'center', fontWeight: 600, margin: '6px 0' } }, `${FULLMONS[m]} ${y}`), h('div', { class: 'cal' }, cells)], 0);
  }
  osPopup() { this.showPopup(null, osSwitchContent(this.env, () => this.closePopup()), 104); }
  simPopup() {
    const env = this.env;
    const eng = env.engine;
    const row = (label, ctl) => h('div', { class: 'row' }, h('span', null, label), ctl);
    const sel = h('select', { class: 'in', style: { minHeight: '22px', padding: '1px 4px' }, onchange: () => { eng.setMode(sel.value); env.settings.mode = sel.value; env.saveSettings(); } },
      h('option', { value: 'instant', selected: eng.mode === 'instant' }, 'Instant (~1 s)'), h('option', { value: 'realistic', selected: eng.mode === 'realistic' }, 'Realistic (60 s)'));
    const snd = h('input', { type: 'checkbox', checked: env.ui.soundOn, onchange: () => { env.ui.soundOn = snd.checked; if (!env.ui.soundOn) env.ui.stopSounds(); env.settings.sound = snd.checked; env.saveSettings(); } });
    this.showPopup(null, [h('h4', null, 'CyberPatriot Simulator'),
      row('Scoring updates', sel), row('Sounds', snd),
      row('Hint', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.hint(); } }, 'Show hint')),
      row('Score report', h('button', { class: 'btn', onclick: () => { this.closePopup(); env.openApp(env.browser || 'chromium', { args: ['file:///opt/CyberPatriot/ScoringReport.html'] }); } }, 'Open')),
      row('Operating system', h('button', { class: 'btn', title: 'Switch between Linux Mint and Ubuntu', onclick: () => { this.closePopup(); this.osPopup(); } }, 'Switch OS…')),
      row('New round', h('button', { class: 'btn', title: 'Deal a new random round of tasks', onclick: () => { this.closePopup(); env.reshuffle(); } }, '↻ Reshuffle…')),
      row('Start over', h('button', { class: 'btn', title: 'Restart this same round from a fresh image', onclick: () => { this.closePopup(); env.reset(); } }, 'Reset image…')),
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
    this.search = h('input', { placeholder: '', title: 'Type to search applications', oninput: () => { this.renderApps(); }, onkeydown: (e) => {
      if (e.key === 'Enter') { const first = this.appsEl.querySelector('.app'); first?.click(); }
      if (e.key === 'Escape') this.closeMenu();
    } });
    const fav = (ic, title, fn) => h('div', { class: 'fb', title, onclick: () => { this.closeMenu(); fn(); } }, icon(ic, 32));
    const favs = h('div', { class: 'fav' },
      fav('chromium', 'Chromium Web Browser\nAccess the Internet', () => env.openApp('chromium')),
      fav('software', 'Software Manager\nAdd and remove applications', () => env.openApp('software')),
      fav('gear', 'System Settings\nControl Center: change appearance, hardware and system settings', () => env.openApp('settings')),
      fav('terminal', 'Terminal\nUse the command line', () => env.openApp('terminal')),
      fav('folder', 'Files\nAccess and organize files', () => env.openApp('nemo')),
      fav('lock', 'Lock Screen\nProtect your computer from unauthorized use', () => env.lock()),
      fav('logout', 'Log Out\nLog out of the session', () => env.logout()),
      fav('power', 'Quit\nShut down the computer', () => env.power('poweroff')));
    this.catsEl = h('div', { class: 'cats' });
    this.appsEl = h('div', { class: 'apps' });
    this.descEl = h('div', { class: 'desc' });
    this.menuEl.append(h('div', { class: 'body' }, favs, h('div', { class: 'right' }, h('div', { class: 'search' }, this.search, h('span', { class: 'mag', html: SYM.search })), h('div', { class: 'cols' }, this.catsEl, h('div', { class: 'appcol' }, this.appsEl, this.descEl)))));
  }
  renderCats() {
    clear(this.catsEl);
    MENU_CATS.forEach(([name, ic,, tip], i) => this.catsEl.append(h('div', { class: 'cat' + (i === this.catIdx ? ' sel' : ''), title: tip, onmouseenter: () => { if (!this.search.value) { this.catIdx = i; this.renderCats(); this.renderApps(); } }, onclick: () => { this.catIdx = i; this.search.value = ''; this.renderCats(); this.renderApps(); } }, icon(ic, 20), name)));
  }
  /** rows shown for the special "Places" / "Recent Files" categories */
  placeRows() {
    const env = this.env; const u = users.getUser(env.sys, env.user); const home = u.home;
    return [['Computer', 'computer', '/', 'Browse all local and remote disks and folders accessible from this computer'], ['Home', 'home', home, 'Open your personal folder'], ['Desktop', 'folder-desktop', `${home}/Desktop`, 'Open the contents of your desktop in a folder'],
      ['Downloads', 'folder-downloads', `${home}/Downloads`, 'Downloaded files'], ['Documents', 'folder-documents', `${home}/Documents`, 'Your documents'], ['Trash', 'trash', `${home}/.local/share/Trash/files`, 'Open the trash']]
      .map(([name, ic, path, tip]) => ({ name, icon: ic, tip, run: () => env.openApp('nemo', { path }) }));
  }
  recentRows() {
    const env = this.env;
    const rec = (env.settings.recent || []).filter((p) => { try { return env.sys.vfs.exists(p); } catch { return false; } });
    return rec.map((p) => ({ name: p.split('/').pop(), icon: fileIconName(p.split('/').pop(), false), tip: p, run: () => env.openPath(p) }));
  }
  renderApps() {
    clear(this.appsEl);
    this.descEl.textContent = '';
    const q = this.search.value.trim().toLowerCase();
    const cat = MENU_CATS[this.catIdx];
    const row = (name, ic, tip, run, ctx) => h('div', { class: 'app', title: tip || undefined, onmouseenter: () => { this.descEl.textContent = tip || ''; }, onmouseleave: () => { this.descEl.textContent = ''; }, onclick: () => { this.closeMenu(); run(); }, oncontextmenu: ctx }, icon(ic, 20), h('div', { class: 'nm' }, name));
    if (!q && cat[0] === 'Places') { for (const r of this.placeRows()) this.appsEl.append(row(r.name, r.icon, r.tip, r.run)); return; }
    if (!q && cat[0] === 'Recent Files') {
      const rec = this.recentRows();
      if (!rec.length) this.appsEl.append(h('div', { class: 'empty' }, 'No recent documents'));
      for (const r of rec) this.appsEl.append(row(r.name, r.icon, r.tip, r.run));
      if (rec.length) this.appsEl.append(h('div', { class: 'app clear', title: 'Clear the list of recently opened files', onclick: () => { this.env.settings.recent = []; this.env.saveSettings(); this.renderApps(); } }, h('div', { class: 'nm' }, 'Clear List')));
      return;
    }
    const apps = this.loadApps();
    const filt = q ? apps.filter((a) => a.name.toLowerCase().includes(q) || a.comment.toLowerCase().includes(q)) : apps.filter((a) => cat[2](a.cats));
    if (!filt.length) { this.appsEl.append(h('div', { class: 'empty' }, q ? 'No matching applications' : 'Empty category')); return; }
    for (const a of filt) this.appsEl.append(row(a.name, a.icon, a.comment, () => runExec(this.env, a.exec), (e) => { e.preventDefault(); this.env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Add to desktop', action: () => this.addToDesktop(a) }]); }));
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
      const el = h('div', { class: 'dicon', title: `${name} — double-click to open`, onmousedown: (e) => { e.stopPropagation(); this.select(el); }, ondblclick: open, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.select(el); env.ui.showMenu(e.clientX, e.clientY, [{ label: 'Open', action: open }, ...(extra || [])]); } }, icon(ic, 48), h('span', { class: 'lbl' }, name));
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
