// systemctl, service, ufw, sysctl, crontab, apt, dpkg, editors and GUI launchers.
import { def } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as sv from '../../core/services.js';
import * as fw from '../../core/firewall.js';
import * as sc from '../../core/sysctl.js';
import { cronEntries, userCrontabPath } from '../../core/cron.js';
import { PACKAGES, SERVICES } from '../../images/catalog.js';
import { getopt, padL, padR, lines } from './util.js';

// ------------------------------------------------------------------ systemctl / service
const AUTH = (verb, unit) => new CmdError(`Failed to ${verb} ${unit}: Interactive authentication required.\nSee system logs and 'systemctl status ${unit}' for details.`, 1);
const unitName = (n) => (/\.(service|socket|target|timer)$/.test(n) ? n : n + '.service');

def('systemctl', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lqf', withArg: 't', long: { now: 'now', 'no-pager': 'np', 'no-legend': 'nl', type: ['t', true], state: ['state', true], all: 'all', full: 'l', quiet: 'q', user: 'user', system: 'system', 'no-ask-password': 'nap', force: 'f' } });
  const [verb, ...names] = rest; const sys = ctx.sys;
  if (!verb) { return ctx.exec(['systemctl', 'list-units']); }
  const mutating = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask', 'try-restart', 'reload-or-restart', 'daemon-reload', 'kill'];
  if (mutating.includes(verb) && ctx.uid !== 0) throw AUTH(verb === 'daemon-reload' ? 'reload daemon' : verb, names[0] ? unitName(names[0]) : '');
  const need = () => { if (!names.length) throw new CmdError('Too few arguments.', 1); };
  let code = 0;
  const each = (fn) => { for (const n of names) { try { fn(n); } catch (e) { if (e instanceof CmdError) { ctx.err(e.message + '\n'); code = 1; } else throw e; } } };
  switch (verb) {
    case 'start': need(); each((n) => sv.startUnit(sys, n)); break;
    case 'stop': need(); each((n) => sv.stopUnit(sys, n)); break;
    case 'restart': case 'try-restart': case 'reload-or-restart': need(); each((n) => sv.restartUnit(sys, n)); break;
    case 'reload': need(); each((n) => sv.reloadUnit(sys, n)); break;
    case 'enable': need(); each((n) => { for (const m of sv.enableUnit(sys, n)) ctx.err(m + '\n'); if (opts.now) sv.startUnit(sys, n); }); break;
    case 'disable': need(); each((n) => { for (const m of sv.disableUnit(sys, n)) ctx.err(m + '\n'); if (opts.now) sv.stopUnit(sys, n); }); break;
    case 'mask': need(); each((n) => { for (const m of sv.maskUnit(sys, n)) ctx.err(m + '\n'); if (opts.now) sv.stopUnit(sys, n); }); break;
    case 'unmask': need(); each((n) => { for (const m of sv.unmaskUnit(sys, n)) ctx.err(m + '\n'); }); break;
    case 'daemon-reload': break;
    case 'status': { need(); each((n) => { const r = sv.statusText(sys, n); (r.code === 4 ? ctx.err : ctx.out)(r.text); if (r.code) code = r.code; }); break; }
    case 'is-active': { need(); const c = sv.canonical(names[0]); const st = c && sys.svcState[c]; const v = st ? st.active : 'inactive'; if (!opts.q) ctx.out(v + '\n'); return v === 'active' ? 0 : 3; }
    case 'is-enabled': { need(); const c = sv.canonical(names[0]); const st = c && sys.svcState[c]; if (!st) { if (!opts.q) ctx.err(`Failed to get unit file state for ${unitName(names[0])}: No such file or directory\n`); return 1; } if (!opts.q) ctx.out(st.enabled + '\n'); return st.enabled === 'enabled' ? 0 : 1; }
    case 'is-failed': { need(); const c = sv.canonical(names[0]); const st = c && sys.svcState[c]; const v = st ? (st.active === 'failed' ? 'failed' : st.active) : 'inactive'; ctx.out(v + '\n'); return v === 'failed' ? 0 : 1; }
    case 'list-units': case 'list-unit-files': {
      const units = sv.listUnits(sys);
      if (verb === 'list-unit-files') { ctx.out('UNIT FILE                    STATE           VENDOR PRESET\n'); for (const u of units) ctx.out(`${padR(u.unit, 28)} ${padR(u.enabled, 15)} enabled\n`); ctx.out(`\n${units.length} unit files listed.\n`); return 0; }
      let list = units; if (opts.state === 'running') list = units.filter((u) => u.sub === 'running'); else if (opts.state === 'failed') list = units.filter((u) => u.active === 'failed'); else if (!opts.all) list = units.filter((u) => u.active !== 'inactive' || u.enabled === 'masked');
      const w = Math.max(...list.map((u) => u.unit.length), 4);
      ctx.out(`  ${padR('UNIT', w)} LOAD   ACTIVE SUB     DESCRIPTION\n`);
      for (const u of list) ctx.out(`  ${padR(u.unit, w)} ${padR(u.load, 6)} ${padR(u.active, 6)} ${padR(u.sub, 7)} ${u.desc}\n`);
      ctx.out(`\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n\n${list.length} loaded units listed.${opts.all ? '' : ' Pass --all to see loaded but inactive units, too.'}\nTo show all installed unit files use 'systemctl list-unit-files'.\n`);
      break;
    }
    case 'list-dependencies': case 'show': case 'cat': break;
    case 'get-default': ctx.out('graphical.target\n'); break;
    default: throw new CmdError(`Unknown command verb ${verb}.`, 1);
  }
  return code;
});

