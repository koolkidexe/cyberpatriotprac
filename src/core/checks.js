// Read-only inspectors of system state. The scoring engine and the GUI apps both use them, so what
// the scorer sees is exactly what a real config parser would see (e.g. sshd: first value wins).
import * as users from './users.js';
import * as pk from './packages.js';
import * as sv from './services.js';
import { ufwActive } from './firewall.js';
import { sysctlConfEffective } from './sysctl.js';
import { hashPassword, compareVersions } from './util.js';
import * as BP from './browserprefs.js';

const rd = (sys, p) => (sys.vfs.isFile(p) ? sys.vfs.readFile(p) : null);

// ---------------------------------------------------------------- sshd_config (first value wins, Include expanded in place)
function sshdParse(sys, path, depth, out) {
  const txt = rd(sys, path);
  if (txt == null || depth > 5) return;
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(\S+)\s*=?\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'include') {
      for (const pat of val.split(/\s+/)) {
        const dir = pat.slice(0, pat.lastIndexOf('/'));
        const re = new RegExp('^' + pat.slice(pat.lastIndexOf('/') + 1).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        if (sys.vfs.isDir(dir)) for (const n of sys.vfs.readdir(dir).sort()) if (re.test(n)) sshdParse(sys, `${dir}/${n}`, depth + 1, out);
      }
      continue;
    }
    if (!out.has(key)) out.set(key, val);
  }
}
export function sshdEffective(sys) {
  const out = new Map();
  sshdParse(sys, '/etc/ssh/sshd_config', 0, out);
  return out;
}
/** Effective value with sshd's built-in defaults for the options we care about. */
export function sshdValue(sys, key) {
  const defaults = { permitrootlogin: 'prohibit-password', permitemptypasswords: 'no', x11forwarding: 'no', maxauthtries: '6', passwordauthentication: 'yes', protocol: '2' };
  const v = sshdEffective(sys).get(key.toLowerCase());
  return (v ?? defaults[key.toLowerCase()] ?? '').toLowerCase();
}

