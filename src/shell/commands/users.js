// Accounts, authentication and privilege commands: id, passwd, adduser, useradd, usermod, su, sudo, crontab, ...
import { cmd, parseOpts, usageError } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import { cronEntries, userCrontabPath } from '../../core/cron.js';
import { sudoersText } from '../../core/checks.js';
import { fmtDate, daysSinceEpoch, posix } from '../../core/util.js';
import { DEFAULT_PATH } from '../shell.js';

const TTY = 'pts/0';
const askSecret = (ctx, prompt) => ctx.term.readLine(prompt, { echo: false, secret: true });
const askLine = (ctx, prompt) => ctx.term.readLine(prompt, { echo: true });
const sleep = (ctx, ms) => ctx.sleep(ms);

// ---------------------------------------------------------------- id / whoami / groups / who / w / last
function idOf(ctx, name) {
  const u = users.getUser(ctx.sys, name);
  if (!u) return null;
  const groups = users.userGroups(ctx.sys, name);
  return { u, groups };
}

cmd('id', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'ugGnrZ', long: { user: 'u', group: 'g', groups: 'G', name: 'n', real: 'r' } });
  if (err) return usageError(ctx, err);
  const name = rest[0] ?? ctx.user;
  let info = idOf(ctx, name);
  if (!info && /^\d+$/.test(name)) { const u = users.getUserByUid(ctx.sys, Number(name)); if (u) info = idOf(ctx, u.name); }
  if (!info) { if (name === 'root') info = { u: { name: 'root', uid: 0, gid: 0 }, groups: [{ name: 'root', gid: 0 }] }; else { ctx.err(`id: ‘${name}’: no such user\n`); return 1; } }
  const { u, groups } = info;
  const grp = groups.map((g) => g.gid);
  const gname = (gid) => users.getGroupByGid(ctx.sys, gid)?.name ?? String(gid);
  if (o.u) { ctx.out((o.n ? u.name : u.uid) + '\n'); return 0; }
  if (o.g) { ctx.out((o.n ? gname(u.gid) : u.gid) + '\n'); return 0; }
  if (o.G) { ctx.out(grp.map((g) => (o.n ? gname(g) : g)).join(' ') + '\n'); return 0; }
  ctx.out(`uid=${u.uid}(${u.name}) gid=${u.gid}(${gname(u.gid)}) groups=${groups.map((g) => `${g.gid}(${g.name})`).join(',')}\n`);
  return 0;
}, { usage: 'id [OPTION]... [USER]...' });

cmd('whoami', (ctx) => { ctx.out(ctx.user + '\n'); return 0; });
cmd('logname', (ctx) => { ctx.out((ctx.sh.frames[0]?.user ?? ctx.user) + '\n'); return 0; });

cmd('groups', (ctx) => {
  if (!ctx.args.length) { ctx.out(users.userGroups(ctx.sys, ctx.user).map((g) => g.name).join(' ') + '\n'); return 0; }
  let rc = 0;
  for (const n of ctx.args) {
    if (!users.getUser(ctx.sys, n)) { ctx.err(`groups: ‘${n}’: no such user\n`); rc = 1; continue; }
    ctx.out(`${n} : ${users.userGroups(ctx.sys, n).map((g) => g.name).join(' ')}\n`);
  }
  return rc;
});

