// Account management on top of /etc/passwd, /etc/shadow, /etc/group, /etc/gshadow and sudoers.
// The files are the single source of truth, exactly like a real system, so editing them by hand
// in a text editor has the same effect as using adduser, usermod, the Users and Groups app, etc.
import { CmdError } from './errors.js';
import { hashPassword, verifyPassword, daysSinceEpoch, posix } from './util.js';

const PASSWD = '/etc/passwd';
const SHADOW = '/etc/shadow';
const GROUP = '/etc/group';
const GSHADOW = '/etc/gshadow';

const lines = (txt) => txt.split('\n').filter((l) => l.trim() !== '');

// ---------------------------------------------------------------- parsing
export function readPasswd(sys) {
  return lines(sys.vfs.readFile(PASSWD)).map((l) => {
    const f = l.split(':');
    return { name: f[0], pw: f[1] ?? 'x', uid: Number(f[2]), gid: Number(f[3]), gecos: f[4] ?? '', home: f[5] ?? '', shell: f[6] ?? '' };
  });
}
export function writePasswd(sys, entries) {
  sys.vfs.writeFile(PASSWD, entries.map((e) => [e.name, e.pw, e.uid, e.gid, e.gecos, e.home, e.shell].join(':')).join('\n') + '\n');
  sys.touch('users');
}

export function readShadow(sys) {
  if (!sys.vfs.exists(SHADOW)) return [];
  return lines(sys.vfs.readFile(SHADOW)).map((l) => {
    const f = l.split(':');
    return { name: f[0], hash: f[1] ?? '', lastchg: f[2] ?? '', min: f[3] ?? '', max: f[4] ?? '', warn: f[5] ?? '', inactive: f[6] ?? '', expire: f[7] ?? '', reserved: f[8] ?? '' };
  });
}
export function writeShadow(sys, entries) {
  sys.vfs.writeFile(SHADOW, entries.map((e) => [e.name, e.hash, e.lastchg, e.min, e.max, e.warn, e.inactive, e.expire, e.reserved].join(':')).join('\n') + '\n');
  sys.touch('users');
}

export function readGroups(sys) {
  return lines(sys.vfs.readFile(GROUP)).map((l) => {
    const f = l.split(':');
    return { name: f[0], pw: f[1] ?? 'x', gid: Number(f[2]), members: (f[3] ?? '').split(',').filter(Boolean) };
  });
}
export function writeGroups(sys, groups) {
  sys.vfs.writeFile(GROUP, groups.map((g) => [g.name, g.pw, g.gid, g.members.join(',')].join(':')).join('\n') + '\n');
  // keep gshadow roughly in sync
  const old = new Map(sys.vfs.exists(GSHADOW) ? lines(sys.vfs.readFile(GSHADOW)).map((l) => [l.split(':')[0], l.split(':')]) : []);
  sys.vfs.writeFile(GSHADOW, groups.map((g) => {
    const o = old.get(g.name);
    return [g.name, o ? o[1] : '!', o ? o[2] ?? '' : '', g.members.join(',')].join(':');
  }).join('\n') + '\n');
  sys.touch('users');
}

// ---------------------------------------------------------------- lookups
export const getUser = (sys, name) => readPasswd(sys).find((u) => u.name === name) || null;
export const getUserByUid = (sys, uid) => readPasswd(sys).find((u) => u.uid === uid) || null;
export const getGroup = (sys, name) => readGroups(sys).find((g) => g.name === name) || null;
export const getGroupByGid = (sys, gid) => readGroups(sys).find((g) => g.gid === gid) || null;
export const getShadow = (sys, name) => readShadow(sys).find((s) => s.name === name) || null;

/** All groups a user belongs to (primary first). */
export function userGroups(sys, name) {
  const u = getUser(sys, name);
  const groups = readGroups(sys);
  const out = [];
  if (u) {
    const prim = groups.find((g) => g.gid === u.gid);
    if (prim) out.push(prim);
  }
  for (const g of groups) if (g.members.includes(name) && !out.includes(g)) out.push(g);
  return out;
}

/** Credential object for permission checks. */
export function credFor(sys, name) {
  const u = getUser(sys, name);
  if (!u) return { name, uid: 65534, gid: 65534, gids: [65534] };
  const gs = userGroups(sys, name);
  return { name, uid: u.uid, gid: u.gid, gids: [...new Set([u.gid, ...gs.map((g) => g.gid)])] };
}

