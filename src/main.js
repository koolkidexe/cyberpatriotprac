// Entry point: boots the scenario, restores saved progress, and builds the desktop.
import { buildScenario } from './scenarios/mint-round1/index.js';
import { System } from './core/system.js';
import { mountVirtual } from './images/mint21.js';
import { ScoringEngine } from './core/scoring.js';
import { cronEntries } from './core/cron.js';
import * as users from './core/users.js';
import { WindowManager } from './ui/wm.js';
import { openTerminal } from './ui/terminal.js';
import { openBrowser, openEditor, openFiles, openPlanned, parseDesktop } from './ui/apps.js';
import { TOOLS, settingsApp } from './ui/admin-apps.js';
import { icon, kindFor } from './ui/icons.js';
import { FsView } from './core/vfs.js';
import { scenario as SCENARIO } from './scenarios/mint-round1/index.js';

const KEY = 'cpsim.mint-round1.v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const app = { sys: null, engine: null, wm: null, delayMs: 0 };
window.cpsim = app; // handy for the browser console while debugging

function load() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const saved = JSON.parse(raw);
    const sys = System.restore(saved.sys, {}); mountVirtual(sys);
    return { sys, engine: saved.engine, delayMs: saved.delayMs ?? 0 };
  } catch (e) { console.warn('could not restore saved image', e); return null; }
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ sys: app.sys.snapshot(), engine: app.engine.serialize(), delayMs: app.delayMs })); } catch (e) { console.warn('save failed', e); } }, 800); }

function boot(fresh = false) {
  const restored = fresh ? null : load();
  if (restored) { app.sys = restored.sys; app.delayMs = restored.delayMs; } else { app.sys = buildScenario().sys; app.delayMs = 0; }
  app.engine?.detach();
  app.engine = new ScoringEngine(app.sys, SCENARIO, { delayMs: app.delayMs });
  if (restored?.engine) app.engine.restore(restored.engine);
  app.engine.attach({ onTick: () => app.sys.runCronTick(cronEntries(app.sys)) });
  app.engine.on('gain', (e) => toast(`You Gained Points!`, `${e.title} (+${e.points})`)); // eslint-disable-line
  app.engine.on('loss', (e) => toast('You Lost Points', `${e.title} (${e.points})`, true));
  app.engine.on('penalty', (e) => toast('Penalty', `${e.title} (${e.points})`, true));
  app.engine.on('update', () => { updateScore(); save(); });
  app.sys.on('change', save);
}

function toast(head, body, bad = false) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.innerHTML = `<b>${esc(head)}</b><small>${esc(body)}</small>`; $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 6000);
  try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = bad ? 220 : 880; g.gain.setValueAtTime(0.06, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.4); o.start(); o.stop(a.currentTime + 0.4); } catch { /* no audio */ }
}
const dialog = (html, buttons = [['OK']]) => new Promise((res) => { const ov = $('#overlay'); ov.innerHTML = `<div class="dlg">${html}<div class="row"></div></div>`; const row = ov.querySelector('.row'); buttons.forEach(([label, val, cls]) => { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = label; b.onclick = () => { ov.classList.remove('open'); res(val ?? label); }; row.appendChild(b); }); ov.classList.add('open'); });

// ------------------------------------------------------------------ launching
app.launch = (name, args = [], ctx = {}) => {
  const user = ctx.root ? 'root' : ctx.user || 'student';
  const file = args.find((a) => a && !a.startsWith('-')); const abs = file && !/^(https?|file|sim):/.test(file) ? (file.startsWith('/') ? file : `${ctx.cwd || '/'}/${file}`) : file;
  switch (name) {
    case 'firefox': return openBrowser(app, app.wm, { url: file ? (/^(https?|file|sim):/.test(file) ? file : abs) : 'sim://scoring-report', user });
    case 'xed': return openEditor(app, app.wm, { path: abs || null, user });
    case 'nemo': return openFiles(app, app.wm, { path: abs, user });
    case 'gnome-terminal': return openTerminal(app, app.wm, { user });
    case 'cinnamon-settings': return app.wm.open({ title: 'System Settings', kind: 'settings', width: 520, height: 300, content: (w) => settingsApp(app, w, (x) => app.launch(x, [], ctx)) });
    default: {
      const t = TOOLS[name];
      if (t) return app.wm.open({ title: t[0], kind: t[1], width: t[3], height: t[4], content: (w) => { w.user = user === 'root' ? 'student' : user; t[2](app, w); } });
      return openPlanned(app, app.wm, appName(name));
    }
  }
};
const appName = (n) => ({ gufw: 'Firewall Configuration', mintupdate: 'Update Manager', mintinstall: 'Software Manager', 'gnome-system-monitor': 'System Monitor', 'cinnamon-settings': 'System Settings', 'users-admin': 'Users and Groups' }[n] || n);
app.openPath = (p, user = 'student') => {
  const fs = new FsView(app.sys.vfs, users.credFor(app.sys, user));
  if (/\.desktop$/.test(p)) { try { app.runDesktop(parseDesktop(fs.readFile(p)).Exec || ''); } catch { /* unreadable */ } return; }
  if (/\.html?$/.test(p)) return app.launch('firefox', [p], { user });
  if (fs.isDir(p)) return app.launch('nemo', [p], { user });
  return app.launch('xed', [p], { user, cwd: '/' });
};
app.runDesktop = (exec) => { const parts = exec.replace(/%[a-zA-Z]/g, '').trim().split(/\s+/); const cmd = parts[0]; if (!cmd) return; app.launch(cmd, parts.slice(1)); };

