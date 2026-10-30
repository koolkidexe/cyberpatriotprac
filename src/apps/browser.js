// Web browser: Chromium (Mint's required browser) or Firefox, each drawing its own frame like the real ones do.
// Tabs, history, bookmarks bar, internal pages (settings, about:config, downloads, policies), the simulated training
// web (browser-sites.js) with pop-up blocking, Safe Browsing interstitials and download blocking. Everything the
// browser decides is read from the user's real preference files (src/core/browserprefs.js), so a setting changed in the
// terminal, in a text editor or in the settings page has the same effect, and the scoring reads the same files.
import { h, clear, esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { FsView, FsError } from '../core/vfs.js';
import * as users from '../core/users.js';
import * as BP from '../core/browserprefs.js';
import { reportHtml } from '../ui/report.js';
import { siteFor, DOWNLOADS, START_PAGE, SITES } from './browser-sites.js';
import { chromeSettings, chromeDownloads, chromePolicy, chromeVersion, ffPreferences, ffConfig, ffPolicies, ffDownloads } from './browser-pages.js';

const errDoc = (title, body, dark) => `<!doctype html><meta charset=utf-8><style>body{font-family:"Segoe UI",Ubuntu,system-ui,sans-serif;background:${dark ? '#202124' : '#f9f9fb'};color:${dark ? '#e8eaed' : '#15141a'};display:flex;justify-content:center;padding-top:14vh;margin:0}div{max-width:600px;padding:0 24px}h1{font-size:24px;font-weight:500}li{margin:6px 0}code{color:${dark ? '#9aa0a6' : '#5b5b66'}}.ico{font-size:52px;opacity:.6}</style><div>${body.replace('{T}', `<h1>${esc(title)}</h1>`)}</div>`;

export function open(env, opts = {}) {
  const sys = env.sys;
  const isFF = opts.app === 'firefox';
  const brand = isFF ? 'Mozilla Firefox' : 'Chromium';
  const bicon = isFF ? 'firefox' : 'chromium';
  const user = opts.user || env.user;
  const cred = user === 'root' ? { name: 'root', uid: 0, gid: 0, gids: [0] } : users.credFor(sys, user);
  const fs = new FsView(sys.vfs, cred);
  const state = {};
  env._downloads = env._downloads || { chromium: [], firefox: [] };
  const downloads = env._downloads[bicon];
  const darkPref = () => env.settings.chromiumMode || 'Dark';
  const isDark = () => (isFF ? document.body.classList.contains('ub-dark') : darkPref() !== 'Light');
  const tabs = [];
  let cur = null;

  // ------------------------------------------------------------ frame
  const tabStrip = h('div', { class: 'bx-tabs' });
  const newTabBtn = h('button', { class: 'bx-newtab', title: 'New tab (Ctrl+T)', onclick: () => newTab(homeUrl()) }, '+');
  const strip = h('div', { class: 'bx-strip' }, tabStrip, newTabBtn, h('div', { class: 'bx-drag' }));
  const url = h('input', { class: 'bx-url', spellcheck: false, title: 'Address bar: type an address or a search and press Enter', onkeydown: (e) => { if (e.key === 'Enter') { nav(url.value.trim()); url.blur(); } }, onfocus: () => url.select() });
  const siteInfo = h('span', { class: 'bx-site', title: 'View site information' });
  const popBadge = h('button', { class: 'bx-popbadge', title: 'Pop-ups blocked on this page', style: { display: 'none' }, onclick: (e) => popupBubble(e.currentTarget) }, '⧉');
  const star = h('button', { class: 'bx-ib', title: 'Bookmark this tab', onclick: () => bookmarkCurrent() }, '☆');
  const tb = (txt, title, fn) => h('button', { class: 'bx-ib', title, onclick: fn }, txt);
  const bBack = tb('←', 'Click to go back', () => { if (cur && cur.pos > 0) { cur.pos--; load(cur, { nav: true }); } });
  const bFwd = tb('→', 'Click to go forward', () => { if (cur && cur.pos < cur.hist.length - 1) { cur.pos++; load(cur, { nav: true }); } });
  const bReload = tb('⟳', 'Reload this page', () => cur && load(cur, { nav: true }));
  const bHome = tb('⌂', 'Open the home page', () => nav(homeUrl()));
  const dlBtn = tb('⤓', 'Downloads', (e) => downloadsPanel(e.currentTarget));
  const menuBtn = tb(isFF ? '≡' : '⋮', isFF ? 'Open application menu' : 'Customise and control Chromium', (e) => appMenu(e.currentTarget));
  const omni = h('div', { class: 'bx-omni' }, siteInfo, url, popBadge, star);
  const toolbar = h('div', { class: 'bx-toolbar' }, bBack, bFwd, bReload, bHome, omni, dlBtn, menuBtn);
  const bookmarks = h('div', { class: 'bx-bookmarks' });
  const infobar = h('div', { class: 'bx-infobar', style: { display: 'none' } });
  const stage = h('div', { class: 'bx-stage' });
  const shelf = h('div', { class: 'bx-shelf', style: { display: 'none' } });
  const root = h('div', { class: `bx ${isFF ? 'bx-ff' : 'bx-cr'}` }, strip, toolbar, bookmarks, infobar, stage, shelf);
  const win = env.wm.open({ title: brand, icon: bicon, width: opts.popup ? 560 : 1000, height: opts.popup ? 420 : 660, appId: bicon, content: root, frameless: true, cls: 'bx-win', minW: 420, minH: 260 });
  strip.append(win.controls());
  win.makeDraggable(strip);
  const unsub = env.engine.on('evaluated', () => {
    for (const t of tabs) {
      if (t.live) load(t, { soft: true });
      else if (t.internal && t === cur && t.sig !== prefSig() && !t.view?.querySelector('.ff-sub') && !t.view?.contains(document.activeElement)) load(t, { soft: true });
    }
    applyChrome();
  });
  win.onClose(() => unsub());

  // ------------------------------------------------------------ helpers
  /** Text of every file that can change what an internal page shows (pages refresh only when this changes). */
  const prefSig = () => {
    const home = BP.homeOf(sys, user);
    const rd = (p) => (sys.vfs.isFile(p) ? sys.vfs.readFile(p) : '');
    const dir = BP.firefoxProfileDir(sys, home) || '';
    return [BP.chromiumPrefsPath(home), BP.chromiumBookmarksPath(home), `${dir}/prefs.js`, `${dir}/user.js`, `${dir}/permissions.json`, ...BP.FIREFOX_POLICY_FILES].map(rd).join('\u0000')
      + JSON.stringify(BP.chromiumPolicies(sys)) + (sys.pkgState?.chromium?.version || '');
  };
  const homeUrl = () => {
    if (isFF) { const hp = BP.firefoxGet(sys, user, 'browser.startup.homepage').value; return !hp || /linuxmint\.com|ubuntu\.com/.test(hp) ? 'about:home' : hp; }
    return 'chrome://newtab';
  };
  function norm(s) {
    if (!s) return homeUrl();
    if (/^about:/.test(s)) return isFF ? s : s.replace(/^about:/, 'chrome://');
    if (/^(chrome|about|file|https?):/.test(s)) return isFF ? s.replace(/^chrome:\/\//, 'about:') : s;
    if (s.startsWith('/')) return 'file://' + s;
    if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return (/\.(example|test)\b/.test(s) ? 'http://' : 'https://') + s;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
  }
  const ctxFor = (t) => ({
    env, sys, user, io: fs, state, brand, nav, refresh: () => load(t, { soft: true }), downloads: () => downloads,
    darkPref, setDark: (m) => { env.settings.chromiumMode = m; env.saveSettings?.(); applyChrome(); load(t, { soft: true }); },
  });
  const popupsAllowed = (u) => BP.popupsAllowed(sys, user, bicon, u);
  const threatBlocked = (threat) => BP.safeBrowsingBlocks(sys, user, bicon, threat);
  const downloadBlocked = () => BP.dangerousDownloadsBlocked(sys, user, bicon);

  // ------------------------------------------------------------ pages
  function internalPage(t, u) {
    const ctx = ctxFor(t);
    const m = /^(?:chrome|about):\/{0,2}([\w-]+)(?:\/([^#?]*))?(?:#(\w+))?/.exec(u) || [];
    const [, name, sub, hash] = m;
    if (isFF) {
      if (name === 'preferences') return { title: 'Settings', view: ffPreferences(ctx, hash || 'general') };
      if (name === 'config') return { title: 'Advanced Preferences', view: ffConfig(ctx) };
      if (name === 'policies') return { title: 'Policies', view: ffPolicies(ctx) };
      if (name === 'downloads') return { title: 'Downloads', view: ffDownloads(ctx) };
      if (name === 'home' || name === 'newtab') return { title: 'New Tab', view: newTabPage() };
      if (name === 'blank') return { title: 'New Tab', view: h('div') };
      return { title: 'Problem loading page', html: errDoc('Page not found', `<p class="ico">🦊</p>{T}<p>Firefox doesn’t know about <code>${esc(u)}</code> in this simulator.</p>`, isDark()) };
    }
    if (name === 'settings') return { title: 'Settings', view: chromeSettings(ctx, sub || '') };
    if (name === 'downloads') return { title: 'Downloads', view: chromeDownloads(ctx) };
    if (name === 'policy') return { title: 'Policies', view: chromePolicy(ctx) };
    if (name === 'version') return { title: 'About Version', view: chromeVersion(ctx) };
    if (name === 'newtab' || name === 'new-tab-page') return { title: 'New Tab', view: newTabPage() };
    if (name === 'blank') return { title: 'about:blank', view: h('div') };
    return { title: u, html: errDoc('This site can’t be reached', `<p class="ico">☹</p>{T}<p>The webpage at <b>${esc(u)}</b> might be temporarily down or it may have moved permanently to a new web address.</p><p><code>ERR_INVALID_URL</code></p>`, isDark()) };
  }
  function newTabPage() {
    const tiles = [['Scenario README', 'file:///opt/CyberPatriot/README.html', 'cyberpatriot'], ['Scoring Report', 'file:///opt/CyberPatriot/ScoringReport.html', 'score'], ['Practice sites', START_PAGE, 'info'],
      ['Prize winner', 'http://www.prize-winner.example/', 'warn'], ['Pop-up test', 'http://popuptest.example/', 'app'], ['Free games', 'http://free-games.example/', 'error']];
    const q = h('input', { class: 'bx-ntp-q', placeholder: isFF ? 'Search with DuckDuckGo or enter address' : 'Search DuckDuckGo or type a URL', title: 'Search or type an address', onkeydown: (e) => { if (e.key === 'Enter') nav(q.value.trim()); } });
    setTimeout(() => q.focus(), 0);
    return h('div', { class: 'bx-ntp' }, h('div', { class: 'bx-ntp-logo' }, icon(bicon, 64)), q,
      h('div', { class: 'bx-ntp-tiles' }, tiles.map(([n, u, ic]) => h('div', { class: 'bx-tile', title: u, onclick: () => nav(u) }, h('div', { class: 'bx-tile-i' }, icon(ic, 28)), h('div', null, n)))),
      h('div', { class: 'bx-ntp-note' }, 'Simulated browser: only the practice sites and local files work.'));
  }
  function interstitial(t, u, site) {
    const go = () => { t.bypass.add(site.host); load(t, { nav: true }); };
    const back = () => { if (t.pos > 0) { t.pos--; t.hist.length = t.pos + 1; load(t, { nav: true }); } else nav(homeUrl()); };
    if (isFF) {
      const adv = h('div', { class: 'sb-adv', style: { display: 'none' } }, h('p', null, `Firefox Safe Browsing flagged ${site.host} as ${site.threat === 'phishing' ? 'a deceptive site that may trick you into giving away passwords or card numbers' : 'a site that may install harmful software'}.`), h('button', { class: 'sb-link', title: 'Visit the site anyway (not recommended)', onclick: go }, 'Ignore the risk'));
      return h('div', { class: 'sb-ff' }, h('div', { class: 'sb-box' }, h('div', { class: 'sb-icon' }, '⚠'), h('h1', null, site.threat === 'phishing' ? 'Deceptive site ahead' : 'Dangerous site ahead'),
        h('p', null, `Firefox blocked this page because it may ${site.threat === 'phishing' ? 'trick you into doing something dangerous like revealing a password or card number' : 'try to install dangerous software on your computer'}.`),
        h('div', { class: 'sb-btns' }, h('button', { class: 'sb-primary', title: 'Leave this site', onclick: back }, 'Go back'), h('button', { class: 'sb-sec', title: 'Show more information', onclick: () => { adv.style.display = adv.style.display ? '' : 'none'; } }, 'Advanced…')), adv));
    }
    const det = h('div', { class: 'sb-adv', style: { display: 'none' } }, h('p', null, `Google Safe Browsing recently ${site.threat === 'phishing' ? 'detected phishing' : 'found malware'} on ${site.host}. Websites that are normally safe are sometimes infected.`), h('p', null, 'If you understand the risks to your security, you may ', h('button', { class: 'sb-link', title: 'Visit the site anyway (not recommended)', onclick: go }, 'visit this unsafe site'), '.'));
    return h('div', { class: 'sb-cr' }, h('div', { class: 'sb-box' }, h('div', { class: 'sb-icon' }, '⚠'), h('h1', null, 'Dangerous site'),
      h('p', null, site.threat === 'phishing' ? `Attackers on ${site.host} might trick you into doing something dangerous like installing software or revealing your personal information (for example, passwords, phone numbers or credit cards).` : `Attackers currently on ${site.host} might attempt to install dangerous programs on your computer that steal or delete your information.`),
      h('div', { class: 'sb-btns' }, h('button', { class: 'sb-sec', title: 'Show details', onclick: () => { det.style.display = det.style.display ? '' : 'none'; } }, 'Details'), h('button', { class: 'sb-primary', title: 'Go back to safety', onclick: back }, 'Back to safety')), det));
  }
  function page(t) {
    const u = t.hist[t.pos];
    t.live = false; t.internal = false; t.threatened = false;
    if (/^(chrome|about):/.test(u)) { t.internal = true; return internalPage(t, u); }
    const m = /^file:\/\/(\/.*)$/.exec(u);
    if (m) {
      const p = decodeURIComponent(m[1]);
      if (p === '/opt/CyberPatriot/ScoringReport.html') { t.live = true; return { title: 'CCS Scoring Report', html: reportHtml(env.engine.report(), { mode: env.settings.mode, title: `CyberPatriot ${env.scenario.title}`, imageName: env.os === 'ubuntu' ? 'Ubuntu 22' : 'Mint 21' }) }; }
      try {
        if (fs.isDir(p)) { const names = fs.readdir(p).sort(); return { title: `Index of ${p}`, html: errDoc(`Index of ${p}`, `{T}<ul>${p !== '/' ? `<li><a href="file://${esc(p.replace(/\/[^/]+\/?$/, '') || '/')}">[parent directory]</a></li>` : ''}${names.map((n) => `<li><a href="file://${esc((p.endsWith('/') ? p : p + '/') + n)}">${esc(n)}</a></li>`).join('')}</ul>`, isDark()) }; }
        const data = fs.readFile(p);
        if (/\.html?$/i.test(p)) return { title: (/<title>([^<]*)/i.exec(data) || [])[1] || p.split('/').pop(), html: data };
        return { title: p.split('/').pop(), html: `<!doctype html><meta charset=utf-8><pre style="font-family:monospace;white-space:pre-wrap;margin:8px">${esc(data)}</pre>` };
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        if (isFF) return { title: 'Problem loading page', html: errDoc(e.code === 'EACCES' ? 'Access to the file was denied' : 'File not found', `{T}${e.code === 'EACCES' ? `<p>The file at ${esc(p)} is not readable. It may have been removed, moved, or file permissions may be preventing access.</p>` : `<p>Firefox can’t find the file at ${esc(p)}.</p><ul><li>Check the file name for capitalisation or other typing errors.</li><li>Check to see if the file was moved, renamed or deleted.</li></ul>`}`, isDark()) };
        return { title: p.split('/').pop(), html: errDoc(e.code === 'EACCES' ? 'Your file couldn’t be accessed' : 'Your file couldn’t be accessed', `<p class="ico">🗋</p>{T}<p>It may have been moved, edited or deleted.</p><p><code>${e.code === 'EACCES' ? 'ERR_ACCESS_DENIED' : 'ERR_FILE_NOT_FOUND'}</code></p>`, isDark()) };
      }
    }
    const site = siteFor(u);
    if (!site || site.missing) {
      const host = site?.host || u;
      if (isFF) return { title: 'Server Not Found', html: errDoc('Hmm. We’re having trouble finding that site.', `{T}<p>We can’t connect to the server at <b>${esc(host)}</b>.</p><ul><li>This simulated computer has no internet access. Open the practice sites from the New Tab page.</li><li>Check the address for typing errors.</li></ul>`, isDark()) };
      return { title: host, html: errDoc('This site can’t be reached', `<p class="ico">☹</p>{T}<p>Check if there is a typo in <b>${esc(host)}</b>.</p><p>This simulated computer has no internet access; open the practice sites from the New Tab page.</p><p><code>ERR_NAME_NOT_RESOLVED</code></p>`, isDark()) };
    }
    if (site.threat && threatBlocked(site.threat) && !t.bypass.has(site.host)) { t.internal = true; t.threatened = true; return { title: isFF ? 'Deceptive site ahead' : 'Security error', view: interstitial(t, u, site) }; }
    return { title: site.title, html: site.html(site.path), site };
  }

  // ------------------------------------------------------------ loading, tabs
  function load(t, { soft = false, nav: isNav = false } = {}) {
    const pg = page(t);
    t.sig = prefSig();
    t.title = pg.title;
    clear(t.box);
    if (pg.view) { t.view = pg.view; t.box.append(pg.view); t.iframe = null; } else {
      const iframe = h('iframe', { class: 'bx-frame', sandbox: 'allow-same-origin' });
      iframe.addEventListener('load', () => hookFrame(t, iframe));
      iframe.srcdoc = pg.html; t.iframe = iframe; t.view = iframe; t.box.append(iframe);
    }
    if (isNav || !soft) {
      t.blocked = [];
      if (pg.site?.popups && !opts.popup && pg.site.path === '/') for (const p of pg.site.popups) { if (popupsAllowed(t.hist[t.pos])) openPopup(p); else t.blocked.push(p); }
    }
    if (t === cur) showCur();
    drawTabs();
  }
  function hookFrame(t, iframe) {
    let d; try { d = iframe.contentDocument; } catch { return; }
    if (!d) return;
    d.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.download) { startDownload(a.dataset.download, a.getAttribute('href')); return; }
      const href = a.getAttribute('href');
      if (href.startsWith('#')) { d.getElementById(href.slice(1))?.scrollIntoView(); return; }
      let target = href;
      try { target = new URL(href, /^https?:/.test(t.hist[t.pos]) ? t.hist[t.pos] : 'http://local.invalid/').href.replace('http://local.invalid', ''); } catch { /* keep */ }
      if (e.ctrlKey || e.button === 1 || a.target === '_blank') newTab(target); else nav(target);
    });
    d.addEventListener('submit', (e) => { e.preventDefault(); env.ui.toast({ title: 'Simulated page', message: 'Forms do not send anything in the simulator.', kind: 'info' }); });
  }
  function showCur() {
    const t = cur;
    for (const x of tabs) x.box.style.display = x === t ? '' : 'none';
    const u = t.hist[t.pos];
    url.value = /^(chrome:\/\/newtab|about:home|about:newtab)$/.test(u) ? '' : u;
    url.placeholder = isFF ? 'Search with DuckDuckGo or enter address' : 'Search DuckDuckGo or type a URL';
    win.setTitle(`${t.title} ${isFF ? '—' : '-'} ${brand}`);
    bBack.disabled = t.pos <= 0; bFwd.disabled = t.pos >= t.hist.length - 1;
    const site = siteFor(u);
    siteInfo.textContent = /^(chrome|about):/.test(u) ? (isFF ? '🦊' : '◉') : /^file:/.test(u) ? '🗋' : site?.scheme === 'https' ? '🔒' : site ? '⚠' : '';
    siteInfo.title = /^https:/.test(u) ? 'Connection is secure' : /^http:/.test(u) ? 'Not secure: this site uses an unencrypted connection' : /^file:/.test(u) ? 'Local or shared file' : `Secure ${brand} page`;
    siteInfo.className = 'bx-site' + (/^http:/.test(u) ? ' warn' : '');
    if (!isFF) { popBadge.style.display = t.blocked?.length ? '' : 'none'; infobar.style.display = 'none'; } else showInfobar(t);
    if (t.blocked?.length && !isFF && !t.bubbleShown) { t.bubbleShown = true; setTimeout(() => popBadge.classList.add('flash'), 10); setTimeout(() => popBadge.classList.remove('flash'), 1600); }
  }
  function showInfobar(t) {
    clear(infobar);
    if (!t.blocked?.length) { infobar.style.display = 'none'; return; }
    infobar.style.display = '';
    const host = siteFor(t.hist[t.pos])?.host || '';
    infobar.append(h('span', { class: 'bx-ib-ic' }, '⧉'), h('span', { style: { flex: 1 } }, `Firefox prevented this site from opening ${t.blocked.length} pop-up window${t.blocked.length > 1 ? 's' : ''}.`),
      h('button', { class: 'ff-b', title: 'Pop-up options for this site', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        env.ui.showMenu(r.left - 160, r.bottom, [
          { label: `Allow pop-ups for ${host}`, action: () => { try { BP.setFirefoxPopupAllowList(sys, user, [...new Set([...BP.firefoxPopupAllowList(sys, user), BP.plainOrigin(t.hist[t.pos])])], fs); } catch (err) { env.ui.alert({ title: 'Error', heading: 'Could not save', message: err.message, icon: 'error' }); } load(t, { nav: true }); } },
          { label: 'Manage pop-up settings…', action: () => newTab('about:preferences#privacy') },
          { label: 'Don’t show this message when pop-ups are blocked', action: () => { t.blocked = []; showInfobar(t); } },
          ...t.blocked.map((p) => ({ label: `Show ‘${p}’`, action: () => { openPopup(p); t.blocked = t.blocked.filter((x) => x !== p); showInfobar(t); } })),
        ]);
      } }, 'Options'),
      h('button', { class: 'bx-ib', title: 'Close this message', onclick: () => { t.blocked = []; showInfobar(t); } }, '✕'));
  }
  function popupBubble(anchor) {
    const t = cur;
    if (!t?.blocked?.length) return;
    const origin = BP.chromiumOrigin(t.hist[t.pos]);
    const r = anchor.getBoundingClientRect();
    let choice = 'block';
    const bubble = h('div', { class: 'bx-bubble', style: { left: Math.max(8, r.right - 330) + 'px', top: r.bottom + 6 + 'px' } },
      h('div', { class: 'bx-bub-t' }, 'Pop-ups blocked:'),
      t.blocked.map((p) => h('div', null, h('a', { href: '#', title: `Open ${p} anyway`, onclick: (e) => { e.preventDefault(); openPopup(p); } }, p))),
      h('label', { class: 'bx-bub-r', title: 'Add this site to the allowed list' }, h('input', { type: 'radio', name: 'pb', onchange: () => { choice = 'allow'; } }), ` Always allow pop-ups and redirects from ${BP.displayOrigin(origin)}`),
      h('label', { class: 'bx-bub-r', title: 'Keep blocking pop-ups here' }, h('input', { type: 'radio', name: 'pb', checked: true, onchange: () => { choice = 'block'; } }), ' Continue blocking'),
      h('div', { class: 'bx-bub-f' }, h('button', { class: 'cr-btn', title: 'Open pop-up settings', onclick: () => { bubble.remove(); newTab('chrome://settings/content/popups'); } }, 'Manage'),
        h('button', { class: 'cr-btn primary', title: 'Apply and close', onclick: () => { bubble.remove(); if (choice === 'allow') { try { BP.chromiumSetException(sys, user, 'popups', origin, 1, fs); } catch (err) { env.ui.alert({ title: 'Error', heading: 'Could not save', message: err.message, icon: 'error' }); } } } }, 'Done')));
    document.getElementById('screen').append(bubble);
    const off = (e) => { if (!bubble.contains(e.target) && e.target !== anchor) { bubble.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }
  function openPopup(u) { open(env, { ...opts, args: [u], popup: true }); }
  function nav(s) { if (!cur) return; const u = norm(s); cur.hist.length = cur.pos + 1; cur.hist.push(u); cur.pos++; cur.bubbleShown = false; load(cur, { nav: true }); }
  function sel(t) { cur = t; showCur(); drawTabs(); }
  function newTab(u) {
    const t = { hist: [norm(u)], pos: 0, box: h('div', { class: 'bx-tab-box' }), title: 'New Tab', live: false, bypass: new Set(), blocked: [] };
    tabs.push(t); stage.append(t.box); cur = t; load(t, { nav: true }); return t;
  }
  function closeTab(t) {
    const i = tabs.indexOf(t); tabs.splice(i, 1); t.box.remove();
    if (!tabs.length) { win.close(); return; }
    if (cur === t) sel(tabs[Math.max(0, i - 1)]); else drawTabs();
  }
  function drawTabs() {
    clear(tabStrip);
    if (opts.popup) { tabStrip.append(h('div', { class: 'bx-tab on bx-popup' }, icon(bicon, 16), h('span', { class: 'bx-tt' }, cur?.title || ''))); return; }
    for (const t of tabs) {
      const fav = t.threatened ? h('span', { class: 'bx-fav' }, '⚠') : /^file:\/\/\/opt\/CyberPatriot/.test(t.hist[t.pos]) ? icon('cyberpatriot', 16) : /^(chrome|about):/.test(t.hist[t.pos]) ? icon(/settings|preferences|config/.test(t.hist[t.pos]) ? 'gear' : bicon, 16) : icon(/^file:/.test(t.hist[t.pos]) ? 'file' : 'net', 16);
      tabStrip.append(h('div', { class: 'bx-tab' + (t === cur ? ' on' : ''), title: t.title, onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } }, onclick: () => sel(t) },
        fav, h('span', { class: 'bx-tt' }, t.title), h('button', { class: 'bx-tx', title: 'Close tab', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, '✕')));
    }
  }

  // ------------------------------------------------------------ downloads
  function startDownload(name, href) {
    const d = DOWNLOADS[name] || { size: 1024, dangerous: false, data: '(simulated download)\n' };
    const home = BP.homeOf(sys, user);
    const item = { name, url: href, blocked: false, path: `${home}/Downloads/${name}`, at: Date.now() };
    if (d.dangerous && downloadBlocked()) item.blocked = true;
    else {
      try {
        let path = item.path; let n = 1;
        while (fs.exists(path)) path = `${home}/Downloads/${name.replace(/(\.[^.]+)?$/, ` (${n++})$1`)}`;
        const o = users.getUser(sys, user) || { uid: 0, gid: 0 };
        const node = fs.writeFile(path, d.data, { mode: 0o664, uid: o.uid, gid: o.gid });
        if (node && d.size) node.size = d.size;
        item.path = path;
        sys.log?.('syslog', isFF ? 'firefox' : 'chromium', `download finished: ${path}`);
      } catch (e) { item.blocked = true; item.error = e.message; }
    }
    downloads.push(item);
    if (isFF) downloadsPanel(dlBtn); else drawShelf();
    dlBtn.classList.add('bx-dl-flash'); setTimeout(() => dlBtn.classList.remove('bx-dl-flash'), 1200);
  }
  function drawShelf() {
    clear(shelf);
    if (!downloads.length) { shelf.style.display = 'none'; return; }
    shelf.style.display = '';
    for (const d of downloads.slice(-4).reverse()) {
      shelf.append(h('div', { class: 'bx-chip' + (d.blocked ? ' bad' : ''), title: d.blocked ? `${d.name} is dangerous, so Chromium has blocked it` : `Saved to ${d.path}` }, d.blocked ? h('span', { class: 'bx-chip-w' }, '⚠') : icon('file', 22),
        h('div', null, h('div', { class: 'bx-chip-n' }, d.name), h('div', { class: 'bx-chip-s' }, d.blocked ? (d.error ? 'Failed - Insufficient permissions' : 'Blocked: dangerous file') : `${(DOWNLOADS[d.name]?.size / 1048576 || 0.1).toFixed(1)} MB`)),
        d.blocked ? h('button', { class: 'cr-btn', title: 'Remove this item', onclick: () => { downloads.splice(downloads.indexOf(d), 1); drawShelf(); } }, 'Discard') : null));
    }
    shelf.append(h('div', { style: { flex: 1 } }), h('button', { class: 'cr-btn', title: 'Open chrome://downloads', onclick: () => newTab('chrome://downloads') }, 'Show all'), h('button', { class: 'bx-ib', title: 'Close the download bar', onclick: () => { shelf.style.display = 'none'; } }, '✕'));
  }
  function downloadsPanel(anchor) {
    if (!isFF) { if (downloads.length) { drawShelf(); } else newTab('chrome://downloads'); return; }
    const r = anchor.getBoundingClientRect();
    const panel = h('div', { class: 'bx-bubble ff-dlp', style: { left: Math.max(8, r.right - 340) + 'px', top: r.bottom + 6 + 'px' } },
      downloads.length ? downloads.slice(-5).reverse().map((d) => h('div', { class: 'ff-dl' + (d.blocked ? ' bad' : '') }, icon(d.blocked ? 'warn' : 'file', 28), h('div', null, h('div', null, d.name), h('div', { class: 'cr-sub' + (d.blocked ? ' red' : '') }, d.blocked ? 'File contains a virus or malware' : 'Completed')))) : h('div', { class: 'cr-empty' }, 'No downloads for this session.'),
      h('button', { class: 'ff-b', style: { width: '100%', marginTop: '6px' }, title: 'Open the Library window', onclick: () => { panel.remove(); newTab('about:downloads'); } }, 'Show all downloads'));
    document.getElementById('screen').append(panel);
    const off = (e) => { if (!panel.contains(e.target)) { panel.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  }

  // ------------------------------------------------------------ menus, bookmarks, chrome
  function appMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const st = isFF ? 'about:preferences' : 'chrome://settings';
    env.ui.showMenu(r.right - 230, r.bottom, [
      { label: 'New tab', action: () => newTab(homeUrl()) },
      { label: 'New window', action: () => open(env, { ...opts, args: [] }) },
      { label: 'Downloads', action: () => newTab(isFF ? 'about:downloads' : 'chrome://downloads') },
      { label: 'Scenario README', action: () => newTab('file:///opt/CyberPatriot/README.html') },
      { label: 'Scoring Report', action: () => newTab('file:///opt/CyberPatriot/ScoringReport.html') },
      { label: 'Practice sites', action: () => newTab(START_PAGE) },
      { label: 'Settings', action: () => newTab(st) },
      ...(isFF ? [{ label: 'Advanced preferences (about:config)', action: () => newTab('about:config') }, { label: 'Policies (about:policies)', action: () => newTab('about:policies') }] : [{ label: 'Policies (chrome://policy)', action: () => newTab('chrome://policy') }, { label: 'About Chromium', action: () => newTab('chrome://settings/help') }]),
      { label: isFF ? 'Quit' : 'Exit', action: () => win.close() },
    ]);
  }
  function bookmarkList() { return isFF ? BP.firefoxBookmarks(sys, user) : BP.chromiumBookmarks(sys, user); }
  function bookmarkCurrent() {
    if (!cur) return;
    const u = cur.hist[cur.pos];
    const list = bookmarkList();
    if (list.some((b) => b.url === u)) { env.ui.toast({ title: 'Bookmark', message: 'This page is already bookmarked.', kind: 'info' }); return; }
    try { (isFF ? BP.writeFirefoxBookmarks : BP.writeChromiumBookmarks)(sys, user, [...list, { name: cur.title, url: u }], fs); applyChrome(); env.ui.toast({ title: 'Bookmark added', message: cur.title, kind: 'info' }); } catch (e) { env.ui.alert({ title: 'Error', heading: 'Could not add the bookmark', message: e.message, icon: 'error' }); }
  }
  function applyChrome() {
    root.classList.toggle('dark', isDark());
    win.el.classList.toggle('bx-dark', isDark());
    bHome.style.display = (isFF || BP.chromiumGet(sys, user, 'browser.show_home_button').value) ? '' : 'none';
    clear(bookmarks);
    const showBar = !opts.popup && (isFF ? /about:(home|newtab)/.test(cur?.hist[cur.pos] || '') : !!BP.chromiumGet(sys, user, 'bookmark_bar.show_on_all_tabs').value);
    bookmarks.style.display = showBar ? '' : 'none';
    const marks = [{ name: 'README', url: 'file:///opt/CyberPatriot/README.html' }, { name: 'Scoring Report', url: 'file:///opt/CyberPatriot/ScoringReport.html' }, { name: 'Practice sites', url: START_PAGE }, ...bookmarkList()];
    for (const b of marks) bookmarks.append(h('button', { class: 'bx-bm', title: b.url, onclick: () => nav(b.url) }, icon(/CyberPatriot/.test(b.url) ? 'cyberpatriot' : 'net', 14), b.name));
    if (opts.popup) { toolbar.classList.add('bx-popup'); newTabBtn.style.display = 'none'; }
  }
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); newTab(homeUrl()); } else if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (cur) closeTab(cur); } else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); url.focus(); } else if (e.key === 'F5') { e.preventDefault(); if (cur) load(cur, { nav: true }); }
  });

  const first = (opts.args || []).filter((a) => !a.startsWith('-'));
  applyChrome();
  if (first.length) first.forEach((a) => newTab(a)); else newTab(homeUrl());
  sel(tabs[0]);
  applyChrome();
  void SITES;
  return win;
}
