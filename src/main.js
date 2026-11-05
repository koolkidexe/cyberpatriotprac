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
import { makeRound, newSeed } from './scenarios/deck/index.js';
import { UbuntuDesktop } from './ui/gnome-shell.js';
import { loadApp } from './apps/registry.js';
import { runExec } from './apps/launch.js';
import { parseDesktop } from './ui/dom.js';
import { showLock, showGreeter } from './ui/greeters.js';
import windowsRound1, { makeWinRound, windows10Round1 } from './scenarios/win-deck/index.js';
import { WinDesktop, showWinLock, showWinSignIn } from './ui/win-shell.js';
import * as WS from './win/state.js';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};


const SCENARIOS = { mint: mintScenario, ubuntu: ubuntuScenario, windows10: windows10Round1, windows: windowsRound1 };
const dealRound = (os, seed) => (os === 'windows10' ? makeWinRound(seed, { ver: 10 }) : os === 'windows' ? makeWinRound(seed) : makeRound(os, seed));
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
        card('ubuntu', 'Ubuntu 22.04', 'GNOME desktop · 100-point round', '#e95420', '🟠'),
        card('windows10', 'Windows 10 Pro', 'Like the competition images · 100-point round', '#0078d7', '🪟'),
        card('windows', 'Windows 11 Pro', 'Windows 11 shell · 100-point round', '#3b8ed8', '🔷')),
      h('div', { style: { color: '#6c7378', fontSize: '12px' } }, 'You can switch later from the simulator menu. Progress is saved separately for each image.'));
    document.getElementById('screen').append(chooser);
    boot?.classList.add('hide');
  });
}
const OS_ID = await chooseOs(); // mint | ubuntu | windows10 | windows
const OS = OS_ID === 'windows10' ? 'windows' : OS_ID;
// Which round is loaded: the fixed Practice Round 1, or a randomly dealt one ("reshuffle", rebuilt from its seed).
const ROUND_KEY = `cpsim.round.${OS_ID}`;
const round = store.get(ROUND_KEY) || { kind: 'fixed' };
let scenario = SCENARIOS[OS_ID];
if (round.kind === 'deck') { try { scenario = dealRound(OS_ID, round.seed); } catch (e) { console.error('could not deal round', e); store.del(ROUND_KEY); } }
// A save only fits the exact set of checks it was made with. Restoring a save into a different (e.g. updated) set of
// checks is what handed out free points on load, so a mismatch starts a fresh image instead.
const FINGERPRINT = `${scenario.id}|v${scenario.version || 1}|${scenario.vulns.map((v) => `${v.id}:${v.points}`).join(',')}|${scenario.penalties.map((p) => p.id).join(',')}`;
document.body.classList.add(`os-${OS}`);
if (OS_ID === 'windows10') document.body.classList.add('win10');
setIconTheme(OS === 'ubuntu' ? 'yaru' : 'mint');
const WIN = OS === 'windows';
initTooltips();
document.title = `CyberPatriot Simulator — ${scenario.imageName}`;
const bootLabel = document.querySelector('#boot > div'); if (bootLabel) bootLabel.textContent = scenario.imageName;
const SAVE_KEY = `cpsim.save.v2.${OS_ID}`;
store.del(`cpsim.save.v1.${SCENARIOS[OS_ID].id}`); // saves from before versioning are not trusted
const SET_KEY = 'cpsim.settings.v1';
const BROWSER = OS === 'ubuntu' || WIN ? 'firefox' : 'chromium';
const README_URL = WIN ? 'file:///C:/CyberPatriot/README.html' : 'file:///opt/CyberPatriot/README.html';