function sessions(ctx) {
  const out = [];
  try {
    for (const l of ctx.sys.vfs.readFile('/run/utmp').split('\n').filter(Boolean)) {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(l);
      if (m) out.push({ user: m[1], tty: m[2], host: m[3], when: m[4] });
    }
  } catch { /* none */ }
  for (const p of ctx.sys.processes) if (p.user && p.comm === 'bash' && p.tty.startsWith('pts/')) out.push({ user: p.user, tty: p.tty, host: '', when: new Date(p.start).toISOString().slice(0, 16).replace('T', ' ') });
  return out;
}
cmd('who', (ctx) => {
  for (const s of sessions(ctx)) ctx.out(`${s.user.padEnd(8)} ${s.tty.padEnd(12)} ${s.when}${s.host && s.host !== '?' ? ` (${s.host})` : ''}\n`);
  return 0;
});
cmd('users', (ctx) => { ctx.out(sessions(ctx).map((s) => s.user).join(' ') + '\n'); return 0; });
cmd('w', (ctx) => {
  const up = Math.floor((ctx.sys.now() - ctx.sys.bootTime) / 60000);
  const d = new Date(ctx.sys.now());
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const ss = sessions(ctx);
  ctx.out(` ${t} up ${up >= 60 ? `${Math.floor(up / 60)}:${String(up % 60).padStart(2, '0')}` : `${up} min`},  ${ss.length} user${ss.length === 1 ? '' : 's'},  load average: 0.21, 0.14, 0.09\n`);
  ctx.out('USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n');
  for (const s of ss) ctx.out(`${s.user.padEnd(8)} ${s.tty.padEnd(8)} ${(s.host || '-').padEnd(16)} ${s.when.slice(11)}   ${'0.00s'.padStart(5)}  0.02s  0.01s bash\n`);
  return 0;
});
cmd(['last', 'lastb'], (ctx) => {
  if (ctx.name === 'lastb') {
    if (!ctx.isRoot) { ctx.err('lastb: cannot open /var/log/btmp: Permission denied\n'); return 1; }
    ctx.out('\nbtmp begins ' + fmtDate(ctx.sys.bootTime).slice(0, 15) + '\n');
    return 0;
  }
  let text = '';
  try { text = ctx.fs.readFile('/var/log/wtmp'); } catch { ctx.err('last: cannot open /var/log/wtmp: Permission denied\n'); return 1; }
  const lines = text.split('\n').filter(Boolean).map((l) => {
    const m = /^(\S+)\s+(\S+(?: boot)?)\s+(\S+)\s+(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)\s+(.*)$/.exec(l);
    if (!m) return l;
    const d = new Date(`${m[4]}-${m[5]}-${m[6]}T${m[7]}:00`);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${m[1].padEnd(8)} ${m[2].padEnd(12)} ${m[3].slice(0, 16).padEnd(16)} ${days[d.getDay()]} ${mons[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${m[7]}   ${m[8]}`;
  });
  const who = ctx.args.filter((a) => !a.startsWith('-'));
  for (const l of lines.filter((l) => !who.length || who.some((w) => l.startsWith(w)))) ctx.out(l + '\n');
  ctx.out(`\nwtmp begins ${fmtDate(ctx.sys.bootTime).slice(0, 15)}\n`);
  return 0;
});
cmd('lastlog', (ctx) => {
  ctx.out('Username         Port     From             Latest\n');
  for (const u of users.readPasswd(ctx.sys)) {
    const real = u.uid === 0 || u.uid >= 1000;
    ctx.out(`${u.name.padEnd(16)} ${real && u.name === 'student' ? 'tty7'.padEnd(8) : '        '} ${'                '} ${u.name === 'student' ? fmtDate(ctx.sys.bootTime) : '**Never logged in**'}\n`);
  }
  return 0;
});

cmd('getent', (ctx) => {
  const [db, ...keys] = ctx.args;
  if (!db) { ctx.err('Usage: getent [OPTION...] database [key ...]\n'); return 1; }
  const sys = ctx.sys;
  let rows = [];
  if (db === 'passwd') rows = users.readPasswd(sys).map((u) => ({ k: [u.name, String(u.uid)], line: [u.name, u.pw, u.uid, u.gid, u.gecos, u.home, u.shell].join(':') }));
  else if (db === 'group') rows = users.readGroups(sys).map((g) => ({ k: [g.name, String(g.gid)], line: [g.name, g.pw, g.gid, g.members.join(',')].join(':') }));
  else if (db === 'shadow') {
    if (!ctx.isRoot) return 2;
    rows = users.readShadow(sys).map((s) => ({ k: [s.name], line: [s.name, s.hash, s.lastchg, s.min, s.max, s.warn, s.inactive, s.expire, s.reserved].join(':') }));
  } else if (db === 'hosts') rows = [{ k: ['localhost'], line: '127.0.0.1       localhost' }, { k: [sys.hostname], line: `127.0.1.1       ${sys.hostname}` }];
  else if (db === 'services') rows = [{ k: ['ssh', '22'], line: 'ssh                   22/tcp' }, { k: ['http', '80'], line: 'http                  80/tcp www' }, { k: ['ftp', '21'], line: 'ftp                   21/tcp' }];
  else { ctx.err(`Unknown database: ${db}\nTry 'getent --help' or 'getent --usage' for more information.\n`); return 1; }
  if (!keys.length) { for (const r of rows) ctx.out(r.line + '\n'); return 0; }
  let rc = 0;
  for (const k of keys) { const r = rows.find((x) => x.k.includes(k)); if (r) ctx.out(r.line + '\n'); else rc = 2; }
  return rc;
});

// ---------------------------------------------------------------- passwd
const fmtShadowDate = (days) => {
  const d = new Date(Number(days) * 86400000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

cmd('passwd', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'ludeSqa', val: 'nxwiR', long: { lock: 'l', unlock: 'u', delete: 'd', expire: 'e', status: 'S', all: 'a', quiet: 'q', mindays: { key: 'n', val: true }, maxdays: { key: 'x', val: true }, warndays: { key: 'w', val: true }, inactive: { key: 'i', val: true }, stdin: 's' } });
  if (err) return usageError(ctx, err);
  const sys = ctx.sys;
  const target = rest[0] ?? ctx.user;
  const self = target === ctx.user;
  const entry = users.getUser(sys, target);
  if (!ctx.isRoot && !self) { ctx.err(`passwd: You may not view or modify password information for ${target}.\n`); return 1; }
  if (!entry) { ctx.err(`passwd: user '${target}' does not exist\n`); return 1; }
  if (o.S) {
    if (!ctx.isRoot && !self) return 1;
    const s = users.getShadow(sys, target);
    const st = users.passwordState(s);
    ctx.out(`${target} ${st} ${s && s.lastchg !== '' ? fmtShadowDate(s.lastchg) : '01/01/1970'} ${s?.min || 0} ${s?.max || 99999} ${s?.warn || 7} ${s?.inactive || -1}\n`);
    return 0;
  }
  const changed = () => { ctx.out('passwd: password expiry information changed.\n'); return 0; };
  if (o.l || o.u || o.d || o.e || o.n != null || o.x != null || o.w != null || o.i != null) {
    if (!ctx.isRoot) { ctx.err('passwd: Permission denied.\n'); return 1; }
    try {
      if (o.l) { users.lockPassword(sys, target); return changed(); }
      if (o.u) { users.unlockPassword(sys, target); return changed(); }
      if (o.d) { users.deletePassword(sys, target); return changed(); }
      if (o.e) { users.expirePassword(sys, target); return changed(); }
      users.chage(sys, target, { min: o.n, max: o.x, warn: o.w, inactive: o.i != null ? Number(o.i) : undefined });
      return changed();
    } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  }
  // interactive change
  if (!ctx.term.readLine || (ctx.stdin && !o.s)) { ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 10; }
  ctx.out(`Changing password for ${target}.\n`);
  const shadow = users.getShadow(sys, target);
  let oldPw = null;
  if (!ctx.isRoot) {
    const hasPw = shadow && shadow.hash && !shadow.hash.startsWith('!');
    if (hasPw) {
      oldPw = await askSecret(ctx, '(current) UNIX password: ');
      if (oldPw == null || !users.checkPassword(sys, target, oldPw)) {
        await sleep(ctx, 1500);
        ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n');
        ctx.out('passwd: Authentication failure\n');
        return 10;
      }
    }
  }
  const retries = Math.max(1, users.pwqualitySettings(sys)?.retry || 3);
  let pw = null;
  for (let attempt = 0; attempt < (ctx.isRoot ? 1 : retries); attempt++) {
    const p1 = await askSecret(ctx, 'New password: ');
    if (p1 == null) { ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 10; }
    const bad = users.passwordQuality(sys, target, p1, oldPw);
    if (bad) {
      ctx.out(`BAD PASSWORD: ${bad}\n`);
      if (!ctx.isRoot || p1 === '') { if (attempt === retries - 1 || ctx.isRoot) { ctx.err('passwd: Have exhausted maximum number of retries for service\npasswd: password unchanged\n'); return 10; } continue; }
    } else if (p1.length === 0) { continue; }
    if (!ctx.isRoot && users.passwordWasUsed(sys, target, p1)) { ctx.out('Password has been already used. Choose another.\n'); if (attempt === retries - 1) { ctx.err('passwd: Have exhausted maximum number of retries for service\npasswd: password unchanged\n'); return 10; } continue; }
    const p2 = await askSecret(ctx, 'Retype new password: ');
    if (p2 == null || p1 !== p2) { ctx.out('Sorry, passwords do not match.\n'); if (attempt === retries - 1 || ctx.isRoot) { ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 10; } continue; }
    pw = p1; break;
  }
  if (pw == null) { ctx.err('passwd: Have exhausted maximum number of retries for service\npasswd: password unchanged\n'); return 10; }
  users.recordOldPassword(sys, target);
  users.setPassword(sys, target, pw);
  sys.log('auth.log', 'passwd', `pam_unix(passwd:chauthtok): password changed for ${target}`, ctx.sh.pid);
  ctx.out('passwd: password updated successfully\n');
  return 0;
}, { usage: 'passwd [options] [LOGIN]' });

// ---------------------------------------------------------------- group tools
cmd('groupadd', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'rf', val: 'g', long: { gid: { key: 'g', val: true }, system: 'r', force: 'f' } });
  if (err) return usageError(ctx, err);
  if (!ctx.isRoot) { ctx.err('groupadd: Permission denied.\ngroupadd: cannot lock /etc/group; try again later.\n'); return 1; }
  if (rest.length !== 1) { ctx.err('Usage: groupadd [options] GROUP\n'); return 2; }
  try { users.groupAdd(ctx.sys, rest[0], { gid: o.g != null ? Number(o.g) : undefined, system: !!o.r }); } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  return 0;
});
cmd('groupdel', (ctx) => {
  if (!ctx.isRoot) { ctx.err('groupdel: Permission denied.\ngroupdel: cannot lock /etc/group; try again later.\n'); return 1; }
  if (ctx.args.length !== 1) { ctx.err('Usage: groupdel [options] GROUP\n'); return 2; }
  try { users.groupDel(ctx.sys, ctx.args[0]); } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  return 0;
});
cmd('groupmod', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { val: 'gn', long: { 'new-name': { key: 'n', val: true }, gid: { key: 'g', val: true } } });
  if (err) return usageError(ctx, err);
  if (!ctx.isRoot) { ctx.err('groupmod: Permission denied.\ngroupmod: cannot lock /etc/group; try again later.\n'); return 1; }
  const gs = users.readGroups(ctx.sys); const g = gs.find((x) => x.name === rest[0]);
  if (!g) { ctx.err(`groupmod: group '${rest[0]}' does not exist\n`); return 6; }
  if (o.n) g.name = o.n; if (o.g) g.gid = Number(o.g);
  users.writeGroups(ctx.sys, gs); return 0;
});
cmd('gpasswd', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { val: 'adAM', bool: 'r' });
  if (err) return usageError(ctx, err);
  const group = rest[rest.length - 1];
  if (!group) { ctx.err('Usage: gpasswd [option] GROUP\n'); return 2; }
  if (!ctx.isRoot) { ctx.err('gpasswd: Permission denied.\n'); return 1; }
  const g = users.getGroup(ctx.sys, group);
  if (!g) { ctx.err(`gpasswd: group '${group}' does not exist in /etc/group\n`); return 3; }
  if (o.a) {
    if (!users.getUser(ctx.sys, o.a)) { ctx.err(`gpasswd: user '${o.a}' does not exist\n`); return 3; }
    users.addMember(ctx.sys, group, o.a); ctx.out(`Adding user ${o.a} to group ${group}\n`); return 0;
  }
  if (o.d) {
    if (!g.members.includes(o.d)) { ctx.err(`gpasswd: user '${o.d}' is not a member of '${group}'\n`); return 3; }
    users.removeMember(ctx.sys, group, o.d); ctx.out(`Removing user ${o.d} from group ${group}\n`); return 0;
  }
  if (o.M != null) { users.setMembers(ctx.sys, group, o.M.split(',').filter(Boolean)); return 0; }
  return 0;
});

// ---------------------------------------------------------------- useradd / userdel / usermod
const needRoot = (ctx, name) => { if (ctx.isRoot) return false; ctx.err(`${name}: Permission denied.\n${name}: cannot lock /etc/passwd; try again later.\n`); return true; };

cmd('useradd', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'mMNrUD', val: 'dsgGucpekfK', long: { 'create-home': 'm', 'no-create-home': 'M', 'no-user-group': 'N', system: 'r', home: { key: 'd', val: true }, 'home-dir': { key: 'd', val: true }, shell: { key: 's', val: true }, gid: { key: 'g', val: true }, groups: { key: 'G', val: true }, uid: { key: 'u', val: true }, comment: { key: 'c', val: true }, password: { key: 'p', val: true }, 'user-group': 'U', defaults: 'D', expiredate: { key: 'e', val: true }, 'no-log-init': 'l' } });
  if (err) return usageError(ctx, err);
  if (o.D) { ctx.out('GROUP=100\nHOME=/home\nINACTIVE=-1\nEXPIRE=\nSHELL=/bin/sh\nSKEL=/etc/skel\nCREATE_MAIL_SPOOL=no\n'); return 0; }
  if (needRoot(ctx, 'useradd')) return 1;
  if (rest.length !== 1) { ctx.err('Usage: useradd [options] LOGIN\n       useradd -D\n       useradd -D [options]\n'); return 2; }
  const sys = ctx.sys;
  const name = rest[0];
  let gid;
  if (o.g != null) {
    const g = users.getGroup(sys, o.g) || (/^\d+$/.test(o.g) ? users.getGroupByGid(sys, Number(o.g)) : null);
    if (!g) { ctx.err(`useradd: group '${o.g}' does not exist\n`); return 6; }
    gid = g.gid;
  }
  const groups = o.G ? o.G.split(',').filter(Boolean) : [];
  for (const g of groups) if (!users.getGroup(sys, g)) { ctx.err(`useradd: group '${g}' does not exist\n`); return 6; }
  if (o.s && !users.loginShells(sys).has(o.s) && o.s !== '/usr/sbin/nologin' && o.s !== '/bin/false') { /* useradd accepts any shell string */ }
  try {
    let uid = o.u != null ? Number(o.u) : undefined;
    const r = users.userAdd(sys, { name, uid, gid: o.N && gid == null ? 100 : gid, groups, gecos: o.c ?? '', home: o.d, shell: o.s ?? (o.r ? '/usr/sbin/nologin' : '/bin/sh'), system: !!o.r, hash: o.p, createHome: !!o.m && !o.M, nonUnique: false });
    void r;
    if (o.m && o.d && !sys.vfs.exists(o.d)) { /* createHome handled by userAdd */ }
  } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  sys.log('auth.log', 'useradd', `new user: name=${name}, UID=${users.getUser(sys, name).uid}, GID=${users.getUser(sys, name).gid}, home=${users.getUser(sys, name).home}, shell=${users.getUser(sys, name).shell}, from=${TTY}`, ctx.sh.pid);
  return 0;
}, { usage: 'useradd [options] LOGIN' });

cmd('userdel', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'rfZ', long: { remove: 'r', force: 'f' } });
  if (err) return usageError(ctx, err);
  if (needRoot(ctx, 'userdel')) return 1;
  if (rest.length !== 1) { ctx.err('Usage: userdel [options] LOGIN\n'); return 2; }
  try { users.userDel(ctx.sys, rest[0], { removeHome: !!o.r, force: !!o.f }); } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  ctx.sys.log('auth.log', 'userdel', `delete user '${rest[0]}'`, ctx.sh.pid);
  return 0;
});

cmd('usermod', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'aLUm', val: 'GgsdlceupU'.replace('U', ''), long: { append: 'a', groups: { key: 'G', val: true }, gid: { key: 'g', val: true }, shell: { key: 's', val: true }, home: { key: 'd', val: true }, login: { key: 'l', val: true }, lock: 'L', unlock: 'U', comment: { key: 'c', val: true }, 'move-home': 'm', expiredate: { key: 'e', val: true }, uid: { key: 'u', val: true }, password: { key: 'p', val: true } } });
  if (err) return usageError(ctx, err);
  if (needRoot(ctx, 'usermod')) return 1;
  if (rest.length !== 1) { ctx.err('Usage: usermod [options] LOGIN\n'); return 2; }
  const sys = ctx.sys; const name = rest[0];
  const ch = {};
  if (o.G != null) {
    const gs = o.G.split(',').filter(Boolean);
    for (const g of gs) if (!users.getGroup(sys, g)) { ctx.err(`usermod: group '${g}' does not exist\n`); return 6; }
    if (o.a) ch.appendGroups = gs; else ch.setGroups = gs;
  } else if (o.a) { ctx.err('usermod: option -a requires option -G\n'); return 2; }
  if (o.g != null) { const g = users.getGroup(sys, o.g) || (/^\d+$/.test(o.g) ? users.getGroupByGid(sys, Number(o.g)) : null); if (!g) { ctx.err(`usermod: group '${o.g}' does not exist\n`); return 6; } ch.gid = g.gid; }
  if (o.s != null) ch.shell = o.s;
  if (o.d != null) { ch.home = o.d; ch.move = !!o.m; }
  if (o.l != null) ch.newName = o.l;
  if (o.c != null) ch.gecos = o.c;
  if (o.u != null) ch.uid = Number(o.u);
  if (o.L) ch.lock = true;
  if (o.U) ch.unlock = true;
  if (o.e != null) {
    if (o.e === '' || o.e === '-1') ch.expire = '';
    else if (/^\d+$/.test(o.e)) ch.expire = o.e;
    else { const ms = Date.parse(o.e); if (Number.isNaN(ms)) { ctx.err(`usermod: invalid date '${o.e}'\n`); return 1; } ch.expire = daysSinceEpoch(ms); }
  }
  try {
    if (ch.newName && users.processesOf(sys, name).some((p) => p.cmd && !p.cmd.startsWith('['))) { ctx.err(`usermod: user ${name} is currently used by process ${users.processesOf(sys, name)[0].pid}\n`); return 8; }
    users.userMod(sys, name, ch);
    if (o.p != null) users.setHash(sys, ch.newName || name, o.p);
  } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code; } throw e; }
  return 0;
}, { usage: 'usermod [options] LOGIN' });

// ---------------------------------------------------------------- chage / chpasswd
cmd('chage', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'l', val: 'mMWIEd', long: { list: 'l', mindays: { key: 'm', val: true }, maxdays: { key: 'M', val: true }, warndays: { key: 'W', val: true }, inactive: { key: 'I', val: true }, expiredate: { key: 'E', val: true }, lastday: { key: 'd', val: true } } });
  if (err) return usageError(ctx, err);
  const target = rest[0];
  if (!target) { ctx.err('Usage: chage [options] LOGIN\n'); return 2; }
  if (!ctx.isRoot && !(o.l && target === ctx.user)) { ctx.err(`chage: Permission denied\n`); return 1; }
  if (!users.getUser(ctx.sys, target)) { ctx.err(`chage: user '${target}' does not exist\n`); return 1; }
  const s = users.getShadow(ctx.sys, target);
  if (o.l) {
    const dt = (days) => { const d = new Date(Number(days) * 86400000); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}`; };
    const last = s.lastchg === '0' ? 'password must be changed' : s.lastchg === '' ? 'never' : dt(s.lastchg);
    const max = s.max === '' || Number(s.max) >= 99999 ? null : Number(s.max);
    const expires = max == null || s.lastchg === '' ? 'never' : dt(Number(s.lastchg) + max);
    const inactive = s.inactive === '' || max == null ? 'never' : dt(Number(s.lastchg) + max + Number(s.inactive));
    ctx.out(`Last password change\t\t\t\t\t: ${last}\nPassword expires\t\t\t\t\t: ${expires}\nPassword inactive\t\t\t\t\t: ${inactive}\nAccount expires\t\t\t\t\t\t: ${s.expire === '' ? 'never' : dt(s.expire)}\nMinimum number of days between password change\t\t: ${s.min || 0}\nMaximum number of days between password change\t\t: ${s.max || 99999}\nNumber of days of warning before password expires\t: ${s.warn || 7}\n`);
    return 0;
  }
  const d = {};
  if (o.m != null) d.min = Number(o.m);
  if (o.M != null) d.max = Number(o.M);
  if (o.W != null) d.warn = Number(o.W);
  if (o.I != null) d.inactive = Number(o.I);
  if (o.E != null) d.expire = /^-?\d+$/.test(o.E) ? Number(o.E) : daysSinceEpoch(Date.parse(o.E));
  if (o.d != null) d.lastchg = /^\d+$/.test(o.d) ? Number(o.d) : daysSinceEpoch(Date.parse(o.d));
  users.chage(ctx.sys, target, d);
  return 0;
});

cmd('chpasswd', async (ctx) => {
  const { o, err } = parseOpts(ctx.args, { bool: 'e', long: { encrypted: 'e' } });
  if (err) return usageError(ctx, err);
  if (!ctx.isRoot) { ctx.err('chpasswd: Permission denied.\nchpasswd: cannot lock /etc/passwd; try again later.\n'); return 1; }
  const text = await ctx.stdinText();
  let n = 0; let rc = 0;
  for (const l of text.split('\n').filter(Boolean)) {
    n++;
    const i = l.indexOf(':');
    if (i < 0) { ctx.err(`chpasswd: line ${n}: missing new password\nchpasswd: error detected, changes ignored\n`); return 1; }
    const user = l.slice(0, i); const pw = l.slice(i + 1);
    if (!users.getUser(ctx.sys, user)) { ctx.err(`chpasswd: (user '${user}' does not exist)\nchpasswd: (line ${n}, user ${user}) password not changed\n`); rc = 1; continue; }
    if (o.e) users.setHash(ctx.sys, user, pw); else users.setPassword(ctx.sys, user, pw);
    ctx.sys.log('auth.log', 'chpasswd', `pam_unix(chpasswd:chauthtok): password changed for ${user}`, ctx.sh.pid);
  }
  return rc;
});

// ---------------------------------------------------------------- adduser / deluser / addgroup / delgroup (Debian front ends)
const BAD_NAME = "adduser: To avoid problems, the username should consist only of letters, digits, underscores, periods, at signs and dashes, and not start with a dash (as defined by your administrator via NAME_REGEX).\nadduser: Please enter a username matching the regular expression configured\nvia the NAME_REGEX[_SYSTEM] configuration variable.  Use the `--force-badname'\noption to relax this check or reconfigure NAME_REGEX.\n";
const NAME_REGEX = /^[a-z][-a-z0-9_]*\$?$/;

cmd(['adduser', 'addgroup'], async (ctx) => {
  const isGroup = ctx.name === 'addgroup';
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'q', val: '', long: { system: 's', group: 'g', 'disabled-password': 'dp', 'disabled-login': 'dl', quiet: 'q', 'no-create-home': 'nch', 'force-badname': 'fb', gecos: { key: 'gecos', val: true }, home: { key: 'home', val: true }, shell: { key: 'shell', val: true }, uid: { key: 'uid', val: true }, gid: { key: 'gid', val: true }, ingroup: { key: 'ingroup', val: true }, 'add_extra_groups': 'x', 'extrausers': 'x', conf: { key: 'conf', val: true }, 'firstuid': { key: 'x1', val: true }, 'lastuid': { key: 'x2', val: true }, 'encrypt-home': 'x' } });
  if (err) return usageError(ctx, err);
  const sys = ctx.sys;
  if (!ctx.isRoot) { ctx.err(`${ctx.name}: Only root may add a user or group to the system.\n`); return 1; }
  const out = (s) => { if (!o.q) ctx.out(s); };
  // adduser USER GROUP
  if (!isGroup && rest.length === 2 && !o.g && !o.s) {
    const [u, g] = rest;
    if (!users.getUser(sys, u)) { ctx.err(`adduser: The user \`${u}' does not exist.\n`); return 1; }
    if (!users.getGroup(sys, g)) { ctx.err(`adduser: The group \`${g}' does not exist.\n`); return 1; }
    if (users.getGroup(sys, g).members.includes(u)) { ctx.out(`The user \`${u}' is already a member of \`${g}'.\n`); return 0; }
    out(`Adding user \`${u}' to group \`${g}' ...\n`);
    users.addMember(sys, g, u);
    out('Done.\n');
    return 0;
  }
  if (rest.length !== 1) { ctx.err(`${ctx.name}: Only one or two names allowed.\n`); return 1; }
  const name = rest[0];
  if (isGroup || o.g) {
    if (!o.fb && !NAME_REGEX.test(name)) { ctx.err(BAD_NAME.replace('username', 'groupname').replace(/adduser:/g, 'addgroup:')); return 1; }
    if (users.getGroup(sys, name)) { ctx.err(`addgroup: The group \`${name}' already exists.\n`); return 1; }
    const gid = o.gid != null ? Number(o.gid) : users.nextGid(sys, { system: !!o.s });
    users.groupAdd(sys, name, { gid, system: !!o.s });
    out(`Adding group \`${name}' (GID ${gid}) ...\nDone.\n`);
    return 0;
  }
  if (!o.fb && !NAME_REGEX.test(name)) { ctx.err(BAD_NAME); return 1; }
  if (users.getUser(sys, name)) { ctx.err(`adduser: The user \`${name}' already exists.\n`); return 1; }
  const system = !!o.s;
  const uid = o.uid != null ? Number(o.uid) : users.nextUid(sys, { system });
  if (users.getUserByUid(sys, uid)) { ctx.err(`adduser: The UID ${uid} is already in use.\n`); return 1; }
  out(`Adding ${system ? 'system ' : ''}user \`${name}' ...\n`);
  let gid; let groupExisted = false;
  if (o.ingroup) {
    const g = users.getGroup(sys, o.ingroup);
    if (!g) { ctx.err(`adduser: The group \`${o.ingroup}' does not exist.\n`); return 1; }
    gid = g.gid; groupExisted = true;
  } else if (users.getGroup(sys, name)) {
    ctx.err(`adduser: The group \`${name}' already exists.\n`); return 1;
  } else {
    gid = system ? users.nextGid(sys, { system: true }) : (users.getGroupByGid(sys, uid) ? users.nextGid(sys) : uid);
    out(`Adding new group \`${name}' (${gid}) ...\n`);
    users.groupAdd(sys, name, { gid, system });
  }
  const home = o.home ?? (system ? `/home/${name}` : `/home/${name}`);
  out(`Adding new user \`${name}' (${uid}) with group \`${groupExisted ? o.ingroup : name}' ...\n`);
  users.userAdd(sys, { name, uid, gid, home, shell: o.shell ?? (system ? '/usr/sbin/nologin' : '/bin/bash'), system, gecos: '', createHome: false, password: undefined });
  if (!o.nch) {
    out(`Creating home directory \`${home}' ...\n`);
    out("Copying files from `/etc/skel' ...\n");
    users.createHome(sys, { name, uid, gid, home });
    try { sys.vfs.chmod(home, 0o750); } catch { /* keep default */ }
  }
  sys.log('auth.log', 'useradd', `new user: name=${name}, UID=${uid}, GID=${gid}, home=${home}, shell=${o.shell ?? '/bin/bash'}, from=${TTY}`, ctx.sh.pid);
  if (system) { out('Done.\n'); return 0; }
  let gecos = o.gecos ?? null;
  if (o.dp || o.dl) {
    // password stays locked
  } else {
    // prompt for a password, up to three attempts
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      const p1 = await askSecret(ctx, 'New password: ');
      if (p1 == null) { ctx.err('adduser: `/usr/bin/passwd bob\' exited from signal 15. Exiting.\n'.replace('bob', name)); users.userDel(sys, name, { removeHome: true, force: true }); return 1; }
      const bad = users.passwordQuality(sys, name, p1, null);
      if (bad) { ctx.out(`BAD PASSWORD: ${bad}\n`); if (i === 2) { ctx.err('passwd: Have exhausted maximum number of retries for service\npasswd: password unchanged\nNow `passwd bob\' will be called again:\n'.replace(/bob/g, name)); } continue; }
      const p2 = await askSecret(ctx, 'Retype new password: ');
      if (p1 !== p2) { ctx.out('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\nTry again? [y/N] '); const a = await askLine(ctx, ''); if (!a || !/^y/i.test(a)) { ctx.err(`adduser: \`/usr/bin/passwd ${name}' exited with status 10. Exiting.\n`); return 1; } i = -1; continue; }
      users.setPassword(sys, name, p1);
      ctx.out('passwd: password updated successfully\n');
      ok = true;
    }
    if (!ok) { ctx.err(`adduser: \`/usr/bin/passwd ${name}' exited from signal 15. Exiting.\n`); return 1; }
  }
  if (gecos == null && !o.dp && !o.dl) {
    ctx.out(`Changing the user information for ${name}\nEnter the new value, or press ENTER for the default\n`);
    const fields = [];
    for (const f of ['Full Name', 'Room Number', 'Work Phone', 'Home Phone', 'Other']) { const a = await askLine(ctx, `\t${f} []: `); fields.push(a ?? ''); }
    const ok = await askLine(ctx, 'Is the information correct? [Y/n] ');
    gecos = ok && /^n/i.test(ok) ? '' : fields.join(',').replace(/,+$/, '') + (fields.some(Boolean) ? '' : '');
    if (fields.some(Boolean)) gecos = fields.join(',');
    users.userMod(sys, name, { gecos });
  } else if (gecos != null) users.userMod(sys, name, { gecos: gecos.replace(/,+$/, '') });
  return 0;
}, { usage: 'adduser [--home DIR] [--shell SHELL] [--no-create-home] [--uid ID] [--firstuid ID] [--lastuid ID] [--ingroup GROUP | --gid ID] [--disabled-password] [--disabled-login] [--gecos GECOS] [--add_extra_groups] [--encrypt-home] user' });

