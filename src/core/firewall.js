// ufw model. /etc/ufw/ufw.conf (ENABLED) and /etc/default/ufw (default policies) are the source of
// truth, exactly as on a real system; rules live in sys.ufw.rules and are mirrored to user.rules.
import { CmdError } from './errors.js';
import * as services from './services.js';

const CONF = '/etc/ufw/ufw.conf';
const DEFAULTS = '/etc/default/ufw';

export const SERVICE_PORTS = {
  ssh: '22/tcp', http: '80/tcp', www: '80/tcp', https: '443/tcp', ftp: '21/tcp', smtp: '25/tcp', telnet: '23/tcp',
  domain: '53', dns: '53', ntp: '123/udp', imap: '143/tcp', imaps: '993/tcp', pop3: '110/tcp', pop3s: '995/tcp',
  mysql: '3306/tcp', postgresql: '5432/tcp', ldap: '389/tcp', snmp: '161/udp', sftp: '22/tcp', ipp: '631/tcp', 'microsoft-ds': '445/tcp',
};
export const APP_PROFILES = { OpenSSH: '22/tcp', CUPS: '631' };

const rd = (sys, p) => (sys.vfs.exists(p) ? sys.vfs.readFile(p) : '');

export const ufwInstalled = (sys) => sys.vfs.exists('/usr/sbin/ufw');
export const confEnabled = (sys) => /^\s*ENABLED\s*=\s*yes\b/im.test(rd(sys, CONF));
/** The firewall is only really up when ufw.conf says so AND the ufw unit is active. */
export const ufwActive = (sys) => ufwInstalled(sys) && confEnabled(sys) && services.isActive(sys, 'ufw');