export const isSystemAccount = (u) => u.uid < 1000 || u.uid === 65534;
export const loginShells = (sys) => new Set(lines(sys.vfs.exists('/etc/shells') ? sys.vfs.readFile('/etc/shells') : '/bin/bash').filter((l) => !l.startsWith('#')));

// ---------------------------------------------------------------- allocation
export function nextUid(sys, { system = false } = {}) {
  const used = new Set(readPasswd(sys).map((u) => u.uid));
  let uid = system ? 100 : 1000;
  const max = system ? 999 : 59999;
  while (used.has(uid) && uid <= max) uid++;
  return uid;
}
export function nextGid(sys, { system = false } = {}) {
  const used = new Set(readGroups(sys).map((g) => g.gid));
  let gid = system ? 100 : 1000;
  const max = system ? 999 : 59999;
  while (used.has(gid) && gid <= max) gid++;
  return gid;
}

const NAME_RE = /^[a-z_][a-z0-9_-]*\$?$/;
export function validName(name) {
  return NAME_RE.test(name) && name.length <= 32;
}

// ---------------------------------------------------------------- groups
export function groupAdd(sys, name, { gid, system = false } = {}) {
  if (!validName(name)) throw new CmdError(`groupadd: '${name}' is not a valid group name`, 3);
  const groups = readGroups(sys);
  if (groups.some((g) => g.name === name)) throw new CmdError(`groupadd: group '${name}' already exists`, 9);
  if (gid != null && groups.some((g) => g.gid === gid)) throw new CmdError(`groupadd: GID '${gid}' already exists`, 4);
  const g = { name, pw: 'x', gid: gid ?? nextGid(sys, { system }), members: [] };
  groups.push(g);
  writeGroups(sys, groups);
  return g;
}

export function groupDel(sys, name) {
  const groups = readGroups(sys);
  const g = groups.find((x) => x.name === name);
  if (!g) throw new CmdError(`groupdel: group '${name}' does not exist`, 6);
  if (readPasswd(sys).some((u) => u.gid === g.gid)) {
    const owner = readPasswd(sys).find((u) => u.gid === g.gid);
    throw new CmdError(`groupdel: cannot remove the primary group of user '${owner.name}'`, 8);
  }
  writeGroups(sys, groups.filter((x) => x !== g));
}

export function addMember(sys, group, user) {
  const groups = readGroups(sys);
  const g = groups.find((x) => x.name === group);
  if (!g) throw new CmdError(`group '${group}' does not exist`, 6);
  if (!g.members.includes(user)) g.members.push(user);
  writeGroups(sys, groups);
}

export function removeMember(sys, group, user) {
  const groups = readGroups(sys);
  const g = groups.find((x) => x.name === group);
  if (!g) throw new CmdError(`group '${group}' does not exist`, 6);
  g.members = g.members.filter((m) => m !== user);
  writeGroups(sys, groups);
}

export function setMembers(sys, group, members) {
  const groups = readGroups(sys);
  const g = groups.find((x) => x.name === group);
  if (!g) throw new CmdError(`group '${group}' does not exist`, 6);
  g.members = [...members];
  writeGroups(sys, groups);
}

// ---------------------------------------------------------------- users
export function userAdd(sys, o) {
  const { name } = o;
  if (!validName(name)) throw new CmdError(`useradd: invalid user name '${name}'`, 3);
  const users = readPasswd(sys);
  if (users.some((u) => u.name === name)) throw new CmdError(`useradd: user '${name}' already exists`, 9);
  const system = !!o.system;
  const uid = o.uid ?? nextUid(sys, { system });
  if (users.some((u) => u.uid === uid) && !o.nonUnique) throw new CmdError(`useradd: UID ${uid} is not unique`, 4);
  const groups = readGroups(sys);
  let gid = o.gid;
  let createdGroup = null;
  if (gid == null) {
    const existing = groups.find((g) => g.name === name);
    if (existing) gid = existing.gid;
    else {
      const wantGid = groups.some((g) => g.gid === uid) ? nextGid(sys, { system }) : uid;
      createdGroup = groupAdd(sys, name, { gid: wantGid, system });
      gid = createdGroup.gid;
    }
  }
  const home = o.home ?? (system ? `/var/lib/${name}` : `/home/${name}`);
  const entry = { name, pw: 'x', uid, gid, gecos: o.gecos ?? '', home, shell: o.shell ?? (system ? '/usr/sbin/nologin' : '/bin/bash') };
  users.push(entry);
  writePasswd(sys, users);
  const sh = readShadow(sys);
  sh.push({
    name,
    hash: o.hash ?? (o.password != null ? (o.password === '' ? '' : hashPassword(o.password, sys.salt())) : '!'),
    lastchg: String(daysSinceEpoch(sys.now())),
    min: '0', max: '99999', warn: '7', inactive: '', expire: '', reserved: '',
  });
  writeShadow(sys, sh);
  for (const gname of o.groups || []) {
    if (readGroups(sys).some((g) => g.name === gname)) addMember(sys, gname, name);
  }
  if (o.createHome !== false && !system) createHome(sys, entry);
  sys.touch('users');
  return { entry, createdGroup };
}

