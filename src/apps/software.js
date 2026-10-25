// Software Manager (mintinstall).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as pk from '../core/packages.js';

export function open(env) {
  const sys = env.sys;
  const out = h('div', { class: 'scroll', style: { flex: 1, padding: '10px' } });
  const q = h('input', { class: 'in', placeholder: 'Search…', style: { flex: 1 }, oninput: () => draw(q.value) });
  const win = env.wm.open({ title: 'Software Manager', icon: 'bag', width: 720, height: 500, appId: 'software', content: h('div', { class: 'app-body' }, h('div', { class: 'toolbar' }, q, h('button', { class: 'btn', onclick: () => { q.value = ''; draw(''); } }, 'Installed')), out) });
  const unsub = sys.on('change', (k) => { if (k === 'packages') draw(q.value); });
  win.onClose(() => unsub());
  function draw(term) {
    if (win.closed) return;
    clear(out);
    const res = term.trim().length >= 2 ? pk.searchPackages(term.trim()) : pk.installedNames(sys).map((n) => pk.def(n)).filter(Boolean);
    if (!term.trim()) out.append(h('div', { style: { color: '#777', marginBottom: '8px' } }, 'Installed software (type to search all packages)'));
    for (const d of res.slice(0, 120)) {
      const inst = pk.isInstalled(sys, d.name);
      out.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 8px', borderBottom: '1px solid #e4e4e4' } }, icon('app', 30), h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, d.name, ' ', h('span', { class: 'badge' + (inst ? ' green' : '') }, inst ? 'installed' : d.v)), h('div', { style: { color: '#666', fontSize: '12px' } }, d.d)),
        h('button', { class: 'btn' + (inst ? '' : ' primary'), onclick: () => act(d, inst) }, inst ? 'Remove' : 'Install')));
    }
    if (!res.length) out.append(h('div', { style: { color: '#777' } }, 'No packages found.'));
  }
  async function act(d, inst) {
    const ok = await env.ui.authenticate({ message: `Authentication is required to ${inst ? 'remove' : 'install'} software`, action: 'com.linuxmint.mintinstall', asUser: env.user });
    if (!ok) return;
    if (inst) {
      const plan = pk.planRemove(sys, [d.name]);
      if (plan.essential.length) { env.ui.alert({ title: 'Software Manager', heading: 'Cannot remove', message: `${plan.essential.join(', ')} is essential and cannot be removed.`, icon: 'error' }); return; }
      const all = plan.remove;
      if (all.length > 1) { const go = await env.ui.confirm({ title: 'Remove', heading: 'The following packages will be removed', message: all.join(', '), ok: 'Remove', danger: true }); if (!go) return; }
      for (const n of all) pk.removePackage(sys, n);
    } else {
      const plan = pk.planInstall(sys, [d.name]);
      for (const n of plan.toInstall) pk.installPackage(sys, n);
    }
    draw(q.value);
  }
  draw('');
  return win;
}