cmd(['deluser', 'delgroup'], (ctx) => {
  const isGroup = ctx.name === 'delgroup';
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'q', long: { group: 'g', 'remove-home': 'rh', 'remove-all-files': 'raf', 'backup': 'b', system: 's', 'only-if-empty': 'oie', quiet: 'q' } });
  if (err) return usageError(ctx, err);
  const sys = ctx.sys;
  if (!ctx.isRoot) { ctx.err(`${ctx.name}: Only root may remove a user or group from the system.\n`); return 1; }
  const out = (s) => { if (!o.q) ctx.out(s); };
  if (!isGroup && !o.g && rest.length === 2) {
    const [u, g] = rest;
    if (!users.getUser(sys, u)) { ctx.err(`deluser: The user \`${u}' does not exist.\n`); return 1; }
    const grp = users.getGroup(sys, g);
    if (!grp) { ctx.err(`deluser: The group \`${g}' does not exist.\n`); return 1; }
    if (!grp.members.includes(u)) { ctx.err(`deluser: The user \`${u}' is not a member of group \`${g}'.\n`); return 1; }
    out(`Removing user \`${u}' from group \`${g}' ...\nDone.\n`);
    users.removeMember(sys, g, u);
    return 0;
  }
  if (rest.length !== 1) { ctx.err(`${ctx.name}: Only one or two names allowed.\n`); return 1; }
  const name = rest[0];
  if (isGroup || o.g) {
    const g = users.getGroup(sys, name);
    if (!g) { ctx.err(`${ctx.name}: The group \`${name}' does not exist.\n`); return 1; }
    const prim = users.readPasswd(sys).find((u) => u.gid === g.gid);
    if (prim) { ctx.err(`${ctx.name}: \`${name}' still has \`${prim.name}' as their primary group!\n`); return 1; }
    if (o.oie && g.members.length) { ctx.err(`${ctx.name}: Group \`${name}' is not empty!\n`); return 1; }
    out(`Removing group \`${name}' ...\n`);
    users.groupDel(sys, name);
    out('Done.\n');
    return 0;
  }
  const u = users.getUser(sys, name);
  if (!u) { ctx.err(`deluser: The user \`${name}' does not exist.\n`); return 1; }
  if (u.uid === 0) { ctx.err("WARNING: You are just about to delete the root account (uid 0)\nUsually this is never required as it may render the whole system unusable\nIf you really want this, call deluser with parameter --force\n(but this `deluser' does not allow `--force', haha)\nStopping now without having performed any action\n"); return 1; }
  const procs = users.processesOf(sys, name).filter((p) => p.cmd && !p.cmd.startsWith('['));
  if (procs.length) { ctx.err(`userdel: user ${name} is currently used by process ${procs[0].pid}\n/usr/sbin/deluser: \`/usr/sbin/userdel ${name}' returned error code 8. Exiting.\n`); return 8; }
  if (o.rh || o.raf) out("Looking for files to backup/remove ...\nRemoving files ...\n");
  out(`Removing user \`${name}' ...\n`);
  const primary = users.getGroupByGid(sys, u.gid);
  users.userDel(sys, name, { removeHome: !!(o.rh || o.raf) });
  if (primary && primary.name === name) out(`Warning: group \`${name}' has no more members.\n`);
  out('Done.\n');
  sys.log('auth.log', 'userdel', `delete user '${name}'`, ctx.sh.pid);
  return 0;
});

