// Account management and privilege commands.
import { def } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import * as users from '../../core/users.js';
import { getopt, needRoot, lines, padR } from './util.js';
import { fmtDate, daysSinceEpoch } from '../../core/util.js';

const SUDO_TTL = 15 * 60 * 1000;

// ------------------------------------------------------------------ sudo / su
async function authenticate(ctx, who, promptText, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const pw = await ctx.io.prompt(promptText, { silent: true });
    if (pw === null || pw === undefined) return false;
    if (users.checkPassword(ctx.sys, who, pw)) return true;
    if (i < tries - 1) ctx.err('Sorry, try again.\n');
  }
  return false;
}

def('sudo', async (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'iskvlbHnESAhV', withArg: 'uCgpTU', stopAtOperand: true, long: { login: 'i', shell: 's', user: ['u', true], 'reset-timestamp': 'k', list: 'l', validate: 'v', 'non-interactive': 'n' } });
  const sys = ctx.sys; const me = ctx.shell.euser;
  if (opts.V) { ctx.out('Sudo version 1.9.9\nSudoers policy plugin version 1.9.9\n'); return 0; }
  if (opts.k) { delete sys.sudoTs[me]; if (!rest.length && !opts.i && !opts.s) return 0; }
  const policy = users.sudoPolicy(sys, me);
  const target = opts.u || 'root';
  if (me !== 'root') {
    if (!policy.allowed) {
      sys.log('auth.log', 'sudo', `    ${me} : user NOT in sudoers ; TTY=pts/0 ; PWD=${ctx.shell.cwd} ; USER=${target} ; COMMAND=${rest.join(' ')}`);
      if (!(await authenticate(ctx, me, `[sudo] password for ${me}: `))) { ctx.err('sudo: 3 incorrect password attempts\n'); return 1; }
      ctx.err(`${me} is not in the sudoers file.  This incident will be reported.\n`);
      return 1;
    }
    const fresh = sys.sudoTs[me] && ctx.now() - sys.sudoTs[me] < SUDO_TTL;
    if (!policy.nopasswd && !fresh) {
      if (opts.n) { ctx.err('sudo: a password is required\n'); return 1; }
      if (!(await authenticate(ctx, me, `[sudo] password for ${me}: `))) { ctx.err('sudo: 3 incorrect password attempts\n'); sys.log('auth.log', 'sudo', `    ${me} : 3 incorrect password attempts ; TTY=pts/0 ; PWD=${ctx.shell.cwd} ; USER=${target} ; COMMAND=${rest.join(' ')}`); return 1; }
      sys.sudoTs[me] = ctx.now();
    } else sys.sudoTs[me] = ctx.now();
  }
  if (opts.v) return 0;
  if (!users.getUser(sys, target)) { ctx.err(`sudo: unknown user ${target}\n`); return 1; }
  if (opts.l) {
    ctx.out(`Matching Defaults entries for ${me} on ${sys.hostname}:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin, use_pty\n\nUser ${me} may run the following commands on ${sys.hostname}:\n`);
    for (const r of policy.rules) ctx.out(`    (${r.runas.includes(':') ? r.runas : r.runas + ' : ALL'}) ${r.tags.map((t) => t + ': ').join('')}${r.cmds}\n`);
    return 0;
  }
  sys.log('auth.log', 'sudo', `${me.padStart(me.length + 4)} : TTY=pts/0 ; PWD=${ctx.shell.cwd} ; USER=${target} ; COMMAND=${rest.join(' ') || '/bin/bash'}`);
  const sh = ctx.shell;
  if (opts.i || opts.s) {
    if (!rest.length) { sh.pushUser(target, { login: !!opts.i, keepEnv: !opts.i }); return 0; }
    const saved = { user: sh.euser, cwd: sh.cwd };
    sh.pushUser(target, { login: !!opts.i, keepEnv: !opts.i });
    try { return await ctx.run(rest.join(' ')); } finally { sh.popUser(); sh.cwd = saved.cwd; }
  }
  if (!rest.length) { ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-knS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-knS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command]\nusage: sudo [-bEHknPS] [-r role] [-t type] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i|-s] [<command>]\n'); return 1; }
  const prevUser = sh.euser; const prevHome = sh.vars.get('HOME'); const prevUserVar = sh.vars.get('USER');
  sh.euser = target; sh.vars.set('USER', target); sh.vars.set('HOME', users.getUser(sys, target).home);
  try { return await ctx.exec(rest, { tty: ctx.tty, stdin: ctx.stdin }); } finally { sh.euser = prevUser; sh.vars.set('HOME', prevHome); sh.vars.set('USER', prevUserVar); }
});
def('sudoedit', (ctx) => ctx.exec(['sudo', 'nano', ...ctx.args]));

