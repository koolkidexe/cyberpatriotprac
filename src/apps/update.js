// Update Manager (mintupdate).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as pk from '../core/packages.js';
import { setIni } from './ini-util.js';
import { aptPeriodic } from '../core/checks.js';

const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} kB`);

export function open(env) {
  const sys = env.sys;
  const sel = new Set();
  const ub = env.os === 'ubuntu';
  const tb = h('tbody');
  const status = h('div', { class: 'statusbar' });
  const desc = h('div', { class: 'mu-desc' });
  let installBtn; let win; let focus = null;
  if (ub) {
    // Ubuntu's update-manager: a compact dialog with an expandable "Details of updates" list
    const details = h('div', { class: 'su-details', style: { display: 'none' } }, h('table', { class: 'grid' }, tb));
    const msg = h('div', { class: 'su-msg' });
    const exp = h('div', { class: 'su-exp', title: 'Show or hide the list of updates', onclick: () => { const o = details.style.display === 'none'; details.style.display = o ? '' : 'none'; exp.firstChild.textContent = o ? '▾ ' : '▸ '; } }, h('span', null, '▸ '), 'Details of updates');
    installBtn = h('button', { class: 'btn primary', title: 'Install the selected updates', onclick: install }, 'Install Now');
    win = env.wm.open({ title: 'Software Updater', icon: 'update', width: 560, height: 420, appId: 'update', content: h('div', { class: 'app-body su' },
      h('div', { class: 'su-top' }, icon('update', 56), msg), exp, details, status,
      h('div', { class: 'su-btns' }, h('button', { class: 'btn', title: 'Open Software & Updates', onclick: prefs }, 'Settings…'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn', title: 'Close and ask again later', onclick: () => win.close() }, 'Remind Me Later'), installBtn)) });
    win.data.msg = msg;
  } else {
    const tbtn = (ic, label, title, fn, cls = '') => h('button', { class: 'mu-tb ' + cls, title, onclick: fn }, h('span', { class: 'mu-ic' }, ic), label);
    installBtn = tbtn('⤓', 'Install Updates', 'Install the selected updates', install, 'go');
    win = env.wm.open({ title: 'Update Manager', icon: 'update', width: 820, height: 560, appId: 'update', content: h('div', { class: 'app-body mu' },
      h('div', { class: 'mu-bar' }, tbtn('✕', 'Clear', 'Deselect all updates', () => { sel.clear(); draw(); }), tbtn('☑', 'Select All', 'Select all updates', () => { sel.clear(); pk.upgradable(sys).forEach((u) => sel.add(u.name)); draw(); }), tbtn('⟳', 'Refresh', 'Refresh the list of updates', refresh), h('span', { style: { flex: 1 } }), tbtn('⚙', 'Preferences', 'Update Manager preferences (automatic refresh)', prefs), installBtn),
      h('div', { class: 'scroll mu-list' }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, [['', '28px'], ['Type', '46px'], ['Upgrade', ''], ['Version', '230px'], ['Size', '80px']].map(([x, w]) => h('th', { style: { width: w } }, x)))), tb)),
      desc, status) });
  }
  const unsub = sys.on('change', (k) => { if (k === 'packages') draw(); });
  win.onClose(() => unsub());
  function draw() {
    if (win.closed) return;
    clear(tb);
    const ups = pk.upgradable(sys).sort((a, b) => (b.security - a.security) || a.name.localeCompare(b.name));
    if (!win.data.init) { win.data.init = true; ups.forEach((u) => sel.add(u.name)); }
    for (const u of ups) {
      const cb = h('input', { type: 'checkbox', checked: sel.has(u.name), title: `Select ${u.name}`, onchange: (e) => { e.target.checked ? sel.add(u.name) : sel.delete(u.name); summary(); } });
      const row = h('tr', { class: focus === u.name ? 'sel' : '', onclick: (e) => { if (e.target !== cb) { focus = u.name; draw(); } } }, h('td', null, cb),
        ub ? null : h('td', { title: u.security ? 'Security update' : 'Software update' }, h('span', { class: 'mu-type ' + (u.security ? 'sec' : 'sw') }, u.security ? '🛡' : '⬆')),
        h('td', null, h('b', null, u.name), ub ? null : h('div', { class: 'mu-sub' }, u.desc)), h('td', null, ub ? '' : u.to), h('td', null, kb(u.size || 0)));
      tb.append(row);
    }
    const f = ups.find((u) => u.name === focus) || ups[0];
    clear(desc);
    if (f && !ub) desc.append(h('div', { class: 'mu-tabs' }, h('span', { class: 'on' }, 'Description'), h('span', null, 'Packages'), h('span', null, 'Changelog')), h('div', { style: { padding: '8px 12px' } }, h('b', null, f.desc || f.name), h('div', { class: 'mu-sub' }, `${f.name}: ${f.from} → ${f.to}${f.security ? ' (security update from jammy-security)' : ''}`)));
    if (ub) win.data.msg.textContent = ups.length ? 'Updated software is available for this computer. Do you want to install it now?' : 'The software on this computer is up to date.';
    summary();
    installBtn.disabled = !ups.length;
  }
  function summary() {
    const ups = pk.upgradable(sys);
    const chosen = ups.filter((u) => sel.has(u.name));
    const size = chosen.reduce((a, u) => a + (u.size || 0), 0);
    status.textContent = !ups.length ? (ub ? '' : 'Your system is up to date') : `${chosen.length} update${chosen.length === 1 ? '' : 's'} selected (${kb(size)})${ub ? '' : ` · ${ups.filter((u) => u.security).length} security`}`;
  }
  async function refresh() {
    const ok = await env.ui.authenticate({ message: 'Authentication is required to refresh the package cache', action: 'com.linuxmint.mintupdate', asUser: env.user });
    if (ok) { sys.log('apt-history', 'mintupdate', 'refresh'); draw(); }
  }
  async function install() {
    const names = [...sel].filter((n) => pk.upgradable(sys).some((u) => u.name === n));
    if (!names.length) { env.ui.toast({ title: 'Update Manager', message: 'No updates are selected.', kind: 'info' }); return; }
    const ok = await env.ui.authenticate({ message: 'Authentication is required to install updates', action: 'com.linuxmint.mintupdate.install', asUser: env.user });
    if (!ok) return;
    for (const n of names) pk.upgradePackage(sys, n);
    sel.clear(); draw();
    env.ui.toast({ title: 'Update Manager', message: `${names.length} update${names.length > 1 ? 's' : ''} installed.`, kind: 'info' });
  }
  async function prefs() {
    if (env.os === 'ubuntu') { env.openApp('swprops'); return; }
    const ok = await env.ui.authenticate({ message: 'Authentication is required to change the update preferences', action: 'com.linuxmint.mintupdate.prefs', asUser: env.user });
    if (!ok) return;
    await env.ui.modal((done) => {
      const on = aptPeriodic(sys, 'Update-Package-Lists') > 0;
      const cb = h('input', { type: 'checkbox', checked: on });
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Preferences'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('label', { style: { display: 'flex', gap: '8px' } }, cb, 'Automatically refresh the list of updates (daily)'))),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
          let t = sys.vfs.exists('/etc/apt/apt.conf.d/10periodic') ? sys.vfs.readFile('/etc/apt/apt.conf.d/10periodic') : '';
          const line = `APT::Periodic::Update-Package-Lists "${cb.checked ? 1 : 0}";`;
          t = /APT::Periodic::Update-Package-Lists/.test(t) ? t.replace(/APT::Periodic::Update-Package-Lists[^\n]*/, line) : line + '\n' + t;
          sys.vfs.writeFile('/etc/apt/apt.conf.d/10periodic', t); done(true);
        } }, 'OK')));
    });
  }
  void setIni;
  draw();
  return win;
}