export function createHome(sys, entry, skel = '/etc/skel') {
  const v = sys.vfs;
  if (!v.exists(entry.home)) v.mkdir(entry.home, { parents: true, mode: 0o750, uid: entry.uid, gid: entry.gid });
  if (v.isDir(skel)) {
    for (const [p, node] of v.walk(skel)) {
      if (p === skel) continue;
      const rel = p.slice(skel.length);
      const dst = entry.home + rel;
      if (node.t === 'd') { if (!v.exists(dst)) v.mkdir(dst, { mode: node.mode, uid: entry.uid, gid: entry.gid }); }
      else if (!v.exists(dst)) v.writeFile(dst, node.data, { mode: node.mode, uid: entry.uid, gid: entry.gid });
    }
  }
  for (const d of ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos']) {
    if (!v.exists(`${entry.home}/${d}`)) v.mkdir(`${entry.home}/${d}`, { mode: 0o755, uid: entry.uid, gid: entry.gid });
  }
}

export function processesOf(sys, name) {
  return sys.processes.filter((p) => p.user === name);
}

export function userDel(sys, name, { removeHome = false, force = false } = {}) {
  const users = readPasswd(sys);
  const u = users.find((x) => x.name === name);
  if (!u) throw new CmdError(`userdel: user '${name}' does not exist`, 6);
  const procs = processesOf(sys, name).filter((p) => p.cmd && !p.cmd.startsWith('['));
  if (procs.length && !force) throw new CmdError(`userdel: user ${name} is currently used by process ${procs[0].pid}`, 8);
  writePasswd(sys, users.filter((x) => x !== u));
  writeShadow(sys, readShadow(sys).filter((s) => s.name !== name));
  const groups = readGroups(sys).map((g) => ({ ...g, members: g.members.filter((m) => m !== name) }));
  // remove the user's private group if it is now unused
  const keep = groups.filter((g) => !(g.name === name && g.gid === u.gid && !users.some((x) => x !== u && x.gid === g.gid) && g.members.length === 0));
  writeGroups(sys, keep);
  const spool = `/var/spool/cron/crontabs/${name}`;
  if (sys.vfs.exists(spool)) sys.vfs.unlink(spool);
  if (removeHome && u.home && u.home !== '/' && sys.vfs.exists(u.home)) sys.vfs.rmrf(u.home);
  sys.touch('users');
  return u;
}

export function userMod(sys, name, ch) {
  const users = readPasswd(sys);
  const u = users.find((x) => x.name === name);
  if (!u) throw new CmdError(`usermod: user '${name}' does not exist`, 6);
  if (ch.newName && ch.newName !== name) {
    if (!validName(ch.newName)) throw new CmdError(`usermod: invalid user name '${ch.newName}'`, 3);
    if (users.some((x) => x.name === ch.newName)) throw new CmdError(`usermod: user '${ch.newName}' already exists`, 9);
    const sh = readShadow(sys);
    for (const s of sh) if (s.name === name) s.name = ch.newName;
    writeShadow(sys, sh);
    const gs = readGroups(sys);
    for (const g of gs) g.members = g.members.map((m) => (m === name ? ch.newName : m));
    writeGroups(sys, gs);
    u.name = ch.newName;
  }
  if (ch.uid != null) u.uid = ch.uid;
  if (ch.gid != null) u.gid = ch.gid;
  if (ch.gecos != null) u.gecos = ch.gecos;
  if (ch.shell != null) u.shell = ch.shell;
  if (ch.home != null) {
    if (ch.move && sys.vfs.exists(u.home)) sys.vfs.rename(u.home, ch.home);
    u.home = ch.home;
  }
  writePasswd(sys, users);
  if (ch.setGroups) {
    for (const g of readGroups(sys)) if (g.members.includes(u.name) && !ch.setGroups.includes(g.name)) removeMember(sys, g.name, u.name);
    for (const gname of ch.setGroups) addMember(sys, gname, u.name);
  }
  for (const gname of ch.appendGroups || []) addMember(sys, gname, u.name);
  if (ch.lock) lockPassword(sys, u.name);
  if (ch.unlock) unlockPassword(sys, u.name);
  if (ch.expire != null) {
    const sh = readShadow(sys);
    const s = sh.find((x) => x.name === u.name);
    if (s) s.expire = ch.expire === '' ? '' : String(ch.expire);
    writeShadow(sys, sh);
  }
  return u;
}

