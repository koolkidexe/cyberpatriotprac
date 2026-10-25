// GUI administration tools. They call the same core functions as the terminal commands, so the
// scoring engine sees identical results whichever way a fix is made.
import * as users from '../core/users.js';
import * as pk from '../core/packages.js';
import * as fw from '../core/firewall.js';
import * as sv from '../core/services.js';
import { lightdmAllowGuest } from '../core/checks.js';
import { PACKAGES } from '../images/catalog.js';
import { icon } from './icons.js';
import { posix } from '../core/util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UNIT_ROOT = 'root';

/** Modal form. fields: [{name,label,type:'text'|'password'|'select'|'check',value,options}]. Resolves to values or null. */
export function form(title, text, fields = [], { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((res) => {
    const ov = document.querySelector('#overlay');
    ov.innerHTML = `<div class="dlg" style="min-width:340px"><h3>${esc(title)}</h3><div>${text}</div>${fields.map((f) => `<div style="margin-top:8px"><label>${f.type === 'check' ? '' : esc(f.label) + '<br>'}${f.type === 'select' ? `<select name="${f.name}" style="width:100%;padding:5px">${f.options.map((o) => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.type === 'check' ? `<input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}` : `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(f.value || '')}" style="width:100%;padding:6px">`}</label></div>`).join('')}<div class="row">${cancel ? `<button class="btn" data-r="0">${esc(cancel)}</button>` : ''}<button class="btn primary" data-r="1" ${danger ? 'style="background:#c9302c;border-color:#a02622"' : ''}>${esc(ok)}</button></div></div>`;
    ov.classList.add('open');
    const get = () => Object.fromEntries(fields.map((f) => { const el = ov.querySelector(`[name="${f.name}"]`); return [f.name, f.type === 'check' ? el.checked : el.value]; }));
    const finish = (v) => { ov.classList.remove('open'); res(v); };
    ov.querySelector('[data-r="0"]')?.addEventListener('click', () => finish(null));
    ov.querySelector('[data-r="1"]').addEventListener('click', () => finish(get()));
    ov.querySelector('input')?.focus();
    ov.querySelector('.dlg').addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(get()); else if (e.key === 'Escape') finish(null); });
  });
}
const alertBox = (title, msg) => form(title, `<p style="margin:0">${msg}</p>`, [], { cancel: null });