def('service', (ctx) => {
  const [a, b] = ctx.args;
  if (a === '--status-all') { for (const u of sv.listUnits(ctx.sys)) ctx.out(` [ ${u.active === 'active' ? '+' : '-'} ]  ${u.name}\n`); return 0; }
  if (!a || !b) throw new CmdError('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]', 1);
  if (!sv.canonical(a) || !sv.isRegistered(ctx.sys, a)) throw new CmdError(`${a}: unrecognized service`, 4);
  return ctx.exec(['systemctl', b === 'force-reload' ? 'reload' : b, a], { tty: ctx.tty });
});

// ------------------------------------------------------------------ ufw
def('ufw', async (ctx) => {
  const a = ctx.args.filter((x) => x !== '--dry-run'); const sys = ctx.sys;
  if (ctx.uid !== 0) throw new CmdError('ERROR: You need to be root to run this script', 1);
  const [cmd, ...r] = a;
  if (!cmd) throw new CmdError('ERROR: not enough args', 1);
  switch (cmd) {
    case 'status': { const v = r.includes('verbose'); const n = r.includes('numbered'); for (const l of fw.statusLines(sys, { verbose: v, numbered: n })) ctx.out(l + '\n'); return 0; }
    case 'enable': fw.ufwEnable(sys); ctx.out('Firewall is active and enabled on system startup\n'); return 0;
    case 'disable': fw.ufwDisable(sys); ctx.out('Firewall stopped and disabled on system startup\n'); return 0;
    case 'reload': if (!fw.ufwActive(sys)) throw new CmdError('Firewall not enabled (skipping reload)', 0); ctx.out('Firewall reloaded\n'); return 0;
    case 'allow': case 'deny': case 'reject': case 'limit': { for (const l of fw.addRule(sys, fw.parseRule(cmd, r))) ctx.out(l + '\n'); return 0; }
    case 'delete': {
      let which = r[0]; if (/^\d+$/.test(which || '')) which = Number(which); else { const act = r.shift(); which = fw.parseRule(act, r); }
      if (typeof which === 'number') { const ans = await ctx.io.prompt('Deleting:\n ' + (fw.displayRules(sys)[which - 1] ? fw.describeRule(fw.displayRules(sys)[which - 1].rule) : '') + '\nProceed with operation (y|n)? ', {}); if (!/^y/i.test(ans || '')) { ctx.out('Aborted\n'); return 0; } }
      for (const l of fw.deleteRule(sys, which)) ctx.out(l + '\n'); return 0;
    }
    case 'default': { const policy = r[0]; const dir = r[1] || 'incoming'; fw.setDefault(sys, dir, policy); ctx.out(`Default ${dir} policy changed to '${policy}'\n(be sure to update your rules accordingly)\n`); return 0; }
    case 'logging': { const lv = r[0]; if (!['on', 'off', 'low', 'medium', 'high', 'full'].includes(lv)) throw new CmdError('ERROR: Invalid logging level', 1); fw.setLogging(sys, lv === 'on' ? 'low' : lv); ctx.out(lv === 'off' ? 'Logging disabled\n' : 'Logging enabled\n'); return 0; }
    case 'reset': { const ans = await ctx.io.prompt('Resetting all rules to installed defaults. Proceed with operation (y|n)? ', {}); if (!/^y/i.test(ans || '')) { ctx.out('Aborted\n'); return 0; } fw.resetRules(sys); ctx.out('Resetting all rules to installed defaults. This may disrupt existing ssh\nconnections. Proceed with operation (y|n)? Backing up \'user.rules\' to \'/etc/ufw/user.rules.20261024_120000\'\n\n'); return 0; }
    case 'show': ctx.out(r[0] === 'added' ? (sys.ufw.rules.length ? 'Added user rules (see \'ufw status\' for running firewall):\n' + sys.ufw.rules.map((x) => 'ufw ' + fw.describeRule(x)).join('\n') + '\n' : 'Added user rules (see \'ufw status\' for running firewall):\n(None)\n') : ''); return 0;
    case 'version': ctx.out('ufw 0.36.1\nCopyright 2008-2021 Canonical Ltd.\n'); return 0;
    default: throw new CmdError(`ERROR: Invalid syntax\n\nUsage: ufw COMMAND\n\nCommands:\n enable                  enables the firewall\n disable                 disables the firewall\n default ARG             set default policy\n logging LEVEL           set logging to LEVEL\n allow ARGS              add allow rule\n deny ARGS               add deny rule\n reject ARGS             add reject rule\n limit ARGS              add limit rule\n delete RULE|NUM         delete RULE\n status                  show firewall status\n status numbered         show firewall status as numbered list of RULES\n status verbose          show verbose firewall status\n reset                   reset firewall`, 1);
  }
}, { bin: '/usr/sbin/ufw' });