// ---------------------------------------------------------------- passwords
function updateShadow(sys, name, fn) {
  const sh = readShadow(sys);
  const s = sh.find((x) => x.name === name);
  if (!s) throw new CmdError(`user '${name}' does not exist in /etc/shadow`, 6);
  fn(s);
  writeShadow(sys, sh);
}

export function setPassword(sys, name, plain) {
  updateShadow(sys, name, (s) => {
    s.hash = hashPassword(plain, sys.salt());
    s.lastchg = String(daysSinceEpoch(sys.now()));
  });
}
export function setHash(sys, name, hash) {
  updateShadow(sys, name, (s) => { s.hash = hash; s.lastchg = String(daysSinceEpoch(sys.now())); });
}
export function lockPassword(sys, name) {
  updateShadow(sys, name, (s) => { if (!s.hash.startsWith('!')) s.hash = '!' + s.hash; });
}
export function unlockPassword(sys, name) {
  updateShadow(sys, name, (s) => {
    if (s.hash.startsWith('!')) {
      const rest = s.hash.slice(1);
      if (rest === '') throw new CmdError("passwd: unlocking the password would result in a passwordless account.\nYou should set a password with usermod -p to unlock the password of this account.", 3);
      s.hash = rest;
    }
  });
}
export function deletePassword(sys, name) {
  updateShadow(sys, name, (s) => { s.hash = ''; s.lastchg = String(daysSinceEpoch(sys.now())); });
}
export function expirePassword(sys, name) {
  updateShadow(sys, name, (s) => { s.lastchg = '0'; });
}
export function chage(sys, name, o) {
  updateShadow(sys, name, (s) => {
    if (o.min != null) s.min = String(o.min);
    if (o.max != null) s.max = String(o.max);
    if (o.warn != null) s.warn = String(o.warn);
    if (o.inactive != null) s.inactive = o.inactive === -1 ? '' : String(o.inactive);
    if (o.expire != null) s.expire = o.expire === -1 ? '' : String(o.expire);
    if (o.lastchg != null) s.lastchg = String(o.lastchg);
  });
}

/** Does the plaintext password authenticate the account (as su/login would)? */
export function checkPassword(sys, name, plain) {
  const s = getShadow(sys, name);
  if (!s) return false;
  if (s.hash === '') return plain === ''; // empty password: login without one (nullok)
  if (s.hash.startsWith('!') || s.hash.startsWith('*')) return false;
  return verifyPassword(plain, s.hash);
}

export const passwordState = (s) => (!s || s.hash === '' ? 'NP' : s.hash.startsWith('!') || s.hash.startsWith('*') ? 'L' : 'P');

// ---------------------------------------------------------------- password quality (pam_pwquality)
const COMMON_WORDS = new Set(['password', 'passw0rd', 'letmein', 'welcome', 'qwerty', 'abc123', 'iloveyou', 'admin', 'monkey', 'dragon', 'football', 'baseball', 'master', 'shadow', 'sunshine', 'princess', 'login', 'cyberpatriot', 'trustno1', 'changeme', 'summer', 'winter', 'spring', 'autumn']);

function readConfFile(sys, path) {
  const o = {};
  if (!sys.vfs.exists(path)) return o;
  for (const l of sys.vfs.readFile(path).split('\n')) {
    const m = /^\s*([a-z_]+)\s*=\s*(\S+)\s*$/.exec(l);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

export function pamLines(sys, file) {
  const p = `/etc/pam.d/${file}`;
  if (!sys.vfs.exists(p)) return [];
  return sys.vfs.readFile(p).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    // type control module args...
    const m = /^(-?\w+)\s+(\[[^\]]*\]|\S+)\s+(\S+)\s*(.*)$/.exec(l);
    if (!m) return null;
    const args = {};
    const flags = [];
    for (const a of m[4].split(/\s+/).filter(Boolean)) {
      const kv = /^([^=]+)=(.*)$/.exec(a);
      if (kv) args[kv[1]] = kv[2]; else flags.push(a);
    }
    return { type: m[1], control: m[2], module: m[3], args, flags, raw: l };
  }).filter(Boolean);
}

