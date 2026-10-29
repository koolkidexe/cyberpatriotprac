// Internal browser pages, drawn as DOM inside the browser window: chrome://settings, chrome://downloads, chrome://policy,
// chrome://version, about:preferences (with the Exceptions sub-dialogs), about:config, about:policies, about:downloads.
// Every control reads and writes the real preference files through src/core/browserprefs.js.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as BP from '../core/browserprefs.js';
import * as pk from '../core/packages.js';

// ---------------------------------------------------------------- small widgets
const managedTip = 'This setting is managed by your organization (enterprise policy)';
const building = () => h('span', { class: 'bp-managed', title: managedTip }, '🏢');

function toggle(on, { disabled, onchange, title }) {
  const el = h('button', { class: 'cr-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled, title: title || (on ? 'Turn off' : 'Turn on'),
    onclick: () => { if (!disabled) onchange(!on); } }, h('i'));
  return el;
}
function crRow(label, sub, control, { managed, onclick, arrow } = {}) {
  return h('div', { class: 'cr-row' + (onclick ? ' link' : ''), onclick, title: onclick ? `Open ${label}` : null },
    h('div', { class: 'cr-lbl' }, h('div', null, label), sub ? h('div', { class: 'cr-sub' }, sub) : null),
    managed ? building() : null, control || null, arrow ? h('span', { class: 'cr-arrow' }, '›') : null);
}
function crRadio(name, value, cur, label, sub, { disabled, onpick }) {
  return h('label', { class: 'cr-radio' + (disabled ? ' dis' : ''), title: disabled ? managedTip : `Choose “${label}”` },
    h('input', { type: 'radio', name, checked: value === cur, disabled, onchange: () => onpick(value) }),
    h('div', null, h('div', null, label), sub ? h('div', { class: 'cr-sub' }, sub) : null));
}
function ffCheck(label, checked, { disabled, onchange, title, indent }) {
  return h('label', { class: 'ff-check' + (disabled ? ' dis' : '') + (indent ? ' ind' : ''), title: title || (disabled ? 'Locked by your organization or by user.js' : null) },
    h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onchange(e.target.checked) }), h('span', null, label));
}
function guard(ctx, fn) {
  try { fn(); } catch (e) { ctx.env.ui.alert({ title: 'Error', heading: 'Could not save the setting', message: e.text || e.message || String(e), icon: 'error' }); }
  ctx.refresh();
}

// ================================================================= Chromium
const CR_NAV = [
  ['You and Google', 'people', 'users'], ['Autofill and passwords', 'autofill', 'key'], ['Privacy and security', 'privacy', 'shield'],
  ['Performance', 'performance', 'pulse'], ['Appearance', 'appearance', 'image'], ['Search engine', 'search', 'question'],
  ['Default browser', 'defaultBrowser', 'chromium'], ['On start-up', 'onStartup', 'power'], ['Languages', 'languages', 'info'],
  ['Downloads', 'downloads', 'folder-downloads'], ['Accessibility', 'accessibility', 'users'], ['System', 'system', 'gear'],
  ['Reset settings', 'reset', 'refresh'], ['About Chromium', 'help', 'chromium'],
];