// ------------------------------------------------------------------ sysctl
def('sysctl', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'anpwNeq', withArg: 'p', long: { system: 'system', all: 'a', write: 'w' } });
  const sys = ctx.sys;
  if (opts.system) {
    needRootSysctl(ctx);
    for (const f of sc.sysctlFiles(sys)) { ctx.out(`* Applying ${f} ...\n`); for (const [k, v] of sc.sysctlApply(sys, [f])) ctx.out(`${k} = ${v}\n`); }
    return 0;
  }
  if (opts.p !== undefined || ctx.args.includes('-p')) {
    needRootSysctl(ctx);
    const f = typeof opts.p === 'string' ? ctx.abs(opts.p) : '/etc/sysctl.conf';
    if (!sys.vfs.isFile(f)) throw new CmdError(`sysctl: cannot open "${f}": No such file or directory`, 255);
    for (const [k, v] of sc.sysctlApply(sys, [f])) ctx.out(`${k} = ${v}\n`);
    return 0;
  }
  if (opts.a || !rest.length) {
    if (!opts.a && !rest.length) throw new CmdError('sysctl: no variables specified\nTry `sysctl --help\' for more information.', 255);
    for (const k of Object.keys(sys.sysctl).sort()) ctx.out(`${k} = ${sys.sysctl[k]}\n`); return 0;
  }
  let code = 0;
  for (const item of rest) {
    const eq = item.indexOf('=');
    if (eq > 0) {
      const k = item.slice(0, eq); const v = item.slice(eq + 1);
      if (!(k in sys.sysctl)) { ctx.err(`sysctl: cannot stat /proc/sys/${k.replace(/\./g, '/')}: No such file or directory\n`); code = 255; continue; }
      if (ctx.uid !== 0) { ctx.err(`sysctl: permission denied on key '${k}'\n`); code = 255; continue; }
      sc.sysctlSet(sys, k, v); ctx.out(`${k} = ${v}\n`);
    } else if (item in sys.sysctl) ctx.out(opts.n ? sys.sysctl[item] + '\n' : `${item} = ${sys.sysctl[item]}\n`);
    else { ctx.err(`sysctl: cannot stat /proc/sys/${item.replace(/\./g, '/')}: No such file or directory\n`); code = 255; }
  }
  return code;
});
function needRootSysctl(ctx) { if (ctx.uid !== 0) throw new CmdError('sysctl: permission denied on key \'kernel.sysrq\'', 255); }

