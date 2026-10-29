// Browser preference files (DOM-free): Chromium's ~/.config/chromium/Default/Preferences (JSON) and Firefox's
// prefs.js / user.js, plus the enterprise policy files that override them. The browser app edits exactly these
// files and the scorer reads exactly these files, so terminal edits and GUI edits are always in sync.
import * as users from './users.js';

const rd = (sys, p) => (sys.vfs.isFile(p) ? sys.vfs.readFile(p) : null);
export const homeOf = (sys, user) => users.getUser(sys, user)?.home || `/home/${user}`;
const owner = (sys, user) => { const u = users.getUser(sys, user); return { uid: u ? u.uid : 0, gid: u ? u.gid : 0 }; };

/** Write a text file as `user` (creating parent directories owned by them). `io` (an FsView) enforces permissions when given. */
export function writeUserFile(sys, user, path, data, io, mode = 0o600) {
  const o = owner(sys, user);
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!sys.vfs.isDir(dir)) (io || sys.vfs).mkdir(dir, { parents: true, mode: 0o700, ...o });
  if (io) io.writeFile(path, data, { mode, ...o }); else sys.vfs.writeFile(path, data, { mode, ...o });
}

// ================================================================= generic dotted-path helpers
export function getPath(obj, dotted, dflt) {
  let o = obj;
  for (const k of dotted.split('.')) { if (o == null || typeof o !== 'object' || !(k in o)) return dflt; o = o[k]; }
  return o;
}
export function setPath(obj, dotted, value) {
  const ks = dotted.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = value;
  return obj;
}
export function deletePath(obj, dotted) {
  const ks = dotted.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o == null || typeof o[ks[i]] !== 'object') return obj; o = o[ks[i]]; }
  if (o) delete o[ks[ks.length - 1]];
  return obj;
}