export function chromeSettings(ctx, sub) {
  const { sys, user, io } = ctx;
  const pol = BP.chromiumPolicies(sys);
  const managedAny = Object.keys(pol).length > 0;
  const get = (k) => BP.chromiumGet(sys, user, k);
  const set = (changes) => guard(ctx, () => BP.setChromium(sys, user, changes, io));
  const section = (sub || '').split('/')[0] || 'people';
  const main = h('div', { class: 'cr-main' });
  const card = (...kids) => h('div', { class: 'cr-card' }, ...kids);
  const head = (t, back) => h('div', { class: 'cr-h' }, back ? h('button', { class: 'cr-back', title: 'Back', onclick: () => ctx.nav(back) }, '←') : null, t);
  const tog = (key, label, subt) => { const g = get(key); return crRow(label, subt, toggle(!!g.value, { disabled: g.managed, onchange: (v) => set({ [key]: v }) }), { managed: g.managed }); };

  if (managedAny) main.append(h('div', { class: 'cr-managed', title: 'Open chrome://policy to see the policies', onclick: () => ctx.nav('chrome://policy') }, building(), ' Your browser is managed by your organization'));

  if (sub === 'security') {
    const sb = BP.chromiumSafeBrowsing(sys, user);
    const pick = (lvl) => guard(ctx, () => BP.chromiumSetSafeBrowsing(sys, user, lvl, io));
    main.append(head('Security', 'chrome://settings/privacy'), card(
      h('div', { class: 'cr-st' }, 'Safe Browsing'),
      h('div', { class: 'cr-sub', style: { padding: '0 20px 8px' } }, 'Protects you against dangerous websites, downloads and extensions.'),
      crRadio('sb', 2, sb.level, 'Enhanced protection', 'Faster, proactive protection against dangerous websites, downloads and extensions.', { disabled: sb.managed, onpick: pick }),
      crRadio('sb', 1, sb.level, 'Standard protection', 'Protects against websites, downloads and extensions that are known to be dangerous.', { disabled: sb.managed, onpick: pick }),
      crRadio('sb', 0, sb.level, 'No protection (not recommended)', 'Does not protect you against dangerous websites, downloads and extensions.', { disabled: sb.managed, onpick: pick }),
      sb.managed ? h('div', { class: 'cr-sub', style: { padding: '6px 20px' } }, building(), ' Safe Browsing is set by an enterprise policy.') : null),
    card(h('div', { class: 'cr-st' }, 'Advanced'), tog('https_only_mode_enabled', 'Always use secure connections', 'Upgrade navigations to HTTPS and warn you before loading sites that don’t support it')));
  } else if (sub === 'content/popups') {
    const g = BP.chromiumPopupSetting(sys, user);
    const ex = BP.chromiumExceptions(sys, user, 'popups');
    const pick = (v) => set({ 'profile.default_content_setting_values.popups': v });
    const list = (title, arr, setting) => card(h('div', { class: 'cr-st cr-lr' }, title,
      h('button', { class: 'cr-btn', disabled: g.managed, title: `Add a site to “${title}”`, onclick: async () => {
        const v = await ctx.env.ui.prompt({ title: 'Add a site', message: 'Site (for example http://www.example.com)', value: 'http://' });
        if (!v || !/^https?:\/\/[^/]+/.test(v.trim())) return;
        guard(ctx, () => BP.chromiumSetException(sys, user, 'popups', BP.chromiumOrigin(v.trim()), setting, io));
      } }, 'Add')),
    arr.length ? arr.map((o) => crRow(BP.displayOrigin(o), null, h('button', { class: 'cr-icon', title: `Remove ${BP.displayOrigin(o)}`, onclick: () => guard(ctx, () => BP.chromiumSetException(sys, user, 'popups', o, null, io)) }, '🗑'))) : h('div', { class: 'cr-empty' }, 'No sites added'));
    main.append(head('Pop-ups and redirects', 'chrome://settings/content'), card(
      h('div', { class: 'cr-sub', style: { padding: '14px 20px 4px' } }, 'Sites might send pop-ups to show ads, or use redirects to lead you to websites that you may want to avoid.'),
      h('div', { class: 'cr-st' }, 'Default behaviour'),
      crRadio('pop', 1, Number(g.value), 'Sites can send pop-ups and use redirects', null, { disabled: g.managed, onpick: pick }),
      crRadio('pop', 2, Number(g.value), 'Don’t allow sites to send pop-ups or use redirects', null, { disabled: g.managed, onpick: pick }),
      g.managed ? h('div', { class: 'cr-sub', style: { padding: '6px 20px' } }, building(), ' This setting is enforced by the DefaultPopupsSetting policy.') : null),
    list('Allowed to send pop-ups and use redirects', ex.allow, 1), list('Not allowed to send pop-ups or use redirects', ex.block, 2));
  } else if (sub === 'content') {
    const label = (k, yes, no) => (Number(get(`profile.default_content_setting_values.${k}`).value) === 1 ? yes : no);
    main.append(head('Site settings', 'chrome://settings/privacy'), card(
      h('div', { class: 'cr-st' }, 'Permissions'),
      crRow('Location', label('geolocation', 'Sites can ask for your location', 'Sites can ask for your location'), null, { arrow: true, onclick: () => ctx.env.ui.toast({ title: 'Location', message: 'Location permissions are not simulated.', kind: 'info' }) }),
      crRow('Notifications', 'Sites can ask to send notifications', null, { arrow: true, onclick: () => ctx.env.ui.toast({ title: 'Notifications', message: 'Notification permissions are not simulated.', kind: 'info' }) })),
    card(h('div', { class: 'cr-st' }, 'Content'),
      crRow('JavaScript', label('javascript', 'Sites can use JavaScript', 'Don’t allow sites to use JavaScript'), toggle(Number(get('profile.default_content_setting_values.javascript').value) === 1, { onchange: (v) => set({ 'profile.default_content_setting_values.javascript': v ? 1 : 2 }) })),
      crRow('Images', label('images', 'Sites can show images', 'Don’t allow sites to show images'), toggle(Number(get('profile.default_content_setting_values.images').value) === 1, { onchange: (v) => set({ 'profile.default_content_setting_values.images': v ? 1 : 2 }) })),
      crRow('Pop-ups and redirects', label('popups', 'Allowed', 'Don’t allow sites to send pop-ups or use redirects'), null, { arrow: true, managed: BP.chromiumPopupSetting(sys, user).managed, onclick: () => ctx.nav('chrome://settings/content/popups') })));
  } else if (section === 'privacy') {
    const sb = BP.chromiumSafeBrowsing(sys, user);
    main.append(head('Privacy and security'), card(
      crRow('Clear browsing data', 'Clear history, cookies, cache and more', null, { arrow: true, onclick: () => ctx.env.ui.toast({ title: 'Clear browsing data', message: 'Browsing data cleared.', kind: 'info' }) }),
      crRow('Third-party cookies', Number(get('profile.cookie_controls_mode').value) === 1 ? 'Third-party cookies are blocked in Incognito mode' : 'Third-party cookies are allowed', null, { arrow: true, onclick: () => set({ 'profile.cookie_controls_mode': Number(get('profile.cookie_controls_mode').value) === 1 ? 2 : 1 }) }),
      crRow('Security', `Safe Browsing (protection from dangerous sites): ${['No protection', 'Standard protection', 'Enhanced protection'][sb.level] || 'Standard protection'}`, null, { arrow: true, managed: sb.managed, onclick: () => ctx.nav('chrome://settings/security') }),
      crRow('Site settings', 'Controls what information sites can use and show (location, camera, pop-ups and more)', null, { arrow: true, onclick: () => ctx.nav('chrome://settings/content') })),
    card(tog('enable_do_not_track', 'Send a “Do Not Track” request with your browsing traffic')));
  } else if (section === 'autofill' || section === 'passwords') {
    main.append(head('Autofill and passwords'), card(
      h('div', { class: 'cr-st' }, 'Password Manager'),
      tog('credentials_enable_service', 'Offer to save passwords', 'Chromium stores passwords you save in this profile'),
      tog('autofill.profile_enabled', 'Save and fill addresses'),
      tog('autofill.credit_card_enabled', 'Save and fill payment methods')));
  } else if (section === 'appearance') {
    main.append(head('Appearance'), card(
      crRow('Mode', 'The theme follows the desktop', h('select', { class: 'cr-sel', title: 'Choose light or dark mode', onchange: (e) => { ctx.setDark(e.target.value); } },
        ['Device', 'Light', 'Dark'].map((m) => h('option', { selected: ctx.darkPref() === m }, m)))),
      tog('browser.show_home_button', 'Show home button'), tog('bookmark_bar.show_on_all_tabs', 'Show bookmarks bar')));
  } else if (section === 'onStartup') {
    const cur = Number(get('session.restore_on_startup').value);
    const pick = (v) => set({ 'session.restore_on_startup': v });
    main.append(head('On start-up'), card(
      crRadio('st', 5, cur, 'Open the New Tab page', null, { onpick: pick }),
      crRadio('st', 1, cur, 'Continue where you left off', null, { onpick: pick }),
      crRadio('st', 4, cur, 'Open a specific page or set of pages', null, { onpick: pick })));
  } else if (section === 'downloads') {
    main.append(head('Downloads'), card(crRow('Location', `${BP.homeOf(sys, user)}/Downloads`, h('button', { class: 'cr-btn', title: 'Change the download folder', onclick: () => ctx.env.ui.toast({ title: 'Downloads', message: 'The download folder is fixed in the simulator.', kind: 'info' }) }, 'Change')),
      tog('download.prompt_for_download', 'Ask where to save each file before downloading')));
  } else if (section === 'system') {
    main.append(head('System'), card(tog('background_mode.enabled', 'Continue running background apps when Chromium is closed'), tog('hardware_acceleration_mode.enabled', 'Use graphics acceleration when available'),
      crRow('Open your computer’s proxy settings', null, null, { arrow: true, onclick: () => ctx.env.openApp('settings') })));
  } else if (section === 'reset') {
    main.append(head('Reset settings'), card(crRow('Restore settings to their original defaults', 'Resets start-up page, content settings, Safe Browsing and cookies. Bookmarks, history and saved passwords are kept.', null, { arrow: true, onclick: async () => {
      const ok = await ctx.env.ui.confirm({ title: 'Reset settings', heading: 'Reset settings?', message: 'This will reset your start-up page, new tab page, search engine and pinned tabs. It will also disable all extensions and clear temporary data like cookies. Your bookmarks, history and saved passwords will not be cleared.', ok: 'Reset settings' });
      if (ok) guard(ctx, () => BP.chromiumResetSettings(sys, user, io));
    } })));
  } else if (section === 'help') {
    const ver = pk.installedVersion(sys, 'chromium') || '';
    const upd = pk.isInstalled(sys, 'chromium') && pk.def('chromium') && ver !== pk.def('chromium').avail;
    main.append(head('About Chromium'), card(h('div', { class: 'cr-about' }, icon('chromium', 40), h('div', null, h('div', { style: { fontSize: '15px' } }, 'Chromium'),
      h('div', { class: 'cr-sub' }, upd ? 'A newer version is available. On Linux, Chromium is updated by your package manager (Update Manager or apt).' : 'Chromium is up to date'),
      h('div', { class: 'cr-sub' }, `Version ${ver.split('-')[0]} (Official Build) built on Ubuntu 22.04, running on Linux Mint 21.3 (64-bit)`)))));
  } else {
    const info = { search: 'Search engine used in the address bar: DuckDuckGo', defaultBrowser: 'Chromium is your default browser', languages: 'English (United States)', accessibility: 'Live caption, focus highlighting and more', performance: 'Memory Saver: off' };
    main.append(head(CR_NAV.find((n) => n[1] === section)?.[0] || 'You and Google'), card(section === 'people'
      ? [crRow('Person 1', 'Not signed in. Sync is not available in the simulator.', h('button', { class: 'cr-btn', disabled: true, title: 'Sign-in is not simulated' }, 'Turn on sync…')), crRow('Customise your Chromium profile', null, null, { arrow: true })]
      : crRow(info[section] || 'This page is not simulated.', null, null)));
  }

  const q = h('input', { class: 'cr-search', placeholder: 'Search settings', title: 'Search settings (type “pop” or “safe”)', onkeydown: (e) => {
    if (e.key !== 'Enter') return;
    const t = q.value.toLowerCase();
    if (/pop|redirect/.test(t)) ctx.nav('chrome://settings/content/popups'); else if (/safe|secur|phish|danger/.test(t)) ctx.nav('chrome://settings/security');
    else if (/pass|autofill/.test(t)) ctx.nav('chrome://settings/autofill'); else if (/reset/.test(t)) ctx.nav('chrome://settings/reset'); else if (/home|theme|dark|mode|bookmark/.test(t)) ctx.nav('chrome://settings/appearance');
  } });
  const navEl = h('div', { class: 'cr-nav' }, CR_NAV.map(([label, id, ic]) => h('div', { class: 'cr-ni' + (section === id || (id === 'privacy' && /^(security|content)/.test(sub || '')) ? ' on' : ''), title: label, onclick: () => ctx.nav(`chrome://settings/${id}`) }, icon(ic, 18), label)));
  return h('div', { class: 'cr-page' }, h('div', { class: 'cr-top' }, h('div', { class: 'cr-title' }, 'Settings'), q), h('div', { class: 'cr-body' }, navEl, main));
}

