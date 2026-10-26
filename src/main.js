// Boot the simulator: restore or build the machine, start scoring, show the desktop.
import { h, clear } from './ui/dom.js';
import { icon, setCustomLogo } from './ui/icons.js';
import { WindowManager } from './ui/wm.js';
import { UI } from './ui/dialogs.js';
import { Desktop } from './ui/desktop.js';
import { System } from './core/system.js';
import { ScoringEngine } from './core/scoring.js';
import { cronEntries } from './core/cron.js';
import { rebootSystem, autostartListeners } from './core/boot.js';
import { mountVirtual } from './images/mint21.js';
import { FsView } from './core/vfs.js';
import * as users from './core/users.js';
import * as K from './core/checks.js';
import scenario from './scenarios/mint-round1/index.js';
import { loadApp } from './apps/registry.js';
import { runExec } from './apps/launch.js';
import { parseDesktop } from './ui/dom.js';

const SAVE_KEY = `cpsim.save.v1.${scenario.id}`;
const SET_KEY = 'cpsim.settings.v1';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const bootMsg = (t) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = t; };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  const params = new URLSearchParams(location.search);
  if (params.has('fresh')) { store.del(SAVE_KEY); }
  const settings = { mode: 'instant', sound: true, welcomed: false, ...(store.get(SET_KEY) || {}) };
  bootMsg('Loading virtual machine…'); await tick();

  let sys; let engineState = null; let restored = false;
  const saved = store.get(SAVE_KEY);
  if (saved && saved.sys) {
    try { sys = System.restore(saved.sys); mountVirtual(sys); engineState = saved.engine; restored = true; } catch (e) { console.error('restore failed', e); sys = null; }
  }
  if (!sys) sys = scenario.createMachine({});
  sys.dirty = false;

  // Optional: drop your own logo at assets/cyberpatriot-logo.png and it replaces the built-in badge icon.
  await new Promise((res) => { const im = new Image(); im.onload = () => { setCustomLogo('assets/cyberpatriot-logo.png'); res(); }; im.onerror = res; im.src = 'assets/cyberpatriot-logo.png'; });
  const ui = new UI({ overlay: document.getElementById('overlay'), toasts: document.getElementById('toasts'), sys });
  ui.soundOn = settings.sound;
  const wm = new WindowManager(document.getElementById('winlayer'));
  const engine = new ScoringEngine(sys, scenario, engineState);
  engine.setMode(settings.mode);

  const env = {
    sys, engine, scenario, wm, ui, settings, user: scenario.user, desktop: null, params,
    saveSettings() { store.set(SET_KEY, settings); },
    userFs() { return new FsView(sys.vfs, users.credFor(sys, env.user)); },
    async openApp(id, opts = {}) {
      try { const open = await loadApp(id); return open(env, { ...opts, app: id }); } catch (e) { console.error(e); ui.alert({ title: 'Error', heading: 'The application failed to start', message: String(e.message || e), icon: 'error' }); return null; }
    },
    openPath(path, opts = {}) {
      const fs = env.userFs();
      try {
        if (fs.isDir(path)) return env.openApp('nemo', { path });
        if (/\.desktop$/.test(path)) { const d = parseDesktop(fs.readFile(path)); return runExec(env, d.Exec || '', { cwd: path.slice(0, path.lastIndexOf('/')) }); }
        if (/\.html?$/i.test(path)) return env.openApp('firefox', { args: ['file://' + path] });
        if (/\.(mp3|ogg|wav|flac|mp4|mkv|avi|png|jpe?g|gif)$/i.test(path)) return env.openApp('generic', { title: path.split('/').pop(), icon: /\.(mp3|ogg|wav|flac)$/i.test(path) ? 'music' : /\.(mp4|mkv|avi)$/i.test(path) ? 'video' : 'image' });
        return env.openApp('xed', { args: [path], ...opts });
      } catch (e) { ui.alert({ title: 'Error', heading: `Could not open “${path.split('/').pop()}”`, message: e.text || e.message, icon: 'error' }); return null; }
    },
    hint() {
      env.engine.evaluate();
      const r = engine.report();
      const left = Object.entries(r.categories).map(([n, c]) => [n, c.total - c.found]).filter(([, n]) => n > 0);
      if (!left.length) { ui.toast({ title: 'Hint', message: 'Everything has been found. Nice work!', kind: 'info' }); return; }
      ui.alert({ title: 'Hint', heading: `${r.totalCount - r.foundCount} vulnerabilities left`, message: left.map(([n, c]) => `${n}: ${c}`).join('\n') + '\n\nRe-read the Scenario README, then audit users, services, software, files and configuration files.', icon: 'info' });
    },
    async reset() {
      const ok = await ui.confirm({ title: 'Reset image', heading: 'Start over from a fresh image?', message: 'All of your changes and your score will be erased.', ok: 'Reset', danger: true });
      if (!ok) return;
      store.del(SAVE_KEY); location.href = location.pathname + '?fresh=1';
    },
    lock() { showLock(env); },
    logout() { showGreeter(env); },
    async power(kind) {
      const label = kind === 'reboot' ? 'Restart' : 'Shut down';
      if (kind === 'poweroff') {
        const ok = await ui.confirm({ title: 'Quit', heading: 'Shut down this simulated computer?', message: 'The image state is saved. You can resume later by reloading this page.', ok: label });
        if (!ok) return;
        save(); document.body.innerHTML = '<div style="color:#bbb;font:16px sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;background:#000">System powered off. Reload this page to start it again.</div>'; return;
      }
      showBoot(env, 'Restarting…', () => { rebootSystem(sys); engine.evaluate(); startAutostart(env); env.wm.wins.slice().forEach((w) => w.close()); env.desktop.renderIcons(); });
    },
  };
  window.cpsim = env;
  env.desktop = new Desktop(env);

  // ---- scoring notifications
  engine.on('score', ({ gained, lost, penalized, cleared }) => {
    for (const v of gained) { ui.toast({ title: `You gained ${v.points} point${v.points === 1 ? '' : 's'}!`, message: v.title, kind: 'good' }); ui.ding('good'); }
    for (const v of lost) { ui.toast({ title: `You lost ${v.points} point${v.points === 1 ? '' : 's'}!`, message: `${v.title} (no longer fixed)`, kind: 'bad' }); ui.ding('bad'); }
    for (const p of penalized) { ui.toast({ title: `You lost ${p.points} points!`, message: p.title, kind: 'bad' }); ui.ding('bad'); }
    void cleared;
    env.desktop.scoreTi.title = `Score: ${engine.score()} / ${engine.maxScore()}`;
  });
  engine.start();

  // ---- background machine behaviour
  setInterval(() => { if (sys.runCronTick(cronEntries(sys))) engine.evaluate(); }, 20000);
  setInterval(() => save(), 4000);
  window.addEventListener('beforeunload', () => save());
  function save() {
    if (!sys.dirty && !env._savedOnce) { env._savedOnce = true; }
    store.set(SAVE_KEY, { v: 1, sys: sys.snapshot(), engine: engine.serialize(), at: Date.now() });
    sys.dirty = false;
  }
  env.save = save;
  startAutostart(env);

  document.getElementById('boot').classList.add('hide');
  setTimeout(() => document.getElementById('boot')?.remove(), 700);
  if (!settings.welcomed && !restored) {
    settings.welcomed = true; env.saveSettings();
    showWelcome(env);
  }
}