// ================================================================= origins
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };
/** Chromium's content-setting key for a URL's origin, e.g. 'http://ads.example.net:80' (default ports are written, like the real file). */
export function chromiumOrigin(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.hostname}:${u.port || DEFAULT_PORT[u.protocol] || ''}`; } catch { return String(url); }
}
/** The origin the way Settings shows it: 'http://ads.example.net' (default ports dropped). */
export const displayOrigin = (key) => String(key).replace(/:(80|443)$/, '');
/** An origin the way Firefox stores permissions: 'http://ads.example.net'. */
export function plainOrigin(url) { try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return String(url); } }

// ================================================================= Chromium
export const chromiumDir = (home) => `${home}/.config/chromium/Default`;
export const chromiumPrefsPath = (home) => `${chromiumDir(home)}/Preferences`;
export const CHROMIUM_POLICY_DIRS = ['/etc/chromium/policies/managed', '/etc/chromium-browser/policies/managed'];

/** Content-setting type → enterprise policy that controls it. */
export const CHROMIUM_POLICY = {
  popups: 'DefaultPopupsSetting', geolocation: 'DefaultGeolocationSetting', notifications: 'DefaultNotificationsSetting',
  javascript: 'DefaultJavaScriptSetting', images: 'DefaultImagesSetting', cookies: 'DefaultCookiesSetting',
};
export const CHROMIUM_DEFAULTS = {
  'profile.default_content_setting_values.popups': 2,
  'profile.default_content_setting_values.geolocation': 3,
  'profile.default_content_setting_values.notifications': 3,
  'profile.default_content_setting_values.media_stream_mic': 3,
  'profile.default_content_setting_values.media_stream_camera': 3,
  'profile.default_content_setting_values.javascript': 1,
  'profile.default_content_setting_values.images': 1,
  'profile.default_content_setting_values.cookies': 1,
  'profile.password_manager_enabled': true,
  'credentials_enable_service': true,
  'safebrowsing.enabled': true,
  'safebrowsing.enhanced': false,
  'enable_do_not_track': false,
  'autofill.profile_enabled': true,
  'autofill.credit_card_enabled': true,
  'browser.show_home_button': false,
  'bookmark_bar.show_on_all_tabs': true,
  'download.prompt_for_download': false,
  'profile.cookie_controls_mode': 1,
  'session.restore_on_startup': 5,
  'net.network_prediction_options': 0,
  'https_only_mode_enabled': false,
  'background_mode.enabled': true,
  'hardware_acceleration_mode.enabled': true,
};

export function chromiumPrefs(sys, home) {
  try { const o = JSON.parse(rd(sys, chromiumPrefsPath(home)) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
/** All managed policies, merged (files read in name order, later wins). */
export function chromiumPolicies(sys) {
  const out = {};
  for (const dir of CHROMIUM_POLICY_DIRS) {
    if (!sys.vfs.isDir(dir)) continue;
    for (const n of sys.vfs.readdir(dir).sort()) {
      if (!n.endsWith('.json')) continue;
      try { Object.assign(out, JSON.parse(rd(sys, `${dir}/${n}`) || '{}')); } catch { /* invalid JSON is ignored, like Chromium does */ }
    }
  }
  return out;
}
const POLICY_BOOL = { 'profile.password_manager_enabled': 'PasswordManagerEnabled', 'credentials_enable_service': 'PasswordManagerEnabled', 'enable_do_not_track': 'EnableDoNotTrack', 'browser.show_home_button': 'ShowHomeButton', 'bookmark_bar.show_on_all_tabs': 'BookmarkBarEnabled', 'autofill.profile_enabled': 'AutofillAddressEnabled', 'autofill.credit_card_enabled': 'AutofillCreditCardEnabled', 'download.prompt_for_download': 'PromptForDownloadLocation', 'https_only_mode_enabled': 'HttpsOnlyMode' };
/** Effective value of a preference key plus whether a managed policy forces it. */
export function chromiumGet(sys, user, key) {
  const pol = chromiumPolicies(sys);
  const m = /^profile\.default_content_setting_values\.(\w+)$/.exec(key);
  if (m && CHROMIUM_POLICY[m[1]] && CHROMIUM_POLICY[m[1]] in pol) return { value: pol[CHROMIUM_POLICY[m[1]]], managed: true };
  if (POLICY_BOOL[key] && POLICY_BOOL[key] in pol) return { value: key === 'https_only_mode_enabled' ? pol.HttpsOnlyMode !== 'disallowed' && !!pol.HttpsOnlyMode : !!pol[POLICY_BOOL[key]], managed: true };
  const prefs = chromiumPrefs(sys, homeOf(sys, user));
  return { value: getPath(prefs, key, CHROMIUM_DEFAULTS[key]), managed: false };
}
/** Safe Browsing: 0 = off ("No protection"), 1 = standard, 2 = enhanced. */
export function chromiumSafeBrowsing(sys, user) {
  const pol = chromiumPolicies(sys);
  if ('SafeBrowsingProtectionLevel' in pol) return { level: Number(pol.SafeBrowsingProtectionLevel), managed: true };
  if ('SafeBrowsingEnabled' in pol) return { level: pol.SafeBrowsingEnabled ? 1 : 0, managed: true };
  const on = chromiumGet(sys, user, 'safebrowsing.enabled').value;
  const enh = chromiumGet(sys, user, 'safebrowsing.enhanced').value;
  return { level: !on ? 0 : enh ? 2 : 1, managed: false };
}
export const chromiumSafeBrowsingOn = (sys, user = 'student') => chromiumSafeBrowsing(sys, user).level >= 1;
export function chromiumSetSafeBrowsing(sys, user, level, io) {
  setChromium(sys, user, { 'safebrowsing.enabled': level > 0, 'safebrowsing.enhanced': level === 2 }, io);
}
/** Write one or more preference keys (read-modify-write of the JSON file; a value of undefined removes the key). */
export function setChromium(sys, user, changes, io) {
  const home = homeOf(sys, user);
  const prefs = chromiumPrefs(sys, home);
  for (const [k, v] of Object.entries(changes)) { if (v === undefined) deletePath(prefs, k); else setPath(prefs, k, v); }
  writeUserFile(sys, user, chromiumPrefsPath(home), JSON.stringify(prefs) + '\n', io);
}
/** Restore Chromium's "Reset settings": content settings, exceptions, safe browsing, cookies and search go back to defaults. */
export function chromiumResetSettings(sys, user, io) {
  setChromium(sys, user, {
    'profile.default_content_setting_values': undefined, 'profile.content_settings.exceptions': undefined,
    'safebrowsing.enabled': true, 'safebrowsing.enhanced': false, 'profile.cookie_controls_mode': 1, 'enable_do_not_track': false,
    'https_only_mode_enabled': undefined, 'browser.show_home_button': undefined, 'session.restore_on_startup': 5,
  }, io);
}
/** 1 = pop-ups allowed, 2 = blocked (the default when the key is missing). */
export const chromiumPopupSetting = (sys, user) => chromiumGet(sys, user, 'profile.default_content_setting_values.popups');
export const chromiumPopupsBlocked = (sys, user = 'student') => Number(chromiumPopupSetting(sys, user).value) === 2;

// per-site exceptions: profile.content_settings.exceptions.<type> = { "http://host:80,*": { setting: 1 } }
export const originKey = (origin) => `${origin},*`;
export function chromiumExceptions(sys, user, type) {
  const prefs = chromiumPrefs(sys, homeOf(sys, user));
  const map = getPath(prefs, `profile.content_settings.exceptions.${type}`, {}) || {};
  const out = { allow: [], block: [] };
  for (const [k, v] of Object.entries(map)) (Number(v?.setting) === 1 ? out.allow : out.block).push(k.replace(/,\*$/, ''));
  return out;
}
export function chromiumSetException(sys, user, type, origin, setting, io) {
  const home = homeOf(sys, user);
  const prefs = chromiumPrefs(sys, home);
  const path = `profile.content_settings.exceptions.${type}`;
  const map = { ...(getPath(prefs, path, {}) || {}) };
  if (setting == null) delete map[originKey(origin)]; else map[originKey(origin)] = { last_modified: String(Date.now()), setting };
  setPath(prefs, path, map);
  writeUserFile(sys, user, chromiumPrefsPath(home), JSON.stringify(prefs) + '\n', io);
}
/** Would a pop-up from this origin be allowed? (site exception first, then the default setting, which policy may force). */
export function chromiumPopupAllowedFor(sys, user, origin) {
  const ex = chromiumExceptions(sys, user, 'popups');
  const pol = chromiumPopupSetting(sys, user);
  if (!pol.managed) { if (ex.allow.includes(origin)) return true; if (ex.block.includes(origin)) return false; }
  return Number(pol.value) === 1;
}

// bookmarks (real Chromium format; only the bookmark bar is used by the simulator)
export const chromiumBookmarksPath = (home) => `${chromiumDir(home)}/Bookmarks`;
export function chromiumBookmarks(sys, user) {
  try { return (JSON.parse(rd(sys, chromiumBookmarksPath(homeOf(sys, user))) || '{}').roots?.bookmark_bar?.children || []).filter((c) => c.type === 'url').map((c) => ({ name: c.name, url: c.url })); } catch { return []; }
}
const bookmarkTree = (list) => ({ roots: { bookmark_bar: { children: list.map((b, i) => ({ date_added: '13340000000000000', id: String(10 + i), name: b.name, type: 'url', url: b.url })), id: '1', name: 'Bookmarks bar', type: 'folder' }, other: { children: [], id: '2', name: 'Other bookmarks', type: 'folder' }, synced: { children: [], id: '3', name: 'Mobile bookmarks', type: 'folder' } }, version: 1 });
export function writeChromiumBookmarks(sys, user, list, io) {
  writeUserFile(sys, user, chromiumBookmarksPath(homeOf(sys, user)), JSON.stringify(bookmarkTree(list), null, 3) + '\n', io);
}

// ================================================================= Firefox
export const FIREFOX_POLICY_FILES = ['/etc/firefox/policies/policies.json', '/usr/lib/firefox/distribution/policies.json', '/usr/lib/firefox-esr/distribution/policies.json'];
export const FF_DEFAULTS = {
  'dom.disable_open_during_load': true,
  'browser.safebrowsing.malware.enabled': true,
  'browser.safebrowsing.phishing.enabled': true,
  'browser.safebrowsing.downloads.enabled': true,
  'browser.safebrowsing.downloads.remote.block_potentially_unwanted': true,
  'browser.safebrowsing.downloads.remote.block_uncommon': true,
  'xpinstall.whitelist.required': true,
  'signon.rememberSignons': true,
  'signon.autofillForms': true,
  'signon.generation.enabled': true,
  'signon.management.page.breach-alerts.enabled': true,
  'network.cookie.cookieBehavior': 5,
  'network.cookie.lifetimePolicy': 0,
  'browser.contentblocking.category': 'standard',
  'privacy.trackingprotection.enabled': false,
  'privacy.donottrackheader.enabled': false,
  'privacy.sanitize.sanitizeOnShutdown': false,
  'dom.security.https_only_mode': false,
  'dom.security.https_only_mode_pbm': false,
  'browser.startup.page': 1,
  'browser.startup.homepage': 'about:home',
  'browser.search.suggest.enabled': true,
  'browser.download.useDownloadDir': true,
  'datareporting.healthreport.uploadEnabled': true,
  'datareporting.policy.dataSubmissionEnabled': true,
  'network.dns.disablePrefetch': false,
  'browser.shell.checkDefaultBrowser': true,
  'general.autoScroll': false,
  'browser.tabs.warnOnClose': false,
  'browser.toolbars.bookmarks.visibility': 'newtab',
  'permissions.default.geo': 0, 'permissions.default.camera': 0, 'permissions.default.microphone': 0, 'permissions.default.desktop-notification': 0,
};

export function parsePrefsJs(text) {
  const out = new Map();
  for (const raw of String(text || '').split('\n')) {
    const m = /^\s*(?:user_pref|pref)\(\s*"([^"]+)"\s*,\s*(.*?)\s*\)\s*;\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^-?\d+$/.test(v)) v = Number(v);
    else { const s = /^"(.*)"$/.exec(v); v = s ? s[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v; }
    out.set(m[1], v);
  }
  return out;
}
const fmtVal = (v) => (typeof v === 'string' ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : String(v));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Set (or add) a `user_pref(...)` line in a prefs.js-style text. */
export function setPrefLine(text, key, value) {
  const line = `user_pref("${key}", ${fmtVal(value)});`;
  const re = new RegExp(`^\\s*user_pref\\(\\s*"${reEsc(key)}"\\s*,.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\n*$/, '\n') + line + '\n';
}
export function removePrefLine(text, key) {
  return text.replace(new RegExp(`^\\s*user_pref\\(\\s*"${reEsc(key)}"\\s*,.*\\n?`, 'm'), '');
}