/** polkit-style authentication: the person must be an administrator and type their own password. */
export async function authorize(app, w, reason, user = 'student') {
  if (w.unlocked && Date.now() - w.unlocked < 5 * 60000) return true;
  if (!users.isAdmin(app.sys, user)) { await alertBox('Authentication failed', `${esc(user)} is not allowed to perform this action.`); return false; }
  for (let i = 0; i < 3; i++) {
    const r = await form('Authentication Required', `<p style="margin:0 0 4px">${esc(reason)}</p><p style="margin:0;color:#555">An application is attempting to perform an action that requires privileges. Authentication as <b>${esc(user)}</b> is required.</p>`, [{ name: 'pw', label: 'Password:', type: 'password' }], { ok: 'Authenticate' });
    if (!r) return false;
    if (users.checkPassword(app.sys, user, r.pw)) { w.unlocked = Date.now(); return true; }
    await alertBox('Authentication failed', 'Authentication failed. Please try again.');
  }
  return false;
}
async function guarded(app, w, reason, fn) {
  if (!(await authorize(app, w, reason, w.user))) return;
  try { await fn(); } catch (e) { await alertBox('Error', esc(e.message || String(e))); }
}
const table = (heads, rows, { sel } = {}) => `<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>${heads.map((h) => `<th style="text-align:left;padding:4px 8px;background:#e8e8e8;border-bottom:1px solid #bbb;position:sticky;top:0">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr data-i="${i}" style="cursor:default;${sel === i ? 'background:#cfe3b0' : ''}">${r.map((c) => `<td style="padding:3px 8px;border-bottom:1px solid #eee">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const scroller = (html) => `<div style="flex:1;overflow:auto;background:#fff">${html}</div>`;
const bar = (btns) => `<div class="tb">${btns.map(([id, label, cls]) => `<button class="btn ${cls || ''}" data-a="${id}">${esc(label)}</button>`).join('')}<span style="flex:1"></span><span class="note" style="color:#666"></span></div>`;
function mount(w, app, render) { render(); const off = app.sys.on('change', () => { if (document.body.contains(w.el)) render(); }); const prev = w.onClose; w.onClose = () => { off(); return prev ? prev() : true; }; }

// ------------------------------------------------------------------ Users and Groups
export function usersApp(app, w) {
  let sel = null; let showSys = false;
  const render = () => {
    const all = users.readPasswd(app.sys).filter((u) => showSys || (u.uid >= 1000 && u.uid < 65534) || u.uid === 0);
    const rows = all.map((u) => [esc(u.name), esc((u.gecos || '').split(',')[0] || u.name), users.isAdmin(app.sys, u.name) ? 'Administrator' : 'Standard', users.passwordState?.(users.getShadow(app.sys, u.name)) === 'L' ? 'Locked' : '', String(u.uid)]);
    w.body.innerHTML = bar([['add', 'Add…'], ['del', 'Remove…'], ['type', 'Change Account Type'], ['pw', 'Change Password…'], ['lock', 'Lock/Unlock'], ['sys', showSys ? 'Hide system users' : 'Show system users']]) + scroller(table(['User name', 'Full name', 'Account type', 'State', 'UID'], rows, { sel })) + '<div class="status">Select a user, then use the buttons. Changes need your password.</div>';
    w.body.querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => { sel = Number(tr.dataset.i); render(); }; });
    const cur = sel !== null ? all[sel] : null; w._cur = cur;
    w.body.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => act(b.dataset.a); });
  };
  const act = async (a) => {
    const cur = w._cur; if (a === 'sys') { showSys = !showSys; sel = null; return render(); }
    if (a === 'add') return guarded(app, w, 'Authentication is required to create a user account', async () => {
      const r = await form('Add User', '', [{ name: 'name', label: 'Username' }, { name: 'full', label: 'Full name' }, { name: 'pw', label: 'Password', type: 'password' }, { name: 'type', label: 'Account type', type: 'select', options: ['Standard', 'Administrator'], value: 'Standard' }], { ok: 'Add' });
      if (!r) return;
      if (!users.validName(r.name)) throw new Error('The username may only contain letters, digits, underscores, periods and dashes, and must not start with a dash.');
      users.userAdd(app.sys, { name: r.name, gecos: `${r.full},,,`, password: r.pw || undefined, groups: r.type === 'Administrator' ? ['sudo'] : [] });
    });
    if (!cur) return alertBox('No user selected', 'Select a user first.');
    if (a === 'del') return guarded(app, w, `Authentication is required to delete ${cur.name}`, async () => {
      const r = await form('Delete user?', `Do you want to keep ${esc(cur.name)}’s files?`, [{ name: 'del', label: 'Delete the home directory and files', value: false }], { ok: 'Delete Account', danger: true }); if (!r) return;
      users.userDel(app.sys, cur.name, { removeHome: r.del }); sel = null;
    });
    if (a === 'type') return guarded(app, w, `Authentication is required to change the account type of ${cur.name}`, async () => { if (users.isAdmin(app.sys, cur.name)) users.removeMember(app.sys, 'sudo', cur.name); else users.addMember(app.sys, 'sudo', cur.name); });
    if (a === 'pw') return guarded(app, w, `Authentication is required to change the password of ${cur.name}`, async () => {
      const r = await form('Change Password', `New password for <b>${esc(cur.name)}</b>`, [{ name: 'pw', label: 'New password', type: 'password' }, { name: 'pw2', label: 'Confirm', type: 'password' }], { ok: 'Change' }); if (!r) return;
      if (r.pw !== r.pw2) throw new Error('The passwords do not match.');
      const bad = users.passwordQuality(app.sys, cur.name, r.pw, null);
      if (bad && !/^Password has been/.test(bad)) throw new Error(`The new password is too weak: ${bad}`);
      users.recordOldPassword?.(app.sys, cur.name); users.setPassword(app.sys, cur.name, r.pw);
    });
    if (a === 'lock') return guarded(app, w, `Authentication is required to lock or unlock ${cur.name}`, async () => { const s = users.getShadow(app.sys, cur.name); if (s.hash.startsWith('!')) users.unlockPassword(app.sys, cur.name); else users.lockPassword(app.sys, cur.name); });
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ Firewall (GUFW)
export function firewallApp(app, w) {
  const render = () => {
    const on = fw.ufwActive(app.sys); const rules = fw.displayRules(app.sys);
    w.body.innerHTML = `<div class="tb"><b>Status:</b> <button class="btn ${on ? 'primary' : ''}" data-a="toggle">${on ? 'ON — click to turn off' : 'OFF — click to turn on'}</button><span style="flex:1"></span>Incoming: <select data-a="in"><option>deny</option><option>allow</option><option>reject</option></select> Outgoing: <select data-a="out"><option>allow</option><option>deny</option><option>reject</option></select></div>${bar([['add', 'Add rule…'], ['del', 'Delete selected']])}${scroller(table(['To', 'Action', 'From'], rules.map((r) => [esc(r.to), esc(r.action), esc(r.from)]), { sel: w._sel }))}<div class="status">${on ? 'Firewall is active.' : 'The firewall is disabled — all connections are allowed.'}</div>`;
    w.body.querySelector('[data-a=in]').value = app.sys.ufw.defaults?.incoming || 'deny'; w.body.querySelector('[data-a=out]').value = app.sys.ufw.defaults?.outgoing || 'allow';
    w.body.querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => { w._sel = Number(tr.dataset.i); render(); }; });
    w.body.querySelector('[data-a=toggle]').onclick = () => guarded(app, w, 'Authentication is required to change the firewall', async () => { if (on) fw.ufwDisable(app.sys); else fw.ufwEnable(app.sys); });
    for (const k of ['in', 'out']) w.body.querySelector(`[data-a=${k}]`).onchange = (e) => guarded(app, w, 'Authentication is required to change firewall policy', async () => { fw.setDefault(app.sys, k === 'in' ? 'incoming' : 'outgoing', e.target.value); });
    w.body.querySelector('[data-a=add]').onclick = () => guarded(app, w, 'Authentication is required to add a firewall rule', async () => {
      const r = await form('Add Rule', 'Example port: 22, 80/tcp, or 5000:5010/tcp', [{ name: 'action', label: 'Policy', type: 'select', options: ['allow', 'deny', 'reject', 'limit'] }, { name: 'port', label: 'Port or service', value: '22' }], { ok: 'Add' }); if (!r) return;
      fw.addRule(app.sys, fw.parseRule(r.action, [r.port.trim()]));
    });
    w.body.querySelector('[data-a=del]').onclick = () => { if (w._sel == null) return alertBox('No rule selected', 'Select a rule to delete.'); guarded(app, w, 'Authentication is required to delete a firewall rule', async () => { fw.deleteRule(app.sys, rules[w._sel].rule); w._sel = null; }); };
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ Update Manager
export function updatesApp(app, w) {
  const render = () => {
    const up = pk.upgradable(app.sys);
    w.body.innerHTML = bar([['refresh', 'Refresh'], ['install', 'Install Updates', 'primary']]) + scroller(up.length ? table(['Package', 'Old version', 'New version'], up.map((u) => [esc(u.name), esc(u.from), esc(u.to)])) : '<p style="padding:30px;text-align:center;color:#4e7a2e"><b>Your system is up to date</b></p>') + `<div class="status">${up.length} update${up.length === 1 ? '' : 's'} available</div>`;
    w.body.querySelector('[data-a=refresh]').onclick = () => { w.body.querySelector('.note').textContent = 'Checked for updates.'; };
    w.body.querySelector('[data-a=install]').onclick = () => guarded(app, w, 'Authentication is required to install software updates', async () => { for (const u of pk.upgradable(app.sys)) pk.upgradePackage(app.sys, u.name); });
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ Software Manager
export function softwareApp(app, w) {
  let term = '';
  const render = () => {
    const found = term ? pk.searchPackages(term) : pk.installedNames(app.sys).map((n) => PACKAGES[n]).filter(Boolean).filter((p) => !p.essential);
    w.body.innerHTML = `<div class="tb"><input type="text" placeholder="Search for software, or leave empty to list what is installed" value="${esc(term)}"></div>${scroller(table(['Name', 'Description', 'State', ''], found.slice(0, 200).map((p) => [esc(p.name), esc(p.d), pk.isInstalled(app.sys, p.name) ? 'Installed' : '', `<button class="btn" data-p="${esc(p.name)}">${pk.isInstalled(app.sys, p.name) ? 'Remove' : 'Install'}</button>`])))}<div class="status">${found.length} package(s)</div>`;
    const inp = w.body.querySelector('input'); inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { term = inp.value.trim(); render(); w.body.querySelector('input').focus(); } };
    w.body.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => guarded(app, w, `Authentication is required to ${b.textContent.toLowerCase()} ${b.dataset.p}`, async () => {
      const n = b.dataset.p;
      if (pk.isInstalled(app.sys, n)) {
        const plan = pk.planRemove(app.sys, [n]);
        if (plan.essential.length) throw new Error('Removing this package could break the system, so it is not allowed.');
        const r = await form('Remove software?', `The following packages will be removed:<br><b>${esc(plan.remove.join(', '))}</b>`, [], { ok: 'Remove', danger: true }); if (!r) return;
        for (const x of plan.remove) pk.removePackage(app.sys, x, { purge: false });
      } else { const plan = pk.planInstall(app.sys, [n]); for (const x of plan.toInstall) pk.installPackage(app.sys, x, { auto: x !== n }); }
    }); });
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ Startup Applications
export function startupApp(app, w) {
  const dirs = [[`/home/${w.user}/.config/autostart`, true], ['/etc/xdg/autostart', false]];
  const render = () => {
    const items = [];
    for (const [d, mine] of dirs) if (app.sys.vfs.isDir(d)) for (const n of app.sys.vfs.readdir(d).filter((x) => x.endsWith('.desktop')).sort()) { const t = app.sys.vfs.readFile(`${d}/${n}`); const g = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(t) || [])[1] || ''; items.push({ path: `${d}/${n}`, name: g('Name') || n, exec: g('Exec'), mine }); }
    w.body.innerHTML = scroller(table(['Name', 'Command', 'Location', ''], items.map((i) => [esc(i.name), esc(i.exec), esc(posix.dirname(i.path)), i.mine ? `<button class="btn" data-p="${esc(i.path)}">Remove</button>` : '<span style="color:#888">system</span>']))) + '<div class="status">Programs listed here start when you log in.</div>';
    w.body.querySelectorAll('[data-p]').forEach((b) => { b.onclick = async () => { const r = await form('Remove startup program?', esc(b.dataset.p), [], { ok: 'Remove', danger: true }); if (r) app.sys.vfs.unlink(b.dataset.p); }; });
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ Login Window
export function loginApp(app, w) {
  const render = () => {
    const guest = lightdmAllowGuest(app.sys);
    w.body.innerHTML = `<div class="stub"><h3>Login Window</h3><p><label><input type="checkbox" ${guest ? 'checked' : ''}> Allow guest sessions</label></p><p style="color:#666">Guest sessions let anyone use this computer without a password.</p></div>`;
    w.body.querySelector('input').onchange = (e) => guarded(app, w, 'Authentication is required to change the login window settings', async () => {
      const v = e.target.checked; app.sys.vfs.writeFile('/etc/lightdm/lightdm.conf.d/50-guest.conf', `[Seat:*]\nallow-guest=${v}\n`, { mode: 0o644 });
    }).then(render);
  };
  mount(w, app, render);
}

// ------------------------------------------------------------------ System Monitor
export function monitorApp(app, w) {
  let sel = null;
  const render = () => {
    const ps = [...app.sys.processes].filter((p) => !p.cmd.startsWith('[')).sort((a, b) => a.pid - b.pid);
    w.body.innerHTML = bar([['kill', 'End Process'], ['refresh', 'Refresh']]) + scroller(table(['Process', 'User', 'PID', 'Command'], ps.map((p) => [esc(p.comm), esc(p.user), String(p.pid), esc(p.cmd.slice(0, 70))]), { sel })) + `<div class="status">${ps.length} processes — ${app.sys.sockets().length} listening sockets</div>`;
    w.body.querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => { sel = ps[Number(tr.dataset.i)].pid; render(); }; });
    w.body.querySelector('[data-a=refresh]').onclick = render;
    w.body.querySelector('[data-a=kill]').onclick = async () => {
      const p = app.sys.findProc(sel); if (!p) return alertBox('No process selected', 'Select a process first.');
      if (p.user !== w.user) { if (!(await authorize(app, w, `Authentication is required to end the process ${p.comm}`, w.user))) return; }
      const r = await form('End process?', `Really end <b>${esc(p.comm)}</b> (PID ${p.pid})?`, [], { ok: 'End Process', danger: true }); if (r) { app.sys.killProc(p.pid); sel = null; }
    };
  };
  mount(w, app, render); w.timer = setInterval(() => { if (document.body.contains(w.el)) render(); }, 5000);
  const prev = w.onClose; w.onClose = () => { clearInterval(w.timer); return prev ? prev() : true; };
}

// ------------------------------------------------------------------ System Settings (launcher grid)
export function settingsApp(app, w, open) {
  const items = [['Users and Groups', 'users', 'users-admin'], ['Login Window', 'settings', 'login-window'], ['Startup Applications', 'generic', 'startup-apps'], ['Firewall', 'shield', 'gufw'], ['Update Manager', 'update', 'mintupdate'], ['Software Manager', 'software', 'mintinstall']];
  w.body.innerHTML = `<div class="files">${items.map(([n, k, x]) => `<div class="it" data-x="${x}"><img src="${icon(k)}"><div>${esc(n)}</div></div>`).join('')}</div>`;
  w.body.querySelectorAll('.it').forEach((el) => { el.ondblclick = el.onclick = () => open(el.dataset.x); });
}

export const TOOLS = {
  'users-admin': ['Users and Groups', 'users', usersApp, 640, 400], 'gufw': ['Firewall Configuration', 'shield', firewallApp, 560, 380], mintupdate: ['Update Manager', 'update', updatesApp, 560, 380],
  mintinstall: ['Software Manager', 'software', softwareApp, 680, 440], 'startup-apps': ['Startup Applications', 'generic', startupApp, 620, 320], 'login-window': ['Login Window', 'settings', loginApp, 420, 220],
  'gnome-system-monitor': ['System Monitor', 'monitor', monitorApp, 640, 420],
};
