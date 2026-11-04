// Windows 11 (23H2) shell: centred taskbar, Start menu with search, notification-area flyouts (quick settings,
// calendar, CyberPatriot), desktop icons read from the Desktop folders, lock screen, sign-in screen and the
// User Account Control prompt used by every "Run as administrator".
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { osSwitchContent } from './os-switch.js';
import * as S from '../win/state.js';

const pad2 = (n) => String(n).padStart(2, '0');
const time12 = (d) => `${((d.getHours() + 11) % 12) + 1}:${pad2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const dateShort = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const FULLDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULLMONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const lc = (s) => String(s).toLowerCase();

/** Every app the Start menu and search know about. admin: true means it always asks UAC (MMC consoles etc.). */
export const WIN_APPS = [
  { id: 'settings', name: 'Settings', icon: 'w-settings', pin: 1, kw: 'control accounts apps update privacy remote desktop' },
  { id: 'explorer', name: 'File Explorer', icon: 'w-explorer', pin: 2, kw: 'files folders this pc' },
  { id: 'chrome', name: 'Google Chrome', icon: 'w-chrome', pin: 3, kw: 'browser web internet' },
  { id: 'terminal', name: 'Terminal', icon: 'w-terminal', pin: 4, kw: 'powershell cmd command prompt shell console', elevatable: true },
  { id: 'notepad', name: 'Notepad', icon: 'w-notepad', pin: 5, kw: 'text editor' },
  { id: 'security', name: 'Windows Security', icon: 'w-security', pin: 6, kw: 'defender antivirus virus firewall smartscreen' },
  { id: 'control', name: 'Control Panel', icon: 'w-control', pin: 7, kw: 'programs features firewall system' },
  { id: 'taskmgr', name: 'Task Manager', icon: 'w-taskmgr', pin: 8, kw: 'processes services performance startup' },
  { id: 'compmgmt', name: 'Computer Management', icon: 'w-compmgmt', pin: 9, admin: true, kw: 'users groups lusrmgr services shares mmc' },
  { id: 'secpol', name: 'Local Security Policy', icon: 'w-secpol', pin: 10, admin: true, kw: 'secpol password lockout audit user rights security options gpedit' },
  { id: 'services', name: 'Services', icon: 'w-services', admin: true, kw: 'services.msc' },
  { id: 'lusrmgr', name: 'Local Users and Groups', icon: 'w-users', admin: true, kw: 'lusrmgr.msc accounts' },
  { id: 'taskschd', name: 'Task Scheduler', icon: 'w-taskschd', admin: true, kw: 'scheduled tasks taskschd.msc' },
  { id: 'regedit', name: 'Registry Editor', icon: 'w-regedit', admin: true, kw: 'regedit registry' },
  { id: 'gpedit', name: 'Edit group policy', icon: 'w-gpedit', admin: true, kw: 'gpedit.msc local group policy editor administrative templates' },
  { id: 'notepadpp', name: 'Notepad++', icon: 'w-notepadpp', kw: 'notepad++ editor', needs: 'Notepad++.Notepad++' },
  { id: 'wireshark', name: 'Wireshark', icon: 'w-wireshark', kw: 'pcap packet capture', needs: 'WiresharkFoundation.Wireshark' },
  { id: 'run', name: 'Run', icon: 'w-exe', kw: 'run dialog win+r' },
  { id: 'firewall', name: 'Windows Defender Firewall', icon: 'w-firewall', kw: 'firewall.cpl' },
  { id: 'programs', name: 'Programs and Features', icon: 'w-programs', kw: 'uninstall appwiz.cpl' },
  { id: 'features', name: 'Turn Windows features on or off', icon: 'w-features', admin: true, kw: 'optionalfeatures smb telnet' },
  { id: 'sysdm', name: 'System Properties', icon: 'w-thispc', admin: true, kw: 'remote desktop sysdm.cpl advanced' },
  { id: 'terminal', name: 'Windows PowerShell', icon: 'w-powershell', elevatable: true, kw: 'powershell', opts: { mode: 'ps' }, alias: true },
  { id: 'terminal', name: 'Command Prompt', icon: 'w-cmd', elevatable: true, kw: 'cmd', opts: { mode: 'cmd' }, alias: true },
];

export class WinDesktop {
  constructor(env) {
    this.env = env;
    document.body.classList.add('os-windows');
    this.screen = document.getElementById('screen');
    this.desk = document.getElementById('desktop');
    this.iconsEl = document.getElementById('icons');
    this.panel = document.getElementById('panel');
    this.menuEl = document.getElementById('menu');
    this.flyout = null;
    env.elevate = (o) => elevate(env, o);
    this.build();
    env.wm.onChange(() => this.renderTasks());
    this.desk.addEventListener('mousedown', (e) => { if (e.target === this.desk || e.target === this.iconsEl) { this.select(null); this.closeAll(); } });
    this.desk.addEventListener('contextmenu', (e) => { if (e.target === this.desk || e.target === this.iconsEl) { e.preventDefault(); this.deskMenu(e); } });
    document.addEventListener('mousedown', (e) => {
      if (this.menuEl.classList.contains('open') && !this.menuEl.contains(e.target) && !e.target.closest('.wtb-start, .wtb-search')) this.closeStart();
      if (this.flyout && !this.flyout.contains(e.target) && !e.target.closest('.wtb-tray')) this.closeFlyout();
    }, true);
    document.addEventListener('keydown', (e) => { if ((e.metaKey || e.altKey && e.ctrlKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); env.openApp('run'); return; } if (e.key === 'Meta' || (e.key === 'Escape' && this.menuEl.classList.contains('open'))) { if (e.key === 'Escape') this.closeStart(); } });
    this.renderIcons();
    this.tick();
    setInterval(() => this.tick(), 10000);
  }

  // ---------------------------------------------------------------- taskbar
  /** Taskbar look follows the real registry values: TaskbarAl (0 = left, 1 = centre) and SearchboxTaskbarMode (0 hidden, 1 icon, 2 box). */
  layout() {
    const sys = this.env.sys;
    const al = Number(S.regGet(sys, 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAl') ?? 1);
    const sm = Number(S.regGet(sys, 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'SearchboxTaskbarMode') ?? 2);
    return { left: al === 0, search: sm };
  }
  build() {
    const env = this.env;
    clear(this.panel);
    const L = this.layout();
    this.panel.className = 'wtb' + (L.left ? ' left' : '');
    this.menuEl.classList.toggle('left', L.left);
    const tbBtn = (cls, ic, title, onclick, extra) => h('button', { class: `wtb-b ${cls}`, title, onclick, ...extra }, typeof ic === 'string' ? icon(ic, 24) : ic);
    this.startBtn = tbBtn('wtb-start', 'w-start', 'Start', () => this.toggleStart());
    const glass = '<svg viewBox="0 0 48 48" width="16" height="16"><circle cx="21" cy="21" r="11" fill="none" stroke="currentColor" stroke-width="4"/><path d="M29 29l11 11" stroke="currentColor" stroke-width="4.500" stroke-linecap="round"/></svg>';
    this.searchBox = L.search === 2 ? h('div', { class: 'wtb-search', title: 'Search', onclick: () => this.openStart({ search: true }) }, h('span', { class: 'wsi', html: glass }), h('span', null, L.left ? 'Type here to search' : 'Search'))
      : L.search === 1 ? h('button', { class: 'wtb-b wtb-sicon', title: 'Search', onclick: () => this.openStart({ search: true }), html: glass.replace(/16/g, '20') }) : null;
    this.taskViewBtn = tbBtn('wtb-tv', 'w-taskview', 'Task View', () => this.taskView());
    const has = (id) => S.listPrograms(env.sys).some((p) => p.id === id);
    // pinned like the competition image: Chrome, Wireshark, File Explorer, Notepad++, Windows PowerShell, Settings
    this.pinned = [
      has('Google.Chrome') && { id: 'chrome', icon: 'w-chrome', name: 'Google Chrome' },
      has('WiresharkFoundation.Wireshark') && { id: 'wireshark', icon: 'w-wireshark', name: 'Wireshark' },
      { id: 'explorer', icon: 'w-explorer', name: 'File Explorer' },
      has('Notepad++.Notepad++') && { id: 'notepadpp', icon: 'w-notepadpp', name: 'Notepad++' },
      { id: 'terminal', icon: 'w-powershell', name: 'Windows PowerShell' },
      { id: 'settings', icon: 'w-settings', name: 'Settings' },
    ].filter(Boolean);
    this.tasksEl = h('div', { class: 'wtb-tasks' });
    this.centre = h('div', { class: 'wtb-centre' }, this.startBtn, this.searchBox, this.taskViewBtn, this.tasksEl);
    // notification area
    this.scoreTi = h('button', { class: 'wtb-tray wtb-ti', title: 'CyberPatriot', onclick: () => this.simFlyout() }, icon('cyberpatriot', 18));
    this.shuffleTi = h('button', { class: 'wtb-tray wtb-ti', title: 'Reshuffle: deal a new random round of tasks', onclick: () => env.reshuffle() }, icon('reshuffle', 18));
    this.hidden = h('button', { class: 'wtb-tray wtb-ti', title: 'Show hidden icons', onclick: () => this.hiddenFlyout() }, h('span', { class: 'chev', html: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.600"/></svg>' }));
    this.qsBtn = h('button', { class: 'wtb-tray wtb-qs', title: 'Network  Internet access\nSpeakers: 64%', onclick: () => this.quickSettings() }, icon('w-network-tray', 16), this.volIcon = icon('w-volume', 16));
    this.clock = h('button', { class: 'wtb-tray wtb-clock', title: '', onclick: () => this.calendar() }, h('div', { class: 'ct' }), h('div', { class: 'cd' }));
    this.bell = h('button', { class: 'wtb-tray wtb-ti', title: 'Notifications', onclick: () => this.calendar() }, icon('w-bell', 16));
    this.tray = h('div', { class: 'wtb-right' }, this.hidden, this.shuffleTi, this.scoreTi, this.qsBtn, this.clock, this.bell, h('div', { class: 'wtb-peek', title: 'Show desktop', onclick: () => env.wm.showDesktop() }));
    this.panel.append(h('div', { class: 'wtb-left' }), this.centre, this.tray);
    this.panel.oncontextmenu = (e) => { if (e.target.closest('.wtb-app, .wtb-start')) return; e.preventDefault(); env.ui.showMenu(e.clientX, e.clientY - 120, [{ label: 'Task Manager', action: () => env.openApp('taskmgr') }, 'sep', { label: 'Taskbar settings', action: () => env.openApp('settings', { page: 'personalization', sub: 'taskbar' }) }]); };
    this.startBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.winX(e); });
    this.renderTasks();
    if (this.clock && this.env.engine) this.tick();
  }
  tick() {
    const d = new Date(this.env.sys.now());
    this.clock.querySelector('.ct').textContent = time12(d);
    this.clock.querySelector('.cd').textContent = dateShort(d);
    this.clock.title = `${FULLDAYS[d.getDay()]}, ${FULLMONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}\n${time12(d)}`;
    this.scoreTi.title = `CyberPatriot — Score: ${this.env.engine.score()} / ${this.env.engine.maxScore()}`;
  }
  renderTasks() {
    const env = this.env;
    clear(this.tasksEl);
    const wins = env.wm.wins;
    const groups = new Map();
    for (const p of this.pinned) groups.set(p.id, { ...p, wins: [] });
    for (const w of wins) {
      const id = w.appId || `w${w.id}`;
      if (!groups.has(id)) groups.set(id, { id, icon: w.iconName, name: w.title, wins: [] });
      groups.get(id).wins.push(w);
    }
    for (const g of groups.values()) {
      const active = g.wins.includes(env.wm.active) && !env.wm.active?.minimized;
      const b = h('button', { class: 'wtb-b wtb-app' + (g.wins.length ? ' running' : '') + (active ? ' active' : ''), title: g.wins.length ? g.wins.map((w) => w.title).join('\n') : g.name,
        onclick: () => {
          if (!g.wins.length) return env.openApp(g.id);
          if (g.wins.length === 1) { const w = g.wins[0]; if (env.wm.active === w && !w.minimized) w.minimize(); else w.restore(); return; }
          const r = b.getBoundingClientRect();
          env.ui.showMenu(r.left, r.top - 30 * g.wins.length - 10, g.wins.map((w) => ({ label: w.title, action: () => w.restore() })));
        },
        oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.jumpList(e, g); } },
      icon(g.icon || 'w-exe', 24), h('i', { class: 'ind' }));
      this.tasksEl.append(b);
    }
  }
  jumpList(e, g) {
    const env = this.env;
    const items = [];
    if (g.id === 'terminal') items.push({ label: 'Windows PowerShell', action: () => env.openApp('terminal', { mode: 'ps' }) }, { label: 'Command Prompt', action: () => env.openApp('terminal', { mode: 'cmd' }) }, 'sep', { label: 'Run as administrator', action: () => elevate(env, { app: 'terminal' }) });
    items.push({ label: g.name || 'Open', action: () => env.openApp(g.id) });
    if (g.wins.length) items.push('sep', { label: g.wins.length > 1 ? 'Close all windows' : 'Close window', action: () => g.wins.slice().forEach((w) => w.close()) });
    env.ui.showMenu(e.clientX - 60, e.clientY - 34 * items.length - 20, items);
  }
  taskView() {
    const env = this.env;
    const wins = env.wm.wins;
    if (!wins.length) { env.ui.toast({ title: 'Task View', message: 'No open windows.', kind: 'info' }); return; }
    const ov = h('div', { class: 'w-taskview', onclick: (e) => { if (e.target === ov) ov.remove(); } },
      h('div', { class: 'tvg' }, wins.map((w) => h('div', { class: 'tvc', title: w.title, onclick: () => { ov.remove(); w.restore(); } }, h('div', { class: 'tvh' }, icon(w.iconName, 16), h('span', null, w.title), h('button', { title: 'Close', onclick: (e) => { e.stopPropagation(); w.close(); e.currentTarget.closest('.tvc').remove(); } }, '✕')), h('div', { class: 'tvp' }, icon(w.iconName, 48))))),
      h('div', { class: 'tvd' }, h('div', { class: 'tvdc cur' }, 'Desktop 1'), h('div', { class: 'tvdc new', title: 'New desktop (not simulated)' }, '+ New desktop')));
    this.screen.append(ov);
  }
  winX(e) {
    const env = this.env;
    const r = this.startBtn.getBoundingClientRect();
    env.ui.showMenu(r.left, r.top - 420, [
      { label: 'Installed apps', action: () => env.openApp('settings', { page: 'apps' }) }, { label: 'System', action: () => env.openApp('sysdm') },
      { label: 'Computer Management', action: () => elevate(env, { app: 'compmgmt' }) }, { label: 'Task Manager', action: () => env.openApp('taskmgr') }, { label: 'Settings', action: () => env.openApp('settings') },
      { label: 'File Explorer', action: () => env.openApp('explorer') }, { label: 'Search', action: () => this.openStart({ search: true }) }, { label: 'Run', action: () => env.openApp('run') }, 'sep',
      { label: 'Terminal', action: () => env.openApp('terminal') }, { label: 'Terminal (Admin)', action: () => elevate(env, { app: 'terminal' }) }, 'sep',
      { label: 'Sign out', action: () => env.logout() }, { label: 'Restart', action: () => env.power('reboot') }, { label: 'Shut down', action: () => env.power('poweroff') }]);
    void e;
  }

  // ---------------------------------------------------------------- start menu
  toggleStart() { if (this.menuEl.classList.contains('open')) this.closeStart(); else this.openStart(); }
  closeStart() { this.menuEl.classList.remove('open'); }
  closeAll() { this.closeStart(); this.closeFlyout(); }
  launch(a, { admin = false } = {}) {
    this.closeAll();
    if (admin || a.admin) return elevate(this.env, { app: a.id, ...(a.opts || {}) });
    return this.env.openApp(a.id, a.opts || {});
  }
  appMenu(e, a) {
    e.preventDefault(); e.stopPropagation();
    const env = this.env;
    env.ui.showMenu(e.clientX, e.clientY, [
      { label: 'Open', action: () => this.launch(a) },
      ...(a.elevatable || a.admin ? [{ label: 'Run as administrator', action: () => this.launch(a, { admin: true }) }] : []),
      ...(a.id === 'terminal' ? [{ label: 'Open file location', action: () => { this.closeAll(); env.openApp('explorer', { path: '/Windows/System32/WindowsPowerShell/v1.0' }); } }] : []),
    ]);
  }
  openStart({ search = false } = {}) {
    const env = this.env;
    this.closeFlyout();
    const m = this.menuEl;
    clear(m);
    m.className = 'wsm open' + (this.layout().left ? ' left' : '');
    const input = h('input', { class: 'wsm-q', placeholder: 'Search for apps, settings, and documents', title: 'Type to search', oninput: () => render(), onkeydown: (e) => { if (e.key === 'Enter') { const f = body.querySelector('.wsm-best, .wsm-res'); if (f) f.click(); } if (e.key === 'Escape') this.closeStart(); } });
    const body = h('div', { class: 'wsm-body' });
    const tile = (a) => h('button', { class: 'wsm-tile', title: a.name, onclick: () => this.launch(a), oncontextmenu: (e) => this.appMenu(e, a) }, icon(a.icon, 32), h('span', null, a.name));
    const recommended = () => {
      const files = [];
      for (const dir of [`/Users/${env.user}/Desktop`, `/Users/${env.user}/Documents`, `/Users/${env.user}/Downloads`]) {
        try { for (const n of env.sys.vfs.readdir(dir)) { const p = `${dir}/${n}`; if (env.sys.vfs.isFile(p)) files.push({ p, n, t: env.sys.vfs.stat(p).mtime }); } } catch { /* ignore */ }
      }
      return files.sort((a, b) => b.t - a.t).slice(0, 6);
    };
    let allApps = false;
    const render = () => {
      clear(body);
      const q = lc(input.value.trim());
      if (q) {
        const apps = WIN_APPS.filter((a) => !a.needs || S.listPrograms(env.sys).some((p) => p.id === a.needs)).filter((a) => lc(a.name).includes(q) || lc(a.kw || '').includes(q) || lc(a.id).startsWith(q));
        const files = [];
        const walk = (dir, d) => { if (d > 4 || files.length > 8) return; let ns = []; try { ns = env.sys.vfs.readdir(dir); } catch { return; } for (const n of ns) { const p = `${dir}/${n}`; if (/^(AppData)$/.test(n)) continue; if (lc(n).includes(q)) files.push(p); if (env.sys.vfs.isDir(p)) walk(p, d + 1); } };
        walk(`/Users/${env.user}`, 0);
        const best = apps[0];
        body.append(h('div', { class: 'wsm-search' },
          h('div', { class: 'wsm-list' },
            best ? [h('div', { class: 'wsm-h' }, 'Best match'), h('button', { class: 'wsm-best', title: best.name, onclick: () => this.launch(best), oncontextmenu: (e) => this.appMenu(e, best) }, icon(best.icon, 32), h('div', null, h('b', null, best.name), h('div', { class: 'sub' }, best.admin ? 'System' : 'App')))] : null,
            apps.length > 1 ? [h('div', { class: 'wsm-h' }, 'Apps'), apps.slice(1).map((a) => h('button', { class: 'wsm-res', onclick: () => this.launch(a), oncontextmenu: (e) => this.appMenu(e, a) }, icon(a.icon, 20), h('span', null, a.name)))] : null,
            files.length ? [h('div', { class: 'wsm-h' }, 'Documents'), files.slice(0, 8).map((p) => h('button', { class: 'wsm-res', title: S.toWin(p), onclick: () => { this.closeAll(); env.openPath(p); } }, icon(winFileIcon(p.split('/').pop(), env.sys.vfs.isDir(p)), 20), h('span', null, p.split('/').pop(), h('small', null, ` — ${S.toWin(p.slice(0, p.lastIndexOf('/')))}`))))] : null,
            !best && !files.length ? h('div', { class: 'wsm-none' }, `No results for “${input.value}”. Try the name of an app, a .msc console or a file.`) : null),
          best ? h('div', { class: 'wsm-detail' }, icon(best.icon, 64), h('h3', null, best.name), h('div', { class: 'sub' }, best.admin ? 'System' : 'App'),
            h('div', { class: 'acts' }, h('button', { title: 'Open', onclick: () => this.launch(best) }, '↗  Open'), best.elevatable || best.admin ? h('button', { title: 'Run as administrator', onclick: () => this.launch(best, { admin: true }) }, '🛡  Run as administrator') : null)) : null));
        return;
      }
      if (allApps) {
        const list = WIN_APPS.filter((a) => !a.needs || S.listPrograms(env.sys).some((p) => p.id === a.needs)).slice().sort((a, b) => a.name.localeCompare(b.name));
        body.append(h('div', { class: 'wsm-sec' }, h('b', null, 'All apps'), h('button', { class: 'wsm-more', onclick: () => { allApps = false; render(); } }, '‹  Back')),
          h('div', { class: 'wsm-all' }, list.map((a, i) => [i === 0 || list[i - 1].name[0] !== a.name[0] ? h('div', { class: 'wsm-letter' }, a.name[0]) : null, h('button', { class: 'wsm-res', title: a.name, onclick: () => this.launch(a), oncontextmenu: (e) => this.appMenu(e, a) }, icon(a.icon, 24), h('span', null, a.name))])));
        return;
      }
      const pins = WIN_APPS.filter((a) => a.pin).sort((a, b) => a.pin - b.pin);
      body.append(h('div', { class: 'wsm-sec' }, h('b', null, 'Pinned'), h('button', { class: 'wsm-more', title: 'Show all apps', onclick: () => { allApps = true; render(); } }, 'All apps  ›')),
        h('div', { class: 'wsm-grid' }, pins.map(tile)),
        h('div', { class: 'wsm-sec' }, h('b', null, 'Recommended')),
        h('div', { class: 'wsm-rec' }, recommended().map((f) => h('button', { class: 'wsm-recf', title: S.toWin(f.p), onclick: () => { this.closeAll(); env.openPath(f.p); } }, icon(winFileIcon(f.n, false), 28), h('div', null, h('div', null, f.n), h('div', { class: 'sub' }, relTime(env.sys.now() - f.t)))))));
    };
    const u = S.getUser(env.sys, env.user);
    const foot = h('div', { class: 'wsm-foot' },
      h('button', { class: 'wsm-user', title: `${u?.full || env.user}\nLocal account`, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left, r.top - 110, [{ label: 'Change account settings', action: () => { this.closeAll(); env.openApp('settings', { page: 'accounts' }); } }, { label: 'Lock', action: () => { this.closeAll(); env.lock(); } }, { label: 'Sign out', action: () => { this.closeAll(); env.logout(); } }]); } }, icon('w-user', 30), h('span', null, u?.full || env.user)),
      h('button', { class: 'wsm-power', title: 'Power', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left - 60, r.top - 120, [{ label: 'Lock', action: () => { this.closeAll(); env.lock(); } }, { label: 'Restart', action: () => { this.closeAll(); env.power('reboot'); } }, { label: 'Shut down', action: () => { this.closeAll(); env.power('poweroff'); } }]); } }, icon('w-power', 18)));
    m.append(h('div', { class: 'wsm-top' }, h('span', { class: 'wsi', html: '<svg viewBox="0 0 48 48" width="15" height="15"><circle cx="21" cy="21" r="11" fill="none" stroke="currentColor" stroke-width="4"/><path d="M29 29l11 11" stroke="currentColor" stroke-width="4.500" stroke-linecap="round"/></svg>' }), input), body, foot);
    render();
    setTimeout(() => input.focus(), 30);
    void search;
  }

  // ---------------------------------------------------------------- flyouts
  showFlyout(content, cls = '') {
    this.closeFlyout(); this.closeStart();
    this.flyout = h('div', { class: 'wfly ' + cls }, content);
    this.screen.append(this.flyout);
  }
  closeFlyout() { this.flyout?.remove(); this.flyout = null; }
  quickSettings() {
    const env = this.env;
    const t = (ic, label, on, onclick, title) => h('button', { class: 'wqs-t' + (on ? ' on' : ''), title: title || label, onclick }, icon(ic, 18), h('span', null, label));
    const fw = S.firewallAllOn(env.sys);
    this.showFlyout([
      h('div', { class: 'wqs-grid' },
        t('w-wifi', 'Wi-Fi', true, () => {}, 'Connected: CORP-WIFI'), t('w-network', 'Ethernet', true, () => {}, 'Network: Connected'), t('w-firewall', fw ? 'Firewall on' : 'Firewall off', fw, () => { this.closeFlyout(); env.openApp('firewall'); }, 'Open Windows Defender Firewall'),
        t('w-security', 'Security', S.realtimeOn(env.sys), () => { this.closeFlyout(); env.openApp('security'); }, 'Open Windows Security'), t('w-update', 'Updates', !S.pendingUpdates(env.sys).length, () => { this.closeFlyout(); env.openApp('settings', { page: 'update' }); }, 'Windows Update'), t('w-lock', 'Lock', false, () => { this.closeFlyout(); env.lock(); }, 'Lock this PC')),
      h('div', { class: 'wqs-sl' }, icon('w-volume', 18), h('input', { type: 'range', min: 0, max: 100, value: env.ui.soundOn ? 64 : 0, title: 'Volume (turn it to 0 to mute the scoring sounds)', oninput: (e) => { env.ui.soundOn = Number(e.target.value) > 0; if (!env.ui.soundOn) env.ui.stopSounds?.(); env.settings.sound = env.ui.soundOn; env.saveSettings(); } })),
      h('div', { class: 'wqs-foot' }, icon('w-battery', 16), h('span', null, '100%'), h('span', { style: { flex: 1 } }), h('button', { class: 'wqs-gear', title: 'All settings', onclick: () => { this.closeFlyout(); env.openApp('settings'); } }, icon('w-settings', 18)))], 'wqs');
  }
  calendar() {
    const d = new Date(this.env.sys.now());
    const y = d.getFullYear(); const m = d.getMonth();
    const first = new Date(y, m, 1).getDay(); const days = new Date(y, m + 1, 0).getDate();
    const cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((x) => h('div', { class: 'cd hd' }, x));
    for (let i = 0; i < first; i++) cells.push(h('div', { class: 'cd' }));
    for (let n = 1; n <= days; n++) cells.push(h('div', { class: 'cd' + (n === d.getDate() ? ' today' : '') }, String(n)));
    this.showFlyout([h('div', { class: 'wnc' }, h('div', { class: 'wnc-h' }, h('b', null, 'Notifications'), h('span', null, 'No new notifications'))),
      h('div', { class: 'wcal' }, h('div', { class: 'wcal-h' }, `${FULLDAYS[d.getDay()]}, ${FULLMONS[m]} ${d.getDate()}`), h('div', { class: 'wcal-m' }, `${FULLMONS[m]} ${y}`), h('div', { class: 'wcal-g' }, cells))], 'wcalf');
  }
  hiddenFlyout() {
    const env = this.env;
    const items = [['w-security', 'Windows Security - No actions needed', () => env.openApp('security')], ['w-update', 'Windows Update', () => env.openApp('settings', { page: 'update' })]];
    if (env.sys.processes.some((p) => /OneDrive/i.test(p.comm))) items.push(['w-folder', 'OneDrive', () => env.openApp('explorer', { path: `/Users/${env.user}/OneDrive` })]);
    this.showFlyout(h('div', { class: 'whid' }, items.map(([ic, t, fn]) => h('button', { title: t, onclick: () => { this.closeFlyout(); fn(); } }, icon(ic, 20)))), 'whidf');
  }
  simFlyout() {
    const env = this.env;
    const eng = env.engine;
    const row = (label, ctl) => h('div', { class: 'wsim-r' }, h('span', null, label), ctl);
    const sel = h('select', { class: 'w-in', onchange: () => { eng.setMode(sel.value); env.settings.mode = sel.value; env.saveSettings(); } },
      h('option', { value: 'instant', selected: eng.mode === 'instant' }, 'Instant (~1 s)'), h('option', { value: 'realistic', selected: eng.mode === 'realistic' }, 'Realistic (60 s)'));
    const snd = h('input', { type: 'checkbox', checked: env.ui.soundOn, onchange: () => { env.ui.soundOn = snd.checked; if (!snd.checked) env.ui.stopSounds?.(); env.settings.sound = snd.checked; env.saveSettings(); } });
    const btn = (t, fn, title) => h('button', { class: 'w-btn', title: title || t, onclick: () => { this.closeFlyout(); fn(); } }, t);
    this.showFlyout([h('div', { class: 'wsim-h' }, icon('cyberpatriot', 28), h('div', null, h('b', null, 'CyberPatriot Simulator'), h('div', { class: 'sub' }, `${env.scenario.title} · ${eng.score()} / ${eng.maxScore()} points`))),
      row('Scoring updates', sel), row('Report check names', h('select', { class: 'w-in', title: 'Competition reports since 2025 say "Application update check passed" / "Unwanted software check passed" instead of naming the program', onchange: (e) => { env.settings.reportNames = e.target.value; env.saveSettings(); } }, h('option', { value: 'detailed', selected: env.settings.reportNames !== 'generic' }, 'Detailed (training)'), h('option', { value: 'generic', selected: env.settings.reportNames === 'generic' }, 'Generic (competition)'))), row('Sounds', snd),
      row('Hint', btn('Show hint', () => env.hint())),
      row('Score report', btn('Open', () => env.openApp('chrome', { args: ['file:///C:/CyberPatriot/ScoringReport.html'] }))),
      row('Operating system', btn('Switch OS…', () => this.showFlyout(osSwitchContent(env, () => this.closeFlyout()), 'wsim'), 'Switch to the Linux images')),
      row('New round', btn('↻ Reshuffle…', () => env.reshuffle(), 'Deal a new random round of tasks')),
      row('Start over', btn('Reset image…', () => env.reset(), 'Restart this round from a fresh image')),
      h('div', { class: 'wsim-n' }, 'Practice tool — not the real scoring engine.')], 'wsim');
  }

  // ---------------------------------------------------------------- desktop icons
  renderIcons() {
    const env = this.env;
    const sys = env.sys;
    clear(this.iconsEl);
    this.iconsEl.className = 'wdi';
    const items = [{ name: 'Recycle Bin', icon: 'w-recycle', open: () => env.openApp('explorer', { path: '/$Recycle.Bin' }), title: 'Recycle Bin' }];
    const seen = new Set();
    for (const dir of [`/Users/${env.user}/Desktop`, '/Users/Public/Desktop']) {
      let ns = []; try { ns = sys.vfs.readdir(dir); } catch { continue; }
      for (const n of ns.sort((a, b) => a.localeCompare(b))) {
        if (seen.has(lc(n)) || /^desktop\.ini$/i.test(n)) continue; seen.add(lc(n));
        const p = `${dir}/${n}`;
        const isDir = sys.vfs.isDir(p);
        const label = isDir || Number(S.regGet(sys, 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'HideFileExt') ?? 1) === 0 ? n.replace(/\.(lnk|url)$/i, '') : n.replace(/\.[^.]+$/, '') || n;
        const ic = /^CyberPatriot/i.test(n) || /^Forensics Question/i.test(n) ? 'cyberpatriot' : /\.lnk$/i.test(n) ? lnkIcon(n) : winFileIcon(n, isDir);
        items.push({ name: label, icon: ic, path: p, title: `${label}\n${isDir ? 'File folder' : S.toWin(p)}`, open: () => env.openPath(p) });
      }
    }
    for (const it of items) {
      const el = h('div', { class: 'wdi-i', tabindex: 0, title: it.title, ondblclick: () => it.open(), onkeydown: (e) => { if (e.key === 'Enter') it.open(); },
        onmousedown: () => this.select(el), oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.select(el); this.iconMenu(e, it); } },
      icon(it.icon, 40), h('span', null, it.name));
      this.iconsEl.append(el);
    }
  }
  select(el) { for (const x of this.iconsEl.querySelectorAll('.sel')) x.classList.remove('sel'); if (el) el.classList.add('sel'); }
  iconMenu(e, it) {
    const env = this.env;
    const items = [{ label: 'Open', action: () => it.open() }];
    if (it.path) {
      items.push({ label: 'Open file location', action: () => env.openApp('explorer', { path: it.path.slice(0, it.path.lastIndexOf('/')) }) });
      if (/\.txt$/i.test(it.path)) items.push({ label: 'Edit in Notepad', action: () => env.openApp('notepad', { path: it.path }) });
      items.push('sep', { label: 'Copy as path', action: () => { navigator.clipboard?.writeText(`"${S.toWin(it.path)}"`).catch(() => {}); } }, { label: 'Delete', action: async () => {
        if (/^\/Users\/Public\//.test(it.path)) { const ok = await elevate(env, { quiet: true, what: 'delete this shortcut' }); if (!ok) return; }
        try { env.sys.vfs.isDir(it.path) ? env.sys.vfs.rmrf(it.path) : env.sys.vfs.unlink(it.path); env.sys.touch('fs'); this.renderIcons(); } catch (err) { env.ui.alert({ title: 'Error', heading: 'Could not delete', message: err.message, icon: 'w-bad' }); }
      } }, { label: 'Properties', action: () => env.ui.alert({ title: `${it.name} Properties`, heading: it.name, message: `Location: ${S.toWin(it.path.slice(0, it.path.lastIndexOf('/')))}\nSize: ${env.sys.vfs.isFile(it.path) ? env.sys.vfs.stat(it.path).size + ' bytes' : '—'}`, icon: 'w-info' }) });
    }
    env.ui.showMenu(e.clientX, e.clientY, items);
  }
  deskMenu(e) {
    const env = this.env;
    env.ui.showMenu(e.clientX, e.clientY, [
      { label: 'View: Large icons', action: () => {} }, { label: 'Refresh', action: () => this.renderIcons() }, 'sep',
      { label: 'New › Folder', action: async () => { const n = await env.ui.prompt({ title: 'New folder', message: 'Folder name:', value: 'New folder' }); if (n) { try { env.sys.vfs.mkdir(`/Users/${env.user}/Desktop/${n}`, { mode: 0o777 }); this.renderIcons(); } catch (err) { env.ui.alert({ title: 'Error', heading: 'Could not create folder', message: err.message, icon: 'w-bad' }); } } } },
      { label: 'New › Text Document', action: async () => { const n = await env.ui.prompt({ title: 'New text document', message: 'File name:', value: 'New Text Document.txt' }); if (n) { env.sys.vfs.writeFile(`/Users/${env.user}/Desktop/${n}`, '', { mode: 0o666, uid: 0, gid: 0 }); this.renderIcons(); } } }, 'sep',
      { label: 'Open in Terminal', action: () => env.openApp('terminal', { cwd: `/Users/${env.user}/Desktop` }) },
      { label: 'Display settings', action: () => env.openApp('settings', { page: 'system' }) }, { label: 'Personalize', action: () => env.openApp('settings', { page: 'personalization' }) }]);
  }
}

export function relTime(ms) { const m = Math.round(ms / 60000); if (m < 60) return `${Math.max(1, m)}m ago`; const hh = Math.round(m / 60); if (hh < 24) return `${hh}h ago`; const d = Math.round(hh / 24); return d === 1 ? 'Yesterday' : `${d} days ago`; }

export function lnkIcon(n) {
  const b = n.replace(/\.lnk$/i, '');
  const known = [[/chrome/i, 'w-chrome'], [/edge/i, 'w-edge'], [/burp/i, 'w-burp'], [/python/i, 'w-python'], [/jellyfin/i, 'w-jellyfin'], [/wireshark/i, 'w-wireshark'], [/notepad\+\+/i, 'w-notepadpp'], [/nmap|zenmap/i, 'w-nmap']].find(([r]) => r.test(b));
  return known ? known[1] : /\.[a-z0-9]{2,5}$/i.test(b) ? winFileIcon(b, false) : 'w-lnk';
}
export function winFileIcon(name, isDir) {
  if (isDir) return { Documents: 'w-folder-docs', Downloads: 'w-folder-downloads', Music: 'w-folder-music', Pictures: 'w-folder-pictures', Videos: 'w-folder-videos', Desktop: 'w-folder-desktop' }[name] || 'w-folder';
  if (/^Forensics Question \d+\.txt$/i.test(name) || /^CyberPatriot/i.test(name)) return 'cyberpatriot';
  if (/\.(txt|log|ini|cfg|inf|md|b64)$/i.test(name)) return 'w-txt';
  if (/\.url$/i.test(name)) return 'w-url';
  if (/\.html?$/i.test(name)) return 'w-html';
  if (/\.lnk$/i.test(name)) return lnkIcon(name);
  if (/\.(exe|msi|com|bat|cmd|ps1|msc)$/i.test(name)) return 'w-exe';
  if (/\.(mp3|wav|flac|ogg|m4a)$/i.test(name)) return 'w-media';
  if (/\.(mp4|mkv|avi|mov)$/i.test(name)) return 'w-video';
  if (/\.(png|jpe?g|gif|bmp)$/i.test(name)) return 'w-image';
  if (/\.(zip|7z|rar)$/i.test(name)) return 'w-zip';
  if (/\.(pcap|pcapng|cap)$/i.test(name)) return 'w-pcap';
  if (/\.lnk$/i.test(name)) return lnkIcon(name);
  if (/\.(csv|xlsx?)$/i.test(name)) return 'w-csv';
  return 'w-file';
}

// ==================================================================== User Account Control
/** Ask for elevation. Admins get the consent prompt; standard users must type an administrator's password.
 *  With { app } the app is opened elevated on Yes. Resolves true/false. */
export function elevate(env, { app, mode, target, args, quiet, what, ...rest } = {}) {
  const sys = env.sys;
  const admin = S.isAdmin(sys, env.user);
  const uacOff = Number(S.regGet(sys, S.KEYS.sysPol, 'EnableLUA') ?? 1) === 0 || Number(S.regGet(sys, S.KEYS.sysPol, 'ConsentPromptBehaviorAdmin') ?? 5) === 0;
  const NAMES = { terminal: mode === 'cmd' ? 'Windows Command Processor' : 'Windows PowerShell', compmgmt: 'Microsoft Management Console', services: 'Microsoft Management Console', lusrmgr: 'Microsoft Management Console', secpol: 'Microsoft Management Console', taskschd: 'Microsoft Management Console', regedit: 'Registry Editor', features: 'Windows Features', sysdm: 'Change Computer Settings', explorer: 'File Explorer' };
  const t = target ? String(target).replace(/\.exe$/i, '').toLowerCase() : null;
  if (!app && t) app = { powershell: 'terminal', cmd: 'terminal', pwsh: 'terminal', wt: 'terminal', 'lusrmgr.msc': 'lusrmgr', 'services.msc': 'services', 'secpol.msc': 'secpol', 'compmgmt.msc': 'compmgmt', 'taskschd.msc': 'taskschd', regedit: 'regedit', notepad: 'notepad', mmc: 'compmgmt', explorer: 'explorer' }[t] || null;
  if (!mode && t === 'cmd') mode = 'cmd';
  delete rest.elevated;
  const go = () => { if (app) env.openApp(app, { ...rest, mode, args, elevated: true }); return true; };
  if (admin && uacOff) return Promise.resolve(go());
  const appName = NAMES[app] || what || 'this app';
  return env.ui.modal((done) => {
    const admins = S.listUsers(sys).filter((u) => u.enabled && S.isAdmin(sys, u.name));
    const err = h('div', { class: 'uac-err' });
    const userSel = h('select', { class: 'w-in' }, admins.map((u) => h('option', { value: u.name }, u.full || u.name)));
    const pw = h('input', { class: 'w-in', type: 'password', placeholder: 'Password', onkeydown: (e) => { if (e.key === 'Enter') yes(); if (e.key === 'Escape') no(); } });
    const yes = () => {
      if (!admin) {
        if (!S.checkPassword(sys, userSel.value, pw.value)) { err.textContent = 'The user name or password is incorrect.'; pw.value = ''; pw.focus(); return; }
      }
      done(true); go();
    };
    const no = () => done(false);
    return h('div', { class: 'uac', onkeydown: (e) => { if (e.key === 'Escape') no(); } },
      h('div', { class: 'uac-t' }, 'User Account Control', h('button', { class: 'uac-x', title: 'Close', onclick: no }, '✕')),
      h('div', { class: 'uac-q' }, 'Do you want to allow this app to make changes to your device?'),
      h('div', { class: 'uac-app' }, icon(app === 'terminal' ? (mode === 'cmd' ? 'w-cmd' : 'w-powershell') : 'w-uac', 36), h('div', null, h('b', null, appName))),
      h('div', { class: 'uac-pub' }, 'Verified publisher: Microsoft Windows', h('br'), 'File origin: Hard drive on this computer'),
      admin ? null : h('div', { class: 'uac-cred' }, h('div', null, 'To continue, enter an admin user name and password.'), userSel, pw, err),
      h('div', { class: 'uac-b' }, h('button', { class: 'w-btn primary', title: 'Allow', autofocus: admin, onclick: yes }, 'Yes'), h('button', { class: 'w-btn', title: 'Do not allow', onclick: no }, 'No')));
  });
}

// ==================================================================== lock and sign-in screens
function wallpaperEl(cls) { return h('div', { class: 'wlock ' + cls }); }
export function showWinLock(env) {
  const scr = document.getElementById('screen');
  const lock = wallpaperEl('wl-lock');
  const t = h('div', { class: 'wl-time' }); const d = h('div', { class: 'wl-date' });
  const upd = () => { const x = new Date(env.sys.now()); t.textContent = `${((x.getHours() + 11) % 12) + 1}:${pad2(x.getMinutes())}`; d.textContent = `${FULLDAYS[x.getDay()]}, ${FULLMONS[x.getMonth()]} ${x.getDate()}`; };
  upd();
  lock.append(h('div', { class: 'wl-clock' }, t, d), h('div', { class: 'wl-hint' }, 'Click or press a key to sign in'));
  const up = () => { document.removeEventListener('keydown', up); lock.classList.add('up'); setTimeout(() => lock.remove(), 350); showWinSignIn(env, { unlock: true }); };
  lock.addEventListener('click', up);
  setTimeout(() => document.addEventListener('keydown', up), 200);
  scr.append(lock);
}
export function showWinSignIn(env, { unlock = false, onLogin } = {}) {
  const sys = env.sys;
  const scr = document.getElementById('screen');
  const el = wallpaperEl('wl-signin');
  let who = unlock ? env.user : env.user;
  const users = () => S.listUsers(sys).filter((u) => u.enabled && u.rid !== 503 && u.rid !== 504);
  const card = h('div', { class: 'wl-card' });
  const list = h('div', { class: 'wl-users' });
  const draw = () => {
    clear(card);
    const u = S.getUser(sys, who);
    const err = h('div', { class: 'wl-err' });
    const pw = h('input', { class: 'wl-pw', type: 'password', placeholder: 'Password', title: `Password for ${who}`, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
    const go = () => {
      const lastHide = Number(S.regGet(sys, S.KEYS.sysPol, 'DontDisplayLastUserName') ?? 0) === 1;
      void lastHide;
      if (!S.checkPassword(sys, who, pw.value)) {
        if (!u?.hash && pw.value === '') { /* blank password: allowed at the console */ } else { err.textContent = 'The password is incorrect. Try again.'; pw.value = ''; return; }
      }
      if (u) u.lastLogon = sys.now();
      el.classList.add('fade'); setTimeout(() => el.remove(), 400);
      if (who !== env.user || !unlock) { env.user = who; onLogin?.(who); }
    };
    card.append(icon('w-user', 180), h('div', { class: 'wl-name' }, u?.full || who), h('div', { style: { position: 'relative' } }, pw, h('button', { class: 'wl-go', title: 'Submit', onclick: go }, '→')), err,
      h('div', { class: 'wl-opts' }, 'Sign-in options'));
    setTimeout(() => pw.focus(), 50);
  };
  const drawList = () => {
    clear(list);
    for (const u of users()) list.append(h('button', { class: 'wl-u' + (u.name === who ? ' cur' : ''), title: `Sign in as ${u.name}`, onclick: () => { who = u.name; draw(); drawList(); } }, icon('w-user', 32), h('span', null, u.full || u.name)));
  };
  draw(); drawList();
  el.append(card, list, h('div', { class: 'wl-corner' }, icon('w-wifi', 20), h('button', { title: 'Power', onclick: () => env.power('reboot') }, icon('w-power', 20))));
  scr.append(el);
}