// ---------------------------------------------------------------- authentication helpers
export function sudoersDefaults(sys) {
  const text = sudoersText(sys);
  const d = { authenticate: true, timeout: 15, requirePw: true };
  for (const l of text.split('\n')) {
    const m = /^\s*Defaults\s+(.*)$/.exec(l.replace(/\s+#.*$/, ''));
    if (!m || m[1].includes(':') && /^\S+\s*:/.test(m[1])) continue;
    for (const item of m[1].split(',').map((x) => x.trim())) {
      if (item === '!authenticate') d.authenticate = false;
      if (item === 'authenticate') d.authenticate = true;
      const t = /^timestamp_timeout\s*=\s*(-?[\d.]+)/.exec(item);
      if (t) d.timeout = Number(t[1]);
    }
  }
  return d;
}

function authLog(ctx, program, msg) { ctx.sys.log('auth.log', program, msg, ctx.sh.pid); }

// ---------------------------------------------------------------- su
cmd('su', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'lmpP', val: 'csg', long: { login: 'l', command: { key: 'c', val: true }, shell: { key: 's', val: true }, 'preserve-environment': 'm' } });
  // "su -" means login
  const args = ctx.args.slice();
  let login = false;
  const idx = args.indexOf('-');
  if (idx >= 0) { login = true; args.splice(idx, 1); }
  const p2 = parseOpts(args, { bool: 'lmpP', val: 'csg', long: { login: 'l', command: { key: 'c', val: true }, shell: { key: 's', val: true }, 'preserve-environment': 'm' } });
  if (p2.err) return usageError(ctx, p2.err);
  void o; void rest; void err;
  const opt = p2.o;
  login = login || !!opt.l;
  const target = p2.rest[0] ?? 'root';
  const sys = ctx.sys;
  const entry = users.getUser(sys, target);
  const caller = ctx.user;
  if (!entry) { ctx.err('su: user ' + target + ' does not exist or the user entry does not contain all the required fields\n'); return 1; }
  if (caller !== 'root') {
    const pw = ctx.stdin && opt.c !== undefined && false ? null : await askSecret(ctx, 'Password: ');
    if (pw == null || !users.checkPassword(sys, target, pw)) {
      await sleep(ctx, 2000);
      ctx.err('su: Authentication failure\n');
      authLog(ctx, 'su', `pam_unix(su:auth): authentication failure; logname=${ctx.sh.frames[0].user} uid=${ctx.cred.uid} euid=0 tty=/dev/${TTY} ruser=${caller} rhost=  user=${target}`);
      return 1;
    }
  }
  const shell = opt.s || entry.shell || '/bin/sh';
  if (caller !== 'root' || true) {
    if (!opt.s && /nologin$|\/bin\/false$/.test(shell)) {
      if (caller !== 'root' || true) { ctx.out('This account is currently not available.\n'); return 1; }
    }
  }
  const sh = ctx.sh;
  authLog(ctx, 'su', `(to ${target}) ${caller} on ${TTY}`);
  authLog(ctx, 'su', `pam_unix(su:session): session opened for user ${target}(uid=${entry.uid}) by ${sh.frames[0].user}(uid=${ctx.cred.uid})`);
  if (opt.c !== undefined) {
    const st = await sh.runScriptAs(opt.c, ctx.stdio, target);
    authLog(ctx, 'su', `pam_unix(su:session): session closed for user ${target}`);
    return st;
  }
  if (login) sh.pushFrame(target, { login: true });
  else sh.pushFrame(target, { cwd: sh.cwd, keepEnv: { ...sh.env } });
  sh.frame.suFrom = caller;
  return 0;
}, { usage: 'su [options] [-] [USER [argument...]]' });