// ------------------------------------------------------------------ crontab
def('crontab', async (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lreivn', withArg: 'u' });
  const sys = ctx.sys; const target = opts.u || ctx.user;
  if (opts.u && ctx.uid !== 0) throw new CmdError(`must be privileged to use -u`, 1);
  if (!users.getUser(sys, target)) throw new CmdError(`crontab: user \`${target}' unknown`, 1);
  const path = userCrontabPath(target); const grp = users.getGroup(sys, 'crontab')?.gid ?? 0; const u = users.getUser(sys, target);
  if (opts.l) { if (!sys.vfs.isFile(path)) throw new CmdError(`no crontab for ${target}`, 1); ctx.out(sys.vfs.readFile(path)); return 0; }
  if (opts.r) { if (!sys.vfs.isFile(path)) throw new CmdError(`no crontab for ${target}`, 1); sys.vfs.unlink(path); return 0; }
  const save = async (t) => { sys.vfs.writeFile(path, t, { mode: 0o600, uid: u.uid, gid: grp }); sys.touch('cron'); };
  if (opts.e) {
    const cur = sys.vfs.isFile(path) ? sys.vfs.readFile(path) : '# Edit this file to introduce tasks to be run by cron.\n#\n# m h  dom mon dow   command\n';
    if (!sys.vfs.isFile(path)) ctx.out(`no crontab for ${target} - using an empty one\n`);
    await ctx.io.editor({ path: `/tmp/crontab.${target}`, content: cur, title: 'GNU nano 6.2  /tmp/crontab', save });
    ctx.out(`crontab: installing new crontab\n`);
    return 0;
  }
  if (rest[0]) { try { await save(ctx.fs.readFile(ctx.abs(rest[0]))); } catch (e) { if (e instanceof FsError) throw new CmdError(`${rest[0]}: ${e.text}`, 1); throw e; } return 0; }
  if (ctx.stdin) { await save(ctx.stdin); return 0; }
  return 0;
}, { bin: '/usr/bin/crontab' });
def('anacron', () => 0);
void cronEntries;

