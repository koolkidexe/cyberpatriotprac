// Browser preference files: what the browser does (pop-ups, Safe Browsing, downloads) and how the scoring reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.mjs';
import * as BP from '../src/core/browserprefs.js';
import { siteFor } from '../src/apps/browser-sites.js';

const PRIZE = 'http://www.prize-winner.example/';
const FF = '/home/student/.mozilla/firefox/k7m2x9qa.default-release';
const CR = '/home/student/.config/chromium/Default/Preferences';

test('the images start with pop-ups allowed and Safe Browsing off in both browsers', () => {
  for (const os of ['mint', 'ubuntu']) {
    const { sys } = makeEnv({ os });
    assert.equal(BP.popupsAllowed(sys, 'student', 'firefox', PRIZE), true, os);
    assert.equal(BP.safeBrowsingBlocks(sys, 'student', 'firefox', 'phishing'), false, os);
    assert.equal(BP.dangerousDownloadsBlocked(sys, 'student', 'firefox'), false, os);
  }
  const { sys } = makeEnv();
  assert.equal(BP.popupsAllowed(sys, 'student', 'chromium', PRIZE), true);
  assert.equal(BP.chromiumSafeBrowsing(sys, 'student').level, 0);
});

test('chromium: default pop-up setting, site exceptions and enterprise policy', () => {
  const { sys } = makeEnv();
  BP.setChromium(sys, 'student', { 'profile.default_content_setting_values.popups': 2 });
  assert.equal(BP.popupsAllowed(sys, 'student', 'chromium', PRIZE), false);
  assert.equal(JSON.parse(sys.vfs.readFile(CR)).profile.default_content_setting_values.popups, 2);
  BP.chromiumSetException(sys, 'student', 'popups', BP.chromiumOrigin('http://intranet.apex.example/x'), 1);
  assert.equal(BP.popupsAllowed(sys, 'student', 'chromium', 'http://intranet.apex.example/'), true, 'allowed site');
  assert.equal(BP.popupsAllowed(sys, 'student', 'chromium', PRIZE), false, 'other sites still blocked');
  assert.deepEqual(BP.chromiumExceptions(sys, 'student', 'popups').allow, ['http://intranet.apex.example:80']);
  // a managed policy overrides the user's choice and the site exceptions
  sys.vfs.mkdir('/etc/chromium/policies/managed', { parents: true });
  sys.vfs.writeFile('/etc/chromium/policies/managed/cp.json', '{"DefaultPopupsSetting": 1}');
  assert.equal(BP.chromiumPopupSetting(sys, 'student').managed, true);
  assert.equal(BP.popupsAllowed(sys, 'student', 'chromium', PRIZE), true);
});

test('chromium: Safe Browsing levels, policy and reset', () => {
  const { sys } = makeEnv();
  BP.chromiumSetSafeBrowsing(sys, 'student', 2);
  assert.deepEqual(BP.chromiumSafeBrowsing(sys, 'student'), { level: 2, managed: false });
  assert.equal(BP.safeBrowsingBlocks(sys, 'student', 'chromium', 'malware'), true);
  assert.equal(BP.dangerousDownloadsBlocked(sys, 'student', 'chromium'), true);
  BP.chromiumSetSafeBrowsing(sys, 'student', 0);
  assert.equal(BP.safeBrowsingBlocks(sys, 'student', 'chromium', 'phishing'), false);
  BP.chromiumResetSettings(sys, 'student');
  assert.equal(BP.chromiumSafeBrowsing(sys, 'student').level, 1, 'reset turns standard protection back on');
  assert.equal(BP.chromiumPopupsBlocked(sys, 'student'), true, 'reset restores the pop-up blocker');
  sys.vfs.mkdir('/etc/chromium/policies/managed', { parents: true });
  sys.vfs.writeFile('/etc/chromium/policies/managed/sb.json', '{"SafeBrowsingProtectionLevel": 0}');
  assert.deepEqual(BP.chromiumSafeBrowsing(sys, 'student'), { level: 0, managed: true });
});