// ---------------------------------------------------------------- sudo
function sudoUsage(ctx) {
  ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command]\nusage: sudo [-ABbEHkNnPS] [-r role] [-t type] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command]\nusage: sudo -e [-ABkNnS] [-r role] [-t type] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] file ...\n');
  return 1;
}

function parseRunas(r) {
  const [u, g] = r.split(':').map((x) => x.trim());
  return { users: (u || 'root').split(',').map((x) => x.trim()), groups: g ? g.split(',').map((x) => x.trim()) : [] };
}

function cmdAllowed(ctx, policy, targetUser, path) {
  for (const r of policy.rules) {
    const ru = parseRunas(r.runas);
    if (!(ru.users.includes('ALL') || ru.users.includes(targetUser))) continue;
    const list = r.cmds.split(/\s*,\s*/).map((c) => c.trim().replace(/^!/, (m) => m));
    let ok = false;
    for (const c of list) {
      if (c.startsWith('!')) { if (c.slice(1).trim().split(/\s+/)[0] === path) ok = false; continue; }
      if (c === 'ALL' || c.split(/\s+/)[0] === path || (c.endsWith('/*') && path.startsWith(c.slice(0, -1)))) ok = true;
    }
    if (ok) return r;
  }
  return null;
}

cmd('sudo', async (ctx) => {
  const sys = ctx.sys;
  const user = ctx.user;
  const argv = ctx.args;
  const o = { u: null, g: null };
  let i = 0;
  const flags = new Set();
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i++; break; }
    if (!a.startsWith('-') || a === '-') break;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'login') flags.add('i'); else if (k === 'shell') flags.add('s'); else if (k === 'list') flags.add('l'); else if (k === 'validate') flags.add('v'); else if (k === 'reset-timestamp') flags.add('k'); else if (k === 'remove-timestamp') flags.add('K'); else if (k === 'non-interactive') flags.add('n'); else if (k === 'stdin') flags.add('S'); else if (k === 'version') flags.add('V'); else if (k === 'help') flags.add('h'); else if (k.startsWith('user=')) o.u = k.slice(5); else if (k === 'user') o.u = argv[++i]; else if (k.startsWith('group=')) o.g = k.slice(6); else if (['preserve-env', 'set-home', 'background', 'edit'].includes(k) || k.startsWith('preserve-env=')) { if (k === 'edit') flags.add('e'); } else { ctx.err(`sudo: unrecognized option '${a}'\n`); return sudoUsage(ctx); }
      continue;
    }
    let j = 1;
    for (; j < a.length; j++) {
      const c = a[j];
      if (c === 'u' || c === 'g' || c === 'p' || c === 'C' || c === 'D' || c === 'h' && false || c === 'r' || c === 't' || c === 'T' || c === 'U' || c === 'R') {
        const v = a.slice(j + 1) || argv[++i];
        if (v == null) { ctx.err(`sudo: option requires an argument -- '${c}'\n`); return sudoUsage(ctx); }
        if (c === 'u') o.u = v; else if (c === 'g') o.g = v; else if (c === 'U') o.U = v; else if (c === 'p') o.prompt = v;
        break;
      }
      if ('AbEHiKklnPsSVvBNe'.includes(c)) flags.add(c);
      else if (c === 'h') flags.add('h');
      else { ctx.err(`sudo: invalid option -- '${c}'\n`); return sudoUsage(ctx); }
    }
  }
  const command = argv.slice(i);
  if (flags.has('V')) { ctx.out('Sudo version 1.9.9\nSudoers policy plugin version 1.9.9\nSudoers file grammar version 48\nSudoers I/O plugin version 1.9.9\nSudoers audit plugin version 1.9.9\n'); return 0; }
  if (flags.has('h')) return sudoUsage(ctx);
  const defaults = sudoersDefaults(sys);
  if (flags.has('K')) { delete sys.sudoTs[user]; return 0; }
  if (flags.has('k') && !command.length && !flags.has('l') && !flags.has('v')) { delete sys.sudoTs[user]; return 0; }
  if (flags.has('k')) delete sys.sudoTs[user];
  if (!flags.has('l') && !flags.has('v') && !flags.has('i') && !flags.has('s') && !command.length) return sudoUsage(ctx);

  const policy = users.sudoPolicy(sys, user);
  const rootNow = ctx.cred.uid === 0 && ctx.sh.frames[0].user === 'root';
  void rootNow;
  const target = o.u ? (o.u.startsWith('#') ? (users.getUserByUid(sys, Number(o.u.slice(1)))?.name ?? null) : o.u) : 'root';
  if (target == null || !(target === 'root' || users.getUser(sys, target))) { ctx.err(`sudo: unknown user ${o.u}\n`); return 1; }

  // ---- authentication
  const now = sys.now();
  const cached = sys.sudoTs[user] != null && defaults.timeout !== 0 && (defaults.timeout < 0 || now - sys.sudoTs[user] < defaults.timeout * 60000);
  const skipPw = !defaults.authenticate || (policy.nopasswd && policy.allowed) || cached;
  const sudoLog = (msg) => authLog(ctx, 'sudo', msg);
  const cwd = ctx.sh.cwd;
  if (!skipPw) {
    if (flags.has('n')) { ctx.err('sudo: a password is required\n'); return 1; }
    let ok = false;
    for (let tries = 0; tries < 3; tries++) {
      let pw;
      if (flags.has('S')) pw = ctx.readLine();
      else pw = await askSecret(ctx, o.prompt ?? `[sudo] password for ${user}: `);
      if (pw == null) { ctx.err('sudo: no password was provided\n'); ctx.err('sudo: a password is required\n'); return 1; }
      if (users.checkPassword(sys, user, pw)) { ok = true; break; }
      await sleep(ctx, 1200);
      if (tries < 2) ctx.err('Sorry, try again.\n');
      else { ctx.err('sudo: 3 incorrect password attempts\n'); sudoLog(`pam_unix(sudo:auth): authentication failure; logname=${ctx.sh.frames[0].user} uid=${ctx.cred.uid} euid=0 tty=/dev/${TTY} ruser=${user} rhost=  user=${user}`); sudoLog(`${user} : 3 incorrect password attempts ; TTY=${TTY} ; PWD=${cwd} ; USER=${target} ; COMMAND=${command.join(' ') || '(shell)'}`); }
    }
    if (!ok) return 1;
  }
  if (!policy.allowed) {
    ctx.err(`${user} is not in the sudoers file.  This incident will be reported.\n`);
    sudoLog(`${user} : user NOT in sudoers ; TTY=${TTY} ; PWD=${cwd} ; USER=${target} ; COMMAND=${command.join(' ') || '(shell)'}`);
    return 1;
  }
  if (defaults.authenticate && !policy.nopasswd) sys.sudoTs[user] = now; else if (cached) sys.sudoTs[user] = now;
  if (flags.has('v')) return 0;

  if (flags.has('l')) {
    ctx.out(`Matching Defaults entries for ${user} on ${sys.hostname}:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin, use_pty\n\nUser ${user} may run the following commands on ${sys.hostname}:\n`);
    for (const r of policy.rules) {
      const tags = r.tags.filter((t) => t === 'NOPASSWD' || t === 'PASSWD').map((t) => t + ': ').join('');
      const ru = r.runas.includes(':') ? r.runas : `${r.runas} : ${r.runas === 'ALL' ? 'ALL' : r.runas}`.replace(/^ALL : ALL$/, 'ALL : ALL');
      ctx.out(`    (${r.runas.includes(':') ? r.runas.replace(/\s*:\s*/, ' : ') : ru}) ${tags}${r.cmds}\n`);
    }
    if (command.length) {
      const path = command[0];
      const allowed = cmdAllowed(ctx, policy, target, path.startsWith('/') ? path : (ctx.sh.whichPath ? ctx.sh.whichPath(path) : path));
      if (!allowed) return 1;
      ctx.out(command.join(' ') + '\n');
    }
    return 0;
  }

  // ---- command resolution & policy for commands
  let resolved = null;
  if (command.length) {
    const nm = command[0];
    resolved = nm.startsWith('/') ? nm : null;
    if (!resolved) {
      for (const d of DEFAULT_PATH.split(':')) { if (sys.vfs.isFile(`${d}/${nm}`) || sys.vfs.isFile(`${d}/${nm}`, {})) { resolved = `${d}/${nm}`; break; } }
    }
    if (!policy.full) {
      const r = cmdAllowed(ctx, policy, target, resolved || nm);
      if (!r) {
        ctx.err(`Sorry, user ${user} is not allowed to execute '${command.join(' ')}' as ${target} on ${sys.hostname}.\n`);
        sudoLog(`${user} : command not allowed ; TTY=${TTY} ; PWD=${cwd} ; USER=${target} ; COMMAND=${command.join(' ')}`);
        return 1;
      }
    }
  } else if (!policy.full && !cmdAllowed(ctx, policy, target, '/bin/bash')) {
    ctx.err(`Sorry, user ${user} is not allowed to execute '${ctx.env.SHELL || '/bin/bash'}' as ${target} on ${sys.hostname}.\n`);
    return 1;
  }
  const tuid = target === 'root' ? 0 : users.getUser(sys, target).uid;
  sudoLog(`${user} : TTY=${TTY} ; PWD=${cwd} ; USER=${target} ; COMMAND=${resolved || command.join(' ') || '/bin/bash'}${command.length > 1 ? ' ' + command.slice(1).join(' ') : ''}`);
  sudoLog(`pam_unix(sudo:session): session opened for user ${target}(uid=${tuid}) by ${ctx.sh.frames[0].user}(uid=${ctx.cred.uid})`);
  const sh = ctx.sh;
  const closed = () => sudoLog(`pam_unix(sudo:session): session closed for user ${target}`);

  if (flags.has('i') || flags.has('s')) {
    if (!command.length) {
      if (flags.has('i')) sh.pushFrame(target, { login: true });
      else sh.pushFrame(target, { cwd: sh.cwd, keepEnv: { ...sh.env, SUDO_USER: user, SUDO_UID: String(ctx.cred.uid), SUDO_GID: String(ctx.cred.gid), SUDO_COMMAND: '/bin/bash' } });
      sh.frame.sudoFrom = user;
      return 0;
    }
    const st = await sh.runScriptAs(command.join(' '), ctx.stdio, target);
    closed();
    return st;
  }
  if (flags.has('e')) { const st = await ctx.exec(['sudoedit-internal', ...command], ctx.stdio, { asUser: target }); closed(); return st; }
  const st = await ctx.exec(command, ctx.stdio, { asUser: target, env: { SUDO_USER: user, SUDO_UID: String(ctx.cred.uid), SUDO_GID: String(ctx.cred.gid), SUDO_COMMAND: resolved || command[0] } });
  closed();
  return st;
}, { usage: 'sudo [options] [command]', noHelp: true });

