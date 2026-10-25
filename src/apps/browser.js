// Firefox-style browser: tabs, URL bar, file:// pages from the virtual FS, live Scoring Report.
import { h, clear, esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { FsView, FsError } from '../core/vfs.js';
import * as users from '../core/users.js';
import { reportHtml } from '../ui/report.js';

const START = 'about:home';
const errPage = (title, body) => `<!doctype html><meta charset=utf-8><style>body{font-family:system-ui,sans-serif;background:#f9f9fa;color:#15141a;display:flex;justify-content:center;padding-top:12vh}div{max-width:560px}h1{font-size:26px;font-weight:400}li{margin:6px 0}button{padding:6px 18px;background:#0060df;color:#fff;border:0;border-radius:4px}</style><div><h1>${esc(title)}</h1>${body}</div>`;
const homePage = `<!doctype html><meta charset=utf-8><style>body{font-family:system-ui,sans-serif;background:#f9f9fa;color:#15141a;text-align:center;padding-top:16vh}h1{font-weight:300;font-size:34px;color:#20123a}input{width:420px;padding:10px 14px;border-radius:6px;border:1px solid #b1b1b3;font-size:15px}p{color:#5b5b66}</style><h1>Firefox</h1><input placeholder="Search with DuckDuckGo or enter address" disabled><p>This is a simulated browser. Try <code>file:///opt/cpsim/README.html</code>.</p>`;

export function open(env, opts = {}) {
  const sys = env.sys;
  const user = opts.user || env.user;
  const fs = new FsView(sys.vfs, user === 'root' ? { name: 'root', uid: 0, gid: 0, gids: [0] } : users.credFor(sys, user));
  const tabs = [];
  let cur = null;
  const tabBar = h('div', { class: 'ff-tabs' });
  const url = h('input', { class: 'in urlbar', onkeydown: (e) => { if (e.key === 'Enter') nav(url.value.trim()); } });
  const mk = (t, title, fn) => h('button', { class: 'btn', title, style: { minWidth: '30px', padding: '2px 8px' }, onclick: fn }, t);
  const bBack = mk('◀', 'Back', () => { if (cur && cur.pos > 0) { cur.pos--; load(cur); } });
  const bFwd = mk('▶', 'Forward', () => { if (cur && cur.pos < cur.hist.length - 1) { cur.pos++; load(cur); } });
  const nav_ = h('div', { class: 'ff-nav' }, bBack, bFwd, mk('⟳', 'Reload', () => cur && load(cur)), url, mk('≡', 'Menu', (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left - 120, r.bottom, [{ label: 'New Tab', action: () => newTab(START) }, { label: 'Scoring Report', action: () => newTab('file:///opt/cpsim/ScoreReport.html') }, { label: 'Scenario README', action: () => newTab('file:///opt/cpsim/README.html') }]); }));
  const stage = h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } });
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, tabBar, nav_, stage);
  const win = env.wm.open({ title: 'Mozilla Firefox', icon: 'firefox', width: 900, height: 600, appId: 'firefox', content });
  const unsub = env.engine.on('evaluated', () => { for (const t of tabs) if (t.live) load(t, true); });
  win.onClose(() => unsub());

  function page(t) {
    const u = t.hist[t.pos];
    if (u === 'about:home' || u === 'about:newtab' || u === 'about:blank') return { title: u === 'about:blank' ? 'about:blank' : 'New Tab', html: u === 'about:blank' ? '' : homePage };
    if (u === 'about:preferences') return { title: 'Settings', html: errPage('Settings', '<p>Firefox preferences are not part of the simulated competition surface.</p>') };
    const m = /^file:\/\/(\/.*)$/.exec(u);
    if (m) {
      const p = decodeURIComponent(m[1]);
      if (p === '/opt/cpsim/ScoreReport.html') { t.live = true; return { title: 'Scoring Report', html: reportHtml(env.engine.report(), { mode: env.settings.mode }) }; }
      t.live = false;
      try {
        if (fs.isDir(p)) { const names = fs.readdir(p); return { title: `Index of ${p}`, html: errPage(`Index of ${p}`, `<ul>${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`) }; }
        const data = fs.readFile(p);
        if (/\.html?$/i.test(p)) return { title: (/<title>([^<]*)/i.exec(data) || [])[1] || p.split('/').pop(), html: data };
        return { title: p.split('/').pop(), html: `<!doctype html><meta charset=utf-8><pre style="font-family:monospace;white-space:pre-wrap">${esc(data)}</pre>` };
      } catch (e) {
        if (e instanceof FsError) return { title: 'Problem loading page', html: errPage(e.code === 'EACCES' ? 'Access to the file was denied' : 'File not found', e.code === 'EACCES' ? `<p>The file at ${esc(p)} is not readable. It may have been removed, moved, or file permissions may be preventing access.</p>` : `<p>Firefox can’t find the file at ${esc(p)}.</p><ul><li>Check the file name for capitalization or other typing errors.</li><li>Check to see if the file was moved, renamed or deleted.</li></ul>`) };
        throw e;
      }
    }
    t.live = false;
    const host = u.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
    return { title: 'Server Not Found', html: errPage('Hmm. We’re having trouble finding that site.', `<p>We can’t connect to the server at <b>${esc(host)}</b>.</p><ul><li>This simulator has no internet access.</li><li>Check the address for typing errors such as <b>ww</b>.example.com instead of <b>www</b>.example.com</li></ul><button>Try Again</button>`) };
  }
  function load(t, soft) {
    const pg = page(t);
    t.title = pg.title; t.iframe.srcdoc = pg.html;
    if (t === cur) { url.value = t.hist[t.pos] === 'about:home' ? '' : t.hist[t.pos]; win.setTitle(`${pg.title} — Mozilla Firefox`); bBack.disabled = t.pos <= 0; bFwd.disabled = t.pos >= t.hist.length - 1; }
    drawTabs();
    void soft;
  }
  function norm(s) {
    if (!s) return START;
    if (/^about:/.test(s) || /^[a-z]+:\/\//.test(s)) return s;
    if (s.startsWith('/')) return 'file://' + s;
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return 'https://' + s;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
  }
  function nav(s) { if (!cur) return; const u = norm(s); cur.hist.length = cur.pos + 1; cur.hist.push(u); cur.pos++; load(cur); }
  function sel(t) { cur = t; for (const x of tabs) x.iframe.style.display = x === t ? '' : 'none'; load(t, true); }
  function newTab(u) {
    const iframe = h('iframe', { class: 'browser-frame', sandbox: 'allow-same-origin' });
    const t = { hist: [norm(u)], pos: 0, iframe, title: 'New Tab', live: false };
    tabs.push(t); stage.append(iframe); sel(t); return t;
  }
  function closeTab(t) {
    const i = tabs.indexOf(t); tabs.splice(i, 1); t.iframe.remove();
    if (!tabs.length) { win.close(); return; }
    if (cur === t) sel(tabs[Math.max(0, i - 1)]); else drawTabs();
  }
  function drawTabs() {
    clear(tabBar);
    for (const t of tabs) tabBar.append(h('div', { class: 'ff-tab' + (t === cur ? ' on' : ''), onclick: () => sel(t) }, icon('firefox', 14), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, t.title), h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, '×')));
    tabBar.append(h('div', { class: 'ff-tab', style: { minWidth: 0, background: 'transparent' }, onclick: () => newTab(START) }, '+'));
  }
  const first = (opts.args || []).filter((a) => !a.startsWith('-'));
  if (first.length) first.forEach((a) => newTab(a)); else newTab(START);
  sel(tabs[0]);
  return win;
}
