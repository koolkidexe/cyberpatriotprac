// apt / apt-get / apt-cache / dpkg / apt-mark front-ends over core/packages.js
import { cmd } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import * as pk from '../../core/packages.js';
import { PACKAGES } from '../../images/catalog.js';
import { globToRegex, fmtDate } from '../../core/util.js';
import { desktopPath } from '../../core/packages.js';

const ARCH = 'amd64';
const pad2 = (n) => String(n).padStart(2, '0');

export function aptSize(kb) {
  if (kb < 1000) return `${Math.round(kb)} kB`;
  if (kb < 1000 * 1000) return kb < 100 * 1000 ? `${(kb / 1000).toFixed(1)} MB` : `${Math.round(kb / 1000)} MB`;
  return `${(kb / 1e6).toFixed(1)} GB`;
}
const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const holds = (sys) => (sys.misc.holds = sys.misc.holds || []);

function stamp(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }

function dpkgLog(sys, action, name, from, to) {
  const d = PACKAGES[name];
  const line = `${stamp(sys.now())} ${action} ${name}:${ARCH} ${from ?? '<none>'} ${to ?? '<none>'}\n`;
  try { sys.vfs.writeFile('/var/log/dpkg.log', line, { append: true, mode: 0o644, uid: 0, gid: 0 }); } catch { /* ignore */ }
  void d;
}
function historyLog(ctx, cmdline, kind, names) {
  const sys = ctx.sys;
  try {
    if (!sys.vfs.exists('/var/log/apt')) sys.vfs.mkdir('/var/log/apt', { parents: true, mode: 0o755 });
    const start = stamp(sys.now());
    const list = names.map((n) => `${n}:${ARCH} (${pk.installedVersion(sys, n) ?? PACKAGES[n]?.v}${kind === 'Upgrade' ? `, ${PACKAGES[n]?.avail}` : ''})`).join(', ');
    const body = `\nStart-Date: ${start}\nCommandline: ${cmdline}\nRequested-By: ${ctx.sh.frames[0].user} (${ctx.sh.frames[0].user === 'root' ? 0 : 1000})\n${kind}: ${list}\nEnd-Date: ${start}\n`;
    sys.vfs.writeFile('/var/log/apt/history.log', body, { append: true, mode: 0o644, uid: 0, gid: 0 });
  } catch { /* ignore */ }
}

async function confirm(ctx, prompt, assumeYes) {
  if (assumeYes) { return true; }
  let ans;
  if (ctx.stdin) ans = ctx.readLine();
  else ans = await ctx.term.readLine(prompt, { echo: true });
  if (ans == null) { ctx.out('Abort.\n'); return false; }
  if (ctx.stdin) ctx.out(prompt + ans + '\n');
  if (ans === '' || /^y(es)?$/i.test(ans.trim())) return true;
  ctx.out('Abort.\n');
  return false;
}

function lockCheck(ctx, kind = 'install') {
  if (ctx.isRoot) return true;
  if (kind === 'update') {
    ctx.out('Reading package lists... Done\n');
    ctx.err('E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)\nW: Problem unlinking the file /var/cache/apt/srcpkgcache.bin - RemoveCaches (13: Permission denied)\n');
  } else if (ctx.name === 'apt-get' || ctx.name === 'apt') {
    ctx.err(`E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n`);
  }
  return false;
}

function parseApt(ctx) {
  const a = ctx.args;
  const o = { y: false, s: false, q: false, reinstall: false, onlyUpgrade: false, noInstallRecommends: false, purge: false, installed: false, upgradable: false, all: false, fix: false };
  const rest = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-y' || x === '--yes' || x === '--assume-yes' || x === '-yy') o.y = true;
    else if (x === '-s' || x === '--simulate' || x === '--dry-run' || x === '--just-print') o.s = true;
    else if (x === '-q' || x === '-qq' || x === '--quiet') o.q = true;
    else if (x === '--reinstall') o.reinstall = true;
    else if (x === '--only-upgrade') o.onlyUpgrade = true;
    else if (x === '--purge') o.purge = true;
    else if (x === '--installed') o.installed = true;
    else if (x === '--upgradable') o.upgradable = true;
    else if (x === '-f' || x === '--fix-broken') o.fix = true;
    else if (x === '--all-versions' || x === '-a') o.all = true;
    else if (x === '-o' || x === '-c' || x === '-t') i++;
    else if (/^-[a-zA-Z]+$/.test(x) && !x.startsWith('--')) { for (const c of x.slice(1)) { if (c === 'y') o.y = true; else if (c === 's') o.s = true; else if (c === 'q') o.q = true; else if (c === 'f') o.fix = true; else if (!'dm'.includes(c)) { ctx.err(`E: Command line option '${c}' [from ${x}] is not understood in combination with the other options.\n`); return null; } } }
    else if (x.startsWith('--')) { /* ignore other long options such as --no-install-recommends */ }
    else rest.push(x);
  }
  return { o, rest };
}