def('su', async (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lmpsh', withArg: 'cs', long: { login: 'l', command: ['c', true] } });
  let args = [...rest]; let login = !!opts.l;
  if (args[0] === '-') { login = true; args.shift(); }
  const target = args[0] || 'root';
  if (!users.getUser(ctx.sys, target)) { ctx.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`); return 1; }
  if (ctx.uid !== 0) {
    const pw = await ctx.io.prompt('Password: ', { silent: true });
    if (pw === null || !users.checkPassword(ctx.sys, target, pw)) {
      await new Promise((r) => setTimeout(r, 0));
      ctx.err('su: Authentication failure\n');
      ctx.sys.log('auth.log', 'su', `FAILED SU (to ${target}) ${ctx.user} on pts/0`);
      return 1;
    }
  }
  ctx.sys.log('auth.log', 'su', `(to ${target}) ${ctx.user} on pts/0`);
  const sh = ctx.shell;
  if (opts.c) { sh.pushUser(target, { login }); try { return await ctx.run(opts.c); } finally { sh.popUser(); } }
  sh.pushUser(target, { login });
  return 0;
});

// ------------------------------------------------------------------ passwd & friends
async function readNewPassword(ctx, user, { isRoot, checkOld = null }) {
  const sys = ctx.sys; let attempts = 0;
  for (;;) {
    const pw = await ctx.io.prompt('New password: ', { silent: true });
    if (pw === null) throw new CmdError('passwd: Authentication token manipulation error\npasswd: password unchanged', 10);
    let bad = users.passwordQuality(sys, user, pw, checkOld);
    if (!bad && pw !== '' && users.passwordWasUsed(sys, user, pw)) bad = 'Password has been already used. Choose another.';
    if (bad && !(isRoot && !bad.startsWith('Password has been'))) {
      const msg = bad.startsWith('Password has been') ? bad : `BAD PASSWORD: ${bad}`;
      ctx.err(msg + '\n');
      if (++attempts >= 3) throw new CmdError('passwd: Have exhausted maximum number of retries for service\npasswd: password unchanged', 10);
      continue;
    }
    if (bad) ctx.err(`BAD PASSWORD: ${bad}\n`);
    const again = await ctx.io.prompt('Retype new password: ', { silent: true });
    if (again !== pw) throw new CmdError('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged', 10);
    return pw;
  }
}

def('passwd', async (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lusdeSaq', withArg: 'nxwiNE', long: { lock: 'l', unlock: 'u', delete: 'd', expire: 'e', status: 'S' } });
  const sys = ctx.sys; const user = rest[0] || ctx.user;
  const entry = users.getUser(sys, user);
  if (opts.S) {
    if (ctx.uid !== 0 && user !== ctx.user) throw new CmdError(`passwd: You may not view or modify password information for ${user}.`, 1);
    const sh = users.getShadow(sys, user); if (!entry || !sh) throw new CmdError(`passwd: user '${user}' does not exist`, 1);
    const d = sh.lastchg && sh.lastchg !== '0' ? new Date(Number(sh.lastchg) * 86400000) : null;
    const date = d ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}` : '01/01/1970';
    ctx.out(`${user} ${users.passwordState(sh)} ${date} ${sh.min || 0} ${sh.max || 99999} ${sh.warn || 7} ${sh.inactive || -1}\n`);
    return 0;
  }
  if (ctx.uid !== 0 && user !== ctx.user) throw new CmdError(`passwd: You may not view or modify password information for ${user}.`, 1);
  if (!entry) throw new CmdError(`passwd: user '${user}' does not exist`, 1);
  if (opts.l || opts.u || opts.d || opts.e) {
    needRoot(ctx, 'passwd: Permission denied.');
    if (opts.l) users.lockPassword(sys, user); else if (opts.u) users.unlockPassword(sys, user); else if (opts.d) users.deletePassword(sys, user); else users.expirePassword(sys, user);
    ctx.out(opts.d ? `passwd: password expiry information changed.\n` : 'passwd: password expiry information changed.\n');
    return 0;
  }
  ctx.out(`Changing password for ${user}.\n`);
  let old = null;
  if (ctx.uid !== 0) {
    old = await ctx.io.prompt('Current password: ', { silent: true });
    if (old === null || !users.checkPassword(sys, user, old)) { ctx.err('passwd: Authentication token manipulation error\npasswd: password unchanged\n'); return 10; }
  }
  const pw = await readNewPassword(ctx, user, { isRoot: ctx.uid === 0, checkOld: old });
  users.recordOldPassword(sys, user);
  users.setPassword(sys, user, pw);
  sys.log('auth.log', 'passwd', `pam_unix(passwd:chauthtok): password changed for ${user}`);
  ctx.out('passwd: password updated successfully\n');
  return 0;
});