// ------------------------------------------------------------------ apt / dpkg
const LOCK_FRONTEND = new CmdError('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?', 100);
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} kB`);
const wrapNames = (names) => '  ' + names.join(' ').replace(/(.{1,76})(\s|$)/g, '$1\n  ').trim();
const status3 = (ctx) => ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
const sizeOf = (n) => PACKAGES[n]?.size ?? 100;

async function confirm(ctx, yes) { if (yes) { ctx.out('\n'); return true; } const a = await ctx.io.prompt('Do you want to continue? [Y/n] ', {}); return a === null ? false : a === '' || /^y/i.test(a); }

async function aptMain(ctx) {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'yqsfVdm', long: { yes: 'y', 'assume-yes': 'y', quiet: 'q', 'no-install-recommends': 'x', 'purge': 'purge', installed: 'installed', upgradable: 'upgradable', 'auto-remove': 'ar', 'allow-unauthenticated': 'x', 'fix-missing': 'x', reinstall: 'reinstall', simulate: 's', 'dry-run': 's', 'show-progress': 'x', 'ignore-missing': 'x' } });
  const [verb, ...names] = rest; const sys = ctx.sys; const yes = !!opts.y; const sim = !!opts.s;
  const readOnly = ['list', 'search', 'show', 'policy', 'depends', 'rdepends', 'showpkg'];
  if (!verb) throw new CmdError('apt 2.4.12 (amd64)\nUsage: apt [options] command', 1);
  if (!readOnly.includes(verb) && ctx.uid !== 0 && !sim) {
    if (verb === 'update') throw new CmdError('Reading package lists... Done\nE: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)\nW: Problem unlinking the file /var/cache/apt/srcpkgcache.bin - RemoveCaches (13: Permission denied)', 100);
    throw LOCK_FRONTEND;
  }
  switch (verb) {
    case 'update': {
      const n = pk.upgradable(sys).length;
      ctx.out('Hit:1 http://packages.linuxmint.com virginia InRelease\nHit:2 http://archive.ubuntu.com/ubuntu jammy InRelease\nGet:3 http://archive.ubuntu.com/ubuntu jammy-updates InRelease [128 kB]\nGet:4 http://security.ubuntu.com/ubuntu jammy-security InRelease [129 kB]\nFetched 257 kB in 1s (312 kB/s)\n'); status3(ctx);
      ctx.out(n ? `${n} package${n === 1 ? '' : 's'} can be upgraded. Run 'apt list --upgradable' to see ${n === 1 ? 'it' : 'them'}.\n` : 'All packages are up to date.\n');
      sys.log('syslog', 'apt', 'update');
      return 0;
    }
    case 'install': case 'reinstall': {
      if (!names.length) throw new CmdError('E: Unable to locate package', 100);
      const plan = pk.planInstall(sys, names.filter((n) => !n.endsWith('-')));
      for (const m of plan.missing) { status3(ctx); throw new CmdError(`E: Unable to locate package ${m}`, 100); }
      const up = pk.upgradable(sys).filter((u) => names.includes(u.name));
      const already = plan.already.filter((n) => !up.some((u) => u.name === n));
      status3(ctx);
      for (const n of already) ctx.out(`${n} is already the newest version (${pk.installedVersion(sys, n)}).\n`);
      if (!plan.toInstall.length && !up.length) { ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${pk.upgradable(sys).length} not upgraded.\n`); return 0; }
      const extra = plan.toInstall.filter((n) => !names.includes(n));
      if (extra.length) ctx.out(`The following additional packages will be installed:\n${wrapNames(extra)}\n`);
      if (plan.toInstall.length) ctx.out(`The following NEW packages will be installed:\n${wrapNames(plan.toInstall)}\n`);
      if (up.length) ctx.out(`The following packages will be upgraded:\n${wrapNames(up.map((u) => u.name))}\n`);
      const total = [...plan.toInstall, ...up.map((u) => u.name)].reduce((a, n) => a + sizeOf(n), 0);
      ctx.out(`${up.length} upgraded, ${plan.toInstall.length} newly installed, 0 to remove and ${pk.upgradable(sys).length - up.length} not upgraded.\nNeed to get ${kb(total)} of archives.\nAfter this operation, ${kb(total)} of additional disk space will be used.\n`);
      if (sim) return 0;
      if (!(await confirm(ctx, yes))) { ctx.out('Abort.\n'); return 1; }
      let i = 1; for (const n of [...plan.toInstall, ...up.map((u) => u.name)]) ctx.out(`Get:${i++} http://archive.ubuntu.com/ubuntu jammy/main amd64 ${n} amd64 ${PACKAGES[n].avail || PACKAGES[n].v} [${kb(sizeOf(n))}]\n`);
      ctx.out(`Fetched ${kb(total)} in 1s (${Math.max(1, Math.round(total / 1.1))} kB/s)\n`);
      for (const n of plan.toInstall) { ctx.out(`Selecting previously unselected package ${n}.\n(Reading database ... 183214 files and directories currently installed.)\nPreparing to unpack .../${n}_${PACKAGES[n].v}_amd64.deb ...\nUnpacking ${n} (${PACKAGES[n].v}) ...\n`); }
      for (const n of plan.toInstall) { pk.installPackage(sys, n, { auto: !names.includes(n) }); ctx.out(`Setting up ${n} (${PACKAGES[n].v}) ...\n`); }
      for (const u of up) { pk.upgradePackage(sys, u.name); ctx.out(`Preparing to unpack .../${u.name}_${u.to}_amd64.deb ...\nUnpacking ${u.name} (${u.to}) over (${u.from}) ...\nSetting up ${u.name} (${u.to}) ...\n`); }
      ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      sys.log('dpkg.log', 'dpkg', `install ${names.join(' ')}`);
      return 0;
    }
    case 'remove': case 'purge': case 'autoremove': case 'autopurge': {
      const purge = verb === 'purge' || verb === 'autopurge' || !!opts.purge;
      let targets;
      if (verb === 'autoremove' || verb === 'autopurge') targets = pk.autoremovable(sys);
      else { if (!names.length) throw new CmdError('E: Unable to locate package', 100); for (const n of names) if (!PACKAGES[n]) { status3(ctx); throw new CmdError(`E: Unable to locate package ${n}`, 100); } targets = names; }
      status3(ctx);
      const plan = pk.planRemove(sys, targets);
      for (const n of plan.notInstalled) { if (purge && sys.pkgState[n]?.config) plan.remove.push(n); else if (verb === 'remove' || verb === 'purge') ctx.out(`Package '${n}' is not installed, so not removed\n`); }
      if (plan.essential.length) throw new CmdError(`E: Removing essential system-critical packages is not permitted. This might break the system.`, 100);
      const rm = plan.remove;
      if (!rm.length) { ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${pk.upgradable(sys).length} not upgraded.\n`); return 0; }
      const extra = rm.filter((n) => !targets.includes(n));
      if (verb.startsWith('auto')) ctx.out(`The following packages will be REMOVED:\n${wrapNames(rm)}\n`);
      else { if (extra.length) ctx.out(`The following packages will be REMOVED:\n${wrapNames(rm)}\n`); else ctx.out(`The following packages will be REMOVED:\n${wrapNames(rm)}\n`); }
      const tot = rm.reduce((a, n) => a + sizeOf(n), 0);
      ctx.out(`0 upgraded, 0 newly installed, ${rm.length} to remove and ${pk.upgradable(sys).length} not upgraded.\nAfter this operation, ${kb(tot)} disk space will be freed.\n`);
      if (sim) return 0;
      if (!(await confirm(ctx, yes))) { ctx.out('Abort.\n'); return 1; }
      ctx.out('(Reading database ... 183214 files and directories currently installed.)\n');
      for (const n of rm) { pk.removePackage(sys, n, { purge }); ctx.out(`${purge ? 'Removing' : 'Removing'} ${n} (${PACKAGES[n].v}) ...\n`); if (purge) ctx.out(`Purging configuration files for ${n} (${PACKAGES[n].v}) ...\n`); }
      ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      sys.log('dpkg.log', 'dpkg', `${purge ? 'purge' : 'remove'} ${rm.join(' ')}`);
      return 0;
    }
    case 'upgrade': case 'full-upgrade': case 'dist-upgrade': {
      status3(ctx); ctx.out('Calculating upgrade... Done\n');
      const up = pk.upgradable(sys);
      if (!up.length) { ctx.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      ctx.out(`The following packages will be upgraded:\n${wrapNames(up.map((u) => u.name))}\n${up.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${kb(up.reduce((a, u) => a + sizeOf(u.name), 0))} of archives.\nAfter this operation, 0 B of additional disk space will be used.\n`);
      if (sim) return 0;
      if (!(await confirm(ctx, yes))) { ctx.out('Abort.\n'); return 1; }
      for (const u of up) { pk.upgradePackage(sys, u.name); ctx.out(`Preparing to unpack .../${u.name}_${u.to}_amd64.deb ...\nUnpacking ${u.name} (${u.to}) over (${u.from}) ...\nSetting up ${u.name} (${u.to}) ...\n`); }
      ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      return 0;
    }
    case 'list': {
      ctx.err('\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
      ctx.out('Listing... Done\n');
      const pat = names[0] ? new RegExp(names[0].replace(/\*/g, '.*')) : null;
      const rows = opts.upgradable ? pk.upgradable(sys).map((u) => `${u.name}/jammy-updates ${u.to} amd64 [upgradable from: ${u.from}]`) : opts.installed ? pk.installedNames(sys).map((n) => `${n}/jammy,now ${pk.installedVersion(sys, n)} amd64 [installed${sys.pkgState[n].auto ? ',automatic' : ''}]`) : Object.keys(PACKAGES).sort().map((n) => `${n}/jammy ${PACKAGES[n].v} amd64${pk.isInstalled(sys, n) ? ' [installed]' : ''}`);
      for (const r of rows) if (!pat || pat.test(r.split('/')[0])) ctx.out(r + '\n');
      return 0;
    }
    case 'search': { ctx.err('\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n'); ctx.out('Sorting... Done\nFull Text Search... Done\n'); for (const p of pk.searchPackages(names[0] || '')) ctx.out(`${p.name}/jammy ${p.v} amd64${pk.isInstalled(sys, p.name) ? ' [installed]' : ''}\n  ${p.d}\n\n`); return 0; }
    case 'show': { const p = PACKAGES[names[0]]; if (!p) { ctx.err(`E: No packages found\n`); return 100; } ctx.out(`Package: ${p.name}\nVersion: ${p.v}\nPriority: optional\nSection: ${p.s}\nInstalled-Size: ${p.size}\nDepends: ${p.dep.join(', ')}\nDescription: ${p.d}\n\n`); return 0; }
    case 'policy': { for (const n of names) { const p = PACKAGES[n]; if (!p) continue; ctx.out(`${n}:\n  Installed: ${pk.isInstalled(sys, n) ? pk.installedVersion(sys, n) : '(none)'}\n  Candidate: ${p.avail || p.v}\n  Version table:\n`); } return 0; }
    case 'clean': case 'autoclean': case 'check': return 0;
    case 'edit-sources': return 0;
    default: throw new CmdError(`E: Invalid operation ${verb}`, 100);
  }
}
def(['apt', 'apt-get'], aptMain);
def('apt-cache', (ctx) => { const a = [...ctx.args]; const v = a.shift(); if (v === 'policy') return ctx.exec(['apt', 'policy', ...a]); if (v === 'search') return ctx.exec(['apt', 'search', ...a]); if (v === 'show') return ctx.exec(['apt', 'show', ...a]); return 0; });
def('apt-mark', () => 0);

def(['dpkg', 'dpkg-query'], (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'lLsSrPWi', long: { list: 'l', 'get-selections': 'sel', status: 's', listfiles: 'L', remove: 'r', purge: 'P', search: 'S', 'show': 'W' }, withArg: 'f' });
  const sys = ctx.sys;
  if (opts.l || (ctx.name === 'dpkg-query' && opts.W === undefined && !opts.L && !opts.s && !opts.S)) {
    const pat = rest[0] ? new RegExp(`^${rest[0].replace(/\*/g, '.*')}$`) : null;
    const names = Object.keys(sys.pkgState).filter((n) => (sys.pkgState[n].installed || sys.pkgState[n].config) && (!pat || pat.test(n))).sort();
    if (pat && !names.length) throw new CmdError(`dpkg-query: no packages found matching ${rest[0]}`, 1);
    const nw = Math.max(4, ...names.map((n) => n.length)) + 1; const vw = Math.max(7, ...names.map((n) => (pk.installedVersion(sys, n) || PACKAGES[n].v).length)) + 1;
    ctx.out('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n');
    ctx.out(`||/ ${padR('Name', nw)} ${padR('Version', vw)} ${padR('Architecture', 12)} Description\n+++-${'='.repeat(nw)}-${'='.repeat(vw)}-${'='.repeat(12)}-${'='.repeat(40)}\n`);
    for (const n of names) ctx.out(`${pk.dpkgState(sys, n)}  ${padR(n, nw)} ${padR(pk.installedVersion(sys, n) || PACKAGES[n].v, vw)} ${padR('amd64', 12)} ${PACKAGES[n].d}\n`.slice(0, ctx.tty ? ctx.cols + 1 : 9999).replace(/\n?$/, '\n'));
    return 0;
  }
  if (opts.sel) { for (const n of Object.keys(sys.pkgState).filter((x) => sys.pkgState[x].installed).sort()) ctx.out(`${padR(n, 42)}install\n`); return 0; }
  if (opts.L) { const p = PACKAGES[rest[0]]; if (!p || !pk.isInstalled(sys, rest[0])) throw new CmdError(`dpkg-query: package '${rest[0]}' is not installed`, 1); ctx.out('/.\n'); for (const f of [...p.bins, ...Object.keys(p.files), ...Object.keys(p.conf)]) ctx.out(f + '\n'); return 0; }
  if (opts.s) { const n = rest[0]; const p = PACKAGES[n]; if (!p || !pk.dpkgState(sys, n)) throw new CmdError(`dpkg-query: package '${n}' is not installed and no information is available\nUse dpkg --info (= dpkg-deb --info) to examine archive files.`, 1); ctx.out(`Package: ${n}\nStatus: install ok ${sys.pkgState[n].installed ? 'installed' : 'config-files'}\nPriority: optional\nSection: ${p.s}\nInstalled-Size: ${p.size}\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nArchitecture: amd64\nVersion: ${p.v}\nDescription: ${p.d}\n`); return 0; }
  if (opts.S) { const q = rest[0]; const hit = Object.values(PACKAGES).find((p) => pk.isInstalled(sys, p.name) && [...p.bins, ...Object.keys(p.files), ...Object.keys(p.conf)].some((f) => f === q || f.endsWith(q))); if (!hit) throw new CmdError(`dpkg-query: no path found matching pattern ${q}`, 1); ctx.out(`${hit.name}: ${q}\n`); return 0; }
  if (opts.r || opts.P) {
    if (ctx.uid !== 0) throw new CmdError('dpkg: error: requested operation requires superuser privilege', 2);
    for (const n of rest) {
      if (!PACKAGES[n] || !sys.pkgState[n]) throw new CmdError(`dpkg: warning: ignoring request to remove ${n} which isn't installed`, 0);
      const rd = pk.reverseDeps(sys, n); if (rd.length) throw new CmdError(`dpkg: dependency problems prevent removal of ${n}:\n ${rd[0]} depends on ${n}.\n\ndpkg: error processing package ${n} (--${opts.P ? 'purge' : 'remove'}):\n dependency problems - not removing`, 1);
      ctx.out(`(Reading database ... 183214 files and directories currently installed.)\n${opts.P ? 'Purging' : 'Removing'} ${n} (${PACKAGES[n].v}) ...\n`); pk.removePackage(sys, n, { purge: !!opts.P });
    }
    return 0;
  }
  throw new CmdError('dpkg: error: need an action option', 2);
});

