// Update Manager (mintupdate).
import { h, clear } from '../ui/dom.js';
import * as pk from '../core/packages.js';
import { setIni } from './ini-util.js';
import { aptPeriodic } from '../core/checks.js';

export function open(env) {
  const sys = env.sys;
  const sel = new Set();
  const tb = h('tbody');
  const status = h('div', { class: 'statusbar' });
  let installBtn;
  const win = env.wm.open({ title: env.os === 'ubuntu' ? 'Software Updater' : 'Update Manager', icon: 'update', width: 760, height: 480, appId: 'update', content: h('div', { class: 'app-body' },
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: refresh }, 'Refresh'), h('button', { class: 'btn', onclick: () => { sel.clear(); pk.upgradable(sys).forEach((u) => sel.add(u.name)); draw(); } }, 'Select All'), h('button', { class: 'btn', onclick: () => { sel.clear(); draw(); } }, 'Clear'), installBtn = h('button', { class: 'btn primary', onclick: install }, env.os === 'ubuntu' ? 'Install Now' : 'Install Updates'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: prefs }, env.os === 'ubuntu' ? 'Settings…' : 'Preferences')),
    h('div', { class: 'scroll', style: { flex: 1, background: 'var(--surface)' } }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['', 'Package', 'Old version', 'New version', 'Size'].map((x) => h('th', null, x)))), tb)), status) });
  const unsub = sys.on('change', (k) => { if (k === 'packages') draw(); });
  win.onClose(() => unsub());
  function draw() {
    if (win.closed) return;
    clear(tb);
    const ups = pk.upgradable(sys);
    for (const u of ups) tb.append(h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: sel.has(u.name), onchange: (e) => { e.target.checked ? sel.add(u.name) : sel.delete(u.name); } })), h('td', null, u.name), h('td', null, u.from), h('td', null, u.to), h('td', null, u.size ? `${u.size} kB` : '')));
    status.textContent = ups.length ? `${ups.length} update${ups.length > 1 ? 's' : ''} available` : env.os === 'ubuntu' ? 'The software on this computer is up to date.' : 'Your system is up to date';
    installBtn.disabled = !ups.length;
  }
  async function refresh() {
    const ok = await env.ui.authenticate({ message: 'Authentication is required to refresh the package cache', action: 'com.linuxmint.mintupdate', asUser: env.user });
    if (ok) { sys.log('apt-history', 'mintupdate', 'refresh'); draw(); }
  }
  async function install() {
    const names = sel.size ? [...sel] : pk.upgradable(sys).map((u) => u.name);
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