def('chpasswd', (ctx) => {
  needRoot(ctx, 'chpasswd: Permission denied.');
  const { opts } = getopt(ctx, ctx.args, { flags: 'em' });
  let code = 0; let n = 0;
  for (const l of lines(ctx.stdin)) {
    const i = l.indexOf(':'); if (i < 0) { ctx.err(`chpasswd: line ${n + 1}: missing new password\n`); code = 1; continue; }
    const u = l.slice(0, i); const pw = l.slice(i + 1); n++;
    if (!users.getUser(ctx.sys, u)) { ctx.err(`chpasswd: (user '${u}' does not exist)\nchpasswd: (line ${n}, user ${u}) password not changed\n`); code = 1; continue; }
    users.recordOldPassword(ctx.sys, u);
    if (opts.e) users.setHash(ctx.sys, u, pw); else users.setPassword(ctx.sys, u, pw);
  }
  return code;
});

const asked = async (ctx, q, def = '') => { const a = await ctx.io.prompt(q, {}); return a === null || a === '' ? def : a; };

def(['adduser', 'addgroup'], async (ctx) => {
  const isGroup = ctx.name === 'addgroup';
  const { opts, rest } = getopt(ctx, ctx.args, { flags: '', withArg: '', long: { 'disabled-password': 'dp', 'disabled-login': 'dl', gecos: ['gecos', true], ingroup: ['ingroup', true], group: 'group', home: ['home', true], shell: ['shell', true], uid: ['uid', true], gid: ['gid', true], system: 'system', quiet: 'quiet', 'no-create-home': 'nch', 'add_extra_groups': 'x' } });
  const sys = ctx.sys;
  if (ctx.uid !== 0) throw new CmdError(`${ctx.name}: Only root may add a user or group to the system.`, 1);
  if (!rest.length) throw new CmdError(`${ctx.name}: Only one or two names allowed.`, 1);
  if (isGroup || opts.group) {
    const name = rest[0];
    ctx.out(`Adding group \`${name}' (GID ${users.nextGid(sys, { system: !!opts.system })}) ...\n`);
    users.groupAdd(sys, name, { gid: opts.gid ? Number(opts.gid) : undefined, system: !!opts.system });
    ctx.out('Done.\n'); return 0;
  }
  if (rest.length === 2) {
    const [u, g] = rest;
    if (!users.getUser(sys, u)) throw new CmdError(`adduser: The user \`${u}' does not exist.`, 1);
    if (!users.getGroup(sys, g)) throw new CmdError(`adduser: The group \`${g}' does not exist.`, 1);
    ctx.out(`Adding user \`${u}' to group \`${g}' ...\n`); users.addMember(sys, g, u); ctx.out('Done.\n'); return 0;
  }
  const name = rest[0];
  if (users.getUser(sys, name)) throw new CmdError(`adduser: The user \`${name}' already exists.`, 1);
  if (!users.validName(name)) throw new CmdError(`adduser: To avoid problems, the username should consist only of letters, digits, underscores, periods, at signs and dashes, and not start with a dash (as defined by your administrator in NAME_REGEX).\nadduser: Please enter a username matching the regular expression configured\nvia the NAME_REGEX[_SYSTEM] configuration variable.  Use the \`--force-badname'\noption to relax this check or reconfigure NAME_REGEX.`, 1);
  const uid = opts.uid ? Number(opts.uid) : users.nextUid(sys, { system: !!opts.system });
  const grp = opts.ingroup ? users.getGroup(sys, opts.ingroup) : null;
  ctx.out(`Adding ${opts.system ? 'system ' : ''}user \`${name}' ...\n`);
  if (!grp) ctx.out(`Adding new group \`${name}' (${uid}) ...\n`);
  ctx.out(`Adding new user \`${name}' (${uid}) with group \`${grp ? grp.name : name}' ...\n`);
  const home = opts.home || (opts.system ? `/var/lib/${name}` : `/home/${name}`);
  ctx.out(`Creating home directory \`${home}' ...\nCopying files from \`/etc/skel' ...\n`);
  let pw = null;
  if (!opts.dp && !opts.dl) {
    for (let tries = 0; ; tries++) {
      const a = await ctx.io.prompt('New password: ', { silent: true }); const b = await ctx.io.prompt('Retype new password: ', { silent: true });
      if (a === b) { pw = a; break; }
      ctx.err('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\nTry again? [y/N] ');
      const again = await ctx.io.prompt('', {}); if (!/^y/i.test(again || '')) { ctx.out('\n'); break; }
    }
  }
  users.userAdd(sys, { name, uid, gid: grp?.gid, gecos: '', home, shell: opts.shell || '/bin/bash', password: pw ?? undefined, system: !!opts.system, createHome: !opts.nch });
  if (pw !== null) ctx.out('passwd: password updated successfully\n');
  let gecos = opts.gecos ?? null;
  if (gecos === null && !opts.dp && !opts.dl) {
    ctx.out(`Changing the user information for ${name}\nEnter the new value, or press ENTER for the default\n`);
    const full = await asked(ctx, '\tFull Name []: '); const room = await asked(ctx, '\tRoom Number []: '); const wp = await asked(ctx, '\tWork Phone []: '); const hp = await asked(ctx, '\tHome Phone []: '); const other = await asked(ctx, '\tOther []: ');
    const ok = await asked(ctx, 'Is the information correct? [Y/n] ', 'y');
    if (/^y/i.test(ok)) gecos = [full, room, wp, hp, other].join(',');
  }
  if (gecos !== null) users.userMod(sys, name, { gecos });
  if (opts.dp || opts.dl) users.lockPassword(sys, name);
  return 0;
});

