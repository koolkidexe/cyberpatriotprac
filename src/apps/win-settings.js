// Settings (System, Accounts, Apps, Windows Update, Privacy & security, Network) and Windows Security
// (Virus & threat protection, Firewall & network protection, App & browser control). Toggles that need
// administrator rights show the UAC prompt first, like the real apps.
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { elevate } from '../ui/win-shell.js';
import { winVer } from '../win/image.js';
import * as S from '../win/state.js';

const lc = (s) => String(s ?? '').toLowerCase();
const tog = (on, onclick, { disabled, title } = {}) => h('div', { class: 'w-togl', title: title || '' }, h('span', null, on ? 'On' : 'Off'), h('div', { class: 'w-tog' + (on ? ' on' : '') + (disabled ? ' dis' : ''), role: 'switch', onclick }));
const card = (ic, title, sub, right, { onclick, cls = '' } = {}) => h('div', { class: `wcard ${cls}${onclick ? ' click' : ''}`, onclick, title: onclick ? title : '' }, ic ? icon(ic, 22) : null, h('div', { class: 't' }, h('b', null, title), sub ? h('div', { class: 'sub' }, sub) : null), right || (onclick ? h('span', { style: { color: '#777' } }, '›') : null));
const admin = (env, opts, what) => (opts.elevated ? Promise.resolve(true) : elevate(env, { what }));

// ============================================================================ Settings
const PAGES = [['system', 'System', 'w-thispc'], ['network', 'Network & internet', 'w-network'], ['personalization', 'Personalization', 'w-image'], ['apps', 'Apps', 'w-programs'], ['accounts', 'Accounts', 'w-users'], ['time', 'Time & language', 'w-taskschd'], ['privacy', 'Privacy & security', 'w-security'], ['update', 'Windows Update', 'w-update']];

const PAGES10 = [['system', 'System', 'w-thispc', 'Display, sound, notifications, power'], ['devices', 'Devices', 'w-thispc', 'Bluetooth, printers, mouse'], ['network', 'Network & Internet', 'w-network', 'Wi-Fi, airplane mode, VPN'], ['personalization', 'Personalization', 'w-image', 'Background, lock screen, colors'], ['apps', 'Apps', 'w-programs', 'Uninstall, defaults, optional features'], ['accounts', 'Accounts', 'w-users', 'Your accounts, email, sync, work, family'], ['time', 'Time & Language', 'w-taskschd', 'Speech, region, date'], ['privacy', 'Privacy', 'w-lock', 'Location, camera, microphone'], ['update', 'Update & Security', 'w-update', 'Windows Update, recovery, backup']];

/** NSIS-style uninstaller window used by most third-party programs ("<name> Uninstall"). Resolves true when removed. */
export function nsisUninstall(env, p, { elevated = false } = {}) {
  const sys = env.sys;
  return (async () => {
    if (!elevated && !(await elevate(env, { what: `${p.name} Uninstall` }))) return false;
    let stage = 0;
    return env.ui.modal((done) => {
      const head = h('div', { class: 'nsis-h' }); const body = h('div', { class: 'nsis-b' }); const foot = h('div', { class: 'nsis-f' });
      const draw = () => {
        clear(head); clear(body); clear(foot);
        if (stage === 0) {
          head.append(h('div', null, h('b', null, `Uninstall ${p.name}`), h('div', null, `Remove ${p.name} from your computer.`)), icon('w-programs', 36));
          body.append(h('p', null, `${p.name} will be uninstalled from the following folder. Click Uninstall to start the uninstallation.`), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, 'Uninstalling from:', h('input', { class: 'w-in', readOnly: true, value: p.dir ? S.toWin(p.dir) : `C:\Program Files\${p.name}`, style: { flex: 1 } })));
          foot.append(h('span', { class: 'nsis-brand' }, 'Nullsoft Install System v3.08'), h('button', { class: 'w-btn primary', onclick: () => { stage = 1; draw(); setTimeout(() => { try { S.uninstallProgram(sys, p); } catch (e) { stage = -1; } if (stage !== -1) stage = 2; draw(); }, 900); } }, 'Uninstall'), h('button', { class: 'w-btn', onclick: () => done(false) }, 'Cancel'));
        } else if (stage === 1) {
          head.append(h('div', null, h('b', null, 'Uninstalling'), h('div', null, `Please wait while ${p.name} is being uninstalled.`)), icon('w-programs', 36));
          body.append(h('div', null, 'Remove folder: ' + (p.dir ? S.toWin(p.dir) : '')), h('progress', { class: 'nsis-p', max: 100, value: 60 }));
          foot.append(h('span', { class: 'nsis-brand' }, 'Nullsoft Install System v3.08'), h('button', { class: 'w-btn', disabled: true }, '< Back'), h('button', { class: 'w-btn', disabled: true }, 'Close'), h('button', { class: 'w-btn', disabled: true }, 'Cancel'));
        } else {
          const ok = stage === 2;
          head.append(h('div', null, h('b', null, ok ? 'Uninstallation Complete' : 'Uninstallation Failed'), h('div', null, ok ? 'Uninstall was completed successfully.' : 'The program could not be removed.')), icon('w-programs', 36));
          body.append(h('div', null, ok ? 'Completed' : 'Error'), h('progress', { class: 'nsis-p', max: 100, value: 100 }));
          foot.append(h('span', { class: 'nsis-brand' }, 'Nullsoft Install System v3.08'), h('button', { class: 'w-btn', disabled: true }, '< Back'), h('button', { class: 'w-btn primary', onclick: () => done(ok) }, 'Close'), h('button', { class: 'w-btn', disabled: true }, 'Cancel'));
        }
      };
      draw();
      return h('div', { class: 'nsis' }, h('div', { class: 'wd-t' }, h('span', null, `${p.name} Uninstall`), h('span', { onclick: () => stage !== 1 && done(stage === 2) }, '✕')), head, body, foot);
    });
  })();
}
const appIcon = (p) => ({ 'Mozilla.Firefox': 'firefox', 'Mozilla.Thunderbird': 'w-thunderbird', 'Notepad++.Notepad++': 'w-notepadpp', 'WiresharkFoundation.Wireshark': 'w-wireshark', 'Insecure.Nmap': 'w-nmap', 'Google.Chrome': 'w-chrome' }[p.id] || 'w-programs');
const isMsApp = (p) => /^Microsoft/i.test(p.publisher || '') || p.system;

