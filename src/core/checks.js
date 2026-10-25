// Read-only helpers that answer "what is the effective configuration?" the way the real daemons would.
// Scenario checks are built from these, so the same logic is used no matter whether the user edited a
// file in nano, a GUI app, or with a command.
import * as users from './users.js';
import * as pk from './packages.js';
import * as sv from './services.js';
import { sysctlConfEffective } from './sysctl.js';
import { globToRegex, posix } from './util.js';

const read = (sys, p) => (sys.vfs.isFile(p) ? sys.vfs.readFile(p) : '');

// ---------------------------------------------------------------- sshd_config
/** Flatten sshd_config + Include files in the order sshd reads them. Stops at the first Match block. */
function sshdLines(sys, path, depth = 0, out = { stop: false, lines: [] }) {
  if (depth > 5 || !sys.vfs.isFile(path)) return out;
  for (const raw of read(sys, path).split('\n')) {
    if (out.stop) break;
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'match') { out.stop = true; break; }
    if (key === 'include') {
      for (const pat of m[2].split(/\s+/)) {
        const full = pat.startsWith('/') ? pat : `/etc/ssh/${pat}`;
        const d = posix.dirname(full);
        const re = globToRegex(posix.basename(full));
        if (!sys.vfs.isDir(d)) continue;
        for (const name of sys.vfs.readdir(d).sort()) if (re.test(name)) sshdLines(sys, `${d}/${name}`, depth + 1, out);
      }
      continue;
    }
    out.lines.push({ key, value: m[2].trim().replace(/^"|"$/g, ''), file: path });
  }
  return out;
}

/** First value wins (sshd semantics). Returns {value, file} or null when unset (then the compiled-in default applies). */
export function sshdEffective(sys, key) {
  const hit = sshdLines(sys, '/etc/ssh/sshd_config').lines.find((l) => l.key === key.toLowerCase());
  return hit ? { value: hit.value, file: hit.file } : null;
}
export const SSHD_DEFAULTS = { permitrootlogin: 'prohibit-password', permitemptypasswords: 'no', passwordauthentication: 'yes', x11forwarding: 'no', protocol: '2' };
export const sshdValue = (sys, key) => (sshdEffective(sys, key)?.value ?? SSHD_DEFAULTS[key.toLowerCase()] ?? '').toLowerCase();

// ---------------------------------------------------------------- login.defs / PAM
export function loginDefs(sys, key) {
  let val = null;
  for (const l of read(sys, '/etc/login.defs').split('\n')) {
    const m = /^\s*([A-Z_]+)\s+(\S+)/.exec(l);
    if (m && m[1] === key) val = m[2];
  }
  return val;
}

/** The password length that `passwd` will really enforce (pwquality conf/PAM line, or legacy pam_unix minlen). */
export function effectiveMinlen(sys) {
  const q = users.pwqualitySettings(sys);
  const unix = users.pamLines(sys, 'common-password').find((l) => l.module === 'pam_unix.so' && l.args.minlen);
  return Math.max(q ? q.minlen : 0, unix ? Number(unix.args.minlen) : 0);
}

const faillockConf = (sys) => {
  const o = {};
  for (const l of read(sys, '/etc/security/faillock.conf').split('\n')) {
    const m = /^\s*([a-z_]+)\s*=?\s*(\S*)\s*$/.exec(l);
    if (m && !l.trim().startsWith('#')) o[m[1]] = m[2];
  }
  return o;
};

/** Failed-login lockout threshold from common-auth (pam_faillock or pam_tally2), or null if no lockout is configured. */
export function lockoutThreshold(sys) {
  for (const l of users.pamLines(sys, 'common-auth')) {
    if (l.module === 'pam_tally2.so' || l.module === 'pam_tally.so') return l.args.deny ? Number(l.args.deny) : 0;
    if (l.module === 'pam_faillock.so' && (l.flags.includes('authfail') || l.flags.includes('preauth'))) {
      const d = l.args.deny ?? faillockConf(sys).deny ?? '3';
      return Number(d);
    }
  }
  return null;
}
export const hasNullok = (sys) => users.pamLines(sys, 'common-auth').some((l) => l.module === 'pam_unix.so' && l.flags.includes('nullok'));