// ------------------------------------------------------------------ editors
async function editor(ctx, title) {
  const files = ctx.args.filter((a) => !a.startsWith('-') && !/^\+\d+$/.test(a));
  const file = files[0];
  if (!file) { await ctx.io.editor({ path: null, content: '', title: `${title}  New Buffer`, save: async () => { throw new Error('No file name'); } }); return 0; }
  const p = ctx.abs(file); let content = ''; let exists = true;
  try { content = ctx.fs.readFile(p); } catch (e) { if (e instanceof FsError && e.code === 'ENOENT') exists = false; else if (e instanceof FsError) { ctx.err(`${ctx.name}: ${file}: ${e.text}\n`); return 1; } else throw e; }
  if (exists && ctx.fs.isDir(p)) { ctx.err(`${ctx.name}: ${file} is a directory\n`); return 1; }
  await ctx.io.editor({ path: p, shown: file, content, isNew: !exists, title: `${title}  ${file}`, save: async (t) => { try { ctx.fs.writeFile(p, t, { mode: 0o644 }); } catch (e) { if (e instanceof FsError) throw new Error(`Error writing ${file}: ${e.text}`); throw e; } } });
  return 0;
}
def(['nano', 'pico'], (ctx) => editor(ctx, 'GNU nano 6.2'), { bin: '/usr/bin/nano' });
def(['vi', 'vim', 'view', 'vim.tiny', 'ex'], (ctx) => editor(ctx, 'VIM'), { bin: '/usr/bin/vi' });
def('editor', (ctx) => editor(ctx, 'GNU nano 6.2'));

