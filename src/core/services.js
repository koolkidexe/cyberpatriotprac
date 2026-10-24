// systemd model: units are registered when their package is installed; start/stop spawn and kill
// real entries in the simulated process table, so `ps`, `ss` and the System Monitor all agree.
import { SERVICES } from '../images/catalog.js';
import { CmdError } from './errors.js';
import { tzAbbrev } from './util.js';

export const UNIT_DIR = '/lib/systemd/system';
export const WANTS_DIR = '/etc/systemd/system/multi-user.target.wants';

/** Canonical unit name ("sshd.service" -> "ssh") or null when no such unit exists in the catalog. */
export function canonical(name) {
  const n = String(name).replace(/\.service$/, '');
  if (SERVICES[n]) return n;
  for (const s of Object.values(SERVICES)) if (s.alias?.includes(n)) return s.name;
  return null;
}

export const unitDef = (name) => SERVICES[canonical(name)] || null;
export const isRegistered = (sys, name) => !!sys.svcState[canonical(name) ?? name];
export const isActive = (sys, name) => sys.svcState[canonical(name) ?? name]?.active === 'active';
export const isEnabled = (sys, name) => sys.svcState[canonical(name) ?? name]?.enabled === 'enabled';

function mainComm(d) {
  const first = (d.execPath || d.exec).split(' ')[0];
  return first.replace(/^@/, '').split('/').pop().replace(/:$/, '');
}

function linkWants(sys, name) {
  const d = SERVICES[name];
  if (!d) return;
  const link = `${WANTS_DIR}/${d.unit}`;
  if (!sys.vfs.exists(WANTS_DIR)) sys.vfs.mkdir(WANTS_DIR, { parents: true });
  if (!sys.vfs.isLink(link)) { try { sys.vfs.symlink(`${UNIT_DIR}/${d.unit}`, link); } catch { /* ignore */ } }
}
function unlinkWants(sys, name) {
  const d = SERVICES[name];
  if (!d) return;
  const link = `${WANTS_DIR}/${d.unit}`;
  if (sys.vfs.isLink(link)) sys.vfs.unlink(link);
}

/** Called when a package that ships a unit is installed (or at image build time). */
export function registerUnit(sys, name, { start = false, enable } = {}) {
  const d = SERVICES[name];
  if (!d) return;
  const en = enable ?? d.enabledByDefault !== false;
  sys.svcState[name] = { active: 'inactive', enabled: en ? 'enabled' : 'disabled', since: sys.now() };
  if (en) linkWants(sys, name);
  if (start) startUnit(sys, name);
  sys.touch('svc');
}

export function unregisterUnit(sys, name) {
  const d = SERVICES[name];
  if (!d) return;
  stopProcesses(sys, name);
  unlinkWants(sys, name);
  delete sys.svcState[name];
  sys.touch('svc');
}

function stopProcesses(sys, name) {
  for (const p of sys.processes.filter((q) => q.svc === name)) {
    const i = sys.processes.indexOf(p);
    if (i >= 0) sys.processes.splice(i, 1);
  }
}

function need(sys, name, verb) {
  const c = canonical(name);
  const st = c && sys.svcState[c];
  if (!st) throw new CmdError(`Failed to ${verb} ${String(name).replace(/\.service$/, '')}.service: Unit ${String(name).replace(/\.service$/, '')}.service not found.`, 5);
  return { name: c, st, d: SERVICES[c] };
}

export function startUnit(sys, name) {
  const { name: n, st, d } = need(sys, name, 'start');
  if (st.enabled === 'masked') throw new CmdError(`Failed to start ${d.unit}: Unit ${d.unit} is masked.`, 1);
  if (st.active === 'active') return false;
  st.since = sys.now();
  if (d.type === 'oneshot') {
    st.active = 'active';
  } else {
    const p = sys.spawn({ user: d.user, cmd: d.procName || d.exec, comm: d.comm || mainComm(d), svc: n, listen: (d.listen || []).map((l) => ({ ...l })), stat: 'Ss' });
    st.active = 'active';
    st.pid = p.pid;
  }
  sys.log('syslog', 'systemd', `Started ${d.unit} - ${d.desc}.`, 1);
  sys.touch('svc');
  return true;
}

export function stopUnit(sys, name) {
  const { st, d } = need(sys, name, 'stop');
  if (st.active !== 'active') return false;
  stopProcesses(sys, d.name);
  st.active = 'inactive';
  st.since = sys.now();
  delete st.pid;
  sys.log('syslog', 'systemd', `Stopped ${d.unit} - ${d.desc}.`, 1);
  sys.touch('svc');
  return true;
}

export function restartUnit(sys, name) {
  need(sys, name, 'restart');
  stopUnit(sys, name);
  startUnit(sys, name);
}

export function reloadUnit(sys, name) {
  const { st, d } = need(sys, name, 'reload');
  if (st.active !== 'active') throw new CmdError(`Failed to reload ${d.unit}: Unit ${d.unit} is not active.`, 1);
}