export function chromeDownloads(ctx) {
  const items = ctx.downloads();
  return h('div', { class: 'cr-page' }, h('div', { class: 'cr-top' }, h('div', { class: 'cr-title' }, 'Downloads'), h('input', { class: 'cr-search', placeholder: 'Search downloads', title: 'Search downloads' })),
    h('div', { class: 'cr-body', style: { justifyContent: 'center' } }, h('div', { class: 'cr-main' }, items.length ? items.slice().reverse().map((d) => h('div', { class: 'cr-card cr-dl' + (d.blocked ? ' bad' : '') }, icon(d.blocked ? 'warn' : 'file', 32),
      h('div', null, h('div', { class: d.blocked ? 'strike' : '' }, d.name), h('div', { class: 'cr-sub' }, d.url), h('div', { class: 'cr-sub' + (d.blocked ? ' red' : '') }, d.blocked ? 'Blocked: this file is dangerous, so Chromium has blocked it.' : `Saved to ${d.path}`)))) : h('div', { class: 'cr-empty', style: { marginTop: '60px' } }, 'Files that you download appear here'))));
}

export function chromePolicy(ctx) {
  const pol = BP.chromiumPolicies(ctx.sys);
  const rows = Object.entries(pol);
  return h('div', { class: 'cr-page' }, h('div', { class: 'cr-top' }, h('div', { class: 'cr-title' }, 'Policies'), h('button', { class: 'cr-btn', title: 'Re-read the policy files', onclick: () => ctx.refresh() }, 'Reload policies')),
    h('div', { class: 'cr-body' }, h('div', { class: 'cr-main', style: { maxWidth: '900px' } }, h('div', { class: 'cr-card' }, h('div', { class: 'cr-st' }, 'Chromium Policies'),
      h('div', { class: 'cr-sub', style: { padding: '0 20px 10px' } }, `Read from ${BP.CHROMIUM_POLICY_DIRS.join(' and ')} (*.json)`),
      rows.length ? h('table', { class: 'cr-tbl' }, h('tr', null, h('th', null, 'Policy name'), h('th', null, 'Policy value'), h('th', null, 'Source'), h('th', null, 'Status')),
        rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, JSON.stringify(v)), h('td', null, 'Platform'), h('td', null, 'OK')))) : h('div', { class: 'cr-empty' }, 'No policies set')))));
}