// ------------------------------------------------------------------ GUI launchers
const GUI = { firefox: '/usr/bin/firefox', xed: '/usr/bin/xed', nemo: '/usr/bin/nemo', 'gnome-terminal': '/usr/bin/gnome-terminal', gufw: '/usr/bin/gufw', mintupdate: '/usr/bin/mintupdate', mintinstall: '/usr/bin/mintinstall', 'cinnamon-settings': '/usr/bin/cinnamon-settings', 'gnome-system-monitor': '/usr/bin/gnome-system-monitor', thunderbird: '/usr/bin/thunderbird', libreoffice: '/usr/bin/libreoffice', mintsources: '/usr/bin/mintsources', rhythmbox: '/usr/bin/rhythmbox', celluloid: '/usr/bin/celluloid', transmission: '/usr/bin/transmission-gtk', 'transmission-gtk': '/usr/bin/transmission-gtk', wireshark: '/usr/bin/wireshark', sol: '/usr/games/sol', timeshift: '/usr/bin/timeshift', 'users-admin': '/usr/bin/cinnamon-settings' };
for (const [name, bin] of Object.entries(GUI)) def(name, (ctx) => { ctx.io.launch?.(name, ctx.args, { user: ctx.user, cwd: ctx.shell.cwd, root: ctx.uid === 0 }); }, { bin });
def('xdg-open', (ctx) => { const t = ctx.args[0]; if (!t) throw new CmdError('xdg-open: no file or URL specified', 1); const app = /^(https?:|file:|sim:)|\.(html?)$/.test(t) ? 'firefox' : /\.(txt|conf|md|sh|log|desktop)$/.test(t) ? 'xed' : ctx.fs.isDir(ctx.abs(t)) ? 'nemo' : 'xed'; ctx.io.launch?.(app, [t], { user: ctx.user, cwd: ctx.shell.cwd, root: ctx.uid === 0 }); });
void lines; void padL; void SERVICES;
