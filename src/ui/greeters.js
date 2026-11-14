// Lock screens and login screens.
//   Mint:   Cinnamon screensaver (big clock, then the unlock box) and Slick Greeter (LightDM) with a top bar and a user list.
//   Ubuntu: GNOME Shell lock screen (clock, click to unlock) and GDM (user list, "Not listed?", session gear).
// The password checks, logging and guest handling read the same virtual system files as everything else.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import * as users from '../core/users.js';
import * as K from '../core/checks.js';

const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = (d, long) => d.toLocaleDateString([], long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
const realName = (u) => (u?.gecos || '').split(',')[0] || u?.name || '';
const avatar = (u, size) => h('div', { class: 'gr-avatar', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' }, title: u?.name }, (realName(u)[0] || '?').toUpperCase());

function ticker(el, fn) {
  fn();
  const t = setInterval(() => { if (!el.isConnected) clearInterval(t); else fn(); }, 15000);
}

// ---------------------------------------------------------------- lock screen
export function showLock(env) {
  const { sys } = env;
  const user = env.user;
  const u = users.getUser(sys, user);
  const ub = env.os === 'ubuntu';
  const err = h('div', { class: 'gr-err' });
  const pw = h('input', { class: 'gr-pw', type: 'password', placeholder: 'Password', title: `Password for ${user}`, onkeydown: (e) => { if (e.key === 'Enter') tryUnlock(); if (e.key === 'Escape' && ub) { box.classList.remove('show'); } } });
  const tryUnlock = () => {
    if (users.checkPassword(sys, user, pw.value)) { sys.log?.('auth.log', ub ? 'gdm-password]' : 'cinnamon-screensaver-pam-helper', `pam_unix(${ub ? 'gdm-password' : 'cinnamon-screensaver'}:auth): session unlocked for user ${user}`); lock.remove(); return; }
    err.textContent = ub ? 'Sorry, that didn’t work. Please try again.' : 'Incorrect password'; pw.value = ''; lock.classList.add('shake'); setTimeout(() => lock.classList.remove('shake'), 400);
  };
  const clock = h('div', { class: 'gr-clock' }, h('div', { class: 'gr-time' }), h('div', { class: 'gr-date' }));
  const box = h('div', { class: 'gr-unlock' }, avatar(u, ub ? 96 : 80), h('div', { class: 'gr-name' }, realName(u)),
    h('div', { class: 'gr-pwrow' }, pw, h('button', { class: 'gr-go', title: 'Unlock', onclick: tryUnlock }, ub ? '→' : '🔓')), err,
    ub ? null : h('div', { class: 'gr-hint' }, 'Please enter your password to unlock'));
  const lock = h('div', { class: `gr gr-lock ${ub ? 'gr-ub' : 'gr-mint'}`, tabindex: 0 }, clock, box,
    ub ? h('div', { class: 'gr-press' }, 'Click or press a key to unlock') : null,
    ub ? h('div', { class: 'gr-sys', title: 'System status' }, '🔊  ⏻') : h('div', { class: 'gr-sys', title: 'Keyboard layout and power' }, 'en   ⏻'));
  const reveal = () => { if (!box.classList.contains('show')) { box.classList.add('show'); lock.classList.add('open'); setTimeout(() => pw.focus(), 30); } };
  lock.addEventListener('mousedown', reveal);
  lock.addEventListener('keydown', (e) => { if (e.target !== pw) reveal(); });
  ticker(lock, () => { const d = new Date(); clock.firstChild.textContent = fmtTime(d); clock.lastChild.textContent = fmtDate(d, true); });
  document.getElementById('screen').append(lock);
  lock.focus();
  if (!ub) reveal();
}

// ---------------------------------------------------------------- login screen
export function showGreeter(env, { onLogin }) {
  const { sys } = env;
  const ub = env.os === 'ubuntu';
  env.wm.wins.slice().forEach((w) => w.close());
  const list = users.readPasswd(sys).filter((u) => u.uid >= 1000 && u.uid < 65534 && !/nologin|false/.test(u.shell));
  let chosen = ub ? null : (list.find((u) => u.name === env.user) || list[0]);
  const guest = !ub && K.guestAllowed(sys);
  const err = h('div', { class: 'gr-err' });
  const pw = h('input', { class: 'gr-pw', type: 'password', placeholder: 'Password', title: 'Password', onkeydown: (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape' && ub) { chosen = null; render(); } } });
  const svc = ub ? 'gdm-password' : 'lightdm';
  const go = () => {
    if (!chosen) return;
    const st = users.getShadow(sys, chosen.name);
    if (users.checkPassword(sys, chosen.name, pw.value)) {
      sys.log('auth.log', ub ? 'gdm-password]' : 'lightdm', `pam_unix(${svc}:session): session opened for user ${chosen.name}(uid=${chosen.uid}) by (uid=0)`);
      g.remove(); onLogin(chosen.name);
      if (K.mustChangePassword?.(sys, chosen.name)) env.ui.toast({ title: 'Password expired', message: `${chosen.name} must change their password (run passwd in a terminal).`, kind: 'info' });
    } else {
      err.textContent = st && st.hash.startsWith('!') ? 'Account is locked' : ub ? 'Sorry, that didn’t work. Please try again.' : 'Invalid password, please try again';
      pw.value = '';
      sys.log('auth.log', ub ? 'gdm-password]' : 'lightdm', `pam_unix(${svc}:auth): authentication failure; logname= uid=0 euid=0 tty=:0 ruser= rhost=  user=${chosen.name}`);
    }
  };
  const body = h('div', { class: 'gr-body' });
  const render = () => {
    clear(body); err.textContent = '';
    if (ub) {
      if (!chosen) {
        body.append(h('div', { class: 'gdm-list' }, list.map((u) => h('div', { class: 'gdm-user', title: `Log in as ${u.name}`, onclick: () => { chosen = u; render(); } }, avatar(u, 48), h('span', null, realName(u)))),
          h('div', { class: 'gdm-notlisted', title: 'Type a user name', onclick: async () => { const n = await env.ui.prompt({ title: 'Username', message: 'Username' }); const f = n && users.getUser(sys, n.trim()); if (f) { chosen = f; render(); } } }, 'Not listed?')));
      } else {
        body.append(h('div', { class: 'gdm-auth' }, h('button', { class: 'gdm-back', title: 'Back to the user list', onclick: () => { chosen = null; render(); } }, '‹'), avatar(chosen, 96), h('div', { class: 'gr-name' }, realName(chosen)),
          h('div', { class: 'gr-pwrow' }, pw, h('button', { class: 'gr-go', title: 'Sign in', onclick: go }, '→')), err,
          h('button', { class: 'gdm-gear', title: 'Choose a session: Ubuntu, Ubuntu on Xorg' }, '⚙')));
        setTimeout(() => pw.focus(), 20);
      }
      return;
    }
    // Slick Greeter: one row per user, the selected one expands to show the password box
    const rows = list.map((u) => {
      const on = u === chosen;
      return h('div', { class: 'sg-user' + (on ? ' on' : ''), title: on ? '' : `Select ${u.name}`, onclick: () => { if (!on) { chosen = u; pw.value = ''; render(); } } },
        h('div', { class: 'sg-head' }, h('span', { class: 'sg-name' }, realName(u)), on ? h('span', { class: 'sg-session', title: 'Session: Cinnamon' }, '◐') : null),
        on ? h('div', { class: 'gr-pwrow' }, pw, h('button', { class: 'gr-go', title: 'Log In', onclick: go }, '➜')) : null, on ? err : null);
    });
    if (guest) rows.push(h('div', { class: 'sg-user', title: 'Log in as a temporary guest', onclick: () => { err.textContent = ''; env.ui.alert({ title: 'Guest Session', heading: 'Guest sessions are enabled on this computer', message: 'Anyone could log in without a password. The simulator does not start guest sessions, but the setting (allow-guest in LightDM) is live.', icon: 'warn' }); } }, h('div', { class: 'sg-head' }, h('span', { class: 'sg-name' }, 'Guest Session'))));
    body.append(h('div', { class: 'sg-box' }, rows));
    setTimeout(() => pw.focus(), 20);
  };
  const clk = h('span', { class: 'gr-topclock' });
  const top = ub
    ? h('div', { class: 'gr-top' }, h('span'), clk, h('span', { title: 'Accessibility, sound and power' }, '♿  🔊  ⏻'))
    : h('div', { class: 'gr-top' }, h('span', { class: 'sg-host', title: 'Computer name' }, sys.hostname), h('span', { style: { flex: 1 } }), h('span', { title: 'Accessibility · Keyboard layout · Power' }, '♿   en   ⏻   '), clk);
  const g = h('div', { class: `gr gr-greeter ${ub ? 'gr-ub' : 'gr-mint'}` }, top, body, ub ? h('div', { class: 'gdm-logo' }, 'ubuntu') : h('div', { class: 'sg-logo', title: 'Linux Mint' }, icon('mint-logo', 34), h('span', null, 'linux mint')));
  ticker(g, () => { const d = new Date(); clk.textContent = ub ? `${fmtDate(d)}  ${fmtTime(d)}` : `${fmtDate(d)}, ${fmtTime(d)}`; });
  document.getElementById('screen').append(g);
  render();
}