// ------------------------------------------------------------------ desktop icons, panel, menu
function desktopIcons() {
  const d = $('#desktop'); d.querySelectorAll('.dicon').forEach((e) => e.remove());
  const fs = new FsView(app.sys.vfs, users.credFor(app.sys, 'student'));
  let names = []; try { names = fs.readdir('/home/student/Desktop').filter((n) => !n.startsWith('.')).sort(); } catch { /* missing */ }
  const items = [{ n: 'Computer', k: 'monitor', act: () => app.launch('nemo', ['/']) }, { n: 'Home', k: 'folder', act: () => app.launch('nemo', ['/home/student']) }];
  for (const n of names) { const p = `/home/student/Desktop/${n}`; let label = n; let k = 'file'; if (/\.desktop$/.test(n)) { try { const e = parseDesktop(fs.readFile(p)); label = e.Name || n; k = /Score/i.test(label) ? 'score' : /README/i.test(label) ? 'doc' : 'generic'; } catch { /* skip */ } } items.push({ n: label, k, act: () => app.openPath(p, 'student') }); }
  items.forEach((it, i) => { const e = document.createElement('div'); e.className = 'dicon'; e.style.left = 12 + Math.floor(i / 6) * 96 + 'px'; e.style.top = 10 + (i % 6) * 92 + 'px'; e.innerHTML = `<img src="${icon(it.k)}"><span>${esc(it.n)}</span>`; e.onclick = (ev) => { d.querySelectorAll('.dicon.sel').forEach((x) => x.classList.remove('sel')); e.classList.add('sel'); ev.stopPropagation(); }; e.ondblclick = it.act; d.appendChild(e); });
}
function menuApps() {
  const fs = new FsView(app.sys.vfs, users.credFor(app.sys, 'student')); const apps = [];
  try { for (const n of fs.readdir('/usr/share/applications')) { if (!n.endsWith('.desktop')) continue; const e = parseDesktop(fs.readFile(`/usr/share/applications/${n}`)); if (e.NoDisplay === 'true') continue; apps.push({ name: e.Name || n, comment: e.Comment || '', exec: e.Exec || '', cat: (e.Categories || 'Other').split(';')[0] || 'Other' }); } } catch { /* none */ }
  apps.push({ name: 'Users and Groups', comment: 'Manage user accounts', exec: 'users-admin', cat: 'System' }, { name: 'Login Window', comment: 'Change the login screen', exec: 'login-window', cat: 'System' }, { name: 'Startup Applications', comment: 'Choose what starts at login', exec: 'startup-apps', cat: 'System' }, { name: 'Terminal', comment: 'Use the command line', exec: 'gnome-terminal', cat: 'Accessories' }, { name: 'Files', comment: 'Browse your files', exec: 'nemo', cat: 'Accessories' });
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
let menuCat = 'All';
function renderMenu() {
  const apps = menuApps(); const cats = ['All', ...new Set(apps.map((a) => a.cat))].sort((a, b) => (a === 'All' ? -1 : a.localeCompare(b)));
  const m = $('#menu'); const q = (m.querySelector('input')?.value || '').toLowerCase();
  m.innerHTML = `<div class="cats">${cats.map((c) => `<div class="cat ${c === menuCat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</div>`).join('')}</div><div class="apps"><input placeholder="Search…" value="${esc(q)}" style="width:100%;padding:6px;margin-bottom:6px"><div class="list"></div></div><div class="foot"><button class="btn" data-a="term">Terminal</button><button class="btn" data-a="reset">Reset image…</button></div>`;
  const list = m.querySelector('.list');
  for (const a of apps.filter((x) => (menuCat === 'All' || x.cat === menuCat) && (!q || x.name.toLowerCase().includes(q)))) { const d = document.createElement('div'); d.className = 'app'; d.innerHTML = `<img src="${icon(kindFor(a.exec + a.name.toLowerCase()))}"><div>${esc(a.name)}<small>${esc(a.comment)}</small></div>`; d.onclick = () => { m.classList.remove('open'); app.runDesktop(a.exec); }; list.appendChild(d); }
  m.querySelectorAll('.cat').forEach((c) => { c.onclick = () => { menuCat = c.dataset.c; renderMenu(); }; });
  const inp = m.querySelector('input'); inp.oninput = () => { const v = inp.value; renderMenu(); const i2 = m.querySelector('input'); i2.value = v; i2.focus(); };
  m.querySelector('[data-a=term]').onclick = () => { m.classList.remove('open'); app.launch('gnome-terminal'); };
  m.querySelector('[data-a=reset]').onclick = resetImage;
}
async function resetImage() {
  $('#menu').classList.remove('open'); $('#smenu').classList.remove('open');
  if ((await dialog('<h3>Reset the image?</h3><p>This throws away all your changes and score and starts the scenario again.</p>', [['Cancel', false], ['Reset', true, 'primary']])) !== true) return;
  localStorage.removeItem(KEY); location.reload();
}
function buildPanel() {
  const p = $('#panel');
  p.innerHTML = `<button class="menu-btn">Menu</button><button data-l="firefox" title="Firefox">🌐</button><button data-l="term" title="Terminal">&gt;_</button><button data-l="nemo" title="Files">📁</button><div class="tasks"></div><div class="score" title="Simulator score (hidden on a real CyberPatriot image)">Score <b id="sc">0</b></div><button class="clock"></button><button class="sim" title="Simulator options">⚙</button>
  <div id="menu"></div><div class="pmenu" id="smenu"><div data-a="report">Open Scoring Report</div><div data-a="readme">Open README</div><hr><div data-a="delay">Scoring delay: <b id="dl"></b> (click to change)</div><div data-a="hide">Show/hide panel score</div><hr><div data-a="reset">Reset image…</div><div data-a="about">About this simulator</div></div>`;
  p.querySelector('.menu-btn').onclick = (e) => { e.stopPropagation(); renderMenu(); $('#menu').classList.toggle('open'); $('#smenu').classList.remove('open'); };
  p.querySelector('[data-l=firefox]').onclick = () => app.launch('firefox', ['/opt/CyberPatriot/README.html']);
  p.querySelector('[data-l=term]').onclick = () => app.launch('gnome-terminal'); p.querySelector('[data-l=nemo]').onclick = () => app.launch('nemo');
  p.querySelector('.sim').onclick = (e) => { e.stopPropagation(); $('#dl').textContent = app.delayMs ? `${app.delayMs / 1000}s` : 'instant'; $('#smenu').classList.toggle('open'); $('#menu').classList.remove('open'); };
  $('#smenu').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; $('#smenu').classList.remove('open');
    if (a === 'report') app.launch('firefox', ['sim://scoring-report']); else if (a === 'readme') app.launch('firefox', ['/opt/CyberPatriot/README.html']);
    else if (a === 'delay') { app.delayMs = app.delayMs === 0 ? 30000 : app.delayMs === 30000 ? 60000 : 0; app.engine.delayMs = app.delayMs; save(); toast('Scoring delay', app.delayMs ? `Fixes are credited after ${app.delayMs / 1000}s, like a real image` : 'Instant scoring'); }
    else if (a === 'hide') $('#panel .score').style.display = $('#panel .score').style.display === 'none' ? '' : 'none';
    else if (a === 'reset') resetImage();
    else if (a === 'about') dialog('<h3>Mint Practice Image (unofficial)</h3><p>A browser-based practice environment inspired by CyberPatriot. Everything runs locally in your browser: the files, users, packages and services are all simulated.</p><p>Not affiliated with the Air &amp; Space Forces Association, CyberPatriot, Linux Mint or Mozilla.</p>');
  };
  document.addEventListener('click', () => { $('#menu').classList.remove('open'); $('#smenu').classList.remove('open'); });
  $('#menu').addEventListener('click', (e) => e.stopPropagation());
  const tick = () => { const d = new Date(); p.querySelector('.clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }; tick(); setInterval(tick, 20000);
}
function updateScore() { const el = $('#sc'); if (el) el.textContent = `${app.engine.score} / ${app.engine.maxScore}`; }
function renderTasks() {
  const t = $('#panel .tasks'); if (!t) return; t.innerHTML = '';
  for (const w of app.wm.list()) { const b = document.createElement('button'); b.className = 'task' + (app.wm.active === w ? ' active' : ''); b.innerHTML = `<img src="${icon(w.kind)}" width="16" height="16" style="vertical-align:-3px"> ${esc(w.title)}`; b.onclick = () => (app.wm.active === w && !w.min ? app.wm.minimize(w) : app.wm.focus(w)); t.appendChild(b); }
}

boot();
app.wm = new WindowManager($('#desktop'), renderTasks);
buildPanel(); updateScore(); desktopIcons();
app.sys.on('change', () => { clearTimeout(app._di); app._di = setTimeout(desktopIcons, 400); });
$('#desktop').addEventListener('mousedown', (e) => { if (e.target.id === 'desktop') $('#desktop').querySelectorAll('.dicon.sel').forEach((x) => x.classList.remove('sel')); });
app.motd = '';
openTerminal(app, app.wm, { user: 'student' });
setTimeout(() => toast('Welcome', 'Double-click README on the desktop to start. Your score is shown in the panel.'), 600);