export function chromeVersion(ctx) {
  const ver = (pk.installedVersion(ctx.sys, 'chromium') || '').split('-')[0];
  const t = [['Chromium', `${ver} (Official Build) built on Ubuntu, running on LinuxMint 21.3 (64-bit)`], ['OS', 'Linux'], ['JavaScript', 'V8 11.9'], ['User agent', `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`], ['Command line', '/usr/lib/chromium/chromium --flag-switches-begin --flag-switches-end'], ['Executable path', '/usr/lib/chromium/chromium'], ['Profile path', `${BP.homeOf(ctx.sys, ctx.user)}/.config/chromium/Default`]];
  return h('div', { class: 'cr-page', style: { padding: '30px' } }, h('table', { class: 'cr-tbl' }, t.map(([a, b]) => h('tr', null, h('td', { style: { fontWeight: 600, width: '160px' } }, a), h('td', null, b)))));
}

// ================================================================= Firefox
const FF_CATS = [['General', 'general', 'gear'], ['Home', 'home', 'home'], ['Search', 'search', 'question'], ['Privacy & Security', 'privacy', 'key']];

function ffSubDialog(ctx, { title, intro, list, onSave }) {
  // Firefox's "Exceptions" sub-dialog: Allowed Websites - Pop-ups
  let items = list.slice();
  let sel = -1;
  const addr = h('input', { class: 'ff-in', placeholder: 'Address of website', onkeydown: (e) => { if (e.key === 'Enter') allow(); }, title: 'Type the exact address, e.g. http://intranet.apex.example' });
  const tbody = h('div', { class: 'ff-ex-list' });
  const draw = () => {
    clear(tbody);
    tbody.append(h('div', { class: 'ff-ex-row hd' }, h('span', null, 'Website'), h('span', null, 'Status')));
    items.forEach((o, i) => tbody.append(h('div', { class: 'ff-ex-row' + (i === sel ? ' sel' : ''), onclick: () => { sel = i; draw(); } }, h('span', null, o), h('span', null, 'Allow'))));
  };
  const allow = () => {
    const v = addr.value.trim();
    if (!v) return;
    // like Firefox: a bare host name allows both the http:// and https:// origins
    const origins = /^[a-z]+:\/\//.test(v) ? [BP.plainOrigin(v)] : [BP.plainOrigin('http://' + v), BP.plainOrigin('https://' + v)];
    for (const o of origins) if (!items.includes(o)) items.push(o);
    addr.value = ''; draw();
  };
  const dlg = h('div', { class: 'ff-sub' }, h('div', { class: 'ff-sub-box' },
    h('div', { class: 'ff-sub-t' }, title),
    h('p', null, intro),
    h('div', { class: 'ff-sub-in' }, addr, h('button', { class: 'ff-b', title: 'Allow pop-ups from this website', onclick: allow }, 'Allow')),
    tbody,
    h('div', { class: 'ff-sub-btns' }, h('button', { class: 'ff-b', title: 'Remove the selected website', onclick: () => { if (sel >= 0) { items.splice(sel, 1); sel = -1; draw(); } } }, 'Remove Website'), h('button', { class: 'ff-b', title: 'Remove every website from the list', onclick: () => { items = []; sel = -1; draw(); } }, 'Remove All Websites')),
    h('div', { class: 'ff-sub-foot' }, h('button', { class: 'ff-b', title: 'Close without saving', onclick: () => dlg.remove() }, 'Cancel'), h('button', { class: 'ff-b primary', title: 'Save the list', onclick: () => { dlg.remove(); guard(ctx, () => onSave(items)); } }, 'Save Changes'))));
  draw();
  return dlg;
}