// ---------------------------------------------------------------- visudo
cmd('visudo', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'cqsV', val: 'fx', long: { check: 'c', file: { key: 'f', val: true }, quiet: 'q', strict: 's', version: 'V' } });
  if (err) return usageError(ctx, err);
  if (o.V) { ctx.out('visudo version 1.9.9\n'); return 0; }
  const path = o.f || '/etc/sudoers';
  void rest;
  const validate = (text) => {
    const errs = [];
    text.split('\n').forEach((raw, idx) => {
      const l = raw.replace(/\s+#.*$/, '').trim();
      if (!l || l.startsWith('#') && !/^#(include|includedir)\b/.test(l)) return;
      if (/^(Defaults|User_Alias|Runas_Alias|Host_Alias|Cmnd_Alias|[#@]include|[#@]includedir)\b/.test(l)) return;
      if (/^\S+\s+\S+\s*=\s*(\([^)]*\))?\s*.+$/.test(l)) return;
      errs.push(`>>> ${path}: syntax error near line ${idx + 1} <<<`);
    });
    return errs;
  };
  if (o.c) {
    let t; try { t = ctx.fs.readFile(path); } catch (e) { if (e instanceof FsError) { ctx.err(`visudo: unable to open ${path}: ${e.text}\n`); return 1; } throw e; }
    const e = validate(t);
    if (e.length) { for (const l of e) ctx.out(l + '\n'); return 1; }
    ctx.out(`${path}: parsed OK\n`);
    return 0;
  }
  if (!ctx.isRoot) { ctx.err('visudo: /etc/sudoers: Permission denied\n'); return 1; }
  let text = ctx.fs.readFile(path);
  for (;;) {
    const res = await ctx.term.editor({ path, text, kind: 'nano', title: `${path}.tmp`, sudoers: true });
    if (res == null) { ctx.out('visudo: no changes made\n'); return 0; }
    const errs = validate(res);
    if (!errs.length) { ctx.fs.writeFile(path, res); try { ctx.sys.vfs.chmod(path, 0o440); } catch { /* ignore */ } return 0; }
    for (const l of errs) ctx.out(l + '\n');
    ctx.out('What now? ');
    const a = await askLine(ctx, '');
    if (a === 'Q' || a === 'q') return 1;
    text = res;
  }
});

// ---------------------------------------------------------------- crontab
const CRON_HEADER = '# Edit this file to introduce tasks to be run by cron.\n# \n# Each task to run has to be defined through a single line\n# indicating with different fields when the task will be run\n# and what command to run for the task\n# \n# To define the time you can provide concrete values for\n# minute (m), hour (h), day of month (dom), month (mon),\n# and day of week (dow) or use \'*\' in these fields (for \'any\').\n# \n# Notice that tasks will be started based on the cron\'s system\n# daemon\'s notion of time and timezones.\n# \n# Output of the crontab jobs (including errors) is sent through\n# email to the user the crontab file belongs to (unless redirected).\n# \n# For example, you can run a backup of all your user accounts\n# at 5 a.m every week with:\n# 0 5 * * 1 tar -zcf /var/backups/home.tgz /home/\n# \n# For more information see the manual pages of crontab(5) and cron(8)\n# \n# m h  dom mon dow   command\n';

function cronAllowed(sys, user) {
  const v = sys.vfs;
  if (user === 'root') return true;
  if (v.exists('/etc/cron.allow')) return v.readFile('/etc/cron.allow').split('\n').map((s) => s.trim()).includes(user);
  if (v.exists('/etc/cron.deny')) return !v.readFile('/etc/cron.deny').split('\n').map((s) => s.trim()).includes(user);
  return true;
}

function validateCrontab(text) {
  const bad = [];
  text.split('\n').forEach((raw, idx) => {
    const l = raw.trim();
    if (!l || l.startsWith('#') || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) return;
    if (/^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)\s+\S+/.test(l)) return;
    const f = l.split(/\s+/);
    if (f.length < 6) { bad.push(`"/tmp/crontab.XXXXXX":${idx + 1}: bad minute`); return; }
    const re = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(,\d+)+|\d+-\d+\/\d+)$/;
    const names = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
    for (let k = 0; k < 5; k++) if (!re.test(f[k]) && !/^[A-Za-z]{3}(,[A-Za-z]{3})*$/.test(f[k])) { bad.push(`"/tmp/crontab.XXXXXX":${idx + 1}: bad ${names[k]}`); return; }
  });
  return bad;
}

