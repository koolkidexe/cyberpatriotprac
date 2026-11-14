// Run a .desktop Exec line or command string headlessly (menu, desktop icons, "Open with"), as a given user.
import { createShell } from '../shell/index.js';

export async function runExec(env, exec, { user = env.user, cwd } = {}) {
  const line = String(exec).replace(/%[uUfFdDnNickvm]/g, '').trim();
  if (!line) return;
  let out = '';
  const io = {
    write: (s) => { out += s; },
    async readLine() { return null; },
    async editor() { return null; },
    launch: (app, o) => env.openApp(app, { ...o }),
    authenticate: (o) => env.ui.authenticate(o),
    clear() {}, exit() {}, cols: 100, rows: 30,
    power: (k) => env.power?.(k),
    notify: (a) => env.ui.toast({ title: a[0] || 'Notification', message: a.slice(1).join(' '), kind: 'info' }),
  };
  const sh = createShell(env.sys, { user, io, login: false });
  if (cwd && env.sys.vfs.isDir(cwd)) sh.cwd = cwd;
  await sh.run(line);
  const msg = out.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
  if (msg) env.ui.alert({ title: 'Error', heading: 'Could not launch application', message: msg, icon: 'error' });
}
