// Login Window (lightdm-settings).
import { h, clear } from '../ui/dom.js';
import { lightdmValue } from '../core/checks.js';
import { setIni } from './ini-util.js';
import { CmdError } from '../core/errors.js';

const CONF = '/etc/lightdm/lightdm.conf.d/70-linuxmint.conf';

export async function open(env) {
  const sys = env.sys;
  const ok = await env.ui.authenticate({ message: 'Authentication is required to run Login Window as root', action: 'com.linuxmint.lightdm-settings', asUser: env.user });
  if (!ok) return null;
  const body = h('div', { class: 'pad', style: { flex: 1, overflow: 'auto' } });
  const win = env.wm.open({ title: 'Login Window', icon: 'login', width: 560, height: 420, appId: 'login', content: h('div', { class: 'app-body' }, body) });
  const unsub = sys.on('change', (k) => { if (k === 'fs') draw(); });
  win.onClose(() => unsub());
  const set = (sec, k, v) => { try { setIni(sys, CONF, sec, k, v); sys.log('syslog', 'lightdm-settings', `set ${k}=${v}`); sys.touch('fs'); } catch (e) { if (e instanceof CmdError) env.ui.alert({ title: 'Error', heading: 'Error', message: e.message, icon: 'error' }); else throw e; } };
  function draw() {
    if (win.closed) return;
    clear(body);
    const guest = (lightdmValue(sys, 'allow-guest') ?? 'true').toLowerCase() === 'true';
    const manual = (lightdmValue(sys, 'greeter-show-manual-login') ?? 'false').toLowerCase() === 'true';
    const hideUsers = (lightdmValue(sys, 'greeter-hide-users') ?? 'false').toLowerCase() === 'true';
    const auto = lightdmValue(sys, 'autologin-user');
    const row = (label, desc, on, fn) => h('div', { style: { display: 'flex', alignItems: 'center', padding: '10px 4px', borderBottom: '1px solid var(--line)', gap: '12px' } }, h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, label), h('div', { style: { fontSize: '12px', color: 'var(--text-dim)' } }, desc)), h('span', { class: 'sw' + (on ? ' on' : ''), onclick: fn }));
    body.append(h('h3', { style: { margin: '0 0 6px' } }, 'Users'),
      row('Allow guest sessions', 'Allow users to log in without a password as a temporary guest', guest, () => set('Seat:*', 'allow-guest', guest ? 'false' : 'true')),
      row('Allow manual login', 'Show a field to type any username at the greeter', manual, () => set('Seat:*', 'greeter-show-manual-login', manual ? 'false' : 'true')),
      row('Hide the user list', 'Do not show user names at the greeter', hideUsers, () => set('Seat:*', 'greeter-hide-users', hideUsers ? 'false' : 'true')),
      h('div', { style: { padding: '10px 4px', color: 'var(--text-dim)' } }, `Automatic login: ${auto ? auto : 'disabled'}`));
  }
  draw();
  return win;
}