export function enableUnit(sys, name) {
  const { name: n, st, d } = need(sys, name, 'enable');
  if (st.enabled === 'masked') throw new CmdError(`Failed to enable unit: Unit file ${UNIT_DIR}/${d.unit} is masked.`, 1);
  const msgs = [];
  if (st.enabled !== 'enabled') {
    msgs.push(`Created symlink ${WANTS_DIR}/${d.unit} → ${UNIT_DIR}/${d.unit}.`);
    st.enabled = 'enabled';
    linkWants(sys, n);
  }
  sys.touch('svc');
  return msgs;
}

export function disableUnit(sys, name) {
  const { name: n, st, d } = need(sys, name, 'disable');
  const msgs = [];
  if (st.enabled === 'enabled') {
    msgs.push(`Removed "${WANTS_DIR}/${d.unit}".`);
    st.enabled = 'disabled';
    unlinkWants(sys, n);
  }
  sys.touch('svc');
  return msgs;
}

export function maskUnit(sys, name) {
  const { st, d } = need(sys, name, 'mask');
  const link = `/etc/systemd/system/${d.unit}`;
  const msgs = [];
  if (st.enabled !== 'masked') {
    if (st.enabled === 'enabled') unlinkWants(sys, d.name);
    st.enabled = 'masked';
    if (!sys.vfs.exists(link)) sys.vfs.symlink('/dev/null', link);
    msgs.push(`Created symlink ${link} → /dev/null.`);
  }
  sys.touch('svc');
  return msgs;
}

export function unmaskUnit(sys, name) {
  const { st, d } = need(sys, name, 'unmask');
  const link = `/etc/systemd/system/${d.unit}`;
  const msgs = [];
  if (st.enabled === 'masked') {
    st.enabled = 'disabled';
    if (sys.vfs.isLink(link)) sys.vfs.unlink(link);
    msgs.push(`Removed "${link}".`);
  }
  sys.touch('svc');
  return msgs;
}

/** Everything `systemctl list-units --type=service` would show. */
export function listUnits(sys) {
  return Object.keys(sys.svcState).sort().map((n) => {
    const d = SERVICES[n];
    const st = sys.svcState[n];
    const sub = st.active === 'failed' ? 'failed' : st.active === 'active' ? (d.type === 'oneshot' ? 'exited' : 'running') : 'dead';
    return { name: n, unit: d.unit, desc: d.desc, load: st.enabled === 'masked' ? 'masked' : 'loaded', active: st.active, sub, enabled: st.enabled };
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtUnitTime(ms) {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tzAbbrev(ms)}`;
}

export function relAgo(ms, now) {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min ago`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ago`;
}

const GREEN = '\u001b[0;1;32m●\u001b[0m';
const RED = '\u001b[0;1;31m×\u001b[0m';
const WHITE = '○';

/** `systemctl status NAME` text (without pager). Returns {text, code}. */
export function statusText(sys, name) {
  const c = canonical(name);
  const bare = String(name).replace(/\.service$/, '');
  if (!c || !sys.svcState[c]) return { text: `Unit ${bare}.service could not be found.\n`, code: 4 };
  const d = SERVICES[c];
  const st = sys.svcState[c];
  const now = sys.now();
  const preset = d.enabledByDefault === false ? 'disabled' : 'enabled';
  const active = st.active === 'active';
  const procs = sys.processes.filter((p) => p.svc === c);
  const bullet = st.active === 'failed' ? RED : active ? GREEN : WHITE;
  let t = `${bullet} ${d.unit} - ${d.desc}\n`;
  t += `     Loaded: ${st.enabled === 'masked' ? 'masked (Reason: Unit ' + d.unit + ' is masked.)' : `loaded (${UNIT_DIR}/${d.unit}; ${st.enabled}; vendor preset: ${preset})`}\n`;
  if (active) {
    t += `     Active: \u001b[0;1;32mactive (${d.type === 'oneshot' ? 'exited' : 'running'})\u001b[0m since ${fmtUnitTime(st.since)}; ${relAgo(st.since, now)}\n`;
  } else {
    t += `     Active: ${st.active === 'failed' ? '\u001b[0;1;31mfailed (Result: exit-code)\u001b[0m' : 'inactive (dead)'} since ${fmtUnitTime(st.since)}; ${relAgo(st.since, now)}\n`;
  }
  if (d.docs) t += `       Docs: ${d.docs}\n`;
  if (active && procs.length) {
    const main = procs[0];
    t += `   Main PID: ${main.pid} (${main.comm})\n`;
    t += `      Tasks: ${procs.length} (limit: 4552)\n`;
    t += `     Memory: ${(main.rss / 1024).toFixed(1)}M\n`;
    t += `        CPU: ${20 + (main.pid % 90)}ms\n`;
    t += `     CGroup: /system.slice/${d.unit}\n`;
    procs.forEach((p, i) => { t += `             ${i === procs.length - 1 ? '└─' : '├─'}${p.pid} ${p.cmd}\n`; });
  }
  const host = sys.hostname;
  const stamp = (ms) => { const dd = new Date(ms); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dd.getMonth()]} ${String(dd.getDate()).padStart(2, ' ')} ${pad2(dd.getHours())}:${pad2(dd.getMinutes())}:${pad2(dd.getSeconds())}`; };
  t += `\n${stamp(st.since)} ${host} systemd[1]: ${active ? 'Started' : 'Stopped'} ${d.unit} - ${d.desc}.\n`;
  return { text: t, code: active ? 0 : 3 };
}