/** Absolute path of the default profile directory (profiles.ini), or null. */
export function firefoxProfileDir(sys, home) {
  for (const base of [`${home}/.mozilla/firefox`, `${home}/snap/firefox/common/.mozilla/firefox`]) {
    const ini = rd(sys, `${base}/profiles.ini`);
    if (ini == null) continue;
    let sec = {}; const secs = [];
    for (const l of ini.split('\n')) {
      const t = l.trim();
      const s = /^\[(.+)\]$/.exec(t);
      if (s) { sec = { _name: s[1] }; secs.push(sec); continue; }
      const kv = /^([^=]+)=(.*)$/.exec(t);
      if (kv) sec[kv[1]] = kv[2];
    }
    const p = secs.find((x) => x.Default === '1' && x.Path) || secs.find((x) => /^Profile/.test(x._name || '') && x.Path);
    if (p) return p.IsRelative === '0' ? p.Path : `${base}/${p.Path}`;
  }
  return null;
}
export function firefoxPolicies(sys) {
  for (const f of FIREFOX_POLICY_FILES) {
    const t = rd(sys, f);
    if (t == null) continue;
    try { const j = JSON.parse(t); if (j && j.policies) return j.policies; } catch { /* ignore */ }
  }
  return {};
}
/** Effective value + who controls it: 'policy' (locked), 'user.js' (re-applied at every start-up), 'prefs.js' or 'default'. */
export function firefoxGet(sys, user, key) {
  const home = homeOf(sys, user);
  const pol = firefoxPolicies(sys);
  const pr = pol.Preferences?.[key];
  if (pr && pr.Status === 'locked') return { value: pr.Value, source: 'policy', locked: true };
  if (key === 'dom.disable_open_during_load' && pol.PopupBlocking && 'Default' in pol.PopupBlocking && pol.PopupBlocking.Locked) return { value: !!pol.PopupBlocking.Default, source: 'policy', locked: true };
  if (key === 'signon.rememberSignons' && 'PasswordManagerEnabled' in pol) return { value: !!pol.PasswordManagerEnabled, source: 'policy', locked: true };
  const dir = firefoxProfileDir(sys, home);
  if (dir) {
    const uj = parsePrefsJs(rd(sys, `${dir}/user.js`));
    if (uj.has(key)) return { value: uj.get(key), source: 'user.js', locked: true };
    const pj = parsePrefsJs(rd(sys, `${dir}/prefs.js`));
    if (pj.has(key)) return { value: pj.get(key), source: 'prefs.js', locked: false };
  }
  if (pr && 'Value' in pr && (pr.Status === 'default' || !pr.Status)) return { value: pr.Value, source: 'default', locked: false };
  if (key === 'dom.disable_open_during_load' && pol.PopupBlocking && 'Default' in pol.PopupBlocking) return { value: !!pol.PopupBlocking.Default, source: 'default', locked: false };
  return { value: FF_DEFAULTS[key], source: 'default', locked: false };
}
export function setFirefox(sys, user, changes, io) {
  const home = homeOf(sys, user);
  const dir = firefoxProfileDir(sys, home);
  if (!dir) throw new Error('No Firefox profile');
  let t = rd(sys, `${dir}/prefs.js`) || '// Mozilla User Preferences\n';
  for (const [k, v] of Object.entries(changes)) t = v === undefined ? removePrefLine(t, k) : setPrefLine(t, k, v);
  writeUserFile(sys, user, `${dir}/prefs.js`, t, io);
}
export const firefoxPopupsBlocked = (sys, user = 'student') => firefoxGet(sys, user, 'dom.disable_open_during_load').value === true;
export const firefoxDangerousContentBlocked = (sys, user = 'student') => firefoxGet(sys, user, 'browser.safebrowsing.malware.enabled').value === true && firefoxGet(sys, user, 'browser.safebrowsing.phishing.enabled').value === true;