function startAutostart(env) {
  for (const l of autostartListeners(env.sys, env.user)) {
    setTimeout(() => {
      if (!env.sys.vfs.exists(l.source)) return;
      if (env.sys.sockets().some((s) => s.port === l.port)) return;
      env.sys.spawn({ user: env.user, cmd: l.cmd, comm: 'nc.traditional', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: l.port }] });
      env.engine.evaluate();
    }, Math.max(l.delayMs, 1000));
  }
}

function showBoot(env, text, then) {
  const b = h('div', { id: 'boot' }, h('div', { style: { fontSize: '15px' } }, text), h('div', { class: 'bar' }, h('i')));
  document.getElementById('screen').append(b);
  setTimeout(() => { then(); b.classList.add('hide'); setTimeout(() => b.remove(), 600); }, 1800);
}

function showWelcome(env) {
  const { ui } = env;
  ui.modal((done) => h('div', { class: 'dlg', style: { maxWidth: '560px' } },
    h('div', { class: 'dt' }, 'Welcome'),
    h('div', { class: 'db' }, icon('shield', 56), h('div', { class: 'txt' },
      h('h3', null, `${env.scenario.title} — ${env.scenario.imageName}`),
      h('p', null, 'This is a practice simulator for CyberPatriot-style Linux hardening. Everything runs in your browser: the desktop, the terminal and the scoring.'),
      h('p', null, 'Start by opening the “Scenario README” on the desktop, then secure the computer. Open the “Scoring Report” to see your points. You can answer the two Forensics Questions by editing the files on the desktop.'),
      h('p', null, h('b', null, 'Your login: '), `${env.scenario.user} / ${env.scenario.password}`),
      h('p', { style: { fontSize: '12px', color: '#6c7378' } }, 'Progress is saved in this browser. Use the chart icon in the panel for hints, scoring speed and reset.'))),
    h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => { done(true); env.openApp('chromium', { args: ['file:///opt/CyberPatriot/README.html'] }); } }, 'Open the README'), h('button', { class: 'btn', onclick: () => done(true) }, 'Start')),
  ));
}