def('useradd', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'mMrNUk', withArg: 'sGgudcpfe', long: { 'create-home': 'm', shell: ['s', true], groups: ['G', true], gid: ['g', true], uid: ['u', true], home: ['d', true], 'home-dir': ['d', true], comment: ['c', true], password: ['p', true], system: 'r', 'no-create-home': 'M', 'user-group': 'U', 'no-user-group': 'N' } });
  needRoot(ctx, 'useradd: Permission denied.');
  if (!rest.length) throw new CmdError("Usage: useradd [options] LOGIN\n       useradd -D\n       useradd -D [options]", 2);
  const sys = ctx.sys;
  let gid; if (opts.g !== undefined) { const g = /^\d+$/.test(opts.g) ? users.getGroupByGid(sys, Number(opts.g)) : users.getGroup(sys, opts.g); if (!g) throw new CmdError(`useradd: group '${opts.g}' does not exist`, 6); gid = g.gid; }
  const groups = opts.G ? opts.G.split(',') : []; for (const g of groups) if (!users.getGroup(sys, g)) throw new CmdError(`useradd: group '${g}' does not exist`, 6);
  users.userAdd(sys, { name: rest[0], uid: opts.u ? Number(opts.u) : undefined, gid, gecos: opts.c ?? '', home: opts.d, shell: opts.s, groups, hash: opts.p, system: !!opts.r, createHome: !!opts.m });
});
def('userdel', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'rfZ', long: { remove: 'r', force: 'f' } });
  needRoot(ctx, 'userdel: Permission denied.');
  if (!rest.length) throw new CmdError('Usage: userdel [options] LOGIN', 2);
  users.userDel(ctx.sys, rest[0], { removeHome: !!opts.r, force: !!opts.f });
  return 0;
});
def('deluser', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: '', long: { 'remove-home': 'rh', 'remove-all-files': 'raf', 'backup': 'b', group: 'group', quiet: 'q', 'system': 's', 'only-if-empty': 'oie' } });
  const sys = ctx.sys;
  if (ctx.uid !== 0) throw new CmdError('deluser: Only root may remove a user or group from the system.', 1);
  if (!rest.length) throw new CmdError('deluser: Only one or two names allowed.', 1);
  if (opts.group) { if (!users.getGroup(sys, rest[0])) throw new CmdError(`deluser: The group \`${rest[0]}' does not exist.`, 1); ctx.out(`Removing group \`${rest[0]}' ...\nDone.\n`); users.groupDel(sys, rest[0]); return 0; }
  if (rest.length === 2) {
    const [u, g] = rest;
    if (!users.getUser(sys, u)) throw new CmdError(`deluser: The user \`${u}' does not exist.`, 1);
    if (!users.getGroup(sys, g)) throw new CmdError(`deluser: The group \`${g}' does not exist.`, 1);
    if (!users.getGroup(sys, g).members.includes(u)) throw new CmdError(`deluser: The user \`${u}' is not a member of group \`${g}'.`, 1);
    ctx.out(`Removing user \`${u}' from group \`${g}' ...\nDone.\n`); users.removeMember(sys, g, u); return 0;
  }
  const name = rest[0];
  if (!users.getUser(sys, name)) throw new CmdError(`deluser: The user \`${name}' does not exist.`, 1);
  ctx.out(opts.rh || opts.raf ? 'Looking for files to backup/remove ...\n' : 'Removing user `' + name + "' ...\n");
  try { users.userDel(sys, name, { removeHome: !!(opts.rh || opts.raf) }); } catch (e) { if (e instanceof CmdError) throw new CmdError(`${e.message}\n/usr/sbin/deluser: \`/usr/sbin/userdel ${name}' returned error code ${e.code}. Exiting.`, 1); throw e; }
  if (opts.rh || opts.raf) ctx.out(`Removing files ...\nRemoving user \`${name}' ...\n`);
  ctx.out('Warning: group `' + name + "' has no more members.\nDone.\n");
  return 0;
});
def('usermod', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'aLUm', withArg: 'GgsldcuepE', long: { append: 'a', groups: ['G', true], shell: ['s', true], lock: 'L', unlock: 'U', login: ['l', true], home: ['d', true], comment: ['c', true], 'move-home': 'm', gid: ['g', true], uid: ['u', true], expiredate: ['e', true], password: ['p', true] } });
  needRoot(ctx, 'usermod: Permission denied.');
  if (!rest.length) throw new CmdError('Usage: usermod [options] LOGIN', 2);
  const sys = ctx.sys; const name = rest[0];
  const ch = {};
  if (opts.G !== undefined) { const gs = opts.G.split(',').filter(Boolean); for (const g of gs) if (!users.getGroup(sys, g)) throw new CmdError(`usermod: group '${g}' does not exist`, 6); if (opts.a) ch.appendGroups = gs; else ch.setGroups = gs; }
  if (opts.a && opts.G === undefined) throw new CmdError('usermod: option -a requires -G', 2);
  if (opts.s) ch.shell = opts.s; if (opts.c !== undefined) ch.gecos = opts.c; if (opts.d) { ch.home = opts.d; ch.move = !!opts.m; } if (opts.l) ch.newName = opts.l;
  if (opts.u) ch.uid = Number(opts.u); if (opts.g) { const g = /^\d+$/.test(opts.g) ? users.getGroupByGid(sys, Number(opts.g)) : users.getGroup(sys, opts.g); if (!g) throw new CmdError(`usermod: group '${opts.g}' does not exist`, 6); ch.gid = g.gid; }
  if (opts.L) ch.lock = true; if (opts.U) ch.unlock = true;
  if (opts.e !== undefined) ch.expire = opts.e === '' || opts.e === '-1' ? '' : /^\d+$/.test(opts.e) ? opts.e : String(daysSinceEpoch(Date.parse(opts.e)));
  users.userMod(sys, name, ch);
  if (opts.p) users.setHash(sys, ch.newName || name, opts.p);
  return 0;
});
def('groupadd', (ctx) => { const { opts, rest } = getopt(ctx, ctx.args, { flags: 'rf', withArg: 'g' }); needRoot(ctx, 'groupadd: Permission denied.'); if (!rest.length) throw new CmdError('Usage: groupadd [options] GROUP', 2); users.groupAdd(ctx.sys, rest[0], { gid: opts.g ? Number(opts.g) : undefined, system: !!opts.r }); });
def('groupdel', (ctx) => { needRoot(ctx, 'groupdel: Permission denied.'); users.groupDel(ctx.sys, ctx.args[0]); });
def('delgroup', (ctx) => ctx.exec(['deluser', '--group', ...ctx.args]));
def('groupmod', (ctx) => { needRoot(ctx, 'groupmod: Permission denied.'); });
def('gpasswd', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: '', withArg: 'adMArR' });
  needRoot(ctx, 'gpasswd: Permission denied.');
  const g = rest[0]; if (!g || !users.getGroup(ctx.sys, g)) throw new CmdError(`gpasswd: group '${g}' does not exist`, 3);
  if (opts.a) { if (!users.getUser(ctx.sys, opts.a)) throw new CmdError(`gpasswd: user '${opts.a}' does not exist`, 3); users.addMember(ctx.sys, g, opts.a); ctx.out(`Adding user ${opts.a} to group ${g}\n`); }
  else if (opts.d) { if (!users.getGroup(ctx.sys, g).members.includes(opts.d)) throw new CmdError(`gpasswd: user '${opts.d}' is not a member of '${g}'`, 3); users.removeMember(ctx.sys, g, opts.d); ctx.out(`Removing user ${opts.d} from group ${g}\n`); }
  else if (opts.M !== undefined) users.setMembers(ctx.sys, g, opts.M.split(',').filter(Boolean));
});
def('chage', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'l', withArg: 'MmWIEd', long: { list: 'l', maxdays: ['M', true], mindays: ['m', true] } });
  const sys = ctx.sys; const user = rest[0] || ctx.user;
  if (!users.getUser(sys, user)) throw new CmdError(`chage: user '${user}' does not exist`, 1);
  if (opts.l) {
    if (ctx.uid !== 0 && user !== ctx.user) throw new CmdError(`chage: Permission denied`, 1);
    const s = users.getShadow(sys, user); const fmt = (d) => (d === '' || d === undefined ? 'never' : fmtDate(Number(d) * 86400000).split(' ').slice(1, 4).join(' ').replace(/(\w+) (\d+) /, '$1 $2, '));
    const last = s.lastchg === '0' ? 'password must be changed' : fmt(s.lastchg);
    const exp = s.max && s.max !== '99999' && s.lastchg ? fmt(String(Number(s.lastchg) + Number(s.max))) : 'never';
    ctx.out(`Last password change\t\t\t\t\t: ${last}\nPassword expires\t\t\t\t\t: ${exp}\nPassword inactive\t\t\t\t\t: never\nAccount expires\t\t\t\t\t\t: ${s.expire ? fmt(s.expire) : 'never'}\nMinimum number of days between password change\t\t: ${s.min || 0}\nMaximum number of days between password change\t\t: ${s.max || 99999}\nNumber of days of warning before password expires\t: ${s.warn || 7}\n`);
    return 0;
  }
  needRoot(ctx, 'chage: Permission denied');
  const ch = {}; if (opts.M !== undefined) ch.max = opts.M; if (opts.m !== undefined) ch.min = opts.m; if (opts.W !== undefined) ch.warn = opts.W; if (opts.I !== undefined) ch.inactive = Number(opts.I); if (opts.E !== undefined) ch.expire = opts.E === '-1' ? -1 : /^\d+$/.test(opts.E) ? opts.E : daysSinceEpoch(Date.parse(opts.E)); if (opts.d !== undefined) ch.lastchg = opts.d;
  users.chage(sys, user, ch);
});