function setConfLine(sys, path, key, value, quote = false) {
  const txt = rd(sys, path);
  const line = `${key}=${quote ? `"${value}"` : value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  sys.vfs.writeFile(path, re.test(txt) ? txt.replace(re, line) : txt + (txt.endsWith('\n') || !txt ? '' : '\n') + line + '\n');
}

export function ufwEnable(sys) {
  setConfLine(sys, CONF, 'ENABLED', 'yes');
  if (!services.isRegistered(sys, 'ufw')) services.registerUnit(sys, 'ufw');
  services.enableUnit(sys, 'ufw');
  services.startUnit(sys, 'ufw');
  writeUserRules(sys);
  sys.log('ufw.log', 'kernel', '[UFW] firewall enabled');
  sys.touch('ufw');
}

export function ufwDisable(sys) {
  setConfLine(sys, CONF, 'ENABLED', 'no');
  if (services.isRegistered(sys, 'ufw')) services.stopUnit(sys, 'ufw');
  sys.touch('ufw');
}

const POLICY_TO_FILE = { deny: 'DROP', allow: 'ACCEPT', reject: 'REJECT' };
const FILE_TO_POLICY = { DROP: 'deny', ACCEPT: 'allow', REJECT: 'reject' };

export function getDefaults(sys) {
  const t = rd(sys, DEFAULTS);
  const g = (k, d) => FILE_TO_POLICY[(new RegExp(`^\\s*${k}\\s*=\\s*"?(\\w+)"?`, 'm').exec(t) || [])[1]] || d;
  return { incoming: g('DEFAULT_INPUT_POLICY', 'deny'), outgoing: g('DEFAULT_OUTPUT_POLICY', 'allow'), routed: g('DEFAULT_FORWARD_POLICY', 'deny') === 'deny' ? 'disabled' : 'allow' };
}

export function setDefault(sys, dir, policy) {
  if (!POLICY_TO_FILE[policy]) throw new CmdError(`ERROR: Invalid policy '${policy}'`, 1);
  const key = { incoming: 'DEFAULT_INPUT_POLICY', outgoing: 'DEFAULT_OUTPUT_POLICY', routed: 'DEFAULT_FORWARD_POLICY' }[dir];
  if (!key) throw new CmdError(`ERROR: Invalid direction '${dir}'`, 1);
  setConfLine(sys, DEFAULTS, key, POLICY_TO_FILE[policy], true);
  sys.touch('ufw');
}

export function loggingLevel(sys) { return sys.ufw.logging || 'low'; }
export function setLogging(sys, level) { sys.ufw.logging = level; sys.touch('ufw'); }

// ---------------------------------------------------------------- rules
const ACTIONS = ['allow', 'deny', 'reject', 'limit'];

function portSpec(tok) {
  // "22", "22/tcp", "80,443/tcp", "6000:6007/udp", "ssh", "OpenSSH"
  const app = Object.keys(APP_PROFILES).find((a) => a.toLowerCase() === String(tok).toLowerCase());
  if (app) { const [p, pr] = APP_PROFILES[app].split('/'); return { port: p, proto: pr || 'any', app }; }
  const svc = SERVICE_PORTS[String(tok).toLowerCase()];
  if (svc) { const [p, pr] = svc.split('/'); return { port: p, proto: pr || 'any' }; }
  const m = /^(\d+(?::\d+)?(?:,\d+(?::\d+)?)*)(?:\/(tcp|udp))?$/.exec(tok);
  if (!m) throw new CmdError(`ERROR: Bad port '${tok}'`, 1);
  for (const part of m[1].split(',')) for (const n of part.split(':')) if (Number(n) < 1 || Number(n) > 65535) throw new CmdError(`ERROR: Bad port '${tok}'`, 1);
  return { port: m[1], proto: m[2] || 'any' };
}

const addr = (a) => (a === 'any' || a === 'anywhere' ? 'any' : a);

/** Parse `ufw allow ...` style arguments (everything after the action word). */
export function parseRule(action, args) {
  const r = { action, dir: 'in', proto: 'any', fromAddr: 'any', fromPort: null, toAddr: 'any', toPort: null, app: null };
  const a = [...args];
  if (!a.length) throw new CmdError('ERROR: Wrong number of arguments', 1);
  while (a[0] === 'log' || a[0] === 'log-all') a.shift();
  if (a[0] === 'in' || a[0] === 'out') r.dir = a.shift();
  while (a[0] === 'log' || a[0] === 'log-all') a.shift();
  if (a[0] === 'on') { a.shift(); a.shift(); }
  if (!a.length) throw new CmdError('ERROR: Wrong number of arguments', 1);
  if (a.length === 1 || (a[0] !== 'from' && a[0] !== 'to' && a[0] !== 'proto')) {
    // simple form: PORT[/proto]
    const ps = portSpec(a.shift());
    r.toPort = ps.port; r.proto = ps.proto; r.app = ps.app || null;
    if (a.length) throw new CmdError('ERROR: Invalid syntax', 1);
    return r;
  }
  while (a.length) {
    const k = a.shift();
    if (k === 'proto') { r.proto = a.shift(); if (!['tcp', 'udp', 'any', 'ipv6', 'esp', 'ah'].includes(r.proto)) throw new CmdError(`ERROR: Unsupported protocol '${r.proto}'`, 1); }
    else if (k === 'from') { r.fromAddr = addr(a.shift()); if (a[0] === 'port') { a.shift(); r.fromPort = portSpec(a.shift()).port; } }
    else if (k === 'to') { r.toAddr = addr(a.shift()); if (a[0] === 'port') { a.shift(); const ps = portSpec(a.shift()); r.toPort = ps.port; if (ps.proto !== 'any') r.proto = ps.proto; } }
    else if (k === 'port') { const ps = portSpec(a.shift()); r.toPort = ps.port; if (ps.proto !== 'any') r.proto = ps.proto; }
    else if (k === 'app') { const ps = portSpec(a.shift()); r.toPort = ps.port; r.proto = ps.proto; r.app = ps.app || null; }
    else throw new CmdError('ERROR: Invalid syntax', 1);
  }
  for (const x of [r.fromAddr, r.toAddr]) {
    if (x !== 'any' && !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(x) && !/^[0-9a-f:]+(\/\d{1,3})?$/i.test(x)) throw new CmdError(`ERROR: Bad source address`, 1);
  }
  return r;
}

const sameRule = (a, b) => ['action', 'dir', 'proto', 'fromAddr', 'fromPort', 'toAddr', 'toPort'].every((k) => a[k] === b[k]);
const isV4Only = (r) => /^\d/.test(r.fromAddr) || /^\d/.test(r.toAddr);
const hasV6 = (sys, r) => /^\s*IPV6\s*=\s*yes/im.test(rd(sys, DEFAULTS)) && !isV4Only(r);

/** Add a rule; returns output lines like the real tool. */
export function addRule(sys, rule) {
  const out = [];
  const active = ufwActive(sys);
  if (sys.ufw.rules.some((x) => sameRule(x, rule))) {
    out.push('Skipping adding existing rule');
    if (hasV6(sys, rule)) out.push('Skipping adding existing rule (v6)');
    return out;
  }
  sys.ufw.rules.push(rule);
  writeUserRules(sys);
  out.push(active ? 'Rule added' : 'Rules updated');
  if (hasV6(sys, rule)) out.push(active ? 'Rule added (v6)' : 'Rules updated (v6)');
  sys.touch('ufw');
  return out;
}

/** Rows as displayed: v4 rules first, then v6 copies, like ufw status. */
export function displayRules(sys) {
  const rows = [];
  const mk = (r, v6) => {
    const proto = r.proto && r.proto !== 'any' ? `/${r.proto}` : '';
    const portTxt = r.toPort ? `${r.toPort}${proto}` : '';
    let to;
    if (r.app) to = r.app;
    else if (r.toAddr === 'any') to = portTxt || 'Anywhere';
    else to = `${r.toAddr}${portTxt ? ' ' + portTxt : ''}`;
    let from = r.fromAddr === 'any' ? 'Anywhere' : r.fromAddr;
    if (r.fromPort) from += ` ${r.fromPort}`;
    if (v6) { to += ' (v6)'; from = r.fromAddr === 'any' ? 'Anywhere (v6)' : from; }
    const action = `${r.action.toUpperCase()} ${r.dir.toUpperCase()}`;
    return { to, action, from, rule: r };
  };
  for (const r of sys.ufw.rules) rows.push(mk(r, false));
  for (const r of sys.ufw.rules) if (hasV6(sys, r)) rows.push(mk(r, true));
  return rows;
}

export function describeRule(r) {
  const parts = [r.action];
  if (r.dir === 'out') parts.push('out');
  if (r.fromAddr !== 'any' || r.toAddr !== 'any' || r.fromPort) {
    if (r.proto !== 'any') parts.push('proto', r.proto);
    parts.push('from', r.fromAddr === 'any' ? 'any' : r.fromAddr);
    if (r.fromPort) parts.push('port', r.fromPort);
    parts.push('to', r.toAddr === 'any' ? 'any' : r.toAddr);
    if (r.toPort) parts.push('port', r.toPort);
  } else if (r.app) parts.push(r.app);
  else parts.push(`${r.toPort}${r.proto !== 'any' ? '/' + r.proto : ''}`);
  return parts.join(' ');
}

export function deleteRule(sys, which) {
  const active = ufwActive(sys);
  let idx = -1;
  if (typeof which === 'number') {
    const rows = displayRules(sys);
    const row = rows[which - 1];
    if (!row) throw new CmdError(`ERROR: Could not find rule '${which}'`, 1);
    idx = sys.ufw.rules.indexOf(row.rule);
  } else idx = sys.ufw.rules.findIndex((x) => sameRule(x, which));
  if (idx < 0) return ['Could not delete non-existent rule'];
  const [r] = sys.ufw.rules.splice(idx, 1);
  writeUserRules(sys);
  sys.touch('ufw');
  const out = [active ? 'Rule deleted' : 'Rules updated'];
  if (hasV6(sys, r)) out.push(active ? 'Rule deleted (v6)' : 'Rules updated (v6)');
  return out;
}

export function resetRules(sys) {
  sys.ufw.rules = [];
  ufwDisable(sys);
  setDefault(sys, 'incoming', 'deny');
  setDefault(sys, 'outgoing', 'allow');
  writeUserRules(sys);
  sys.touch('ufw');
}

// ---------------------------------------------------------------- status text
const pad = (s, n) => (s.length >= n ? s + ' ' : s.padEnd(n));

export function statusLines(sys, { verbose = false, numbered = false } = {}) {
  if (!ufwActive(sys)) return ['Status: inactive'];
  const out = ['Status: active'];
  if (verbose) {
    const d = getDefaults(sys);
    const lg = loggingLevel(sys);
    out.push(lg === 'off' ? 'Logging: off' : `Logging: on (${lg})`);
    out.push(`Default: ${d.incoming} (incoming), ${d.outgoing} (outgoing), ${d.routed} (routed)`);
    out.push('New profiles: skip');
  }
  const rows = displayRules(sys);
  if (!rows.length) return out;
  out.push('');
  const w = numbered ? 22 : 26;
  const num = (i) => (numbered ? `[${String(i + 1).padStart(2, ' ')}] ` : '');
  out.push(`${numbered ? '     ' : ''}${pad('To', w)}${pad('Action', 12)}From`);
  out.push(`${numbered ? '     ' : ''}${pad('--', w)}${pad('------', 12)}----`);
  rows.forEach((r, i) => out.push(`${num(i)}${pad(r.to, w)}${pad(r.action, 12)}${r.from}`));
  return out;
}

// ---------------------------------------------------------------- user.rules mirror
export function writeUserRules(sys) {
  const lines = ['*filter', ':ufw-user-input - [0:0]', ':ufw-user-output - [0:0]', ':ufw-user-forward - [0:0]', ':ufw-before-logging-input - [0:0]', ':ufw-before-logging-output - [0:0]', ':ufw-before-logging-forward - [0:0]', ':ufw-user-logging-input - [0:0]', ':ufw-user-logging-output - [0:0]', ':ufw-user-logging-forward - [0:0]', ':ufw-after-logging-input - [0:0]', ':ufw-after-logging-output - [0:0]', ':ufw-after-logging-forward - [0:0]', ':ufw-logging-deny - [0:0]', ':ufw-logging-allow - [0:0]', ':ufw-user-limit - [0:0]', ':ufw-user-limit-accept - [0:0]', '### RULES ###', ''];
  for (const r of sys.ufw.rules) {
    const tgt = { allow: 'ACCEPT', deny: 'DROP', reject: 'REJECT', limit: 'ufw-user-limit' }[r.action];
    const chain = r.dir === 'out' ? 'ufw-user-output' : 'ufw-user-input';
    const p = r.proto !== 'any' ? ` -p ${r.proto}` : '';
    const dport = r.toPort ? ` --dport ${r.toPort.replace(':', ':')}` : '';
    const src = r.fromAddr !== 'any' ? ` -s ${r.fromAddr}` : '';
    const dst = r.toAddr !== 'any' ? ` -d ${r.toAddr}` : '';
    lines.push(`### tuple ### ${r.action} ${r.proto} ${r.toPort || 'any'} ${r.toAddr === 'any' ? '0.0.0.0/0' : r.toAddr} ${r.fromPort || 'any'} ${r.fromAddr === 'any' ? '0.0.0.0/0' : r.fromAddr} ${r.dir}`);
    lines.push(`-A ${chain}${p}${dport}${src}${dst} -j ${tgt}`, '');
  }
  lines.push('### END RULES ###', '', '### LOGGING ###', '-A ufw-after-logging-input -j LOG --log-prefix "[UFW BLOCK] " -m limit --limit 3/min --limit-burst 10', '### END LOGGING ###', '', 'COMMIT', '');
  const path = '/etc/ufw/user.rules';
  if (sys.vfs.exists('/etc/ufw')) sys.vfs.writeFile(path, lines.join('\n'), { mode: 0o640, uid: 0, gid: 0 });
}