function showLock(env) {
  const user = env.user;
  const u = users.getUser(env.sys, user);
  const err = h('div', { class: 'err', style: { minHeight: '16px', color: '#ff9a94', fontSize: '12px' } });
  const pw = h('input', { class: 'in', type: 'password', placeholder: 'Password', style: { width: '240px' }, onkeydown: (e) => { if (e.key === 'Enter') { if (users.checkPassword(env.sys, user, pw.value)) lock.remove(); else { err.textContent = 'Incorrect password, please try again'; pw.value = ''; } } } });
  const lock = h('div', { style: { position: 'absolute', inset: 0, zIndex: 9950, background: 'radial-gradient(900px 600px at 50% 30%, #3a6a60, #12262c)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', color: '#fff' } },
    icon('users', 80), h('div', { style: { fontSize: '20px' } }, (u.gecos || '').split(',')[0] || user), pw, err, h('div', { style: { fontSize: '12px', opacity: .7 } }, 'Screen locked'));
  document.getElementById('screen').append(lock);
  setTimeout(() => pw.focus(), 30);
}

function showGreeter(env) {
  const { sys } = env;
  env.wm.wins.slice().forEach((w) => w.close());
  const list = users.readPasswd(sys).filter((u) => u.uid >= 1000 && u.uid < 65534 && !/nologin|false/.test(u.shell));
  let chosen = list.find((u) => u.name === env.user) || list[0];
  const err = h('div', { style: { minHeight: '16px', color: '#ff9a94', fontSize: '12px' } });
  const pw = h('input', { class: 'in', type: 'password', placeholder: 'Password', style: { width: '240px' }, onkeydown: (e) => { if (e.key === 'Enter') go(); } });
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' } });
  const guest = K.guestAllowed(sys);
  const render = () => {
    clear(box);
    box.append(icon('users', 80), h('div', { style: { fontSize: '20px' } }, (chosen.gecos || '').split(',')[0] || chosen.name), pw, err, h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn primary', onclick: go }, 'Log In')));
  };
  const go = () => {
    const st = users.getShadow(sys, chosen.name);
    if (users.checkPassword(sys, chosen.name, pw.value)) {
      sys.log('auth.log', 'lightdm', `pam_unix(lightdm:session): session opened for user ${chosen.name}(uid=${chosen.uid}) by (uid=0)`);
      env.user = chosen.name; g.remove(); env.desktop.renderIcons(); env.desktop.menuDirty = true; startAutostart(env);
    } else { err.textContent = st && st.hash.startsWith('!') ? 'Account is locked' : 'Incorrect password, please try again'; pw.value = ''; sys.log('auth.log', 'lightdm', `pam_unix(lightdm:auth): authentication failure; logname= uid=0 euid=0 tty=:0 ruser= rhost=  user=${chosen.name}`); }
  };
  const side = h('div', { style: { position: 'absolute', left: '24px', top: '24px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' } },
    h('div', { style: { opacity: .7, marginBottom: '4px' } }, 'Users'),
    ...list.map((u) => h('div', { style: { padding: '5px 10px', borderRadius: '4px', cursor: 'default', background: 'rgba(255,255,255,.12)' }, onclick: () => { chosen = u; pw.value = ''; err.textContent = ''; render(); pw.focus(); } }, u.name)),
    guest ? h('div', { style: { padding: '5px 10px', borderRadius: '4px', background: 'rgba(255,255,255,.12)' }, onclick: () => { err.textContent = 'Guest sessions are not simulated, but the guest login is enabled on this computer.'; } }, 'Guest Session') : null);
  const g = h('div', { style: { position: 'absolute', inset: 0, zIndex: 9950, background: 'radial-gradient(900px 600px at 50% 30%, #3a6a60, #12262c)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' } }, side, box);
  document.getElementById('screen').append(g);
  render();
  setTimeout(() => pw.focus(), 30);
}

main().catch((e) => { console.error(e); document.getElementById('boot-msg').textContent = 'Failed to start: ' + e.message; });