// per-site permission store next to the profile (real Firefox keeps these in permissions.sqlite; JSON is used here so it is visible/editable)
function sitePerms(sys, user) {
  const dir = firefoxProfileDir(sys, homeOf(sys, user));
  if (!dir) return {};
  try { return JSON.parse(rd(sys, `${dir}/permissions.json`) || '{}') || {}; } catch { return {}; }
}
export function firefoxPopupAllowList(sys, user) {
  const pol = firefoxPolicies(sys);
  return [...new Set([...(pol.PopupBlocking?.Allow || []), ...(sitePerms(sys, user).popup || [])])];
}
export function setFirefoxPopupAllowList(sys, user, list, io) { setFirefoxSitePerm(sys, user, 'popup', list, io); }
export function firefoxSitePerm(sys, user, type) { return sitePerms(sys, user)[type] || []; }
export function setFirefoxSitePerm(sys, user, type, list, io) {
  const dir = firefoxProfileDir(sys, homeOf(sys, user));
  if (!dir) return;
  const cur = sitePerms(sys, user);
  cur[type] = list;
  writeUserFile(sys, user, `${dir}/permissions.json`, JSON.stringify(cur, null, 2) + '\n', io);
}
export function firefoxBookmarks(sys, user) {
  const dir = firefoxProfileDir(sys, homeOf(sys, user));
  if (!dir) return [];
  try { return JSON.parse(rd(sys, `${dir}/bookmarks.json`) || '[]'); } catch { return []; }
}
export function writeFirefoxBookmarks(sys, user, list, io) {
  const dir = firefoxProfileDir(sys, homeOf(sys, user));
  if (dir) writeUserFile(sys, user, `${dir}/bookmarks.json`, JSON.stringify(list, null, 2) + '\n', io);
}

