// System Monitor (gnome-system-monitor).
import { h, clear } from '../ui/dom.js';
import { memInfo, loadavg } from '../shell/commands/system.js';
import * as users from '../core/users.js';

export function open(env) {
  const sys = env.sys;
  let sel = null; let tab = 'proc';
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  const win = env.wm.open({ title: 'System Monitor', icon: 'pulse', width: 720, height: 480, appId: 'monitor', content: h('div', { class: 'app-body' }, tabs, body) });
  const unsub = sys.on('change', (k) => { if (k === 'proc') draw(); });
  const timer = setInterval(() => { if (!win.closed && tab !== 'proc') draw(); }, 2000);
  win.onClose(() => { unsub(); clearInterval(timer); });
  async function kill(p, sig) {
    if (p.user !== env.user) {
      const ok = await env.ui.authenticate({ message: 'Authentication is required to kill a process owned by another user', action: 'org.gnome.gnomesystemmonitor.kill', asUser: env.user });
      if (!ok) return;
    }
    sys.killProc(p.pid); sel = null; draw();
  }
  function draw() {
    if (win.closed) return;
    clear(tabs);
    for (const [id, n] of [['proc', 'Processes'], ['res', 'Resources'], ['fs', 'File Systems']]) tabs.append(h('div', { class: 'tab' + (tab === id ? ' on' : ''), title: `Show ${n}`, onclick: () => { tab = id; draw(); } }, n));
    clear(body);
    if (tab === 'proc') {
      const tb = h('tbody');
      for (const p of [...sys.processes].sort((a, b) => a.pid - b.pid)) tb.append(h('tr', { class: sel === p.pid ? 'sel' : '', onclick: () => { sel = p.pid; draw(); } }, h('td', null, p.comm), h('td', null, p.user), h('td', null, String(p.cpu)), h('td', null, String(p.pid)), h('td', null, p.cmd.slice(0, 80))));
      const target = sys.findProc(sel);
      body.append(h('div', { class: 'scroll', style: { flex: 1, background: 'var(--surface)' } }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Process Name', 'User', '% CPU', 'ID', 'Command Line'].map((x) => h('th', null, x)))), tb)),
        h('div', { class: 'toolbar' }, h('span', { class: 'sp' }), h('button', { class: 'btn', title: 'Ask the selected process to stop (SIGTERM)', disabled: !target, onclick: () => kill(target, 15) }, 'End Process'), h('button', { class: 'btn danger', title: 'Force the selected process to stop (SIGKILL)', disabled: !target, onclick: () => kill(target, 9) }, 'Kill Process')));
    } else if (tab === 'res') {
      const m = memInfo(sys); const la = loadavg(sys);
      body.append(h('div', { class: 'pad' }, h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Load average'), h('div', null, la.map((x) => x.toFixed(2)).join(', ')), h('div', { class: 'k' }, 'Memory'), h('div', null, `${(m.used / 1048576).toFixed(1)} GiB of ${(m.total / 1048576).toFixed(1)} GiB`), h('div', { class: 'k' }, 'Processes'), h('div', null, String(sys.processes.length)))));
    } else {
      body.append(h('div', { class: 'scroll', style: { flex: 1, background: 'var(--surface)' } }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Device', 'Directory', 'Type', 'Total', 'Used'].map((x) => h('th', null, x)))), h('tbody', null, h('tr', null, ...['/dev/sda1', '/', 'ext4', '48.0 GB', '14.9 GB'].map((x) => h('td', null, x))), h('tr', null, ...['/dev/sda15', '/boot/efi', 'vfat', '512 MB', '6 MB'].map((x) => h('td', null, x)))))));
    }
  }
  void users;
  draw();
  return win;
}