// ------------------------------------------------------------------ id / groups / who / last / getent
def('id', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'ugGnrZ', long: { user: 'u', group: 'g', groups: 'G', name: 'n' } });
  const name = rest[0] || ctx.user; const u = users.getUser(ctx.sys, name);
  if (!u) throw new CmdError(`id: ‘${name}’: no such user`, 1);
  const gs = users.userGroups(ctx.sys, name);
  const pr = users.getGroupByGid(ctx.sys, u.gid);
  if (opts.u) { ctx.out((opts.n ? name : u.uid) + '\n'); return 0; }
  if (opts.g) { ctx.out((opts.n ? pr?.name : u.gid) + '\n'); return 0; }
  if (opts.G) { ctx.out(gs.map((g) => (opts.n ? g.name : g.gid)).join(' ') + '\n'); return 0; }
  ctx.out(`uid=${u.uid}(${u.name}) gid=${u.gid}(${pr?.name ?? u.gid}) groups=${gs.map((g) => `${g.gid}(${g.name})`).join(',')}\n`);
});
def('groups', (ctx) => {
  const names = ctx.args.length ? ctx.args : [ctx.user];
  for (const n of names) { if (!users.getUser(ctx.sys, n)) throw new CmdError(`groups: ‘${n}’: no such user`, 1); const g = users.userGroups(ctx.sys, n).map((x) => x.name).join(' '); ctx.out(ctx.args.length ? `${n} : ${g}\n` : g + '\n'); }
});
const utmp = (sys, path) => (sys.vfs.isFile(path) ? lines(sys.vfs.readFile(path)).map((l) => { const [user, tty, host, at, kind] = l.split('\t'); return { user, tty, host, at: Number(at), kind }; }) : []);
const pad2 = (n) => String(n).padStart(2, '0');
const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
def(['who'], (ctx) => { for (const r of utmp(ctx.sys, '/var/run/utmp')) ctx.out(`${padR(r.user, 8)} ${padR(r.tty.replace(/^:0$/, ':0'), 12)} ${iso(r.at)} (${r.host})\n`); });
def('users', (ctx) => ctx.out(utmp(ctx.sys, '/var/run/utmp').map((r) => r.user).join(' ') + '\n'));
def('w', (ctx) => {
  const sys = ctx.sys; const up = Math.floor((ctx.now() - sys.bootTime) / 60000); const d = new Date(ctx.now());
  const rows = utmp(sys, '/var/run/utmp');
  ctx.out(` ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} up ${up} min,  ${rows.length} user${rows.length === 1 ? '' : 's'},  load average: 0.15, 0.15, 0.11\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n`);
  for (const r of rows) ctx.out(`${padR(r.user, 8)} ${padR(r.tty, 8)} ${padR(r.host, 16)} ${pad2(new Date(r.at).getHours())}:${pad2(new Date(r.at).getMinutes())}   ${'?xdm?'.padEnd(6)} 0.05s  0.02s cinnamon-session\n`);
});
def(['last', 'lastb'], (ctx) => {
  if (ctx.name === 'lastb') { if (ctx.uid !== 0) throw new CmdError('lastb: cannot open /var/log/btmp: Permission denied', 1); ctx.out('\nbtmp begins ' + fmtDate(ctx.sys.bootTime).split(' ').slice(0, 5).join(' ') + '\n'); return 0; }
  const rows = utmp(ctx.sys, '/var/log/wtmp').reverse(); const f = (ms) => fmtDate(ms).split(' ').slice(0, 4).join(' ').replace(/ (\d+:\d+).*/, '') ;
  for (const r of rows) {
    const t = new Date(r.at); const when = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()]} ${String(t.getDate()).padStart(2)} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
    if (r.kind === 'boot') ctx.out(`reboot   system boot  ${padR(r.host.slice(0, 15), 15)} ${when}   still running\n`);
    else ctx.out(`${padR(r.user, 8)} ${padR(r.tty, 12)} ${padR(r.host, 16)} ${when}   still logged in\n`);
  }
  void f;
  ctx.out(`\nwtmp begins ${fmtDate(ctx.sys.misc.image?.installAt ?? ctx.sys.bootTime).split(' ').slice(0, 5).join(' ').replace(/ \d+:\d+:\d+/, '')}\n`);
});
def('getent', (ctx) => {
  const [db, key] = ctx.args; const sys = ctx.sys; let found = false;
  if (db === 'passwd') for (const u of users.readPasswd(sys)) if (!key || u.name === key || String(u.uid) === key) { ctx.out([u.name, u.pw, u.uid, u.gid, u.gecos, u.home, u.shell].join(':') + '\n'); found = true; }
  if (db === 'group') for (const g of users.readGroups(sys)) if (!key || g.name === key || String(g.gid) === key) { ctx.out([g.name, g.pw, g.gid, g.members.join(',')].join(':') + '\n'); found = true; }
  if (db === 'shadow') { if (ctx.uid !== 0) return 2; for (const s of users.readShadow(sys)) if (!key || s.name === key) { ctx.out([s.name, s.hash, s.lastchg, s.min, s.max, s.warn, s.inactive, s.expire, s.reserved].join(':') + '\n'); found = true; } }
  if (db === 'hosts') { ctx.out('127.0.0.1       localhost\n'); found = true; }
  return found ? 0 : 2;
});
def('logname', (ctx) => ctx.out((ctx.shell.frames[0]?.user ?? ctx.user) + '\n'));
def('visudo', async (ctx) => {
  needRoot(ctx, 'visudo: /etc/sudoers: Permission denied');
  const p = '/etc/sudoers';
  await ctx.io.editor({ path: p, content: ctx.fs.readFile(p), title: 'GNU nano 6.2  /etc/sudoers.tmp', save: async (t) => { ctx.sys.vfs.writeFile(p, t); } });
});
export { SUDO_TTL };