/** Effective pwquality settings from pwquality.conf overridden by the PAM line. */
export function pwqualitySettings(sys) {
  const conf = { minlen: '8', dcredit: '0', ucredit: '0', lcredit: '0', ocredit: '0', minclass: '0', maxrepeat: '0', usercheck: '1', dictcheck: '1', enforce_for_root: false, ...readConfFile(sys, '/etc/security/pwquality.conf') };
  const line = pamLines(sys, 'common-password').find((l) => l.module === 'pam_pwquality.so' && l.type === 'password');
  if (!line) return null;
  Object.assign(conf, line.args);
  if (line.flags.includes('enforce_for_root')) conf.enforce_for_root = true;
  const n = (k) => Number(conf[k]);
  return { minlen: n('minlen'), dcredit: n('dcredit'), ucredit: n('ucredit'), lcredit: n('lcredit'), ocredit: n('ocredit'), minclass: n('minclass'), maxrepeat: n('maxrepeat'), usercheck: n('usercheck') !== 0, dictcheck: n('dictcheck') !== 0, retry: Number(conf.retry || 1), enforceForRoot: !!conf.enforce_for_root };
}

/** Returns an error string (without "BAD PASSWORD: ") or null if the password is acceptable. */
export function passwordQuality(sys, user, pw, oldPw) {
  const s = pwqualitySettings(sys);
  // minlen can also be given on the pam_unix line (legacy option, still honoured by our model)
  const unix = pamLines(sys, 'common-password').find((l) => l.module === 'pam_unix.so');
  let minlen = s ? s.minlen : 0;
  if (unix && unix.args.minlen) minlen = Math.max(minlen, Number(unix.args.minlen));
  if (!s && !unix?.args.minlen) return null;
  if (oldPw != null && oldPw === pw) return 'The password is the same as the old one';
  if (pw.length < minlen) return `The password is shorter than ${minlen} characters`;
  if (s) {
    const cnt = { d: (pw.match(/\d/g) || []).length, u: (pw.match(/[A-Z]/g) || []).length, l: (pw.match(/[a-z]/g) || []).length, o: (pw.match(/[^A-Za-z0-9]/g) || []).length };
    const names = { d: ['dcredit', 'digits'], u: ['ucredit', 'uppercase letters'], l: ['lcredit', 'lowercase letters'], o: ['ocredit', 'non-alphanumeric characters'] };
    for (const k of Object.keys(names)) {
      const credit = s[names[k][0]];
      if (credit < 0 && cnt[k] < -credit) return `The password contains less than ${-credit} ${names[k][1]}`;
    }
    if (s.minclass > 0) {
      const classes = Object.values(cnt).filter((x) => x > 0).length;
      if (classes < s.minclass) return `The password contains less than ${s.minclass} character classes`;
    }
    if (s.maxrepeat > 0 && new RegExp(`(.)\\1{${s.maxrepeat},}`).test(pw)) return 'The password contains more than ' + s.maxrepeat + ' same characters consecutively';
    if (s.usercheck && user && user.length >= 3 && (pw.toLowerCase().includes(user.toLowerCase()) || pw.toLowerCase().includes([...user].reverse().join('').toLowerCase()))) return 'The password contains the user name in some form';
    if (s.dictcheck) {
      const bare = pw.toLowerCase().replace(/[^a-z]/g, '');
      if (COMMON_WORDS.has(pw.toLowerCase()) || COMMON_WORDS.has(bare)) return 'The password fails the dictionary check - it is based on a dictionary word';
      if (pw.length >= 3 && /^(.)\1+$/.test(pw)) return 'The password fails the dictionary check - it is too simplistic/systematic';
      if (/^(012|123|234|345|456|567|678|789)/.test(pw) && /^\d+$/.test(pw)) return 'The password fails the dictionary check - it is too simplistic/systematic';
    }
  }
  return null;
}