const bootMsg = (t) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = t; };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  const params = new URLSearchParams(location.search);
  if (params.has('fresh')) { store.del(SAVE_KEY); }
  const settings = { mode: 'instant', sound: true, welcomed: false, ...(store.get(SET_KEY) || {}) };
  bootMsg('Loading virtual machine…'); await tick();

  let sys; let engineState = null; let restored = false;
  const saved = store.get(SAVE_KEY);
  let staleSave = false;
  if (saved && saved.sys && saved.fp !== FINGERPRINT) { staleSave = true; store.del(SAVE_KEY); }
  else if (saved && saved.sys) {
    try { sys = System.restore(saved.sys); if (!WIN) mountVirtual(sys); engineState = saved.engine; restored = true; } catch (e) { console.error('restore failed', e); sys = null; }
  }
  if (!sys) sys = scenario.createMachine({});
  sys.dirty = false;

  // Optional: drop your own logo at assets/cyberpatriot-logo.png and it replaces the built-in badge icon.
  await new Promise((res) => { const im = new Image(); im.onload = () => { setCustomLogo('assets/cyberpatriot-logo.png'); res(); }; im.onerror = res; im.src = 'assets/cyberpatriot-logo.png'; });
  const ui = new UI({ overlay: document.getElementById('overlay'), toasts: document.getElementById('toasts'), sys });
  ui.soundOn = settings.sound;
  ui.preloadSounds();
  const wm = new WindowManager(document.getElementById('winlayer'));
  const engine = new ScoringEngine(sys, scenario, engineState);
  engine.setMode(settings.mode);

  const env = {
    sys, engine, scenario, wm, ui, settings, user: scenario.user, desktop: null, params, os: OS, osId: OS_ID, winVer: OS_ID === 'windows10' ? 10 : 11, browser: BROWSER, readmeUrl: README_URL,
    /** Reboot into another image (progress is saved per image). With no argument: show the chooser. */
    switchOs(id) {
      try { env.save?.(); } catch { /* ignore */ }
      if (SCENARIOS[id]) { store.set(OS_KEY, id); location.href = `${location.pathname}?os=${id}`; } else { store.del(OS_KEY); location.href = location.pathname; }
    },
    saveSettings() { store.set(SET_KEY, settings); },
    userFs() { return new FsView(sys.vfs, WIN ? { name: env.user, uid: 0, gid: 0, gids: [0] } : users.credFor(sys, env.user)); },
    async openApp(id, opts = {}) {
      try { const open = await loadApp(id, OS); return open(env, { ...opts, app: id }); } catch (e) { console.error(e); ui.alert({ title: 'Error', heading: 'The application failed to start', message: String(e.message || e), icon: 'error' }); return null; }
    },
    openPath(path, opts = {}) {
      if (WIN) return winOpenPath(env, path, opts);
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
    /** Deal a brand-new random round of tasks (new people, files, answers and checks). */
    async reshuffle({ ask = true } = {}) {
      if (ask) {
        const ok = await ui.confirm({ title: 'Reshuffle', heading: 'Deal a new round of tasks?', message: 'You get a fresh image with a new random set of problems, people and forensics questions. Your progress on this round is discarded.', ok: 'Reshuffle' });
        if (!ok) return;
      }
      store.set(ROUND_KEY, { kind: 'deck', seed: newSeed() });
      store.del(SAVE_KEY); location.href = `${location.pathname}?os=${OS_ID}&fresh=1`;
    },
    async reset() {
      const ok = await ui.confirm({ title: 'Reset image', heading: 'Start over from a fresh image?', message: 'All of your changes and your score will be erased.', ok: 'Reset', danger: true });
      if (!ok) return;
      store.del(SAVE_KEY); location.href = `${location.pathname}?os=${OS_ID}&fresh=1`;
    },
    lock() { if (WIN) return showWinLock(env); showLock(env); },
    logout() { if (WIN) return showWinSignIn(env, { onLogin: (name) => { env.user = name; env.desktop.renderIcons(); } }); showGreeter(env, { onLogin: (name) => { env.user = name; env.desktop.renderIcons(); env.desktop.menuDirty = true; startAutostart(env); } }); },
    async power(kind) {
      const label = kind === 'reboot' ? 'Restart' : 'Shut down';
      if (kind === 'poweroff') {
        const ok = await ui.confirm({ title: 'Quit', heading: 'Shut down this simulated computer?', message: 'The image state is saved. You can resume later by reloading this page.', ok: label });
        if (!ok) return;
        save(); document.body.innerHTML = '<div style="color:#bbb;font:16px sans-serif;display:flex;height:100vh;align-items:center;justify-content:center;background:#000">System powered off. Reload this page to start it again.</div>'; return;
      }
      if (WIN) { showBoot(env, 'Restarting', () => { winReboot(sys); engine.evaluate(); env.wm.wins.slice().forEach((w) => w.close()); env.desktop.renderIcons(); }); return; }
      showBoot(env, 'Restarting…', () => { rebootSystem(sys); engine.evaluate(); startAutostart(env); env.wm.wins.slice().forEach((w) => w.close()); env.desktop.renderIcons(); });
    },
  };
  // ---- CyberPatriot scoring client (Windows): Competitor Agreement, Set Unique Identifier, Stop Scoring
  if (WIN) {
    const uidKey = `uid:${scenario.id}`;
    const stopKey = `stopped:${scenario.id}`;
    engine.paused = !!settings[stopKey];
    env.ccs = {
      uid: () => settings[uidKey] || null,
      agreement() {
        return ui.modal((done) => {
          const cb = h('input', { type: 'checkbox', onchange: () => { go.disabled = !cb.checked; } });
          const go = h('button', { class: 'w-btn', disabled: true, onclick: () => done(true) }, 'Continue');
          return h('div', { class: 'ccs-dlg', style: { width: '320px' } }, h('div', { class: 'ccs-t' }, 'CyberPatriot Competitor Agreement'),
            h('div', { class: 'ccs-b' }, h('p', null, 'While practicing with CyberPatriot images:'), h('p', null, 'I will consider the ethical and legal implications of all of my actions. I will not attack, hack, penetrate or interfere with another team\'s or individual\'s computer system.'), h('p', null, 'I will not keep or share competition images outside their allowed dates of use.'), h('p', null, 'I will follow the rules of my competition.'), h('p', null, 'I will enter my team\'s Unique Identifier immediately.')),
            h('div', { class: 'ccs-f' }, h('label', null, cb, ' I Agree'), go));
        });
      },
      async setUid() {
        const ok = await env.elevate({ what: 'CyberPatriot Set Unique Identifier' }); if (!ok) return;
        const v = await ui.modal((done) => {
          const inp = h('input', { class: 'ccs-in', maxLength: 14, value: settings[uidKey] || '', placeholder: 'XXXX-XXXX-XXXX', onkeydown: (e) => { if (e.key === 'Enter') sub(); } });
          const err = h('div', { style: { color: '#c00', minHeight: '16px', fontSize: '12px' } });
          const sub = () => { const t = inp.value.trim().toUpperCase(); if (t.replace(/-/g, '').length !== 12 || !/^[A-Z0-9-]+$/.test(t)) { err.textContent = 'Your Unique Identifier must be 12 letters or digits.'; return; } done(t.replace(/-/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3')); };
          return h('div', { class: 'ccs-dlg', style: { width: '330px' } }, h('div', { class: 'ccs-t' }, 'Set Unique Identifier'),
            h('div', { class: 'ccs-b', style: { textAlign: 'center' } }, h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Enter Your 12 Character Unique Identifier*'), inp, err, h('div', { style: { fontSize: '11px', color: '#555' } }, '*Practice image: any 12 letters or digits work.')),
            h('div', { class: 'ccs-f' }, h('button', { class: 'w-btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'w-btn primary', onclick: sub }, 'Apply')));
        });
        if (!v) return;
        settings[uidKey] = v; delete settings[stopKey]; engine.paused = false; env.saveSettings(); engine.evaluate();
        ui.toast({ title: 'CCS Client', message: `Unique Identifier set to ${v}. Scoring is running.`, kind: 'info' });
      },
      async stop() {
        const ok = await env.elevate({ what: 'CyberPatriot Stop Scoring' }); if (!ok) return;
        const yes = await ui.confirm({ title: 'CyberPatriot Stop Scoring', heading: 'Are you sure you want to stop scoring?', message: 'On a competition image this ends scoring for the image permanently. In this practice simulator scoring is only paused: set the Unique Identifier again (or use the CyberPatriot icon in the notification area) to resume.', ok: 'Yes', cancel: 'No', icon: 'w-warn' });
        if (!yes) return;
        settings[stopKey] = true; engine.paused = true; env.saveSettings();
        ui.toast({ title: 'CCS Client', message: 'Scoring has been stopped.', kind: 'info' });
      },
      resume() { delete settings[stopKey]; engine.paused = false; env.saveSettings(); engine.evaluate(); },
    };
  }
  window.cpsim = env;
  env.desktop = WIN ? new WinDesktop(env) : OS === 'ubuntu' ? new UbuntuDesktop(env) : new Desktop(env);

  // ---- scoring notifications
  engine.on('score', ({ gained, lost, penalized, cleared }) => {
    for (const v of gained) { ui.toast({ title: `You gained ${v.points} point${v.points === 1 ? '' : 's'}!`, message: v.title, kind: 'good' }); }
    for (const v of lost) { ui.toast({ title: `You lost ${v.points} point${v.points === 1 ? '' : 's'}!`, message: `${v.title} (no longer fixed)`, kind: 'bad' }); }
    for (const p of penalized) { ui.toast({ title: `You lost ${p.points} points!`, message: p.title, kind: 'bad' }); }
    // one sound per scoring update: the alarm if anything was lost, otherwise the gain sound
    if (lost.length || penalized.length) ui.ding('bad'); else if (gained.length) ui.ding('good');
    void cleared;
    env.desktop.scoreTi.title = `Score: ${engine.score()} / ${engine.maxScore()}`;
    if (gained.length && engine.score() >= engine.maxScore() && !engine.report().penalties.length) roundComplete(env);
  });
  engine.start();

  // ---- background machine behaviour
  if (WIN) setInterval(() => { if (WS.tick(sys)) engine.evaluate(); }, 8000);
  else setInterval(() => { if (sys.runCronTick(cronEntries(sys))) engine.evaluate(); }, 20000);
  setInterval(() => save(), 4000);
  window.addEventListener('beforeunload', () => save());
  function save() {
    if (!sys.dirty && !env._savedOnce) { env._savedOnce = true; }
    store.set(SAVE_KEY, { v: 2, fp: FINGERPRINT, sys: sys.snapshot(), engine: engine.serialize(), at: Date.now() });
    sys.dirty = false;
  }
  env.save = save;
  startAutostart(env);

  document.getElementById('boot').classList.add('hide');
  setTimeout(() => document.getElementById('boot')?.remove(), 700);
  if (staleSave) ui.toast({ title: 'Fresh image started', message: 'The simulator was updated since your last visit, so your old save no longer matched the scoring. A fresh copy of the image was started.', kind: 'info', ms: 10000 });
  if (WIN && !restored && !settings[`uid:${scenario.id}`]) { env.ccs.agreement().then(() => env.ccs.setUid()); }
  if (!settings.welcomed && !restored) {
    settings.welcomed = true; env.saveSettings();
    showWelcome(env);
  }
}

function roundComplete(env) {
  const key = `done:${env.scenario.id}`;
  if (env.settings[key]) return;
  env.settings[key] = true; env.saveSettings();
  setTimeout(() => env.ui.modal((done) => h('div', { class: 'dlg', style: { maxWidth: '520px' } },
    h('div', { class: 'dt' }, 'Round complete'),
    h('div', { class: 'db' }, icon('score', 56), h('div', { class: 'txt' },
      h('h3', null, `100 out of 100 — all ${env.scenario.vulns.length} checks found!`),
      h('p', null, 'Every problem in this round is fixed and there are no penalties. Deal a new random round to keep practising: new people, new files, new forensics questions and a different set of problems.'))),
    h('div', { class: 'df' }, h('button', { class: 'btn', title: 'Stay on this round', onclick: () => done(false) }, 'Not now'),
      h('button', { class: 'btn primary', title: 'Deal a new random round', onclick: () => { done(true); env.reshuffle({ ask: false }); } }, '↻ Reshuffle')))), 1500);
}

function startAutostart(env) {
  if (env.os === 'windows') return;
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
      h('p', null, `This is a practice simulator for CyberPatriot-style ${env.os === 'windows' ? 'Windows' : 'Linux'} hardening. Everything runs in your browser: the desktop, the ${env.os === 'windows' ? 'PowerShell terminal, the management consoles' : 'terminal'} and the scoring.`),
      h('p', null, `Start by opening the “Scenario README” on the desktop, then secure the computer. Open the “Scoring Report” to see your points. You can answer the ${env.scenario.forensics.length} Forensics Questions by editing the files on the desktop.`),
      h('p', null, h('b', null, 'Your login: '), `${env.scenario.user} / ${env.scenario.password}`),
      env.os === 'windows' ? h('p', null, 'Most fixes need administrator rights: right-click Terminal in Start and choose “Run as administrator”, or use Computer Management and Local Security Policy.') : null,
      h('p', { style: { fontSize: '12px', color: '#6c7378' } }, `Progress is saved in this browser. Use the chart icon in the ${env.os === 'windows' ? 'taskbar' : 'panel'} for hints, scoring speed and reset.`))),
    h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => { done(true); env.openApp(BROWSER, { args: [env.readmeUrl] }); } }, 'Open the README'), h('button', { class: 'btn', onclick: () => done(true) }, 'Start')),
  ));
}

// ---- Windows: opening files from Explorer or the desktop, and restarting
function winOpenPath(env, path, opts = {}) {
  const { sys, ui } = env;
  const real = WS.resolve(sys, path);
  const name = real.split('/').pop();
  try {
    if (sys.vfs.isDir(real)) return env.openApp('explorer', { path: real });
    if (!sys.vfs.exists(real)) { ui.alert({ title: 'Location is not available', heading: `${WS.toWin(real)} is not accessible.`, message: 'The system cannot find the file specified.', icon: 'w-warn' }); return null; }
    if (/\.url$/i.test(name)) { const u = /^URL=(.*)$/m.exec(sys.vfs.readFile(real))?.[1]; return env.openApp('firefox', { args: [u || 'about:blank'] }); }
    if (/\.lnk$/i.test(name)) {
      const t = sys.vfs.readFile(real);
      const target = t.replace(/^\[shortcut\]\s*/, '').trim();
      if (/CCSClientUID\.exe/i.test(t)) return env.ccs?.setUid();
      if (/CCSStopScoring\.exe/i.test(t)) return env.ccs?.stop();
      const app = /firefox\.exe|chrome\.exe|msedge/i.test(t) ? 'firefox' : /thunderbird\.exe/i.test(t) ? 'thunderbird' : /notepad\+\+\.exe/i.test(t) ? 'notepadpp' : /wireshark\.exe/i.test(t) ? 'wireshark' : null;
      if (app) return env.openApp(app, {});
      const tp = WS.resolve(sys, WS.fromWin(target));
      if (/^[a-z]:\\/i.test(target) && sys.vfs.exists(tp) && !/\.(exe|bat|cmd|msi)$/i.test(tp)) return winOpenPath(env, tp, opts);
      if (/^[a-z]:\\/i.test(target) && !sys.vfs.exists(tp)) { ui.alert({ title: 'Problem with Shortcut', heading: `The item '${target.split('\\').pop()}' that this shortcut refers to has been changed or moved, so this shortcut will no longer work properly.`, message: target, icon: 'w-warn' }); return null; }
      ui.alert({ title: name.replace(/\.lnk$/i, ''), heading: 'This program is not part of the simulation', message: `The shortcut points to ${t.replace(/^\[shortcut\]\s*/, '')}. Uninstall unwanted programs from Settings > Apps or with winget.`, icon: 'w-info' }); return null;
    }
    if (/\.(pcap|pcapng|cap)$/i.test(name)) { if (WS.listPrograms(sys).some((p) => p.id === 'WiresharkFoundation.Wireshark')) return env.openApp('wireshark', { path: real }); ui.alert({ title: name, heading: 'How do you want to open this file?', message: 'No app is installed that opens .pcap files. Wireshark opens packet captures.', icon: 'w-info' }); return null; }
    if (/\.html?$/i.test(name)) return env.openApp('firefox', { args: ['file:///' + WS.toWin(real).replace(/\\/g, '/')] });
    if (/\.(exe|msi|bat|cmd|ps1|sys|dll)$/i.test(name)) { ui.alert({ title: name, heading: 'Windows protected your PC', message: 'Running programs from files is not part of the simulation. Remove unwanted programs and files instead.', icon: 'w-security' }); return null; }
    if (/\.(mp3|ogg|wav|flac|mp4|mkv|avi|png|jpe?g|gif)$/i.test(name)) { ui.alert({ title: name, heading: 'Media Player', message: `${name} would play here. Personal media files are usually prohibited on CyberPatriot images.`, icon: 'w-media' }); return null; }
    return env.openApp(/\.(conf|cfg|xml|json|py|c|ps1|bat|cmd|js|php|ini)$/i.test(name) && WS.listPrograms(sys).some((p) => p.id === 'Notepad++.Notepad++') ? 'notepadpp' : 'notepad', { path: real, ...opts });
  } catch (e) { ui.alert({ title: 'Error', heading: `Could not open “${name}”`, message: e.message, icon: 'w-bad' }); return null; }
}
function winReboot(sys) {
  // services set to start automatically come up; stopped/disabled stay down; user programs restart from Run keys/tasks
  for (const s of WS.listServices(sys)) {
    for (const p of sys.processes.filter((x) => x.svc === `win:${s.name}`)) sys.killProc(p.pid);
    if (/^Automatic/.test(s.startType)) { s.status = 'Running'; WS.spawnFor(sys, s); } else if (s.status === 'Running' && s.startType === 'Disabled') s.status = 'Stopped'; else if (s.status === 'Running') WS.spawnFor(sys, s);
  }
  for (const u of WS.pendingUpdates(sys)) void u;
  WS.tick(sys);
  sys.touch('win');
}

main().catch((e) => { console.error(e); document.getElementById('boot-msg').textContent = 'Failed to start: ' + e.message; });