const readingLines = (ctx, o, extra = true) => {
  if (o.q) return;
  ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\n' + (extra ? 'Reading state information... Done\n' : ''));
};

function listCols(names, cols = 80) {
  // apt prints package names in two-space indented wrapped lines
  const lines = [];
  let cur = ' ';
  for (const n of names) {
    if ((cur + ' ' + n).length > cols - 1 && cur.trim()) { lines.push(cur); cur = ' '; }
    cur += ' ' + n;
  }
  if (cur.trim()) lines.push(cur);
  return lines.join('\n') + '\n';
}

async function aptInstall(ctx, o, specs) {
  const sys = ctx.sys;
  const names = [];
  for (const sp of specs) {
    const n = sp.split('=')[0].replace(/:amd64$/, '').replace(/\/.*$/, '');
    names.push(n);
  }
  readingLines(ctx, o);
  const plan = pk.planInstall(sys, names);
  for (const m of plan.missing) {
    const hasRepoMatch = pk.searchPackages(m).length;
    void hasRepoMatch;
    ctx.err(`E: Unable to locate package ${m}\n`);
    return 100;
  }
  const upgrades = [];
  for (const n of plan.already) {
    const d = PACKAGES[n];
    if (o.onlyUpgrade) { if (d.avail && pk.installedVersion(sys, n) !== d.avail) upgrades.push(n); continue; }
    if (o.reinstall) continue;
    if (d.avail && pk.installedVersion(sys, n) !== d.avail) { upgrades.push(n); ctx.out(''); continue; }
    ctx.out(`${n} is already the newest version (${pk.installedVersion(sys, n)}).\n`);
  }
  if (!o.reinstall && !upgrades.length && !plan.toInstall.length) {
    const upg = pk.upgradable(sys).length;
    ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${upg} not upgraded.\n`);
    return 0;
  }
  const autoNames = plan.toInstall.filter((n) => !names.includes(n));
  if (autoNames.length) ctx.out(`The following additional packages will be installed:\n${listCols(autoNames)}`);
  if (plan.toInstall.length) {
    ctx.out(`The following NEW packages will be installed:\n${listCols(plan.toInstall)}`);
  }
  if (upgrades.length) ctx.out(`The following packages will be upgraded:\n${listCols(upgrades)}`);
  const total = plan.toInstall.reduce((a, n) => a + PACKAGES[n].size, 0) + upgrades.reduce((a, n) => a + PACKAGES[n].size, 0);
  const upg = pk.upgradable(sys).length - upgrades.length;
  ctx.out(`${upgrades.length} upgraded, ${plan.toInstall.length} newly installed, 0 to remove and ${Math.max(0, upg)} not upgraded.\n`);
  if (total) ctx.out(`Need to get ${aptSize(total * 0.45)} of archives.\nAfter this operation, ${aptSize(total)} of additional disk space will be used.\n`);
  if (o.s) { for (const n of plan.toInstall) ctx.out(`Inst ${n} (${PACKAGES[n].v} Ubuntu:22.04/jammy-updates [${ARCH}])\n`); return 0; }
  if (!(await confirm(ctx, 'Do you want to continue? [Y/n] ', o.y))) return 1;
  const reinstall = o.reinstall ? plan.already : [];
  let i = 0;
  const all = [...plan.toInstall, ...upgrades, ...reinstall];
  for (const n of all) { i++; ctx.out(`Get:${i} http://archive.ubuntu.com/ubuntu jammy/main ${ARCH} ${n} ${ARCH} ${PACKAGES[n].v} [${aptSize(PACKAGES[n].size * 0.45)}]\n`); }
  ctx.out(`Fetched ${aptSize(total * 0.45)} in 1s (${aptSize(total * 0.3)}/s)\n`);
  await ctx.sleep(200);
  const n0 = pk.installedNames(sys).length * 3 + 9500;
  ctx.out(`(Reading database ... ${n0} files and directories currently installed.)\n`);
  for (const n of plan.toInstall) ctx.out(`Selecting previously unselected package ${n}.\nPreparing to unpack .../${n}_${PACKAGES[n].v}_${ARCH}.deb ...\nUnpacking ${n} (${PACKAGES[n].v}) ...\n`);
  for (const n of upgrades) ctx.out(`Preparing to unpack .../${n}_${PACKAGES[n].avail}_${ARCH}.deb ...\nUnpacking ${n} (${PACKAGES[n].avail}) over (${pk.installedVersion(sys, n)}) ...\n`);
  const instNames = [];
  for (const n of plan.toInstall) {
    pk.installPackage(sys, n, { auto: !names.includes(n) });
    dpkgLog(sys, 'install', n, null, PACKAGES[n].v);
    instNames.push(n);
    ctx.out(`Setting up ${n} (${PACKAGES[n].v}) ...\n`);
    for (const s of PACKAGES[n].svc) {
      const unit = `${s}.service`;
      ctx.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${unit} → /lib/systemd/system/${unit}.\n`);
    }
  }
  for (const n of upgrades) { const from = pk.installedVersion(sys, n); pk.upgradePackage(sys, n); dpkgLog(sys, 'upgrade', n, from, PACKAGES[n].avail); ctx.out(`Setting up ${n} (${PACKAGES[n].avail}) ...\n`); }
  for (const n of reinstall) ctx.out(`Setting up ${n} (${pk.installedVersion(sys, n)}) ...\n`);
  ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
  for (const n of names) { if (sys.pkgState[n]) sys.pkgState[n].auto = false; }
  historyLog(ctx, `apt ${ctx.name === 'apt-get' ? 'install' : 'install'} ${names.join(' ')}`, 'Install', instNames);
  return 0;
}

async function aptRemove(ctx, o, specs, purge) {
  const sys = ctx.sys;
  const names = specs.map((s) => s.replace(/[+-]$/, '').replace(/:amd64$/, ''));
  readingLines(ctx, o);
  for (const n of names) if (!PACKAGES[n]) { ctx.err(`E: Unable to locate package ${n}\n`); return 100; }
  const plan = pk.planRemove(sys, names);
  for (const n of plan.notInstalled) {
    const rc = !pk.isInstalled(sys, n) && sys.pkgState[n]?.config && purge;
    if (rc) continue;
    ctx.out(`Package '${n}' is not installed, so not removed\n`);
  }
  const confOnly = plan.notInstalled.filter((n) => purge && sys.pkgState[n]?.config);
  if (plan.essential.length) {
    ctx.err(`E: Removing essential system-critical packages is not permitted. This might break the system.\n`);
    return 100;
  }
  if (!plan.remove.length && !confOnly.length) { ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${pk.upgradable(sys).length} not upgraded.\n`); return 0; }
  const extra = plan.remove.filter((n) => !names.includes(n));
  if (extra.length) ctx.out(`The following packages will be REMOVED:\n${listCols(plan.remove)}`);
  else if (plan.remove.length) ctx.out(`The following packages will be REMOVED:\n${listCols(plan.remove.map((n) => (purge ? n + '*' : n)))}`);
  const freed = plan.remove.reduce((a, n) => a + PACKAGES[n].size, 0);
  ctx.out(`0 upgraded, 0 newly installed, ${plan.remove.length + confOnly.length} to remove and ${pk.upgradable(sys).length} not upgraded.\n`);
  if (freed) ctx.out(`After this operation, ${aptSize(freed)} disk space will be freed.\n`);
  if (o.s) return 0;
  if (!(await confirm(ctx, 'Do you want to continue? [Y/n] ', o.y))) return 1;
  ctx.out(`(Reading database ... ${pk.installedNames(sys).length * 3 + 9500} files and directories currently installed.)\n`);
  for (const n of plan.remove) {
    const v = pk.installedVersion(sys, n);
    pk.removePackage(sys, n, { purge });
    dpkgLog(sys, purge ? 'purge' : 'remove', n, v, null);
    ctx.out(`Removing ${n} (${v}) ...\n`);
    if (purge) ctx.out(`Purging configuration files for ${n} (${v}) ...\n`);
  }
  for (const n of confOnly) { const d = PACKAGES[n]; pk.removePackage(sys, n, { purge: true }); void d; ctx.out(`Purging configuration files for ${n} (${PACKAGES[n].v}) ...\n`); }
  ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
  historyLog(ctx, `apt ${purge ? 'purge' : 'remove'} ${names.join(' ')}`, purge ? 'Purge' : 'Remove', plan.remove);
  return 0;
}

async function aptUpgrade(ctx, o, full) {
  const sys = ctx.sys;
  readingLines(ctx, o);
  ctx.out('Calculating upgrade... Done\n');
  const held = holds(sys);
  const list = pk.upgradable(sys).filter((u) => !held.includes(u.name));
  if (!list.length) { ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${held.length ? pk.upgradable(sys).length : 0} not upgraded.\n`); return 0; }
  ctx.out(`The following packages will be upgraded:\n${listCols(list.map((u) => u.name))}`);
  const kept = pk.upgradable(sys).length - list.length;
  ctx.out(`${list.length} upgraded, 0 newly installed, 0 to remove and ${kept} not upgraded.\n`);
  const total = list.reduce((a, u) => a + u.size, 0);
  ctx.out(`Need to get ${aptSize(total * 0.45)} of archives.\nAfter this operation, ${aptSize(total * 0.03)} of additional disk space will be used.\n`);
  if (o.s) return 0;
  if (!(await confirm(ctx, 'Do you want to continue? [Y/n] ', o.y))) return 1;
  let i = 0;
  for (const u of list) { i++; ctx.out(`Get:${i} http://archive.ubuntu.com/ubuntu jammy-updates/main ${ARCH} ${u.name} ${ARCH} ${u.to} [${aptSize(u.size * 0.45)}]\n`); }
  ctx.out(`Fetched ${aptSize(total * 0.45)} in 2s (${aptSize(total * 0.2)}/s)\n`);
  await ctx.sleep(250);
  ctx.out(`(Reading database ... ${pk.installedNames(sys).length * 3 + 9500} files and directories currently installed.)\n`);
  for (const u of list) ctx.out(`Preparing to unpack .../${u.name}_${u.to}_${ARCH}.deb ...\nUnpacking ${u.name} (${u.to}) over (${u.from}) ...\n`);
  for (const u of list) { pk.upgradePackage(sys, u.name); dpkgLog(sys, 'upgrade', u.name, u.from, u.to); ctx.out(`Setting up ${u.name} (${u.to}) ...\n`); }
  ctx.out('Processing triggers for man-db (2.10.2-1) ...\nProcessing triggers for desktop-file-utils (0.26-1ubuntu3) ...\n');
  historyLog(ctx, `apt ${full ? 'full-upgrade' : 'upgrade'}`, 'Upgrade', list.map((u) => u.name));
  return 0;
}

async function aptUpdate(ctx, o) {
  const sys = ctx.sys;
  const lines = [
    'Hit:1 http://packages.linuxmint.com virginia InRelease',
    'Hit:2 http://archive.ubuntu.com/ubuntu jammy InRelease',
    'Get:3 http://archive.ubuntu.com/ubuntu jammy-updates InRelease [128 kB]',
    'Get:4 http://security.ubuntu.com/ubuntu jammy-security InRelease [129 kB]',
    'Hit:5 http://archive.ubuntu.com/ubuntu jammy-backports InRelease',
    'Get:6 http://archive.ubuntu.com/ubuntu jammy-updates/main amd64 Packages [2,319 kB]',
    'Get:7 http://security.ubuntu.com/ubuntu jammy-security/main amd64 Packages [2,086 kB]',
  ];
  if (!o.q) { for (const l of lines) { ctx.out(l + '\n'); await ctx.sleep(80); } ctx.out('Fetched 4,662 kB in 2s (2,274 kB/s)\n'); }
  readingLines(ctx, o);
  sys.misc.aptUpdated = sys.now();
  try { sys.vfs.writeFile('/var/lib/apt/periodic/update-success-stamp', '', { mode: 0o644, uid: 0, gid: 0 }); } catch { /* optional dir */ }
  const n = pk.upgradable(sys).length;
  if (n) ctx.out(`${n} package${n === 1 ? '' : 's'} can be upgraded. Run 'apt list --upgradable' to see them.\n`);
  else ctx.out('All packages are up to date.\n');
  return 0;
}

function aptListLines(ctx, filter) {
  const sys = ctx.sys;
  const rows = [];
  for (const d of Object.values(PACKAGES).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!filter(d)) continue;
    const st = sys.pkgState[d.name];
    const inst = !!st?.installed;
    const upg = inst && d.avail && pk.installedVersion(sys, d.name) !== d.avail;
    const v = upg ? d.avail : d.v;
    const flags = inst ? (upg ? `[upgradable from: ${pk.installedVersion(sys, d.name)}]` : st.auto ? '[installed,automatic]' : '[installed]') : '';
    rows.push(`${d.name}/jammy${upg ? '-updates,now' : inst ? ',now' : ''} ${v} ${ARCH}${flags ? ' ' + flags : ''}`);
  }
  return rows;
}

function showPackage(ctx, n) {
  const d = PACKAGES[n];
  if (!d) return false;
  const st = ctx.sys.pkgState[n];
  let t = `Package: ${d.name}\nVersion: ${st?.installed ? pk.installedVersion(ctx.sys, n) : d.v}\nPriority: ${d.essential ? 'required' : 'optional'}\nSection: ${d.s || 'misc'}\nOrigin: Ubuntu\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${d.size} kB\n`;
  if (d.dep.length) t += `Depends: ${d.dep.join(', ')}\n`;
  t += `Download-Size: ${aptSize(d.size * 0.45)}\nAPT-Manual-Installed: ${st?.installed && !st.auto ? 'yes' : 'no'}\nAPT-Sources: http://archive.ubuntu.com/ubuntu jammy/main amd64 Packages\nDescription: ${d.d}\n`;
  ctx.out(t + '\n');
  return true;
}

cmd(['apt', 'apt-get'], async (ctx) => {
  const parsed = parseApt(ctx);
  if (!parsed) return 100;
  const { o, rest } = parsed;
  const sys = ctx.sys;
  const verb = rest[0];
  const args = rest.slice(1);
  if (!verb) { ctx.out(ctx.name === 'apt' ? 'apt 2.4.13 (amd64)\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n' : 'apt 2.4.13 (amd64)\nUsage: apt-get [options] command\n'); return 0; }
  if (ctx.args.includes('--version') || verb === '-v') { ctx.out('apt 2.4.13 (amd64)\n'); return 0; }
  const write = ['install', 'remove', 'purge', 'autoremove', 'autopurge', 'upgrade', 'full-upgrade', 'dist-upgrade', 'reinstall', 'update', 'clean', 'autoclean', 'build-dep', 'check'].includes(verb);
  if (write) {
    if (!lockCheck(ctx, verb === 'update' ? 'update' : 'install')) return 100;
  }
  switch (verb) {
    case 'update': return aptUpdate(ctx, o);
    case 'upgrade': return aptUpgrade(ctx, o, false);
    case 'full-upgrade': case 'dist-upgrade': return aptUpgrade(ctx, o, true);
    case 'install': {
      if (!args.length) { ctx.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n0 upgraded, 0 newly installed, 0 to remove and ' + pk.upgradable(sys).length + ' not upgraded.\n'); return 0; }
      const rm = args.filter((a) => a.endsWith('-') && PACKAGES[a.slice(0, -1)]);
      const inst = args.filter((a) => !rm.includes(a));
      if (rm.length) { const r = await aptRemove(ctx, o, rm, false); if (r) return r; }
      return aptInstall(ctx, o, inst);
    }
    case 'reinstall': return aptInstall(ctx, { ...o, reinstall: true }, args);
    case 'remove': case 'uninstall': return aptRemove(ctx, o, args, false);
    case 'purge': case 'autopurge': if (verb === 'autopurge') return aptAutoremove(ctx, o, true); return aptRemove(ctx, o, args, true);
    case 'autoremove': return aptAutoremove(ctx, o, o.purge);
    case 'clean': case 'autoclean': return 0;
    case 'check': readingLines(ctx, o); return 0;
    case 'search': {
      if (!args.length) { ctx.err('E: You must give at least one search pattern\n'); return 100; }
      ctx.out('Sorting... Done\nFull Text Search... Done\n');
      const terms = args.map((a) => a.toLowerCase());
      const rows = [];
      for (const d of Object.values(PACKAGES).sort((x, y) => (x.name < y.name ? -1 : 1))) {
        if (!terms.every((t) => d.name.includes(t) || d.d.toLowerCase().includes(t))) continue;
        const st = sys.pkgState[d.name];
        rows.push(`${d.name}/jammy ${d.v} ${ARCH}${st?.installed ? (st.auto ? ' [installed,automatic]' : ' [installed]') : ''}\n  ${d.d}\n`);
      }
      ctx.out(rows.join('\n') + (rows.length ? '\n' : ''));
      return 0;
    }
    case 'list': {
      if (ctx.tty || true) ctx.err(ctx.tty ? '' : 'WARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
      ctx.out('Listing... Done\n');
      let pats = args.map((a) => globToRegex(a.toLowerCase()));
      const filter = (d) => {
        const st = sys.pkgState[d.name];
        if (o.installed && !st?.installed) return false;
        if (o.upgradable && !(st?.installed && d.avail && pk.installedVersion(sys, d.name) !== d.avail)) return false;
        return !pats.length || pats.some((re) => re.test(d.name));
      };
      const rows = aptListLines(ctx, filter);
      ctx.out(rows.join('\n') + (rows.length ? '\n' : ''));
      return 0;
    }
    case 'show': {
      let rc = 0;
      for (const n of args) if (!showPackage(ctx, n)) { ctx.err(`E: No packages found\n`); rc = 100; }
      return rc;
    }
    case 'policy': return policy(ctx, args);
    case 'autoremove-list': return 0;
    case 'edit-sources': ctx.out(''); return 0;
    case 'moo': ctx.out('                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n...."Have you mooed today?"...\n'); return 0;
    default:
      ctx.err(`E: Invalid operation ${verb}\n`);
      return 100;
  }
}, { usage: 'apt [options] command', noHelp: true });

async function aptAutoremove(ctx, o, purge) {
  const sys = ctx.sys;
  readingLines(ctx, o);
  const list = pk.autoremovable(sys);
  if (!list.length) { ctx.out(`0 upgraded, 0 newly installed, 0 to remove and ${pk.upgradable(sys).length} not upgraded.\n`); return 0; }
  ctx.out(`The following packages will be REMOVED:\n${listCols(list)}`);
  const freed = list.reduce((a, n) => a + PACKAGES[n].size, 0);
  ctx.out(`0 upgraded, 0 newly installed, ${list.length} to remove and ${pk.upgradable(sys).length} not upgraded.\nAfter this operation, ${aptSize(freed)} disk space will be freed.\n`);
  if (o.s) return 0;
  if (!(await confirm(ctx, 'Do you want to continue? [Y/n] ', o.y))) return 1;
  ctx.out(`(Reading database ... ${pk.installedNames(sys).length * 3 + 9500} files and directories currently installed.)\n`);
  for (const n of list) { const v = pk.installedVersion(sys, n); pk.removePackage(sys, n, { purge }); dpkgLog(sys, purge ? 'purge' : 'remove', n, v, null); ctx.out(`Removing ${n} (${v}) ...\n`); }
  ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
  return 0;
}

function policy(ctx, args) {
  let rc = 0;
  for (const n of args) {
    const d = PACKAGES[n];
    if (!d) { ctx.err(`N: Unable to locate package ${n}\n`); continue; }
    const inst = pk.installedVersion(ctx.sys, n);
    const cand = d.avail || d.v;
    ctx.out(`${n}:\n  Installed: ${inst ?? '(none)'}\n  Candidate: ${cand}\n  Version table:\n`);
    if (d.avail) ctx.out(` ${inst === d.avail ? '***' : '   '} ${d.avail} 500\n        500 http://archive.ubuntu.com/ubuntu jammy-updates/main amd64 Packages\n`);
    ctx.out(` ${inst === d.v ? '***' : '   '} ${d.v} 500\n        500 http://archive.ubuntu.com/ubuntu jammy/main amd64 Packages\n` + (inst === d.v ? '        100 /var/lib/dpkg/status\n' : ''));
  }
  return rc;
}

cmd('apt-cache', (ctx) => {
  const [verb, ...args] = ctx.args.filter((a) => !a.startsWith('-'));
  switch (verb) {
    case 'policy': return policy(ctx, args);
    case 'show': case 'showpkg': { let rc = 0; for (const n of args) if (!showPackage(ctx, n)) { ctx.err(`E: No packages found\n`); rc = 100; } return rc; }
    case 'search': {
      const terms = args.map((a) => a.toLowerCase());
      for (const d of Object.values(PACKAGES).sort((x, y) => (x.name < y.name ? -1 : 1))) if (terms.every((t) => d.name.includes(t) || d.d.toLowerCase().includes(t))) ctx.out(`${d.name} - ${d.d}\n`);
      return 0;
    }
    case 'depends': for (const n of args) { const d = PACKAGES[n]; if (!d) { ctx.err(`E: No packages found\n`); return 100; } ctx.out(`${n}\n${d.dep.map((x) => `  Depends: ${x}`).join('\n')}${d.dep.length ? '\n' : ''}`); } return 0;
    case 'rdepends': for (const n of args) { ctx.out(`${n}\nReverse Depends:\n${Object.values(PACKAGES).filter((d) => d.dep.includes(n)).map((d) => `  ${d.name}`).join('\n')}\n`); } return 0;
    case 'madison': for (const n of args) { const d = PACKAGES[n]; if (d) ctx.out(`${n.padStart(10)} | ${d.avail || d.v} | http://archive.ubuntu.com/ubuntu jammy-updates/main amd64 Packages\n`); } return 0;
    case 'pkgnames': for (const n of Object.keys(PACKAGES).filter((x) => !args[0] || x.startsWith(args[0])).sort()) ctx.out(n + '\n'); return 0;
    default: ctx.err('E: Invalid operation ' + (verb ?? '') + '\n'); return 100;
  }
});

cmd('apt-mark', (ctx) => {
  const [verb, ...names] = ctx.args.filter((a) => !a.startsWith('-'));
  const sys = ctx.sys;
  const h = holds(sys);
  if (verb === 'showhold') { for (const n of h) ctx.out(n + '\n'); return 0; }
  if (verb === 'showmanual' || verb === 'showauto') {
    for (const n of pk.installedNames(sys)) if ((verb === 'showauto') === !!sys.pkgState[n].auto) ctx.out(n + '\n');
    return 0;
  }
  if (!ctx.isRoot) { ctx.err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n'); return 100; }
  for (const n of names) {
    if (!PACKAGES[n]) { ctx.err(`E: Can not find package ${n}\n`); return 100; }
    if (verb === 'hold') { if (!h.includes(n)) h.push(n); ctx.out(`${n} set on hold.\n`); }
    else if (verb === 'unhold') { const i = h.indexOf(n); if (i >= 0) h.splice(i, 1); ctx.out(`Canceled hold on ${n}.\n`); }
    else if (verb === 'manual') { if (sys.pkgState[n]) sys.pkgState[n].auto = false; ctx.out(`${n} set to manually installed.\n`); }
    else if (verb === 'auto') { if (sys.pkgState[n]) sys.pkgState[n].auto = true; ctx.out(`${n} set to automatically installed.\n`); }
  }
  sys.touch('packages');
  return 0;
});

// ---------------------------------------------------------------- dpkg
function pkgFiles(sys, d) {
  const files = ['/.'];
  const dirs = new Set();
  const add = (p) => { files.push(p); let q = p.slice(0, p.lastIndexOf('/')); while (q) { dirs.add(q); q = q.slice(0, q.lastIndexOf('/')); } };
  for (const b of d.bins || []) add(b);
  for (const f of Object.keys(d.files || {})) add(f);
  for (const f of Object.keys(d.conf || {})) add(f);
  if (d.gui) add(desktopPath(d.name));
  return [...new Set([...files, ...[...dirs].sort()])].sort((a, b) => (a === '/.' ? -1 : b === '/.' ? 1 : a < b ? -1 : 1));
}

cmd(['dpkg', 'dpkg-query'], async (ctx) => {
  const sys = ctx.sys;
  const a = ctx.args;
    const rest = a.filter((x) => !x.startsWith('-'));
  const opt = (...ks) => a.some((x) => ks.includes(x));
  if (opt('--version')) { ctx.out('Debian dpkg package management program version 1.21.1 ubuntu2.3 (amd64).\n'); return 0; }
  if (opt('-l', '--list')) {
    const pats = rest.map((p) => globToRegex(p));
    let names = Object.keys(sys.pkgState).filter((n) => sys.pkgState[n].installed || sys.pkgState[n].config);
    if (pats.length) { names = names.filter((n) => pats.some((re) => re.test(n))); }
    names.sort();
    if (!names.length) { if (pats.length) { ctx.err(`dpkg-query: no packages found matching ${rest.join(' ')}\n`); return 1; } return 0; }
    const rows = names.map((n) => ({ st: pk.dpkgState(sys, n), n, v: pk.installedVersion(sys, n) || PACKAGES[n]?.v || '', d: PACKAGES[n]?.d || '' }));
    const wn = Math.max(4, ...rows.map((r) => r.n.length));
    const wv = Math.max(7, ...rows.map((r) => r.v.length));
    ctx.out('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n');
    ctx.out(`||/ ${'Name'.padEnd(wn)} ${'Version'.padEnd(wv)} ${'Architecture'} Description\n+++-${'='.repeat(wn)}-${'='.repeat(wv)}-${'='.repeat(12)}-${'='.repeat(40)}\n`);
    const cols = ctx.cols || 80;
    for (const r of rows) {
      const line = `${r.st} ${r.n.padEnd(wn)} ${r.v.padEnd(wv)} ${ARCH}         ${r.d}`;
      ctx.out(`${hasHold(sys, r.n) ? 'h' + line.slice(1) : line}`.slice(0, Math.max(cols, 40)) + '\n');
    }
    return 0;
  }
  if (opt('-W', '--show')) {
    const fmtIdx = a.findIndex((x) => x === '-f' || x.startsWith('--showformat'));
    let fmt = '${binary:Package}\t${Version}\n';
    if (fmtIdx >= 0) fmt = (a[fmtIdx].includes('=') ? a[fmtIdx].split('=').slice(1).join('=') : a[fmtIdx + 1]).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    const pats = rest.filter((x) => x !== fmt).map((p) => globToRegex(p));
    const names = Object.keys(sys.pkgState).filter((n) => sys.pkgState[n].installed).filter((n) => !pats.length || pats.some((re) => re.test(n))).sort();
    if (!names.length) { ctx.err(`dpkg-query: no packages found matching ${rest.join(' ')}\n`); return 1; }
    for (const n of names) ctx.out(fmt.replace(/\$\{(?:binary:)?(\w+)\}/g, (_, k) => ({ Package: n, Version: pk.installedVersion(sys, n), Status: 'install ok installed', Architecture: ARCH }[k] ?? '')));
    return 0;
  }
  if (opt('-s', '--status')) {
    let rc = 0;
    for (const n of rest) {
      const st = pk.dpkgState(sys, n);
      const d = PACKAGES[n];
      if (!d || !st) { ctx.err(`dpkg-query: package '${n}' is not installed and no information is available\nUse dpkg --info (= dpkg-deb --info) to examine archive files.\n`); rc = 1; continue; }
      ctx.out(`Package: ${n}\nStatus: ${st === 'ii' ? 'install ok installed' : 'deinstall ok config-files'}\nPriority: ${d.essential ? 'required' : 'optional'}\nSection: ${d.s || 'misc'}\nInstalled-Size: ${d.size}\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nArchitecture: ${ARCH}\nVersion: ${pk.installedVersion(sys, n) || d.v}\n${d.dep.length ? `Depends: ${d.dep.join(', ')}\n` : ''}Description: ${d.d}\n\n`);
    }
    return rc;
  }
  if (opt('-L', '--listfiles')) {
    let rc = 0;
    for (const n of rest) {
      const d = PACKAGES[n];
      if (!d || !pk.isInstalled(sys, n)) { ctx.err(`dpkg-query: package '${n}' is not installed\nUse dpkg --info (= dpkg-deb --info) to examine archive files.\n`); rc = 1; continue; }
      ctx.out(pkgFiles(sys, d).join('\n') + '\n');
    }
    return rc;
  }
  if (opt('-S', '--search')) {
    let rc = 0;
    for (const p of rest) {
      const hits = Object.values(PACKAGES).filter((d) => pk.isInstalled(sys, d.name) && pkgFiles(sys, d).some((f) => (p.includes('*') ? globToRegex(p).test(f) : f === p || f.endsWith('/' + p))));
      if (!hits.length) { ctx.err(`dpkg-query: no path found matching pattern ${p}\n`); rc = 1; continue; }
      for (const d of hits) ctx.out(`${d.name}: ${pkgFiles(sys, d).find((f) => f === p || f.endsWith('/' + p)) || p}\n`);
    }
    return rc;
  }
  if (opt('--get-selections')) {
    for (const n of Object.keys(sys.pkgState).filter((x) => sys.pkgState[x].installed).sort()) ctx.out(`${n}${':amd64'}`.padEnd(48) + (hasHold(sys, n) ? 'hold\n' : 'install\n'));
    return 0;
  }
  if (opt('-r', '--remove', '-P', '--purge', '-i', '--install', '--configure', '-C', '--audit')) {
    if (opt('-C', '--audit')) return 0;
    if (!ctx.isRoot) { ctx.err('dpkg: error: requested operation requires superuser privilege\n'); return 2; }
    if (opt('-i', '--install')) { ctx.err(`dpkg: error: cannot access archive '${rest[0] ?? ''}': No such file or directory\n`); return 2; }
    const purge = opt('-P', '--purge');
    let rc = 0;
    for (const n of rest) {
      if (!PACKAGES[n] || !(pk.isInstalled(sys, n) || (purge && sys.pkgState[n]?.config))) { ctx.err(`dpkg: warning: ignoring request to remove ${n} which isn't installed\n`); continue; }
      const dependents = pk.reverseDeps(sys, n);
      if (dependents.length) { ctx.err(`dpkg: dependency problems prevent removal of ${n}:\n ${dependents[0]} depends on ${n}.\n\ndpkg: error processing package ${n} (--${purge ? 'purge' : 'remove'}):\n dependency problems - not removing\nErrors were encountered while processing:\n ${n}\n`); rc = 1; continue; }
      if (PACKAGES[n].essential) { ctx.err(`dpkg: error processing package ${n} (--remove):\n this is an essential package; it should not be removed.\n`); rc = 1; continue; }
      const v = pk.installedVersion(sys, n);
      pk.removePackage(sys, n, { purge });
      dpkgLog(sys, purge ? 'purge' : 'remove', n, v, null);
      ctx.out(`(Reading database ... ${pk.installedNames(sys).length * 3 + 9500} files and directories currently installed.)\nRemoving ${n} (${v}) ...\n`);
      if (purge) ctx.out(`Purging configuration files for ${n} (${v}) ...\n`);
    }
    return rc;
  }
  ctx.err('dpkg: error: need an action option\n\nType dpkg --help for help about installing and deinstalling packages [*];\nUse \'apt\' or \'aptitude\' for user-friendly package management;\nType dpkg -Dhelp for a list of dpkg debug flag values;\n');
  return 2;
}, { usage: 'dpkg [<option> ...] <command>', noHelp: true });

function hasHold(sys, n) { return holds(sys).includes(n); }

cmd('add-apt-repository', (ctx) => {
  if (!ctx.isRoot) { ctx.err('add-apt-repository: error: must run as root (try sudo)\n'); return 1; }
  ctx.out('Repository: \'deb http://ppa.launchpad.net/example/ppa/ubuntu jammy main\'\nAdding repository.\nPress [ENTER] to continue or Ctrl-c to cancel.\n');
  return 0;
});
cmd('snap', (ctx) => { ctx.err(`Command 'snap' not found, but can be installed with:\n\nsudo apt install snapd\n`); return 127; });
cmd('unattended-upgrade', (ctx) => { if (!ctx.isRoot) { ctx.err('Must be root.\n'); return 1; } return 0; }, { pkg: 'unattended-upgrades' });
cmd('mintupdate-cli', (ctx) => { ctx.out(''); return 0; });

export { fmtDate };
