// Software & Updates (software-properties-gtk), Ubuntu: automatic update checks.
import { h } from '../ui/dom.js';
import { aptPeriodic } from '../core/checks.js';

export async function open(env) {
  const sys = env.sys;
  const ok = await env.ui.authenticate({ message: 'Authentication is required to change software sources', action: 'com.ubuntu.softwareproperties.applychanges', asUser: env.user });
  if (!ok) return null;
  const PATH = '/etc/apt/apt.conf.d/10periodic';
  const setKey = (key, val) => {
    let t = sys.vfs.exists(PATH) ? sys.vfs.readFile(PATH) : '';
    const line = `APT::Periodic::${key} "${val}";`;
    t = new RegExp(`APT::Periodic::${key}`).test(t) ? t.replace(new RegExp(`APT::Periodic::${key}[^\\n]*`), line) : t + (t && !t.endsWith('\n') ? '\n' : '') + line + '\n';
    sys.vfs.writeFile(PATH, t);
  };
  const body = h('div', { class: 'pad', style: { flex: 1 } });
  const win = env.wm.open({ title: 'Software & Updates', icon: 'refresh', width: 560, height: 360, appId: 'swprops', content: h('div', { class: 'app-body' }, h('div', { class: 'tabs' }, h('div', { class: 'tab' }, 'Ubuntu Software'), h('div', { class: 'tab' }, 'Other Software'), h('div', { class: 'tab on' }, 'Updates'), h('div', { class: 'tab' }, 'Authentication')), body) });
  void win;
  const freq = (key) => { const v = aptPeriodic(sys, key); return v >= 7 ? '7' : v >= 1 ? '1' : '0'; };
  const sel = (key) => { const s = h('select', { class: 'in', onchange: () => { setKey(key, s.value); } }, [['1', 'Daily'], ['2', 'Every two days'], ['7', 'Weekly'], ['0', 'Never']].map(([v, l]) => h('option', { value: v, selected: v === freq(key) || (v === '1' && freq(key) === '1') }, l))); return s; };
  body.append(h('div', { class: 'kv', style: { gridTemplateColumns: '260px 1fr' } },
    h('div', { class: 'k' }, 'Automatically check for updates:'), sel('Update-Package-Lists'),
    h('div', { class: 'k' }, 'When there are security updates:'), h('div', null, 'Download and install automatically'),
    h('div', { class: 'k' }, 'When there are other updates:'), h('div', null, 'Display immediately'),
    h('div', { class: 'k' }, 'Notify me of a new Ubuntu version:'), h('div', null, 'For long-term support versions')));
  return win;
}