export function ffPreferences(ctx, cat = 'general') {
  const { sys, user, io } = ctx;
  const pol = BP.firefoxPolicies(sys);
  const get = (k) => BP.firefoxGet(sys, user, k);
  const set = (changes) => guard(ctx, () => BP.setFirefox(sys, user, changes, io));
  const chk = (key, label, opts = {}) => { const g = get(key); return ffCheck(label, opts.invert ? g.value !== true : g.value === true, { disabled: g.locked, indent: opts.indent, onchange: (v) => set({ [key]: opts.invert ? !v : v }) }); };
  const main = h('div', { class: 'ff-main' });
  const sec = (t, ...kids) => h('section', { class: 'ff-sec' }, h('h2', null, t), ...kids);
  if (Object.keys(pol).length) main.append(h('div', { class: 'ff-managed', title: 'Open about:policies', onclick: () => ctx.nav('about:policies') }, building(), ' Your browser is being managed by your organization.'));

  if (cat === 'privacy') {
    const cb = get('browser.contentblocking.category');
    const pick = (v) => set({ 'browser.contentblocking.category': v, 'privacy.trackingprotection.enabled': v === 'strict' });
    const radio = (v, label, sub) => h('label', { class: 'ff-radio', title: `Use ${label} tracking protection` }, h('input', { type: 'radio', name: 'etp', checked: cb.value === v, disabled: cb.locked, onchange: () => pick(v) }), h('div', null, h('b', null, label), h('div', { class: 'ff-sub-t2' }, sub)));
    const pop = get('dom.disable_open_during_load');
    const host = h('div');
    const sbm = get('browser.safebrowsing.malware.enabled'); const sbp = get('browser.safebrowsing.phishing.enabled');
    const sbOn = sbm.value === true && sbp.value === true;
    const https = get('dom.security.https_only_mode');
    main.append(
      h('h1', null, 'Privacy & Security'),
      sec('Enhanced Tracking Protection', h('p', { class: 'ff-sub-t2' }, 'Trackers follow you around online to collect information about your browsing habits and interests.'),
        radio('standard', 'Standard', 'Balanced for protection and performance. Pages will load normally.'), radio('strict', 'Strict', 'Stronger protection, but may cause some sites or content to break.'), radio('custom', 'Custom', 'Choose which trackers and scripts to block.')),
      sec('Website Privacy Preferences', chk('privacy.donottrackheader.enabled', 'Send websites a “Do Not Track” request')),
      sec('Cookies and Site Data', chk('privacy.sanitize.sanitizeOnShutdown', 'Delete cookies and site data when Firefox is closed')),
      sec('Logins and Passwords', chk('signon.rememberSignons', 'Ask to save logins and passwords for websites'), chk('signon.autofillForms', 'Fill logins and passwords automatically', { indent: true }), chk('signon.generation.enabled', 'Suggest and generate strong passwords', { indent: true }), chk('signon.management.page.breach-alerts.enabled', 'Show alerts about passwords for breached websites', { indent: true })),
      sec('Permissions',
        h('div', { class: 'ff-line' }, ffCheck('Block pop-up windows', pop.value === true, { disabled: pop.locked, onchange: (v) => set({ 'dom.disable_open_during_load': v }), title: pop.locked ? 'Locked by policy or user.js' : 'Stop websites from opening new windows on their own' }),
          h('button', { class: 'ff-b', title: 'Websites that are allowed to open pop-up windows', onclick: () => host.append(ffSubDialog(ctx, { title: 'Allowed Websites - Pop-ups', intro: 'You can specify which websites are allowed to open pop-up windows. Type the exact address of the site you want to allow and then click Allow.', list: BP.firefoxPopupAllowList(sys, user), onSave: (l) => BP.setFirefoxPopupAllowList(sys, user, l, io) })) }, 'Exceptions…')),
        h('div', { class: 'ff-line' }, chk('xpinstall.whitelist.required', 'Warn you when websites try to install add-ons'),
          h('button', { class: 'ff-b', title: 'Websites that may install add-ons', onclick: () => host.append(ffSubDialog(ctx, { title: 'Allowed Websites - Add-ons Installation', intro: 'You can specify which websites are allowed to install add-ons. Type the exact address of the site you want to allow and then click Allow.', list: BP.firefoxSitePerm(sys, user, 'install'), onSave: (l) => BP.setFirefoxSitePerm(sys, user, 'install', l, io) })) }, 'Exceptions…'))),
      sec('Security', h('h3', null, 'Deceptive Content and Dangerous Software Protection'),
        ffCheck('Block dangerous and deceptive content', sbOn, { disabled: sbm.locked || sbp.locked, onchange: (v) => set({ 'browser.safebrowsing.malware.enabled': v, 'browser.safebrowsing.phishing.enabled': v }), title: 'Firefox Safe Browsing: warns about phishing and malware sites' }),
        (() => { const g = get('browser.safebrowsing.downloads.enabled'); return ffCheck('Block dangerous downloads', g.value === true, { disabled: g.locked || !sbOn, indent: true, onchange: (v) => set({ 'browser.safebrowsing.downloads.enabled': v }) }); })(),
        chk('browser.safebrowsing.downloads.remote.block_potentially_unwanted', 'Warn you about unwanted and uncommon software', { indent: true }),
        h('h3', null, 'HTTPS-Only Mode'),
        h('label', { class: 'ff-radio' }, h('input', { type: 'radio', name: 'https', checked: https.value === true, disabled: https.locked, onchange: () => set({ 'dom.security.https_only_mode': true }) }), 'Enable HTTPS-Only Mode in all windows'),
        h('label', { class: 'ff-radio' }, h('input', { type: 'radio', name: 'https', checked: https.value !== true, disabled: https.locked, onchange: () => set({ 'dom.security.https_only_mode': false }) }), 'Don’t enable HTTPS-Only Mode')),
      host);
  } else if (cat === 'home') {
    const hp = get('browser.startup.homepage');
    const inp = h('input', { class: 'ff-in', value: hp.value, disabled: hp.locked, title: 'Homepage address', style: { width: '360px' } });
    main.append(h('h1', null, 'Home'), sec('New Windows and Tabs', h('div', { class: 'ff-line' }, h('span', null, 'Homepage and new windows'), inp, h('button', { class: 'ff-b', disabled: hp.locked, title: 'Save the homepage', onclick: () => set({ 'browser.startup.homepage': inp.value.trim() || 'about:home' }) }, 'Save')),
      h('div', { class: 'ff-line' }, h('button', { class: 'ff-b', title: 'Use the default Firefox Home page', onclick: () => set({ 'browser.startup.homepage': undefined }) }, 'Restore Defaults'))));
  } else if (cat === 'search') {
    main.append(h('h1', null, 'Search'), sec('Default Search Engine', h('select', { class: 'ff-in', title: 'Default search engine' }, ['DuckDuckGo', 'Google', 'Bing', 'Wikipedia (en)'].map((n) => h('option', null, n)))),
      sec('Search Suggestions', chk('browser.search.suggest.enabled', 'Show search suggestions')));
  } else {
    const sp = get('browser.startup.page');
    main.append(h('h1', null, 'General'),
      sec('Startup', ffCheck('Open previous windows and tabs', Number(sp.value) === 3, { disabled: sp.locked, onchange: (v) => set({ 'browser.startup.page': v ? 3 : 1 }) }), chk('browser.shell.checkDefaultBrowser', 'Always check if Firefox is your default browser')),
      sec('Tabs', chk('browser.tabs.warnOnClose', 'Confirm before closing multiple tabs')),
      sec('Downloads', h('div', { class: 'ff-line' }, h('span', null, 'Save files to'), h('input', { class: 'ff-in', value: `${BP.homeOf(sys, user)}/Downloads`, disabled: true, title: 'Download folder' })), chk('browser.download.useDownloadDir', 'Always ask you where to save files', { invert: true })),
      sec('Firefox Updates', h('p', { class: 'ff-sub-t2' }, 'On Linux Mint and Ubuntu, Firefox is updated by the system package manager. Use Update Manager / Software Updater or apt.')),
      sec('Browsing', chk('general.autoScroll', 'Use autoscrolling'), chk('network.dns.disablePrefetch', 'Disable DNS prefetching')));
  }
  const q = h('input', { class: 'ff-in ff-find', placeholder: 'Find in Settings', title: 'Find in Settings (try “pop-up”)', onkeydown: (e) => { if (e.key === 'Enter') { const t = q.value.toLowerCase(); ctx.nav(/home/.test(t) ? 'about:preferences#home' : /search/.test(t) ? 'about:preferences#search' : /pop|safe|danger|password|track|cookie|https|secur|privacy/.test(t) ? 'about:preferences#privacy' : 'about:preferences'); } } });
  return h('div', { class: 'ff-page' }, h('div', { class: 'ff-side' }, FF_CATS.map(([label, id, ic]) => h('div', { class: 'ff-cat' + (cat === id ? ' on' : ''), title: label, onclick: () => ctx.nav(id === 'general' ? 'about:preferences' : `about:preferences#${id}`) }, icon(ic, 18), label)),
    h('div', { class: 'ff-cat foot', title: 'Open about:config', onclick: () => ctx.nav('about:config') }, 'Advanced preferences (about:config)')),
  h('div', { class: 'ff-col' }, h('div', { class: 'ff-findbar' }, q), main));
}