// ================================================================= what the browser does (used by the browser app and the tests)
/** Would `browser` ('chromium' | 'firefox') let the page at `url` open pop-up windows on its own? */
export function popupsAllowed(sys, user, browser, url) {
  if (browser === 'firefox') return !firefoxPopupsBlocked(sys, user) || firefoxPopupAllowList(sys, user).includes(plainOrigin(url));
  return chromiumPopupAllowedFor(sys, user, chromiumOrigin(url));
}
/** Does Safe Browsing stop a visit to a site flagged as `threat` ('phishing' | 'malware')? */
export function safeBrowsingBlocks(sys, user, browser, threat) {
  if (browser === 'firefox') return firefoxGet(sys, user, threat === 'phishing' ? 'browser.safebrowsing.phishing.enabled' : 'browser.safebrowsing.malware.enabled').value === true;
  return chromiumSafeBrowsingOn(sys, user);
}
/** Are downloads that Safe Browsing flags as dangerous blocked? */
export function dangerousDownloadsBlocked(sys, user, browser) {
  if (browser === 'firefox') return firefoxGet(sys, user, 'browser.safebrowsing.malware.enabled').value === true && firefoxGet(sys, user, 'browser.safebrowsing.downloads.enabled').value === true;
  return chromiumSafeBrowsingOn(sys, user);
}