// ---------------------------------------------------------------- sudo
export function sudoWithoutPassword(sys) {
  const files = ['/etc/sudoers'];
  if (sys.vfs.isDir('/etc/sudoers.d')) for (const n of sys.vfs.readdir('/etc/sudoers.d')) if (!n.includes('.') && !n.endsWith('~')) files.push(`/etc/sudoers.d/${n}`);
  const text = files.map((f) => read(sys, f)).join('\n');
  if (/^\s*Defaults[^#\n]*!\s*authenticate/m.test(text)) return true;
  return users.sudoRules(sys).some((r) => r.tags.includes('NOPASSWD') && (r.cmds === 'ALL' || /(^|,\s*)ALL$/.test(r.cmds)));
}

// ---------------------------------------------------------------- LightDM
/** allow-guest as lightdm resolves it: later files override earlier ones; the default is true. */
export function lightdmAllowGuest(sys) {
  const files = ['/etc/lightdm/lightdm.conf'];
  const d = '/etc/lightdm/lightdm.conf.d';
  if (sys.vfs.isDir(d)) for (const n of sys.vfs.readdir(d).sort()) if (n.endsWith('.conf')) files.push(`${d}/${n}`);
  let val = true;
  for (const f of files) {
    let sec = '';
    for (const raw of read(sys, f).split('\n')) {
      const l = raw.trim();
      const s = /^\[(.+)\]$/.exec(l);
      if (s) { sec = s[1]; continue; }
      const m = /^allow-guest\s*=\s*(\S+)/.exec(l);
      if (m && (sec === 'Seat:*' || sec === 'SeatDefaults' || sec.startsWith('Seat:'))) val = m[1].toLowerCase() === 'true';
    }
  }
  return val;
}

// ---------------------------------------------------------------- apt
export function aptConfValue(sys, key) {
  const d = '/etc/apt/apt.conf.d';
  let val = null;
  if (sys.vfs.isDir(d)) {
    for (const n of sys.vfs.readdir(d).sort()) {
      const t = read(sys, `${d}/${n}`);
      const re = new RegExp(`^\\s*${key.replace(/[:]/g, '\\:')}\\s+"([^"]*)"\\s*;`, 'gm');
      let m;
      while ((m = re.exec(t))) val = m[1];
    }
  }
  return val;
}

// ---------------------------------------------------------------- misc state
export const userExists = (sys, n) => !!users.getUser(sys, n);
export const inGroup = (sys, user, group) => !!users.getGroup(sys, group)?.members.includes(user) || users.getUser(sys, user)?.gid === users.getGroup(sys, group)?.gid;
export const sysctlConf = (sys, key) => sysctlConfEffective(sys)[key];
export const pkgGone = (sys, name) => !pk.isInstalled(sys, name);
/** Service neither running nor enabled, or its package is gone. */
export const svcOff = (sys, unit) => !sv.isRegistered(sys, unit) || (!sv.isActive(sys, unit) && !sv.isEnabled(sys, unit));
export const fileMode = (sys, p) => (sys.vfs.exists(p) ? sys.vfs.stat(p).mode & 0o7777 : null);
export const listeningOn = (sys, port) => sys.sockets().some((s) => s.port === port);

/** Does the plaintext password appear as an ANSWER line in the file? (forensics questions) */
export function answered(sys, path, pattern) {
  if (!sys.vfs.isFile(path)) return false;
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return read(sys, path).split('\n').some((l) => { const m = /^\s*ANSWER:\s*(.*?)\s*$/i.exec(l); return !!m && re.test(m[1]); });
}

import * as fw from './firewall.js';
export const ufwOn = (sys) => fw.ufwActive(sys);