test('firefox: prefs.js, exceptions list, user.js and policies.json', () => {
  const { sys } = makeEnv({ os: 'ubuntu' });
  BP.setFirefox(sys, 'student', { 'dom.disable_open_during_load': true });
  assert.match(sys.vfs.readFile(`${FF}/prefs.js`), /user_pref\("dom\.disable_open_during_load", true\);/);
  assert.equal(BP.popupsAllowed(sys, 'student', 'firefox', PRIZE), false);
  BP.setFirefoxPopupAllowList(sys, 'student', ['http://www.prize-winner.example']);
  assert.equal(BP.popupsAllowed(sys, 'student', 'firefox', PRIZE), true, 'exception allows the site');
  assert.equal(BP.popupsAllowed(sys, 'student', 'firefox', 'http://popuptest.example/'), false);
  // user.js wins over prefs.js and is reported as locked
  sys.vfs.writeFile(`${FF}/user.js`, 'user_pref("dom.disable_open_during_load", false);\n');
  assert.deepEqual(BP.firefoxGet(sys, 'student', 'dom.disable_open_during_load'), { value: false, source: 'user.js', locked: true });
  sys.vfs.unlink(`${FF}/user.js`);
  // a locked enterprise policy wins over everything
  sys.vfs.mkdir('/etc/firefox/policies', { parents: true });
  sys.vfs.writeFile('/etc/firefox/policies/policies.json', JSON.stringify({ policies: { PopupBlocking: { Default: false, Locked: true } } }));
  assert.equal(BP.firefoxGet(sys, 'student', 'dom.disable_open_during_load').source, 'policy');
  assert.equal(BP.firefoxPopupsBlocked(sys, 'student'), false);
});

test('firefox: dangerous downloads need both malware and download protection', () => {
  const { sys } = makeEnv({ os: 'ubuntu' });
  BP.setFirefox(sys, 'student', { 'browser.safebrowsing.malware.enabled': true, 'browser.safebrowsing.phishing.enabled': true });
  assert.equal(BP.safeBrowsingBlocks(sys, 'student', 'firefox', 'phishing'), true);
  assert.equal(BP.dangerousDownloadsBlocked(sys, 'student', 'firefox'), false);
  BP.setFirefox(sys, 'student', { 'browser.safebrowsing.downloads.enabled': true });
  assert.equal(BP.dangerousDownloadsBlocked(sys, 'student', 'firefox'), true);
});

test('mint scoring: Chromium pop-up and Safe Browsing checks gain and lose points', async () => {
  const e = makeEnv();
  e.engine.evaluate();
  assert.ok(!e.engine.state.found['chr-popups'] && !e.engine.state.found['chr-safebrowsing']);
  await e.run(`sed -i 's/"popups":1/"popups":2/' ~/.config/chromium/Default/Preferences`);
  BP.chromiumSetSafeBrowsing(e.sys, 'student', 1);
  e.engine.evaluate();
  assert.ok(e.engine.state.found['chr-popups'], 'pop-ups blocked');
  assert.ok(e.engine.state.found['chr-safebrowsing'], 'safe browsing on');
  assert.equal(e.engine.score(), 4);
  BP.chromiumSetSafeBrowsing(e.sys, 'student', 0);
  e.engine.evaluate();
  assert.ok(!e.engine.state.found['chr-safebrowsing'], 'turning it off again removes the points');
});

test('ubuntu scoring: Firefox checks follow prefs.js edits made in the terminal', async () => {
  const e = makeEnv({ os: 'ubuntu' });
  await e.run("sed -i 's/\"dom.disable_open_during_load\", false/\"dom.disable_open_during_load\", true/' ~/.mozilla/firefox/*.default-release/prefs.js");
  await e.run("sed -i '/safebrowsing.\\(malware\\|phishing\\)/s/false/true/' ~/.mozilla/firefox/*.default-release/prefs.js");
  e.engine.evaluate();
  assert.ok(e.engine.state.found['ff-popups']);
  assert.ok(e.engine.state.found['ff-safebrowsing']);
  assert.ok(!e.engine.state.found['ff-downloads'], 'download protection is a separate setting');
});

test('another user cannot change student\'s browser settings', () => {
  const { sys } = makeEnv();
  const st = sys.vfs.stat(CR);
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(st.uid, 1000);
});

test('the simulated web knows its training sites and nothing else', () => {
  assert.equal(siteFor('http://account-verify.example/login').threat, 'phishing');
  assert.equal(siteFor('http://free-games.example/').threat, 'malware');
  assert.equal(siteFor(PRIZE).popups.length, 2);
  assert.equal(siteFor('https://www.google.com/').missing, true);
  assert.equal(siteFor('file:///etc/passwd'), null);
});
