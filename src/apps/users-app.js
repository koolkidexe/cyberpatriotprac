// Users and Groups (cinnamon-settings-users).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as users from '../core/users.js';
import { CmdError } from '../core/errors.js';
import { autologinUser, usesGdm } from '../core/checks.js';
import { setIni } from './ini-util.js';

const CONF = '/etc/lightdm/lightdm.conf.d/70-linuxmint.conf';

export function open(env) {
  const sys = env.sys;
  let unlocked = false;
  let selName = env.user;
  const list = h('div', { class: 'listbox', style: { width: '200px', flex: 'none' } });
  const form = h('div', { class: 'pad', style: { flex: 1, overflow: 'auto' } });
  const lock = h('div', { class: 'lockbar' }, icon('lock', 20), h('span', { style: { flex: 1 } }, 'Some settings are locked. Click the Unlock button to make changes.'), h('button', { class: 'btn', onclick: unlockIt }, 'Unlock'));
  const add = h('button', { class: 'btn', disabled: true, onclick: addUser }, '+');
  const rem = h('button', { class: 'btn', disabled: true, onclick: delUser }, '−');
  const body = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, h('div', { style: { display: 'flex', flexDirection: 'column', padding: '8px', gap: '6px' } }, list, h('div', { class: 'hbox' }, add, rem)), form);
  const win = env.wm.open({ title: env.os === 'ubuntu' ? 'Users' : 'Users and Groups', icon: 'users', width: 640, height: 470, appId: 'users', content: h('div', { class: 'app-body' }, lock, body) });
  const unsub = sys.on('change', (k) => { if (k === 'users' || k === 'fs') draw(); });
  win.onClose(() => unsub());

  const fail = (e) => { if (e instanceof CmdError) { env.ui.alert({ title: 'Error', heading: 'Error', message: e.message.replace(/^[a-z]+: /, ''), icon: 'error' }); return true; } return false; };
  const guard = (fn) => { try { return fn(); } catch (e) { if (!fail(e)) throw e; } };
  const normalUsers = () => users.readPasswd(sys).filter((u) => u.uid >= 1000 && u.uid < 65534);

  async function unlockIt() {
    const ok = await env.ui.authenticate({ message: 'Authentication is required to change user data', action: 'org.cinnamon.settings-users.administration', asUser: env.user });
    if (ok) { unlocked = true; lock.style.display = 'none'; add.disabled = false; draw(); }
  }
  function draw() {
    if (win.closed) return;
    clear(list);
    const us = normalUsers();
    if (!us.some((u) => u.name === selName)) selName = us[0]?.name;
    for (const u of us) list.append(h('div', { class: 'li' + (u.name === selName ? ' sel' : ''), onclick: () => { selName = u.name; draw(); } }, icon('users', 28), h('div', null, h('div', { style: { fontWeight: 600 } }, (u.gecos || '').split(',')[0] || u.name), h('div', { style: { fontSize: '11px', opacity: .75 } }, u.name + (u.name === env.user ? ' (you)' : '')))));
    rem.disabled = !unlocked || !selName || selName === env.user || selName === 'root';
    drawForm();
  }
  function drawForm() {
    clear(form);
    const u = selName && users.getUser(sys, selName);
    if (!u) return;
    const isAdm = users.getGroup(sys, 'sudo')?.members.includes(u.name);
    const typeSel = h('select', { class: 'in', disabled: !unlocked || u.name === 'root', onchange: () => guard(() => { if (typeSel.value === 'admin') users.addMember(sys, 'sudo', u.name); else users.removeMember(sys, 'sudo', u.name); sys.log('auth.log', 'usermod', `change user '${u.name}' account type`); drawForm(); }) }, h('option', { value: 'std', selected: !isAdm }, 'Standard'), h('option', { value: 'admin', selected: isAdm }, 'Administrator'));
    const sh = users.getShadow(sys, u.name);
    const st = users.passwordState(sh);
    const locked = st === 'L';
    const autologin = autologinUser(sys) === u.name;
    const sw = (on, fn, dis) => h('span', { class: 'sw' + (on ? ' on' : '') + (dis ? ' dis' : ''), onclick: fn });
    form.append(h('div', { style: { textAlign: 'center', marginBottom: '12px' } }, icon('users', 64), h('div', { style: { fontSize: '16px', fontWeight: 600 } }, (u.gecos || '').split(',')[0] || u.name)),
      h('div', { class: 'kv' },
        h('div', { class: 'k' }, 'Account type'), typeSel,
        h('div', { class: 'k' }, 'Username'), h('div', null, u.name),
        h('div', { class: 'k' }, 'Password'), h('button', { class: 'btn', disabled: !unlocked && u.name !== env.user, style: { justifySelf: 'start' }, onclick: () => pwDlg(u.name) }, st === 'NP' ? 'No password set' : locked ? '(locked)' : '********'),
        h('div', { class: 'k' }, 'Groups'), h('button', { class: 'btn', disabled: !unlocked, style: { justifySelf: 'start' }, onclick: () => groupsDlg(u.name) }, 'Click to change…'),
        h('div', { class: 'k' }, env.os === 'ubuntu' ? 'Automatic Login' : 'Automatic login'), sw(autologin, () => { if (!unlocked) return; guard(() => { if (usesGdm(sys)) { setIni(sys, '/etc/gdm3/custom.conf', 'daemon', 'AutomaticLoginEnable', autologin ? 'false' : 'true'); setIni(sys, '/etc/gdm3/custom.conf', 'daemon', 'AutomaticLogin', u.name); } else setIni(sys, CONF, 'Seat:*', 'autologin-user', autologin ? '' : u.name); sys.touch('fs'); drawForm(); }); }, !unlocked),
        h('div', { class: 'k' }, 'Last login'), h('div', null, 'Today')));
  }
  async function pwDlg(name) {
    if (!unlocked && name !== env.user) return;
    await env.ui.modal((done) => {
      const p1 = h('input', { class: 'in', type: 'password', style: { width: '100%' } });
      const p2 = h('input', { class: 'in', type: 'password', style: { width: '100%' } });
      const err = h('div', { class: 'err' });
      const go = () => {
        if (!p1.value) { err.textContent = 'The password cannot be empty.'; return; }
        if (p1.value !== p2.value) { err.textContent = 'The passwords do not match.'; return; }
        const bad = users.passwordQuality(sys, name, p1.value, null);
        if (bad) { err.textContent = `Password rejected: ${bad}`; sys.log('auth.log', 'passwd', `pam_pwquality(passwd:chauthtok): rejected: ${bad}`); return; }
        if (users.passwordWasUsed?.(sys, name, p1.value)) { err.textContent = 'Password has been already used. Choose another.'; return; }
        guard(() => { users.recordOldPassword?.(sys, name); users.setPassword(sys, name, p1.value); sys.log('auth.log', 'passwd', `pam_unix(passwd:chauthtok): password changed for ${name}`); });
        done(true);
      };
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, `Change password for ${name}`), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('label', null, 'New password'), p1, h('label', { style: { display: 'block', marginTop: '8px' } }, 'Confirm new password'), p2, err)),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Change')));
    });
    draw();
  }
  async function groupsDlg(name) {
    await env.ui.modal((done) => {
      const gs = users.readGroups(sys).filter((g) => g.gid >= 1000 || ['sudo', 'adm', 'cdrom', 'dip', 'plugdev', 'lpadmin', 'sambashare', 'audio', 'video', 'netdev', 'nopasswdlogin', 'docker', 'shadow', 'root'].includes(g.name)).sort((a, b) => a.name.localeCompare(b.name));
      const prim = users.getUser(sys, name).gid;
      const boxes = gs.map((g) => { const c = h('input', { type: 'checkbox', checked: g.members.includes(name) || g.gid === prim, disabled: g.gid === prim, onchange: () => guard(() => { if (c.checked) users.addMember(sys, g.name, name); else users.removeMember(sys, g.name, name); }) }); return h('label', { style: { display: 'flex', gap: '8px', padding: '3px 6px' } }, c, g.name); });
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, `Groups of ${name}`), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('div', { class: 'listbox', style: { height: '260px', width: '300px' } }, boxes))), h('div', { class: 'df' }, h('button', { class: 'btn primary', onclick: () => done(true) }, 'Close')));
    });
    draw();
  }
  async function addUser() {
    await env.ui.modal((done) => {
      const full = h('input', { class: 'in', style: { width: '100%' } });
      const nm = h('input', { class: 'in', style: { width: '100%' } });
      const ty = h('select', { class: 'in' }, h('option', { value: 'std' }, 'Standard'), h('option', { value: 'admin' }, 'Administrator'));
      const err = h('div', { class: 'err' });
      full.addEventListener('input', () => { if (!nm.dataset.touched) nm.value = full.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32); });
      nm.addEventListener('input', () => { nm.dataset.touched = '1'; });
      const go = () => {
        try { users.userAdd(sys, { name: nm.value, gecos: full.value, groups: ['cdrom', 'floppy', 'audio', 'dip', 'video', 'plugdev', 'netdev', ...(ty.value === 'admin' ? ['sudo'] : [])].filter((g) => users.getGroup(sys, g)) }); selName = nm.value; done(true); }
        catch (e) { if (e instanceof CmdError) err.textContent = e.message.replace(/^useradd: /, ''); else throw e; }
      };
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Add a new user'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('label', null, 'Account Type'), ty, h('label', { style: { display: 'block', marginTop: '8px' } }, 'Full name'), full, h('label', { style: { display: 'block', marginTop: '8px' } }, 'Username'), nm, err)),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Add')));
    });
    draw();
  }
  async function delUser() {
    const name = selName;
    const keep = await env.ui.confirm({ title: 'Delete user', heading: `Do you want to keep ${name}’s files?`, message: 'It is possible to keep the home directory when deleting a user account.', ok: 'Keep the files', cancel: 'Delete the files', icon: 'question' });
    guard(() => { users.userDel(sys, name, { removeHome: !keep }); sys.log('auth.log', 'userdel', `delete user '${name}'`); });
    draw();
  }
  draw();
  return win;
}