export function ffConfig(ctx) {
  const { sys, user, io } = ctx;
  if (!ctx.state.configAccepted) {
    return h('div', { class: 'ff-warn' }, h('div', { class: 'ff-warn-box' }, icon('warn', 48), h('h1', null, 'Proceed with Caution'),
      h('p', null, 'Changing advanced configuration preferences can impact Firefox performance or security.'),
      ffCheck('Warn me when I attempt to access these preferences', true, { onchange: () => {} }),
      h('button', { class: 'ff-b primary', title: 'Show the preference list', onclick: () => { ctx.state.configAccepted = true; ctx.refresh(); } }, 'Accept the Risk and Continue')));
  }
  const dir = BP.firefoxProfileDir(sys, BP.homeOf(sys, user));
  const userVals = dir && sys.vfs.isFile(`${dir}/prefs.js`) ? BP.parsePrefsJs(sys.vfs.readFile(`${dir}/prefs.js`)) : new Map();
  const keys = [...new Set([...Object.keys(BP.FF_DEFAULTS), ...userVals.keys()])].sort();
  const filt = ctx.state.configFilter || '';
  const onlyMod = !!ctx.state.configOnlyModified;
  const list = h('div', { class: 'ff-cfg' });
  const draw = () => {
    clear(list);
    const f = (ctx.state.configFilter || '').toLowerCase();
    let shown = 0;
    for (const k of keys) {
      const g = BP.firefoxGet(sys, user, k);
      const modified = userVals.has(k) || g.source === 'user.js' || g.source === 'policy';
      if (f && !k.toLowerCase().includes(f)) continue;
      if (ctx.state.configOnlyModified && !modified) continue;
      shown++;
      const t = typeof g.value;
      const actions = g.locked ? h('span', { class: 'ff-cfg-lock', title: g.source === 'policy' ? 'Locked by enterprise policy' : 'Set by user.js; it is re-applied every time Firefox starts' }, '🔒')
        : h('span', null,
          t === 'boolean' ? h('button', { class: 'ff-ib', title: 'Toggle', onclick: () => guard(ctx, () => BP.setFirefox(sys, user, { [k]: !g.value }, io)) }, '⇄')
            : h('button', { class: 'ff-ib', title: 'Edit', onclick: async () => { const v = await ctx.env.ui.prompt({ title: 'Edit preference', message: k, value: String(g.value ?? '') }); if (v == null) return; guard(ctx, () => BP.setFirefox(sys, user, { [k]: t === 'number' ? Number(v) : v }, io)); } }, '✎'),
          userVals.has(k) ? h('button', { class: 'ff-ib', title: 'Reset to the default value', onclick: () => guard(ctx, () => BP.setFirefox(sys, user, { [k]: undefined }, io)) }, '↺') : null);
      list.append(h('div', { class: 'ff-cfg-row' + (modified ? ' mod' : '') }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, String(g.value)), actions));
    }
    if (f && !keys.includes(f) && /^[\w.-]+$/.test(f)) {
      const add = (type, val) => guard(ctx, () => BP.setFirefox(sys, user, { [f]: val }, io));
      list.append(h('div', { class: 'ff-cfg-row new' }, h('span', { class: 'k' }, f),
        h('span', { class: 'v' }, h('label', { title: 'New boolean preference' }, h('input', { type: 'radio', name: 'nt', onchange: () => add('b', true) }), ' Boolean '), h('label', { title: 'New number preference' }, h('input', { type: 'radio', name: 'nt', onchange: () => add('n', 0) }), ' Number '), h('label', { title: 'New string preference' }, h('input', { type: 'radio', name: 'nt', onchange: () => add('s', '') }), ' String')), h('span')));
    }
    if (!shown && !f) list.append(h('div', { class: 'cr-empty' }, 'No preferences'));
  };
  const search = h('input', { class: 'ff-in', placeholder: 'Search preference name', value: filt, title: 'Filter preferences by name, e.g. dom.disable_open_during_load', style: { flex: 1 }, oninput: () => { ctx.state.configFilter = search.value; draw(); } });
  draw();
  setTimeout(() => search.focus(), 0);
  return h('div', { class: 'ff-cfg-page' }, h('div', { class: 'ff-line' }, search, ffCheck('Show only modified preferences', onlyMod, { onchange: (v) => { ctx.state.configOnlyModified = v; draw(); } })), list);
}