// ================================================================= seeding for the images
/** mkdir -p owned by the user (the generic image seeder would create root-owned parents). */
function mkdirOwned(sys, dir, o) {
  let cur = '';
  for (const part of dir.split('/').filter(Boolean)) {
    cur += '/' + part;
    if (!sys.vfs.exists(cur)) sys.vfs.mkdir(cur, { mode: cur.endsWith('/Default') || /\.default/.test(cur) || /\/(\.mozilla|firefox|chromium)$/.test(cur) ? 0o700 : 0o755, ...o });
  }
}
const FF_PREFS_HEADER = '// Mozilla User Preferences\n\n// DO NOT EDIT THIS FILE.\n//\n// If you make changes to this file while the application is running,\n// the changes will be overwritten when the application exits.\n//\n// To change a preference value, you can either:\n// - modify it via the UI (e.g. via about:config in the browser); or\n// - set it within a user.js file in your profile.\n\n';

/** Create the browser profiles. Settings are deliberately misconfigured (pop-ups allowed, Safe Browsing off) for the scenarios to find. */
export function seedBrowserProfiles(sys, { distro, home = '/home/student', uid = 1000, gid = 1000 }) {
  const o = { uid, gid };
  const put = (path, data, mode = 0o600) => { mkdirOwned(sys, path.slice(0, path.lastIndexOf('/')), o); sys.vfs.writeFile(path, data, { mode, ...o }); };
  mkdirOwned(sys, `${home}/Downloads`, o);
  if (distro === 'mint') {
    const prefs = {
      browser: { has_seen_welcome_page: true, show_home_button: true, window_placement: { bottom: 760, left: 60, maximized: false, right: 1010, top: 40 } },
      credentials_enable_service: true,
      extensions: { settings: {} },
      homepage: 'https://www.linuxmint.com/start/virginia/', homepage_is_newtabpage: true,
      intl: { selected_languages: 'en-US,en' },
      profile: { avatar_index: 26, default_content_setting_values: { geolocation: 3, notifications: 3, popups: 1 }, name: 'Person 1', password_manager_enabled: true },
      safebrowsing: { enabled: false, enhanced: false },
      session: { restore_on_startup: 5 },
      bookmark_bar: { show_on_all_tabs: true },
    };
    put(chromiumPrefsPath(home), JSON.stringify(prefs) + '\n');
    put(`${home}/.config/chromium/Local State`, JSON.stringify({ browser: { enabled_labs_experiments: [] }, os_crypt: { encrypted_key: 'simulated' } }) + '\n');
    const bm = bookmarkTree([{ name: 'Community', url: 'https://community.linuxmint.com/' }]);
    put(chromiumBookmarksPath(home), JSON.stringify(bm, null, 3) + '\n');
  }
  // Firefox (installed on both images; it is the required browser on Ubuntu)
  const prof = `${home}/.mozilla/firefox/k7m2x9qa.default-release`;
  put(`${home}/.mozilla/firefox/profiles.ini`, '[Profile0]\nName=default-release\nIsRelative=1\nPath=k7m2x9qa.default-release\nDefault=1\n\n[General]\nStartWithLastProfile=1\nVersion=2\n', 0o644);
  const ffHome = distro === 'ubuntu' ? 'about:home' : 'https://www.linuxmint.com/start/virginia/';
  const ffPrefs = [
    ['app.normandy.first_run', false], ['browser.startup.homepage', ffHome], ['browser.shell.checkDefaultBrowser', false],
    ['dom.disable_open_during_load', false],
    ['browser.safebrowsing.malware.enabled', false], ['browser.safebrowsing.phishing.enabled', false], ['browser.safebrowsing.downloads.enabled', false],
    ['signon.rememberSignons', true], ['network.cookie.cookieBehavior', 5],
  ];
  put(`${prof}/prefs.js`, FF_PREFS_HEADER + ffPrefs.map(([k, v]) => `user_pref("${k}", ${fmtVal(v)});`).join('\n') + '\n');
  put(`${prof}/bookmarks.json`, '[]\n');
}