// ---------------------------------------------------------------- login.defs
export function loginDefs(sys) {
  const out = {};
  for (const l of (rd(sys, '/etc/login.defs') || '').split('\n')) {
    const m = /^\s*([A-Z_]+)\s+(\S+)/.exec(l);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ---------------------------------------------------------------- PAM
export function pamAll(sys) {
  const out = [];
  if (!sys.vfs.isDir('/etc/pam.d')) return out;
  for (const f of sys.vfs.readdir('/etc/pam.d')) for (const l of users.pamLines(sys, f)) out.push({ ...l, file: f });
  return out;
}
export function effectiveMinLen(sys) {
  const pwq = users.pwqualitySettings(sys);
  const unix = users.pamLines(sys, 'common-password').find((l) => l.module === 'pam_unix.so' && l.type === 'password');
  const cr = users.pamLines(sys, 'common-password').find((l) => l.module === 'pam_cracklib.so');
  return Math.max(pwq ? pwq.minlen : 0, unix?.args.minlen ? Number(unix.args.minlen) : 0, cr?.args.minlen ? Number(cr.args.minlen) : 0);
}
export function lockoutDeny(sys) {
  const lines = users.pamLines(sys, 'common-auth');
  const fl = lines.find((l) => l.module === 'pam_faillock.so' || l.module === 'pam_tally2.so' || l.module === 'pam_tally.so');
  if (!fl) return null;
  if (fl.args.deny) return Number(fl.args.deny);
  const conf = rd(sys, '/etc/security/faillock.conf') || '';
  const m = /^\s*deny\s*=\s*(\d+)/m.exec(conf);
  return m ? Number(m[1]) : 3; // pam_faillock's default
}
export function nullokPresent(sys) {
  return ['common-auth', 'common-password'].some((f) => users.pamLines(sys, f).some((l) => l.module === 'pam_unix.so' && (l.flags.includes('nullok') || l.flags.includes('nullok_secure'))));
}

// ---------------------------------------------------------------- sudoers
export function sudoersText(sys) {
  let t = rd(sys, '/etc/sudoers') || '';
  if (sys.vfs.isDir('/etc/sudoers.d')) for (const n of sys.vfs.readdir('/etc/sudoers.d').sort()) if (!n.includes('.') && !n.endsWith('~')) t += '\n' + (rd(sys, `/etc/sudoers.d/${n}`) || '');
  return t;
}
export function sudoNeedsNoPassword(sys) {
  if (/^\s*Defaults[^#\n]*!\s*authenticate/m.test(sudoersText(sys))) return true;
  return users.sudoRules(sys).some((r) => r.tags.includes('NOPASSWD'));
}

// ---------------------------------------------------------------- misc settings
export function lightdmValue(sys, key) {
  let val;
  const files = ['/etc/lightdm/lightdm.conf'];
  if (sys.vfs.isDir('/etc/lightdm/lightdm.conf.d')) for (const n of sys.vfs.readdir('/etc/lightdm/lightdm.conf.d').sort()) if (n.endsWith('.conf')) files.push(`/etc/lightdm/lightdm.conf.d/${n}`);
  for (const f of files) {
    let section = '';
    for (const raw of (rd(sys, f) || '').split('\n')) {
      const l = raw.trim();
      const s = /^\[(.+)\]$/.exec(l);
      if (s) { section = s[1]; continue; }
      if (!/^(Seat:\*|LightDM)$/.test(section)) continue;
      const m = new RegExp(`^${key}\\s*=\\s*(.*)$`).exec(l);
      if (m) val = m[1].trim();
    }
  }
  return val;
}
export const guestAllowed = (sys) => pk.isInstalled(sys, 'lightdm') && (lightdmValue(sys, 'allow-guest') ?? 'true').toLowerCase() === 'true';

/** Value of a key in the [daemon] section of GDM's custom.conf (Ubuntu). */
export function gdmValue(sys, key) {
  let val; let section = '';
  for (const raw of (rd(sys, '/etc/gdm3/custom.conf') || '').split('\n')) {
    const l = raw.trim();
    const sm = /^\[(.+)\]$/.exec(l);
    if (sm) { section = sm[1]; continue; }
    if (section !== 'daemon') continue;
    const m = new RegExp(`^${key}\\s*=\\s*(.*)$`).exec(l);
    if (m) val = m[1].trim();
  }
  return val;
}
export const usesGdm = (sys) => pk.isInstalled(sys, 'gdm3');
/** The account that logs in automatically at boot (null = none), for whichever display manager is installed. */
export function autologinUser(sys) {
  if (usesGdm(sys)) return (gdmValue(sys, 'AutomaticLoginEnable') || '').toLowerCase() === 'true' ? gdmValue(sys, 'AutomaticLogin') || null : null;
  return lightdmValue(sys, 'autologin-user') || null;
}

export function aptPeriodic(sys, key) {
  let v = null;
  if (!sys.vfs.isDir('/etc/apt/apt.conf.d')) return 0;
  for (const n of sys.vfs.readdir('/etc/apt/apt.conf.d').sort()) {
    const m = new RegExp(`APT::Periodic::${key}\\s+"?(\\d+)"?`).exec(rd(sys, `/etc/apt/apt.conf.d/${n}`) || '');
    if (m) v = Number(m[1]);
  }
  return v ?? 0;
}

export const sysctlConfValue = (sys, key) => sysctlConfEffective(sys)[key];

// ---------------------------------------------------------------- passwords
const WORDS = ['password', 'password1', 'password123', 'passw0rd', 'Password1', 'P@ssw0rd', '123456', '12345678', '123456789', 'qwerty', 'letmein', 'welcome', 'changeme', 'admin', 'abc123', 'iloveyou', 'monkey', 'dragon', 'cyberpatriot', 'summer2024', 'summer2025', 'summer2026'];
const weakCache = new Map();
function weakCandidates(user) {
  const cap = user[0].toUpperCase() + user.slice(1);
  return [...WORDS, user, cap, `${user}1`, `${user}12`, `${user}123`, `${user}1234`, `${user}!`, `${user}2024`, `${user}2025`, `${user}2026`, `${cap}1`, `${cap}123`, `${cap}!`, `${cap}1!`, `${user}${user}`, `${user}password`, `password${user}`];
}
/** Is the user's current password a decent, changed one? Unchanged / dictionary / username-based = false. */
export function passwordIsSecure(sys, user) {
  const s = users.getShadow(sys, user);
  if (!s) return false;
  const h = s.hash.replace(/^!+/, '');
  if (!h || h === '*' || !h.startsWith('$y$')) return false;
  if (sys.misc.initialHashes?.[user] === h) return false;
  const key = `${user}|${h}`;
  if (weakCache.has(key)) return weakCache.get(key);
  const salt = /^\$y\$j9T\$([^$]+)\$/.exec(h)?.[1];
  const weak = weakCandidates(user).some((c) => hashPassword(c, salt) === h);
  weakCache.set(key, !weak);
  return !weak;
}

// ---------------------------------------------------------------- services / packages
export function serviceOff(sys, svcName, pkgName) {
  if (pkgName && !pk.isInstalled(sys, pkgName)) return true;
  const st = sys.svcState[svcName];
  if (!st) return true;
  return st.active !== 'active' && st.enabled !== 'enabled';
}
export const portListening = (sys, port) => sys.sockets().some((s) => s.port === port);

// ---------------------------------------------------------------- files
export function fileMode(sys, path) {
  try { return sys.vfs.stat(path).mode & 0o7777; } catch { return null; }
}
export function answerOf(sys, path) {
  const t = rd(sys, path);
  if (t == null) return '';
  const m = /^ANSWER:[ \t]*(.*)$/m.exec(t);
  return m ? m[1].trim() : '';
}

export { users, pk, sv, ufwActive };

// ---- added for the past-season task types
/** All named packages are installed and at the newest available version. */
export function upToDate(sys, names) {
  return names.every((n) => pk.isInstalled(sys, n) && compareVersions(pk.installedVersion(sys, n), pk.def(n).avail || pk.installedVersion(sys, n)) >= 0);
}
/** The user has to choose a new password at next login (shadow "last change" field is 0, as set by `passwd -e` / `chage -d 0`). */
export function mustChangePassword(sys, name) {
  const s = users.getShadow(sys, name);
  return !!s && s.lastchg === '0';
}
/** A newly created standard (non-admin) login account. */
export function standardUserExists(sys, name) {
  const u = users.getUser(sys, name);
  return !!u && u.uid >= 1000 && !/nologin|false$/.test(u.shell || '') && !users.isAdmin(sys, name);
}
export const chromiumPopupsBlocked = (sys) => BP.chromiumPopupsBlocked(sys, 'student');
export const chromiumSafeBrowsing = (sys) => BP.chromiumSafeBrowsingOn(sys, 'student');
export const firefoxPopupsBlocked = (sys) => BP.firefoxPopupsBlocked(sys, 'student');
export const firefoxSafeBrowsing = (sys) => BP.firefoxDangerousContentBlocked(sys, 'student');
export const firefoxDownloadsProtected = (sys) => BP.dangerousDownloadsBlocked(sys, 'student', 'firefox');