export function open(env, opts = {}) {
  if (opts.app === 'security') return openSecurity(env, opts);
  const sys = env.sys;
  const W10 = winVer(sys).shell === 10;
  let page = W10 && !opts.page ? 'home' : opts.page === 'activation' ? 'update' : PAGES.some((p) => p[0] === opts.page) ? opts.page : /update/.test(opts.page || '') ? 'update' : /remotedesktop|about/.test(opts.page || '') ? 'system' : /otherusers|accounts|yourinfo/.test(opts.page || '') ? 'accounts' : /apps|appsfeatures/.test(opts.page || '') ? 'apps' : /windowsdefender|privacy/.test(opts.page || '') ? 'privacy' : 'system';
  let sub = opts.sub || (opts.page === 'activation' ? 'activation' : /remotedesktop/.test(opts.page || '') ? 'rdp' : /taskbar/.test(opts.page || '') ? 'taskbar' : null);
  if (/taskbar/.test(opts.page || '')) page = 'personalization';
  const nav = h('div', { class: 'wset-nav' });
  const main = h('div', { class: 'wset-main' });
  const root = h('div', { class: 'wset' }, nav, main);
  const add = (...xs) => main.append(...xs.filter((x) => x != null && x !== false));
  const win = env.wm.open({ title: 'Settings', icon: 'w-settings', width: 1000, height: 660, appId: 'settings', content: root });
  const u = () => S.getUser(sys, env.user);
  const q = h('input', { class: 'w-in wset-q', placeholder: 'Find a setting', title: 'Search settings', onkeydown: (e) => { if (e.key !== 'Enter') return; const v = lc(q.value); const hit = [['remote', 'system', 'rdp'], ['firewall', 'privacy', null], ['update', 'update', null], ['user', 'accounts', null], ['account', 'accounts', null], ['app', 'apps', null], ['uninstall', 'apps', null], ['defender', 'privacy', null], ['virus', 'privacy', null], ['about', 'system', 'about']].find(([k]) => v.includes(k)); if (hit) { page = hit[1]; sub = hit[2]; render(); } } });
  function drawNav() {
    clear(nav);
    if (W10) {
      nav.append(h('div', { class: 'wset-n' + (page === 'home' ? ' sel' : ''), title: 'Home', onclick: () => { page = 'home'; sub = null; render(); } }, h('span', { style: { width: '18px', textAlign: 'center' } }, '⌂'), h('span', null, 'Home')), q);
      for (const [id, name, ic] of PAGES10) if (id !== 'devices') nav.append(h('div', { class: 'wset-n' + (page === id ? ' sel' : ''), title: name, onclick: () => { page = id; sub = null; render(); } }, icon(ic, 18), h('span', null, name)));
      return;
    }
    nav.append(h('div', { class: 'wset-user' }, icon('w-user', 60), h('div', null, h('div', { style: { fontWeight: 600 } }, u()?.full || env.user), h('div', { class: 'sub' }, 'Local Account'))), q);
    for (const [id, name, ic] of PAGES) nav.append(h('div', { class: 'wset-n' + (page === id ? ' sel' : ''), title: name, onclick: () => { page = id; sub = null; render(); } }, icon(ic, 18), h('span', null, name)));
  }
  const title = (t, crumb) => h('h1', null, crumb ? [h('span', { class: 'crumb', style: { cursor: 'pointer' }, onclick: () => { sub = null; render(); } }, crumb), '  ›  '] : null, t);
  function render() {
    drawNav(); clear(main);
    root.classList.toggle('w10', W10);
    const P = { home, devices: home, system, network, personalization, apps, accounts, time, privacy, update }[page];
    P();
    win.setTitle('Settings');
  }
  // -------------------------------------------------------------- Home (Windows 10 tile grid)
  function home() {
    page = 'home';
    add(h('div', { class: 'w10-home-h' }, h('h1', null, 'Windows Settings'), h('input', { class: 'w-in', placeholder: 'Find a setting', style: { width: '380px' }, onkeydown: (e) => { if (e.key === 'Enter') { q.value = e.target.value; q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); } } })),
      sys.win.activated ? null : h('div', { class: 'w10-act' }, 'Windows isn\'t activated. ', h('a', { class: 'w-link', onclick: () => { page = 'update'; sub = 'activation'; render(); } }, 'Activate Windows now.')),
      h('div', { class: 'w10-grid' }, PAGES10.map(([id, name, ic, d]) => h('div', { class: 'w10-tile', title: name, onclick: () => { page = id === 'devices' ? 'system' : id; sub = null; render(); } }, icon(ic, 32), h('div', null, h('b', null, name), h('div', { class: 'sub' }, d))))));
  }
  function activation() {
    add(title('Activation', W10 ? 'Update & Security' : 'System'),
      h('h3', null, 'Windows'), card(null, 'Edition', winVer(sys).product), card(null, 'Activation', sys.win.activated ? 'Windows is activated' : 'Windows is not activated'),
      sys.win.activated ? null : h('div', { class: 'wcard warn' }, icon('w-warn', 20), h('div', { class: 't' }, h('b', null, 'Windows reported that no product key was found on your device.'), h('div', { class: 'sub' }, 'Error code: 0xC004F213. A practice image does not need to be activated; activation is never a scored task.'))),
      card('w-settings', 'Change product key', '', null, { onclick: () => env.ui.alert({ title: 'Activation', heading: 'Enter a product key', message: 'Product keys cannot be entered on this practice image.', icon: 'w-info' }) }));
  }
  // -------------------------------------------------------------- System
  function system() {
    if (sub === 'rdp') {
      const on = S.rdpEnabled(sys); const nla = S.nlaRequired(sys);
      add(title('Remote Desktop', 'System'),
        card('w-thispc', 'Remote Desktop', 'Connect to and use this PC from another device using the Remote Desktop app', tog(on, async () => {
          if (!(await admin(env, opts, 'Remote Desktop settings'))) return;
          if (!on) { const ok = await env.ui.confirm({ title: 'Remote Desktop', heading: 'Enable Remote Desktop?', message: 'You and anyone you allow will be able to connect to this PC remotely.', ok: 'Confirm' }); if (!ok) return; }
          S.regSet(sys, S.KEYS.ts, 'fDenyTSConnections', on ? 1 : 0);
          const t = S.getService(sys, 'TermService');
          if (!on) { if (t.startType === 'Disabled') S.setStartType(sys, 'TermService', 'Manual'); S.startService(sys, 'TermService'); } else S.stopService(sys, 'TermService');
          render();
        })),
        on ? card(null, 'Require devices to use Network Level Authentication to connect (Recommended)', '', h('input', { type: 'checkbox', checked: nla, title: 'Network Level Authentication', onclick: async (e) => { e.preventDefault(); if (!(await admin(env, opts, 'Remote Desktop settings'))) return; S.regSet(sys, S.KEYS.rdpTcp, 'UserAuthentication', nla ? 0 : 1); render(); } })) : null,
        card(null, 'Remote Desktop port', String(S.regGet(sys, S.KEYS.rdpTcp, 'PortNumber') ?? 3389)),
        card('w-users', 'Remote Desktop users', `Members of the Remote Desktop Users group: ${S.getGroup(sys, 'Remote Desktop Users').members.join(', ') || '(none)'}`, null, { onclick: () => env.openApp('lusrmgr', { node: 'groups' }) }));
      return;
    }
    if (sub === 'about') {
      add(title('About', 'System'), h('div', { class: 'wban' }, icon('w-thispc', 48), h('div', null, h('h2', null, sys.hostname), h('div', { class: 'sub' }, 'Simulated PC'))),
        h('h3', null, 'Device specifications'), card(null, 'Device name', sys.hostname), card(null, 'Processor', 'Intel(R) Core(TM) i5-1135G7 @ 2.40GHz'), card(null, 'Installed RAM', '8.00 GB'), card(null, 'System type', '64-bit operating system, x64-based processor'),
        h('h3', null, 'Windows specifications'), card(null, 'Edition', winVer(sys).product), card(null, 'Version', winVer(sys).display), card(null, 'OS build', `${winVer(sys).build}.${winVer(sys).ubr}`),
        card(null, 'Advanced system settings', 'System Properties: remote assistance, computer name', null, { onclick: () => env.openApp('sysdm') }));
      return;
    }
    add(title('System'), h('div', { class: 'wban' }, icon('w-thispc', 48), h('div', null, h('h2', null, sys.hostname), h('div', { class: 'sub' }, winVer(sys).product))),
      card('w-thispc', 'Display', 'Monitors, brightness, night light, display profile'), card('w-volume', 'Sound', 'Volume levels, output, input, sound devices'), card('w-bell', 'Notifications', 'Alerts from apps and system'),
      card('w-thispc', 'Remote Desktop', 'Remote Desktop users, connection permissions', null, { onclick: () => { sub = 'rdp'; render(); } }),
      card('w-info', 'About', 'Device specifications, rename PC, Windows specifications', null, { onclick: () => { sub = 'about'; render(); } }),
      W10 ? null : card('w-ok', 'Activation', 'Activation state, subscriptions, product key', null, { onclick: () => { page = 'update'; sub = 'activation'; render(); } }));
  }
  function network() {
    const fw = S.firewallAllOn(sys);
    add(title('Network & internet'), h('div', { class: 'wban' }, icon('w-network', 48), h('div', null, h('h2', null, 'Ethernet'), h('div', { class: 'sub' }, 'Private network · Connected, secured'))),
      card('w-firewall', 'Windows Firewall', fw ? 'Firewall is on for all network profiles' : 'One or more firewall profiles are off', null, { onclick: () => env.openApp('security', { page: 'firewall' }), cls: fw ? '' : 'warn' }),
      card('w-network', 'Advanced network settings', 'View all network adapters, network reset', null, { onclick: () => env.openApp('control') }));
  }
  function personalization() {
    if (sub === 'taskbar') {
      const ADV = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced'; const SRCH = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search';
      const al = Number(S.regGet(sys, ADV, 'TaskbarAl') ?? 1); const sm = Number(S.regGet(sys, SRCH, 'SearchboxTaskbarMode') ?? 2);
      const sel = (cur, opts2, onchange, t) => h('select', { class: 'w-in', title: t, onchange: (e) => { onchange(Number(e.target.value)); env.desktop?.build?.(); render(); } }, opts2.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
      add(title('Taskbar', 'Personalization'),
        card('w-search', 'Search', 'Choose how search looks on the taskbar', sel(sm, [[0, 'Hide'], [1, 'Search icon only'], [2, 'Search box']], (v) => S.regSet(sys, SRCH, 'SearchboxTaskbarMode', v), 'Search on the taskbar')),
        h('h3', null, 'Taskbar behaviors'),
        card('w-explorer', 'Taskbar alignment', 'Left (like the competition image) or Center (the Windows 11 default)', sel(al, [[0, 'Left'], [1, 'Center']], (v) => S.regSet(sys, ADV, 'TaskbarAl', v), 'Taskbar alignment')));
      return;
    }
    add(title('Personalization'), card('w-image', 'Background', 'Background image, color, slideshow'), card('w-settings', 'Colors', 'Accent color, transparency effects, color theme'), card('w-lock', 'Lock screen', 'Lock screen images, apps, animations'), card('w-explorer', 'Taskbar', 'Taskbar behaviors, system pins', null, { onclick: () => { sub = 'taskbar'; render(); } }));
  }
  function time() { const d = new Date(sys.now()); add(title('Time & language'), card('w-taskschd', 'Date & time', d.toLocaleString(), null), card('w-network', 'Language & region', 'English (United States)')); }
  // -------------------------------------------------------------- Apps
  function apps() {
    if (sub === 'optional') { env.openApp('features'); sub = null; }
    let picked = null;
    const list = S.listPrograms(sys).slice().sort((a, b) => a.name.localeCompare(b.name));
    const search = h('input', { class: 'w-in', placeholder: 'Search apps', style: { width: '320px' }, oninput: () => draw() });
    const box = h('div');
    const draw = () => {
      clear(box);
      const f = list.filter((p) => !search.value || lc(p.name).includes(lc(search.value)));
      box.append(h('div', { class: 'sub', style: { margin: '10px 0' } }, `${f.length} apps found`));
      if (W10) {
        for (const p of f) {
          const row = h('div', { class: 'w10-app' + (picked === p.id ? ' sel' : ''), onclick: () => { picked = picked === p.id ? null : p.id; draw(); } },
            h('div', { class: 'w10-app-r' }, icon(appIcon(p), 30), h('div', { style: { flex: 1 } }, h('div', null, p.name), h('div', { class: 'sub' }, p.publisher || '')), h('div', { style: { textAlign: 'right' } }, h('div', null, p.size ? `${p.size} MB` : ''), h('div', { class: 'sub' }, p.installed || ''))));
          if (picked === p.id) row.append(h('div', { class: 'w10-app-a' }, h('span', { class: 'sub' }, p.version), h('span', { style: { flex: 1 } }), h('button', { class: 'w-btn', disabled: true }, 'Modify'), h('button', { class: 'w-btn', disabled: !!p.system, onclick: (e) => { e.stopPropagation(); uninstall(p, e.currentTarget); } }, 'Uninstall')));
          box.append(row);
        }
        return;
      }
      for (const p of f) {
        const more = h('button', { class: 'w-btn', title: 'More options', style: { minHeight: '28px', padding: '0 10px' }, onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); env.ui.showMenu(r.left - 100, r.bottom, [{ label: 'Modify', disabled: true }, { label: 'Uninstall', disabled: !!p.system, action: () => uninstall(p) }]); } }, '⋯');
        box.append(card(p.id === 'Google.Chrome' ? 'w-chrome' : 'w-programs', p.name, `${p.version}  |  ${p.publisher || ''}  |  ${p.installed || ''}`, h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, h('span', { class: 'sub' }, p.size ? `${p.size} MB` : ''), more)));
      }
    };
    if (W10) { add(title('Apps & features'), h('div', { class: 'sub' }, 'Search, sort, and filter by drive. If you would like to uninstall or move an app, select it from the list.'), h('div', { style: { margin: '10px 0' } }, search), box); draw(); return; }
    add(title('Installed apps', 'Apps'), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, search, h('a', { class: 'w-link', onclick: () => env.openApp('features') }, 'Optional features'), h('a', { class: 'w-link', onclick: () => env.openApp('programs') }, 'Programs and Features')), box);
    draw();
  }
  async function uninstall(p) {
    const ok = await env.ui.confirm({ title: 'Uninstall', heading: `This app and its related info will be uninstalled.`, message: p.name, ok: 'Uninstall' });
    if (!ok) return;
    if (!isMsApp(p)) { const done = await nsisUninstall(env, p, { elevated: opts.elevated }); if (done) { env.ui.toast({ title: 'Uninstalled', message: p.name, kind: 'info' }); env.desktop?.renderIcons?.(); } render(); return; }
    if (!(await admin(env, opts, `${p.name} Uninstaller`))) return;
    try { S.uninstallProgram(sys, p); env.ui.toast({ title: 'Uninstalled', message: p.name, kind: 'info' }); env.desktop?.renderIcons?.(); } catch (e) { env.ui.alert({ title: 'Uninstall', heading: 'Could not uninstall', message: e.message, icon: 'w-bad' }); }
    render();
  }
  // -------------------------------------------------------------- Accounts
  function accounts() {
    if (sub === 'others') {
      const list = S.listUsers(sys).filter((x) => x.rid >= 1000 && lc(x.name) !== lc(env.user));
      add(title('Other users', 'Accounts'), card('w-users', 'Add other user', '', h('button', { class: 'w-btn', onclick: addAccount }, 'Add account')), h('h3', null, 'Other users'));
      for (const x of list) {
        const adminNow = S.isAdmin(sys, x.name);
        add(card('w-user', x.full || x.name, `${adminNow ? 'Administrator - ' : ''}Local account${x.enabled ? '' : ' · Disabled'}`, h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { class: 'w-btn', title: 'Change account type', onclick: () => changeType(x.name) }, 'Change account type'), h('button', { class: 'w-btn', title: 'Remove account and data', onclick: () => removeAccount(x.name) }, 'Remove'))));
      }
      return;
    }
    const me = u();
    add(title('Accounts'), h('div', { class: 'wban' }, icon('w-user', 64), h('div', null, h('h2', null, me?.full || env.user), h('div', { class: 'sub' }, `Local Account${S.isAdmin(sys, env.user) ? '\nAdministrator' : ''}`))),
      card('w-user', 'Your info', 'Accounts used by email, calendar, and contacts'), card('w-lock', 'Sign-in options', 'Windows Hello, security key, password, dynamic lock', null, { onclick: () => changeMyPw() }),
      card('w-users', 'Other users', 'Device access, work or school users, kiosk assigned access', null, { onclick: () => { sub = 'others'; render(); } }));
  }
  async function changeMyPw() {
    const cur = await env.ui.prompt({ title: 'Change your password', message: 'Current password:', password: true }); if (cur == null) return;
    if (!S.checkPassword(sys, env.user, cur)) { env.ui.alert({ title: 'Change your password', heading: 'Your current password is incorrect.', message: '', icon: 'w-warn' }); return; }
    const n = await env.ui.prompt({ title: 'Change your password', message: 'New password:', password: true }); if (n == null) return;
    try { S.setPassword(sys, env.user, n); env.ui.toast({ title: 'Password changed', message: 'Use your new password the next time you sign in.', kind: 'info' }); } catch (e) { env.ui.alert({ title: 'Change your password', heading: e.message, message: '', icon: 'w-warn' }); }
  }
  async function addAccount() {
    if (!(await admin(env, opts, 'Add account'))) return;
    const name = await env.ui.prompt({ title: 'Create a user for this PC', message: 'User name:' }); if (!name) return;
    const pw = await env.ui.prompt({ title: 'Create a user for this PC', message: 'Make it secure. Password:', password: true }); if (pw == null) return;
    try { S.addUser(sys, { name: name.trim(), groups: ['Users'] }); if (pw) S.setPassword(sys, name.trim(), pw); } catch (e) { try { if (S.getUser(sys, name.trim())) S.removeUser(sys, name.trim()); } catch { /* ignore */ } env.ui.alert({ title: 'Create a user', heading: 'Could not create the account', message: e.message, icon: 'w-warn' }); }
    render();
  }
  async function changeType(name) {
    const isA = S.isAdmin(sys, name);
    const sel = await env.ui.modal((done) => { const s = h('select', { class: 'w-in', style: { width: '100%' } }, h('option', { selected: isA }, 'Administrator'), h('option', { selected: !isA }, 'Standard User')); return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Change account type'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('h3', null, name), h('p', null, 'Account type'), s)), h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => done(s.value) }, 'OK'), h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'))); });
    if (!sel || (sel === 'Administrator') === isA) return;
    if (!(await admin(env, opts, 'Change account type'))) return;
    if (sel === 'Administrator') S.addMember(sys, 'Administrators', name); else S.removeMember(sys, 'Administrators', name);
    render();
  }
  async function removeAccount(name) {
    const ok = await env.ui.confirm({ title: 'Delete account and data?', heading: `Deleting ${name}'s account will remove all of their data from this PC, including items on their desktop, downloads, documents, photos, music and other files.`, message: '', ok: 'Delete account and data', danger: true, icon: 'w-warn' });
    if (!ok) return;
    if (!(await admin(env, opts, 'Remove account'))) return;
    try { S.removeUser(sys, name); const d = `/Users/${name}`; if (sys.vfs.exists(d)) sys.vfs.rmrf(d); sys.touch('fs'); } catch (e) { env.ui.alert({ title: 'Remove account', heading: 'Could not remove the account', message: e.message, icon: 'w-bad' }); }
    render();
  }
  // -------------------------------------------------------------- Privacy & security
  function privacy() {
    add(title('Privacy & security'), h('h3', null, 'Security'),
      card('w-security', 'Windows Security', 'Antivirus, browser, firewall, and network protection for your device', null, { onclick: () => env.openApp('security') }),
      card('w-thispc', 'Find my device', 'Off'), card('w-settings', 'For developers', 'These settings are intended for development use only'),
      h('h3', null, 'Windows permissions'), card('w-info', 'General', 'Advertising ID, local content, app launches, setting suggestions'), card('w-search', 'Search permissions', 'SafeSearch, cloud content search, search history'));
  }
  // -------------------------------------------------------------- Windows Update
  function update() {
    if (sub === 'activation') return activation();
    const pend = S.pendingUpdates(sys);
    const managed = !S.autoUpdatesOn(sys);
    const svc = S.getService(sys, 'wuauserv');
    const svcOff = svc.startType === 'Disabled';
    const status = h('div', { class: 'sub' });
    add(title('Windows Update', W10 ? 'Update & Security' : null));
    if (W10) add(h('div', { class: 'w10-subnav' }, ['Windows Update', 'Delivery Optimization', 'Windows Security', 'Backup', 'Troubleshoot', 'Recovery', 'Activation', 'Find my device', 'For developers'].map((t) => h('a', { class: 'w-link', onclick: () => { if (t === 'Activation') { sub = 'activation'; render(); } else if (t === 'Windows Security') env.openApp('security'); } }, t))));
    if (managed) add(h('div', { class: 'wcard warn' }, icon('w-warn', 20), h('div', { class: 't' }, h('b', null, '*Some settings are managed by your organization'), h('div', { class: 'sub' }, 'Automatic updates are turned off by a policy (HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU\\NoAutoUpdate).'))));
    add(h('div', { class: 'wban' }, icon(pend.length ? 'w-update' : 'w-ok', 56), h('div', { style: { flex: 1 } }, h('h2', null, svcOff ? 'There were problems installing some updates' : pend.length ? 'Updates available' : "You're up to date"), status),
      h('button', { class: 'w-btn primary', title: pend.length ? 'Install all available updates' : 'Check for updates', onclick: async () => {
        if (svcOff) { env.ui.alert({ title: 'Windows Update', heading: "We couldn't install updates", message: 'Error 0x80070422: the Windows Update service (wuauserv) is disabled. Set it to Manual or Automatic in Services, then try again.', icon: 'w-warn' }); return; }
        if (!pend.length) { status.textContent = `Last checked: Today, ${new Date(sys.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; return; }
        status.textContent = 'Installing - 0%'; let pct = 0;
        const t = setInterval(() => { pct += 20; status.textContent = `Installing - ${pct}%`; if (pct >= 100) { clearInterval(t); if (svc.status !== 'Running') S.startService(sys, 'wuauserv'); S.installUpdates(sys); render(); env.ui.toast({ title: 'Windows Update', message: 'Updates installed. Restart to finish.', kind: 'info' }); } }, 350);
      } }, pend.length ? 'Install all' : 'Check for updates')));
    if (S.restartPending(sys).length) add(card('w-update', 'Restart required', 'Your device will finish installing updates when it restarts: ' + S.restartPending(sys).join(', '), h('button', { class: 'w-btn primary', onclick: () => env.power('reboot') }, 'Restart now')));
    for (const x of pend) add(card('w-update', x.title, svcOff ? 'Install error - 0x80070422' : 'Pending install', h('span', { class: 'sub' }, `${x.size} MB`)));
    add(h('h3', null, 'More options'), card('w-taskschd', 'Pause updates', '', h('select', { class: 'w-in', disabled: true }, h('option', null, 'Pause for 1 week'))),
      card('w-update', 'Update history', `${sys.win.installedUpdates.length + sys.win.updates.filter((x) => x.installed).length} updates installed`), card('w-settings', 'Advanced options', 'Delivery optimization, optional updates, active hours, other update settings'));
    status.textContent = svcOff ? 'The Windows Update service is disabled.' : pend.length ? `${pend.length} updates are ready to install` : `Last checked: Today`;
  }
  render();
  return win;
}

// ============================================================================ Windows Security
export function openSecurity(env, opts = {}) {
  const sys = env.sys;
  let page = opts.page && /firewall/.test(opts.page) ? 'firewall' : opts.page && /virus|threat/.test(opts.page) ? 'virus' : opts.page && /app|browser|smartscreen/.test(opts.page) ? 'appbrowser' : 'home';
  let profile = null;
  const nav = h('div', { class: 'wset-nav', style: { width: '260px' } });
  const main = h('div', { class: 'wset-main' });
  const root = h('div', { class: 'wset' }, nav, main);
  const add = (...xs) => main.append(...xs.filter((x) => x != null && x !== false));
  const win = env.wm.open({ title: 'Windows Security', icon: 'w-security', width: 980, height: 640, appId: 'security', content: root });
  const SS = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer';
  const NAV = [['home', 'Home', 'w-info'], ['virus', 'Virus & threat protection', 'w-security'], ['account', 'Account protection', 'w-user'], ['firewall', 'Firewall & network protection', 'w-firewall'], ['appbrowser', 'App & browser control', 'w-edge'], ['device', 'Device security', 'w-thispc'], ['health', 'Device performance & health', 'w-ok'], ['family', 'Family options', 'w-users']];
  function drawNav() { clear(nav); nav.append(h('div', { style: { height: '10px' } })); for (const [id, n, ic] of NAV) nav.append(h('div', { class: 'wset-n' + (page === id ? ' sel' : ''), title: n, onclick: () => { page = id; profile = null; render(); } }, icon(ic, 18), h('span', null, n))); }
  const status = () => ({ av: S.realtimeOn(sys), fw: S.firewallAllOn(sys), ss: lc(S.regGet(sys, SS, 'SmartScreenEnabled') ?? 'warn') !== 'off' });
  function render() {
    drawNav(); clear(main);
    ({ home, virus, firewall, appbrowser, account: simple('Account protection', 'Security for your account and sign-in.'), device: simple('Device security', 'Security that comes built into your device.'), health: simple('Device performance & health', 'No action needed.'), family: simple('Family options', 'Manage how your family uses their devices.') }[page])();
  }
  const simple = (t, s) => () => add(h('h1', null, t), card('w-ok', s, ''));
  function home() {
    const st = status();
    const tile = (ic, t, ok, id) => h('div', { class: 'wcard click' + (ok ? ' good' : ' bad'), style: { flexDirection: 'column', alignItems: 'flex-start', width: '200px', display: 'inline-flex', margin: '0 10px 10px 0', minHeight: '120px' }, onclick: () => { page = id; render(); } }, icon(ic, 36), h('b', null, t), h('div', { class: 'sub' }, ok ? 'No action needed.' : 'Action recommended.'));
    add(h('h1', null, 'Security at a glance'), h('div', { class: 'sub', style: { marginBottom: '16px' } }, 'See what\'s happening with the security and health of your device and take any actions needed.'),
      h('div', null, tile('w-security', 'Virus & threat protection', st.av, 'virus'), tile('w-user', 'Account protection', true, 'account'), tile('w-firewall', 'Firewall & network protection', st.fw, 'firewall'), tile('w-edge', 'App & browser control', st.ss, 'appbrowser'), tile('w-thispc', 'Device security', true, 'device'), tile('w-ok', 'Device performance & health', true, 'health')));
  }
  function virus() {
    const d = sys.win.defender;
    const managed = S.realtimeManaged(sys);
    const set = async (patch, what) => {
      if (!(await admin(env, opts, 'Windows Security'))) return;
      if (what === 'realtime' && !patch.realtime) { const ok = await env.ui.confirm({ title: 'Windows Security', heading: 'Turn off real-time protection?', message: 'Real-time protection is off, leaving your device vulnerable.', ok: 'Turn off' }); if (!ok) return; }
      S.setDefender(sys, patch); render();
    };
    const sig = sys.win.updates.find((u) => u.kb === 'KB2267602');
    add(h('h1', null, 'Virus & threat protection'), h('div', { class: 'sub', style: { marginBottom: '12px' } }, 'Protection for your device against threats.'),
      card('w-taskschd', 'Current threats', 'No current threats.\nLast scan: 9 days ago (quick scan)', h('button', { class: 'w-btn', onclick: () => env.ui.toast({ title: 'Windows Security', message: 'Quick scan finished. No current threats.', kind: 'info' }) }, 'Quick scan')),
      h('h3', null, 'Virus & threat protection settings'),
      !S.realtimeOn(sys) ? h('div', { class: 'wcard bad' }, icon('w-bad', 20), h('div', { class: 't' }, h('b', null, 'Real-time protection is off, leaving your device vulnerable.'))) : null,
      card(null, 'Real-time protection', managed ? 'This setting is managed by your administrator.' : 'Locates and stops malware from installing or running on your device.', tog(S.realtimeOn(sys), () => set({ realtime: !d.realtime }, 'realtime'), { disabled: managed, title: managed ? 'Managed by a policy: HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection' : 'Real-time protection' })),
      card(null, 'Cloud-delivered protection', 'Provides increased and faster protection with access to the latest protection data in the cloud.', tog(d.cloud, () => set({ cloud: !d.cloud }))),
      card(null, 'Automatic sample submission', 'Send sample files to Microsoft to help protect you and others from potential threats.', tog(d.sampleSubmission, () => set({ sampleSubmission: !d.sampleSubmission }))),
      card(null, 'Tamper Protection', 'Prevents others from tampering with important security features.', tog(d.tamper, () => set({ tamper: !d.tamper }))),
      h('h3', null, 'Virus & threat protection updates'),
      card('w-update', sig && !sig.installed ? 'Security intelligence is out of date' : 'Security intelligence is up to date.', `Last update: ${sig && !sig.installed ? '9 days ago' : 'Today'}`, h('button', { class: 'w-btn', onclick: () => { if (sig && !sig.installed) { S.installUpdates(sys, ['KB2267602']); render(); } } }, 'Check for updates'), { cls: sig && !sig.installed ? 'warn' : '' }));
  }
  function firewall() {
    if (profile) {
      const p = sys.win.firewall[profile];
      add(h('h1', null, h('span', { class: 'crumb', style: { cursor: 'pointer' }, onclick: () => { profile = null; render(); } }, 'Firewall & network protection'), '  ›  ', `${profile} network`),
        card(null, 'Microsoft Defender Firewall', 'Helps protect your device while on this network.', tog(p.enabled, async () => {
          if (!(await admin(env, opts, 'Windows Security'))) return;
          S.setFirewall(sys, [profile], !p.enabled); render();
        })),
        card(null, 'Incoming connections', 'Blocks all incoming connections, including those in the list of allowed apps.', h('input', { type: 'checkbox', disabled: true })));
      return;
    }
    add(h('h1', null, 'Firewall & network protection'), h('div', { class: 'sub', style: { marginBottom: '12px' } }, 'Who and what can access your networks.'));
    for (const [k, v] of Object.entries(sys.win.firewall)) add(card(v.enabled ? 'w-ok' : 'w-bad', `${k} network${k === 'Private' ? ' (active)' : ''}`, `Firewall is ${v.enabled ? 'on' : 'off'}.`, null, { onclick: () => { profile = k; render(); }, cls: v.enabled ? '' : 'bad' }));
    add(h('h3', null, ''), h('a', { class: 'w-link', onclick: () => env.openApp('firewall') }, 'Allow an app through firewall'), h('br'), h('a', { class: 'w-link', onclick: () => env.openApp('firewall') }, 'Advanced settings'), h('br'), h('a', { class: 'w-link', onclick: async () => { if (!(await admin(env, opts, 'Windows Security'))) return; S.setFirewall(sys, ['Domain', 'Private', 'Public'], true); render(); } }, 'Restore firewalls to default'));
  }
  function appbrowser() {
    const ss = S.regGet(sys, SS, 'SmartScreenEnabled') ?? 'Warn';
    const d = sys.win.defender;
    add(h('h1', null, 'App & browser control'), h('div', { class: 'sub', style: { marginBottom: '12px' } }, 'App protection and online security.'), h('h3', null, 'Reputation-based protection'),
      card(null, 'Check apps and files', 'Microsoft Defender SmartScreen helps protect your device by checking for unrecognized apps and files from the web.', tog(lc(ss) !== 'off', async () => { if (!(await admin(env, opts, 'Windows Security'))) return; S.regSet(sys, SS, 'SmartScreenEnabled', lc(ss) === 'off' ? 'Warn' : 'Off', 'REG_SZ'); render(); })),
      card(null, 'SmartScreen for Microsoft Edge', 'Helps protect your device from malicious sites and downloads.', tog(d.smartscreenEdge, async () => { if (!(await admin(env, opts, 'Windows Security'))) return; S.setDefender(sys, { smartscreenEdge: !d.smartscreenEdge }); render(); })),
      card(null, 'Potentially unwanted app blocking', 'Protect your device from low-reputation apps that might cause unexpected behaviors.', tog(d.pua, async () => { if (!(await admin(env, opts, 'Windows Security'))) return; S.setDefender(sys, { pua: !d.pua }); render(); })),
      h('h3', null, 'Exploit protection'), card('w-security', 'Exploit protection settings', 'Exploit protection is built into Windows to help protect your device against attacks.'));
  }
  render();
  return win;
}
