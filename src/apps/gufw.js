// Firewall Configuration (gufw).
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import * as fw from '../core/firewall.js';
import { CmdError } from '../core/errors.js';

export async function open(env) {
  const sys = env.sys;
  if (!fw.ufwInstalled(sys)) { env.ui.alert({ title: 'Firewall Configuration', heading: 'ufw is not installed', message: 'The firewall back-end (ufw) is not installed on this system.', icon: 'error' }); return null; }
  const ok = await env.ui.authenticate({ message: 'Authentication is required to run Firewall Configuration', action: 'com.ubuntu.pkexec.gufw', asUser: env.user });
  if (!ok) return null;
  let tab = 'rules';
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  const head = h('div', { class: 'pad', style: { borderBottom: '1px solid #d0d0d0' } });
  const tabs = h('div', { class: 'tabs' });
  const win = env.wm.open({ title: 'Firewall Configuration', icon: 'shield', width: 640, height: 480, appId: 'gufw', content: h('div', { class: 'app-body' }, head, tabs, body) });
  const unsub = sys.on('change', (k) => { if (k === 'ufw' || k === 'services') draw(); });
  win.onClose(() => unsub());
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof CmdError) { env.ui.alert({ title: 'Error', heading: 'Error', message: e.message.replace(/^ERROR: /, ''), icon: 'error' }); return null; } throw e; } };

  function draw() {
    if (win.closed) return;
    const on = fw.ufwActive(sys);
    const d = fw.getDefaults(sys);
    clear(head);
    const pol = (dir) => h('select', { class: 'in', onchange: (e) => guard(() => fw.setDefault(sys, dir, e.target.value)) }, ['allow', 'deny', 'reject'].map((p) => h('option', { value: p, selected: p === d[dir] }, p === 'allow' ? 'Allow' : p === 'deny' ? 'Deny' : 'Reject')));
    head.append(h('div', { class: 'kv', style: { gridTemplateColumns: '110px 1fr 110px 1fr' } },
      h('div', { class: 'k' }, 'Status'), h('span', { class: 'sw' + (on ? ' on' : ''), onclick: () => guard(() => (on ? fw.ufwDisable(sys) : fw.ufwEnable(sys))) }),
      h('div', { class: 'k' }, 'Incoming'), pol('incoming'), h('div', { class: 'k' }, ''), h('div'), h('div', { class: 'k' }, 'Outgoing'), pol('outgoing')));
    clear(tabs);
    for (const [id, n] of [['rules', 'Rules'], ['log', 'Log']]) tabs.append(h('div', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; draw(); } }, n));
    clear(body);
    if (tab === 'rules') drawRules(); else drawLog();
  }
  function drawRules() {
    const rows = fw.displayRules(sys);
    const sel = { i: -1 };
    const tb = h('tbody');
    rows.forEach((r, i) => tb.append(h('tr', { onclick: () => { sel.i = i; [...tb.children].forEach((c, j) => c.classList.toggle('sel', j === i)); del.disabled = false; } }, h('td', null, String(i + 1)), h('td', null, r.to), h('td', null, r.action), h('td', null, r.from))));
    const del = h('button', { class: 'btn', disabled: true, onclick: () => { if (sel.i >= 0) guard(() => fw.deleteRule(sys, sel.i + 1)); } }, '−');
    body.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: addDlg }, '+'), del), h('div', { class: 'scroll', style: { flex: 1, background: '#fff' } }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['#', 'To', 'Action', 'From'].map((x) => h('th', null, x)))), tb)));
  }
  function drawLog() {
    const txt = sys.vfs.exists('/var/log/ufw.log') ? sys.vfs.readFile('/var/log/ufw.log') : '';
    body.append(h('pre', { class: 'scroll', style: { flex: 1, margin: 0, padding: '8px', background: '#fff', fontFamily: 'var(--mono)', fontSize: '12px', userSelect: 'text' } }, txt || 'No log entries.'));
  }
  async function addDlg() {
    await env.ui.modal((done) => {
      const act = h('select', { class: 'in' }, ['allow', 'deny', 'reject', 'limit'].map((a) => h('option', { value: a }, a[0].toUpperCase() + a.slice(1))));
      const dir = h('select', { class: 'in' }, h('option', { value: 'in' }, 'In'), h('option', { value: 'out' }, 'Out'));
      const proto = h('select', { class: 'in' }, ['both', 'tcp', 'udp'].map((a) => h('option', { value: a }, a === 'both' ? 'Both' : a.toUpperCase())));
      const port = h('input', { class: 'in', placeholder: 'e.g. 22 or 8000:8100', style: { width: '100%' } });
      const from = h('input', { class: 'in', placeholder: 'Anywhere', style: { width: '100%' } });
      const err = h('div', { class: 'err' });
      const go = () => {
        try {
          const a = [dir.value]; // simple/advanced rule built the way gufw builds `ufw` calls
          const args = [...a, 'from', from.value || 'any', 'to', 'any', 'port', port.value.trim() || '', ...(proto.value !== 'both' ? ['proto', proto.value] : [])];
          if (!port.value.trim()) throw new CmdError('Port is required', 1);
          const rule = fw.parseRule(act.value, args.filter((x) => x !== ''));
          fw.addRule(sys, rule); done(true);
        } catch (e) { if (e instanceof CmdError) err.textContent = e.message.replace(/^ERROR: /, ''); else throw e; }
      };
      return h('div', { class: 'dlg' }, h('div', { class: 'dt' }, 'Firewall - Add Rule'), h('div', { class: 'db' }, h('div', { class: 'txt' }, h('div', { class: 'kv', style: { gridTemplateColumns: '90px 1fr' } }, h('div', { class: 'k' }, 'Policy'), act, h('div', { class: 'k' }, 'Direction'), dir, h('div', { class: 'k' }, 'Protocol'), proto, h('div', { class: 'k' }, 'From'), from, h('div', { class: 'k' }, 'Port'), port), err)),
        h('div', { class: 'df' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Close'), h('button', { class: 'btn primary', onclick: go }, 'Add')));
    });
  }
  draw();
  return win;
}