cmd('crontab', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'lreiv', val: 'u' });
  if (err) { ctx.err(`crontab: invalid option -- '${err.slice(-2, -1)}'\ncrontab: usage error: unrecognized option\nusage:\tcrontab [-u user] file\n\tcrontab [-u user] [-i] { -e | -l | -r }\n\t\t(default operation is replace, per 1003.2)\n\t-e\t(edit user's crontab)\n\t-l\t(list user's crontab)\n\t-r\t(delete user's crontab)\n\t-i\t(prompt before deleting user's crontab)\n`); return 1; }
  const sys = ctx.sys;
  const target = o.u ?? ctx.user;
  if (o.u && !ctx.isRoot) { ctx.err(`must be privileged to use -u\n`); return 1; }
  if (!users.getUser(sys, target)) { ctx.err(`crontab: user \`${target}' unknown\n`); return 1; }
  if (!cronAllowed(sys, ctx.user)) { ctx.err(`You (${ctx.user}) are not allowed to use this program (crontab)\nSee crontab(1) for more information\n`); return 1; }
  const path = userCrontabPath(target);
  const entry = users.getUser(sys, target);
  const write = (text) => {
    if (!sys.vfs.isDir('/var/spool/cron/crontabs')) sys.vfs.mkdir('/var/spool/cron/crontabs', { parents: true, mode: 0o1730, gid: users.getGroup(sys, 'crontab')?.gid ?? 0 });
    sys.vfs.writeFile(path, text, { mode: 0o600, uid: entry.uid, gid: users.getGroup(sys, 'crontab')?.gid ?? entry.gid });
    sys.touch('cron');
  };
  if (o.l) {
    if (!sys.vfs.exists(path)) { ctx.err(`no crontab for ${target}\n`); return 1; }
    ctx.out(sys.vfs.readFile(path));
    return 0;
  }
  if (o.r) {
    if (!sys.vfs.exists(path)) { ctx.err(`no crontab for ${target}\n`); return 1; }
    sys.vfs.unlink(path); sys.touch('cron');
    return 0;
  }
  if (o.e) {
    let text; let fresh = false;
    if (sys.vfs.exists(path)) text = sys.vfs.readFile(path); else { ctx.err(`no crontab for ${target} - using an empty one\n`); text = CRON_HEADER; fresh = true; }
    void fresh;
    const home = entry.home;
    if (!sys.vfs.exists(`${home}/.selected_editor`) && ctx.tty) {
      ctx.out('\nSelect an editor.  To change later, run \'select-editor\'.\n\n  1. /bin/nano        <---- easiest\n  2. /usr/bin/vim.basic\n  3. /usr/bin/vim.tiny\n  4. /bin/ed\n\n');
      const a = await askLine(ctx, 'Choose 1-4 [1]: ');
      const choice = { 1: '/bin/nano', 2: '/usr/bin/vim.basic', 3: '/usr/bin/vim.tiny', 4: '/bin/ed' }[(a || '1').trim()] || '/bin/nano';
      try { sys.vfs.writeFile(`${home}/.selected_editor`, `# Generated by /usr/bin/select-editor\nSELECTED_EDITOR="${choice}"\n`, { uid: entry.uid, gid: entry.gid }); } catch { /* ignore */ }
    }
    for (;;) {
      const res = await ctx.term.editor({ path: `/tmp/crontab.${Math.random().toString(36).slice(2, 8)}/crontab`, text, kind: 'nano', title: `/tmp/crontab.XXXXXX/crontab` });
      if (res == null) { ctx.err('No modification made\n'); return 0; }
      const bad = validateCrontab(res);
      if (!bad.length) { write(res); ctx.err('crontab: installing new crontab\n'); return 0; }
      for (const b of bad) ctx.err(b + '\n');
      ctx.err("errors in crontab file, can't install.\n");
      const a = await askLine(ctx, 'Do you want to retry the same edit? (y/n) ');
      if (!a || !/^y/i.test(a)) { ctx.err('crontab: edits left in /tmp/crontab.XXXXXX\n'); return 1; }
      text = res;
    }
  }
  if (rest.length) {
    let text;
    try { text = ctx.fs.readFile(ctx.resolve(rest[0])); } catch (e) { if (e instanceof FsError) { ctx.err(`${rest[0]}: ${e.text}\n`); return 1; } throw e; }
    const bad = validateCrontab(text);
    if (bad.length) { for (const b of bad) ctx.err(b.replace('/tmp/crontab.XXXXXX', rest[0]) + '\n'); ctx.err("errors in crontab file, can't install.\n"); return 1; }
    write(text); return 0;
  }
  // crontab with no args reads stdin
  const text = await ctx.stdinText();
  write(text);
  return 0;
}, { usage: 'crontab [-u user] file | [-u user] { -e | -l | -r }' });

cmd('select-editor', (ctx) => { ctx.out('\nSelect an editor.  To change later, run \'select-editor\'.\n\n  1. /bin/nano        <---- easiest\n  2. /usr/bin/vim.basic\n  3. /usr/bin/vim.tiny\n  4. /bin/ed\n\n'); return 0; });

export { cronEntries };