export function ffPolicies(ctx) {
  const pol = BP.firefoxPolicies(ctx.sys);
  const rows = Object.entries(pol);
  return h('div', { class: 'ff-cfg-page' }, h('h1', { style: { fontWeight: 400 } }, 'Policies'),
    rows.length ? h('div', null, h('p', null, 'The Enterprise Policies service is active.'), h('table', { class: 'cr-tbl' }, h('tr', null, h('th', null, 'Policy Name'), h('th', null, 'Policy Value')), rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, h('code', null, JSON.stringify(v)))))))
      : h('p', null, `The Enterprise Policies service is inactive. Policies are read from ${BP.FIREFOX_POLICY_FILES[0]}.`));
}

export function ffDownloads(ctx) {
  const items = ctx.downloads();
  return h('div', { class: 'ff-cfg-page' }, h('h1', { style: { fontWeight: 400 } }, 'Downloads'), items.length ? items.slice().reverse().map((d) => h('div', { class: 'ff-dl' + (d.blocked ? ' bad' : '') }, icon(d.blocked ? 'warn' : 'file', 32), h('div', null, h('div', null, d.name), h('div', { class: 'cr-sub' + (d.blocked ? ' red' : '') }, d.blocked ? 'File contains a virus or malware' : `Completed — ${d.path}`)))) : h('p', null, 'There are no downloads.'));
}
