// Boot the simulator: restore or build the machine, start scoring, show the desktop.
import { h, clear } from './ui/dom.js';
import { icon, setCustomLogo, setIconTheme } from './ui/icons.js';
import { initTooltips } from './ui/tooltip.js';
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
import mintScenario from './scenarios/mint-round1/index.js';
import ubuntuScenario from './scenarios/ubuntu-round1/index.js';
import { UbuntuDesktop } from './ui/gnome-shell.js';
import { loadApp } from './apps/registry.js';
import { runExec } from './apps/launch.js';
import { parseDesktop } from './ui/dom.js';
import { showLock, showGreeter } from './ui/greeters.js';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};


const SCENARIOS = { mint: mintScenario, ubuntu: ubuntuScenario };
const OS_KEY = 'cpsim.os';

function chooseOs() {
  const qs = new URLSearchParams(location.search);
  const want = qs.get('os') || store.get(OS_KEY);
  if (SCENARIOS[want]) { store.set(OS_KEY, want); return Promise.resolve(want); }
  return new Promise((resolve) => {
    const boot = document.getElementById('boot');
    const card = (id, name, sub, color, logo) => h('div', { onclick: () => { store.set(OS_KEY, id); chooser.remove(); resolve(id); }, style: { cursor: 'pointer', width: '230px', padding: '22px 18px', borderRadius: '10px', background: '#1d2125', border: `2px solid ${color}`, textAlign: 'center', color: '#eee' } },
      h('div', { style: { fontSize: '44px', marginBottom: '8px' }, html: logo }), h('div', { style: { fontSize: '18px', fontWeight: 700 } }, name), h('div', { style: { fontSize: '12px', color: '#9aa0a4', marginTop: '6px' } }, sub));
    const chooser = h('div', { style: { position: 'absolute', inset: 0, zIndex: 10001, background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '26px', fontFamily: 'sans-serif' } },
      h('div', { style: { color: '#fff', fontSize: '26px', fontWeight: 300 } }, 'CyberPatriot Simulator'), h('div', { style: { color: '#9aa0a4' } }, 'Choose an image to practice on'),
      h('div', { style: { display: 'flex', gap: '24px' } },
        card('mint', 'Linux Mint 21', 'Cinnamon desktop · 100-point round', '#8fa876', '🌿'),
        card('ubuntu', 'Ubuntu 22.04', 'GNOME desktop · 100-point round', '#e95420', '🟠')),
      h('div', { style: { color: '#6c7378', fontSize: '12px' } }, 'You can switch later from the simulator menu. Progress is saved separately for each image.'));
    document.getElementById('screen').append(chooser);
    boot?.classList.add('hide');
  });
}
const OS = await chooseOs();
const scenario = SCENARIOS[OS];
document.body.classList.add(`os-${OS}`);
setIconTheme(OS === 'ubuntu' ? 'yaru' : 'mint');
initTooltips();
document.title = `CyberPatriot Simulator — ${scenario.imageName}`;
const bootLabel = document.querySelector('#boot > div'); if (bootLabel) bootLabel.textContent = scenario.imageName;
const SAVE_KEY = `cpsim.save.v1.${scenario.id}`;
const SET_KEY = 'cpsim.settings.v1';
const BROWSER = OS === 'ubuntu' ? 'firefox' : 'chromium';

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
    sys, engine, scenario, wm, ui, settings, user: scenario.user, desktop: null, params, os: OS, browser: BROWSER,
    /** Reboot into another image (progress is saved per image). With no argument: show the chooser. */
    switchOs(id) {
      try { env.save?.(); } catch { /* ignore */ }
      if (SCENARIOS[id]) { store.set(OS_KEY, id); location.href = `${location.pathname}?os=${id}`; } else { store.del(OS_KEY); location.href = location.pathname; }
    },
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
        if (/\.html?$/i.test(path)) return env.openApp(BROWSER, { args: ['file://' + path] });
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
    logout() { showGreeter(env, { onLogin: (name) => { env.user = name; env.desktop.renderIcons(); env.desktop.menuDirty = true; startAutostart(env); } }); },
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
  env.desktop = OS === 'ubuntu' ? new UbuntuDesktop(env) : new Desktop(env);

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
    h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => { done(true); env.openApp(BROWSER, { args: ['file:///opt/CyberPatriot/README.html'] }); } }, 'Open the README'), h('button', { class: 'btn', onclick: () => done(true) }, 'Start')),
  ));
}

main().catch((e) => { console.error(e); document.getElementById('boot-msg').textContent = 'Failed to start: ' + e.message; });