// ---------------------------------------------------------------- password history (pam_unix remember=N)
export function rememberCount(sys) {
  const unix = pamLines(sys, 'common-password').find((l) => l.module === 'pam_unix.so' && l.type === 'password');
  return unix && unix.args.remember ? Number(unix.args.remember) : 0;
}
function readOpasswd(sys) {
  const p = '/etc/security/opasswd';
  const map = new Map();
  if (!sys.vfs.exists(p)) return map;
  for (const l of lines(sys.vfs.readFile(p))) {
    const f = l.split(':');
    map.set(f[0], { uid: f[1], count: f[2], hashes: (f[3] ?? '').split(',').filter(Boolean) });
  }
  return map;
}
export function passwordWasUsed(sys, user, plain) {
  const n = rememberCount(sys);
  if (!n) return false;
  const rec = readOpasswd(sys).get(user);
  if (!rec) return false;
  return rec.hashes.slice(-n).some((h) => verifyPassword(plain, h));
}
export function recordOldPassword(sys, user) {
  const n = rememberCount(sys);
  if (!n) return;
  const s = getShadow(sys, user);
  if (!s || !s.hash.startsWith('$')) return;
  const map = readOpasswd(sys);
  const u = getUser(sys, user);
  const rec = map.get(user) || { uid: String(u?.uid ?? ''), hashes: [] };
  rec.hashes.push(s.hash);
  rec.hashes = rec.hashes.slice(-Math.max(n, 5));
  map.set(user, rec);
  const out = [...map.entries()].map(([k, r]) => `${k}:${r.uid}:${r.hashes.length}:${r.hashes.join(',')}`);
  sys.vfs.writeFile('/etc/security/opasswd', out.join('\n') + '\n', { mode: 0o600 });
}

// ---------------------------------------------------------------- sudoers
function sudoersFiles(sys) {
  const files = [];
  const read = (p) => {
    if (!sys.vfs.exists(p)) return;
    const txt = sys.vfs.readFile(p);
    files.push({ path: p, text: txt });
    for (const l of txt.split('\n')) {
      const m = /^\s*[#@]includedir\s+(\S+)/.exec(l);
      if (m && sys.vfs.isDir(m[1])) {
        for (const name of sys.vfs.readdir(m[1]).sort()) {
          if (name.includes('.') || name.endsWith('~')) continue;
          read(`${m[1]}/${name}`);
        }
      }
      const inc = /^\s*[#@]include\s+(\S+)/.exec(l);
      if (inc) read(inc[1]);
    }
  };
  read('/etc/sudoers');
  return files;
}

export function sudoRules(sys) {
  const rules = [];
  for (const f of sudoersFiles(sys)) {
    for (const raw of f.text.split('\n')) {
      const l = raw.replace(/\s+#.*$/, '').trim();
      if (!l || l.startsWith('#') || l.startsWith('@') || /^(Defaults|User_Alias|Runas_Alias|Host_Alias|Cmnd_Alias)\b/.test(l)) continue;
      const m = /^(\S+)\s+(\S+)\s*=\s*(\([^)]*\))?\s*(.*)$/.exec(l);
      if (!m) continue;
      let rest = m[4];
      const tags = [];
      let t;
      while ((t = /^(NOPASSWD|PASSWD|SETENV|NOSETENV|NOEXEC|EXEC|LOG_INPUT|LOG_OUTPUT):\s*/.exec(rest))) { tags.push(t[1]); rest = rest.slice(t[0].length); }
      rules.push({ who: m[1], host: m[2], runas: (m[3] || '(root)').slice(1, -1), tags, cmds: rest.trim(), raw: l, file: f.path });
    }
  }
  return rules;
}

/** What may `user` do with sudo? */
export function sudoPolicy(sys, user) {
  const groups = userGroups(sys, user).map((g) => g.name);
  const matching = sudoRules(sys).filter((r) => {
    if (r.who === 'ALL') return true;
    if (r.who.startsWith('%')) return groups.includes(r.who.slice(1));
    return r.who === user;
  });
  const allAll = matching.filter((r) => r.cmds === 'ALL' || r.cmds.split(/\s*,\s*/).includes('ALL'));
  // last matching rule decides the tag, as in sudo
  const last = allAll[allAll.length - 1];
  return {
    allowed: matching.length > 0,
    full: allAll.length > 0,
    nopasswd: !!last && last.tags.includes('NOPASSWD') && !last.tags.slice(last.tags.lastIndexOf('NOPASSWD') + 1).includes('PASSWD'),
    rules: matching,
  };
}

export function isAdmin(sys, user) {
  return user === 'root' || sudoPolicy(sys, user).full;
}

export { posix };
