// System information, services, processes, logs, editors and GUI launchers.
import { cmd, commands, parseOpts, usageError } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import { FsError } from '../../core/vfs.js';
import * as users from '../../core/users.js';
import * as services from '../../core/services.js';
import * as pk from '../../core/packages.js';
import { fmtDate, fmtIso, posix, tzAbbrev, humanSize } from '../../core/util.js';
import { KERNEL } from '../../images/mint21.js';
import { SERVICES, PACKAGES } from '../../images/catalog.js';

const KERNEL_VERSION = '#136-Ubuntu SMP Wed Nov 6 10:38:22 UTC 2024';
const pad2 = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- polkit-style authorization (systemctl, etc.)
/** Ask for the admin password the way pkttyagent does. Returns true when authorised. */
export async function polkitAuth(ctx, actionId, message, failMsg) {
  const sys = ctx.sys;
  if (ctx.isRoot) return true;
  sys.polkitTs = sys.polkitTs || {};
  const last = sys.polkitTs[ctx.user];
  if (last && sys.now() - last < 5 * 60000) return true;
  if (ctx.term.authenticate) {
    const ok = await ctx.term.authenticate({ message: message.replace(/^Authentication is required to /, 'Authentication is required to '), action: actionId, asUser: ctx.user });
    if (!ok) ctx.err(failMsg + '\n');
    return ok;
  }
  if (!users.isAdmin(sys, ctx.user)) { ctx.err(failMsg + '\n'); return false; }
  if (!ctx.tty) { ctx.err(failMsg.replace('Access denied', 'Interactive authentication required.') + '\n'); return false; }
  const u = users.getUser(sys, ctx.user);
  const full = (u?.gecos || '').split(',')[0] || ctx.user;
  ctx.out(`==== AUTHENTICATING FOR ${actionId} ====\n${message}\nAuthenticating as: ${full} (${ctx.user})\n`);
  for (let tries = 0; tries < 3; tries++) {
    const pw = await ctx.term.readLine('Password: ', { echo: false, secret: true });
    if (pw == null) break;
    await ctx.sleep(600);
    if (users.checkPassword(sys, ctx.user, pw)) {
      ctx.out('==== AUTHENTICATION COMPLETE ====\n');
      sys.polkitTs[ctx.user] = sys.now();
      sys.log('auth.log', 'polkitd(authority=local)', `Operator of unix-session:c2 successfully authenticated as unix-user:${ctx.user} to gain TEMPORARY authorization for action ${actionId} for system-bus-name::1.80 [${ctx.name}] (owned by unix-user:${ctx.user})`);
      return true;
    }
    ctx.err('polkit-agent-helper-1: pam_authenticate failed: Authentication failure\n');
    ctx.out('==== AUTHENTICATION FAILED ====\n');
    break;
  }
  ctx.err(failMsg + '\n');
  return false;
}

// ---------------------------------------------------------------- uname / hostname / uptime / date / free
cmd('uname', (ctx) => {
  const { o, err } = parseOpts(ctx.args, { bool: 'asnrvmpio', long: { 'kernel-name': 's', 'nodename': 'n', 'kernel-release': 'r', 'kernel-version': 'v', machine: 'm', 'operating-system': 'o', all: 'a', processor: 'p', 'hardware-platform': 'i' } });
  if (err) return usageError(ctx, err);
  const f = { s: 'Linux', n: ctx.sys.hostname, r: KERNEL, v: KERNEL_VERSION, m: 'x86_64', p: 'x86_64', i: 'x86_64', o: 'GNU/Linux' };
  const keys = o.a ? ['s', 'n', 'r', 'v', 'm', 'p', 'i', 'o'] : 'snrvmpio'.split('').filter((k) => o[k]);
  ctx.out((keys.length ? keys : ['s']).map((k) => f[k]).join(' ') + '\n');
  return 0;
});

cmd('hostname', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'sfidIay', long: { short: 's', fqdn: 'f', 'all-ip-addresses': 'I', 'ip-address': 'i', domain: 'd' } });
  if (err) return usageError(ctx, err);
  if (rest.length) {
    if (!ctx.isRoot) { ctx.err('hostname: you must be root to change the host name\n'); return 1; }
    ctx.sys.hostname = rest[0];
    ctx.sys.vfs.writeFile('/etc/hostname', rest[0] + '\n');
    ctx.sys.touch('hostname');
    return 0;
  }
  if (o.I || o.i) { ctx.out('10.0.2.15 \n'); return 0; }
  if (o.d) { ctx.out('\n'); return 0; }
  if (o.s) { ctx.out(ctx.sys.hostname.split('.')[0] + '\n'); return 0; }
  ctx.out(ctx.sys.hostname + '\n');
  return 0;
});

cmd('hostnamectl', async (ctx) => {
  const a = ctx.args.filter((x) => !x.startsWith('-'));
  if (a[0] === 'set-hostname') {
    if (!a[1]) { ctx.err('Argument required.\n'); return 1; }
    if (!(await polkitAuth(ctx, 'org.freedesktop.hostname1.set-static-hostname', 'Authentication is required to set the statically configured local host name, as well as the pretty host name.', 'Could not set static hostname: Access denied'))) return 1;
    ctx.sys.hostname = a[1]; ctx.sys.vfs.writeFile('/etc/hostname', a[1] + '\n'); ctx.sys.touch('hostname');
    return 0;
  }
  const up = (s) => s;
  ctx.out(`   Static hostname: ${ctx.sys.hostname}\n         Icon name: computer-vm\n           Chassis: vm\n        Machine ID: 6b2f9a0f6f2d4f5aa3cbe3b9b1c7d0e1\n           Boot ID: 3d7a1f55c0a14d0e9e4b2fb1f2a61c0b\n    Virtualization: ${up('oracle')}\n  Operating System: Linux Mint 21.3\n            Kernel: Linux ${KERNEL}\n      Architecture: x86-64\n Hardware Vendor: innotek GmbH\n  Hardware Model: VirtualBox\n`);
  return 0;
});

function uptimeParts(sys) {
  const secs = Math.max(0, Math.floor((sys.now() - sys.bootTime) / 1000));
  const d = Math.floor(secs / 86400); const h = Math.floor((secs % 86400) / 3600); const m = Math.floor((secs % 3600) / 60);
  return { secs, d, h, m };
}
function upText(sys) {
  const { d, h, m } = uptimeParts(sys);
  const parts = [];
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m || !parts.length) parts.push(`${m} min`);
  return parts;
}
const clock = (ms) => { const dt = new Date(ms); return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`; };
export const loadavg = (sys) => { const n = sys.processes.length; return [0.05 + (n % 7) / 100, 0.09 + (n % 5) / 100, 0.08 + (n % 3) / 100]; };

cmd('uptime', (ctx) => {
  const { o } = parseOpts(ctx.args, { bool: 'psV', long: { pretty: 'p', since: 's' } });
  const sys = ctx.sys;
  if (o.s) { ctx.out(fmtIso(sys.bootTime).replace('T', ' ').slice(0, 19) + '\n'); return 0; }
  if (o.p) { ctx.out('up ' + upText(sys).join(', ').replace(/ min$/, ' minutes') + '\n'); return 0; }
  const sess = ctx.sys.vfs.exists('/run/utmp') ? (ctx.sys.vfs.readFile('/run/utmp').split('\n').filter(Boolean).length || 1) : 1;
  const up = upText(sys).join(',  ').replace(/(\d+) hours?$/, (x) => x).replace(/,  /g, ', ');
  const l = loadavg(sys).map((x) => x.toFixed(2)).join(', ');
  ctx.out(` ${clock(sys.now())} up ${up},  ${sess} user${sess === 1 ? '' : 's'},  load average: ${l}\n`);
  return 0;
});

export function strftime(fmt, ms) {
  const d = new Date(ms);
  const hr12 = d.getHours() % 12 || 12;
  const tz = tzAbbrev(ms);
  const off = -d.getTimezoneOffset();
  const offs = `${off < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(off) / 60))}${pad2(Math.abs(off) % 60)}`;
  const yday = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
  const map = {
    a: DAY[d.getDay()], A: DAYFULL[d.getDay()], b: MON[d.getMonth()], B: MONFULL[d.getMonth()], h: MON[d.getMonth()],
    c: `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${clock(ms)} ${d.getFullYear()}`,
    d: pad2(d.getDate()), e: String(d.getDate()).padStart(2, ' '), D: `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(2)}`,
    F: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, H: pad2(d.getHours()), I: pad2(hr12), j: String(yday).padStart(3, '0'),
    k: String(d.getHours()).padStart(2, ' '), l: String(hr12).padStart(2, ' '), m: pad2(d.getMonth() + 1), M: pad2(d.getMinutes()), n: '\n', p: d.getHours() < 12 ? 'AM' : 'PM', P: d.getHours() < 12 ? 'am' : 'pm',
    r: `${pad2(hr12)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`, R: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, s: String(Math.floor(ms / 1000)), S: pad2(d.getSeconds()),
    t: '\t', T: clock(ms), u: String(d.getDay() || 7), w: String(d.getDay()), x: `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(2)}`, X: clock(ms), y: String(d.getFullYear()).slice(2), Y: String(d.getFullYear()),
    z: offs, Z: tz, N: String((ms % 1000) * 1000000).padStart(9, '0'), '%': '%',
  };
  return fmt.replace(/%([-_0^#]?)([a-zA-Z%])/g, (m0, flag, c) => {
    let v = map[c];
    if (v == null) return m0;
    if (flag === '-') v = v.replace(/^[0 ]+(?=.)/, '');
    else if (flag === '_') v = v.replace(/^0+(?=.)/, (z) => ' '.repeat(z.length));
    else if (flag === '^') v = v.toUpperCase();
    return v;
  });
}

cmd('date', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'uRI', val: 'dsr', long: { utc: 'u', date: { key: 'd', val: true }, set: { key: 's', val: true }, 'iso-8601': { key: 'I', val: true, optional: true }, 'rfc-2822': 'R' } });
  if (err) return usageError(ctx, err);
  if (o.s) { ctx.err('date: cannot set date: Operation not permitted\n' + fmtDate(ctx.sys.now()) + '\n'); return 1; }
  let ms = ctx.sys.now();
  if (o.d) {
    const s = String(o.d).trim();
    if (/^@-?\d+$/.test(s)) ms = Number(s.slice(1)) * 1000;
    else if (/^now$/i.test(s)) ms = ctx.sys.now();
    else if (/^yesterday$/i.test(s)) ms -= 86400000;
    else if (/^tomorrow$/i.test(s)) ms += 86400000;
    else { const m = /^([+-]?\d+)\s*(second|sec|minute|min|hour|day|week|month|year)s?(\s+ago)?$/i.exec(s); if (m) { const mul = { second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }[m[2].toLowerCase()]; ms += Number(m[1]) * mul * (m[3] ? -1 : 1); } else { const t = Date.parse(s); if (Number.isNaN(t)) { ctx.err(`date: invalid date ‘${s}’\n`); return 1; } ms = t; } }
  }
  const fmt = rest.find((a) => a.startsWith('+'));
  let text;
  if (fmt) text = strftime(fmt.slice(1), ms);
  else if (o.I) text = strftime(o.I === 'seconds' ? '%FT%T%z' : '%F', ms);
  else if (o.R) text = strftime('%a, %d %b %Y %T %z', ms);
  else text = fmtDate(ms);
  if (o.u) text = new Date(ms).toUTCString().replace('GMT', 'UTC').replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) UTC$/, (_, w, dd, mo, yy, tt) => `${w} ${mo} ${dd.padStart(2, ' ')} ${tt} UTC ${yy}`);
  ctx.out(text + '\n');
  return 0;
});

cmd('timedatectl', (ctx) => {
  const ms = ctx.sys.now();
  const z = tzAbbrev(ms);
  const d = new Date(ms);
  const utc = new Date(ms);
  ctx.out(`               Local time: ${DAY[d.getDay()]} ${strftime('%F %T', ms)} ${z}\n           Universal time: ${DAY[utc.getUTCDay()]} ${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())} ${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}:${pad2(utc.getUTCSeconds())} UTC\n                 RTC time: ${DAY[utc.getUTCDay()]} ${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())} ${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}:${pad2(utc.getUTCSeconds())}\n                Time zone: America/New_York (${z}, ${strftime('%z', ms)})\nSystem clock synchronized: yes\n              NTP service: active\n          RTC in local TZ: no\n`);
  return 0;
});

const MEM = { total: 4009040, free: 1873512, shared: 25432, buff: 410220, cache: 612300, swapTotal: 2097148 };
function memInfo(sys) {
  const procs = sys.processes.length;
  const used = 880000 + procs * 2100;
  const free = Math.max(200000, MEM.total - used - MEM.buff - MEM.cache);
  const avail = MEM.total - used + Math.floor(MEM.cache * 0.8);
  return { total: MEM.total, used, free, shared: MEM.shared, buff: MEM.buff + MEM.cache, avail, swapTotal: MEM.swapTotal, swapUsed: 0 };
}
export { memInfo };

cmd('free', (ctx) => {
  const { o, err } = parseOpts(ctx.args, { bool: 'bkmghtwsl', long: { human: 'h', total: 't', mega: 'M', giga: 'G', kibi: 'k', mebi: 'm', gibi: 'g', bytes: 'b', si: 'H', wide: 'w' } });
  if (err) return usageError(ctx, err);
  const m = memInfo(ctx.sys);
  const conv = (kb) => {
    if (o.b) return String(kb * 1024);
    if (o.m) return String(Math.floor(kb / 1024));
    if (o.g) return String(Math.floor(kb / 1048576));
    if (o.h) return humanSize(kb * 1024).replace(/(\d)([KMGT])$/, '$1$2i').replace(/^([\d.]+)$/, '$1B');
    return String(kb);
  };
  const w = o.h ? 11 : 12;
  const row = (label, vals) => label.padEnd(8) + vals.map((v) => String(v).padStart(w)).join('') + '\n';
  ctx.out(`${''.padEnd(8)}${['total', 'used', 'free', 'shared', 'buff/cache', 'available'].map((s) => s.padStart(w)).join('')}\n`);
  ctx.out(row('Mem:', [m.total, m.used, m.free, m.shared, m.buff, m.avail].map(conv)));
  ctx.out(row('Swap:', [m.swapTotal, 0, m.swapTotal].map(conv)));
  if (o.t) ctx.out(row('Total:', [m.total + m.swapTotal, m.used, m.free + m.swapTotal].map(conv)));
  return 0;
});

cmd('lsb_release', (ctx) => {
  const { o, err } = parseOpts(ctx.args, { bool: 'aidrcsvh', long: { all: 'a', id: 'i', description: 'd', release: 'r', codename: 'c', short: 's', version: 'v' } });
  if (err) return usageError(ctx, err);
  const rows = { i: ['Distributor ID', 'LinuxMint'], d: ['Description', 'Linux Mint 21.3'], r: ['Release', '21.3'], c: ['Codename', 'virginia'] };
  if (o.v) { ctx.out('No LSB modules are available.\n'); return 0; }
  const keys = o.a ? ['i', 'd', 'r', 'c'] : ['i', 'd', 'r', 'c'].filter((k) => o[k]);
  if (!keys.length) { ctx.out('No LSB modules are available.\n'); return 0; }
  if (o.a) ctx.out('No LSB modules are available.\n');
  for (const k of keys) ctx.out(o.s ? rows[k][1] + '\n' : `${rows[k][0]}:\t${rows[k][1]}\n`);
  return 0;
});

cmd('nproc', (ctx) => { ctx.out('2\n'); return 0; });
cmd('arch', (ctx) => { ctx.out('x86_64\n'); return 0; });
cmd('lscpu', (ctx) => { ctx.out('Architecture:                         x86_64\nCPU op-mode(s):                       32-bit, 64-bit\nAddress sizes:                        39 bits physical, 48 bits virtual\nByte Order:                           Little Endian\nCPU(s):                               2\nOn-line CPU(s) list:                  0,1\nVendor ID:                            GenuineIntel\nModel name:                           Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz\nThread(s) per core:                   1\nCore(s) per socket:                   2\nSocket(s):                            1\nHypervisor vendor:                    KVM\nVirtualization type:                  full\n'); return 0; });
cmd('lsblk', (ctx) => { ctx.out('NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nloop0    7:0    0    4K  1 loop /snap/bare/5\nsda      8:0    0   40G  0 disk \n├─sda1   8:1    0  512M  0 part /boot/efi\n└─sda2   8:2    0 39.5G  0 part /\nsr0     11:0    1 1024M  0 rom  \n'); return 0; });
cmd('lsmod', (ctx) => { ctx.out('Module                  Size  Used by\nsnd_intel8x0           49152  2\nsnd_ac97_codec        176128  1 snd_intel8x0\nvboxvideo              45056  0\nintel_rapl_msr         20480  0\ncrct10dif_pclmul       16384  1\nghash_clmulni_intel    16384  0\nvboxguest              45056  3\nnls_iso8859_1          16384  1\n'); return 0; });
cmd('lspci', (ctx) => { ctx.out('00:00.0 Host bridge: Intel Corporation 440FX - 82441FX PMC [Natoma] (rev 02)\n00:01.0 ISA bridge: Intel Corporation 82371SB PIIX3 ISA [Natoma/Triton II]\n00:02.0 VGA compatible controller: VMware SVGA II Adapter\n00:03.0 Ethernet controller: Intel Corporation 82540EM Gigabit Ethernet Controller (rev 02)\n00:04.0 System peripheral: InnoTek Systemberatung GmbH VirtualBox Guest Service\n'); return 0; });

// ---------------------------------------------------------------- systemctl / service
const sysUnitName = (n) => String(n).replace(/\.service$/, '');
const ACTIONS = {
  start: 'org.freedesktop.systemd1.manage-units', stop: 'org.freedesktop.systemd1.manage-units', restart: 'org.freedesktop.systemd1.manage-units', reload: 'org.freedesktop.systemd1.manage-units',
  'try-restart': 'org.freedesktop.systemd1.manage-units', 'reload-or-restart': 'org.freedesktop.systemd1.manage-units',
  enable: 'org.freedesktop.systemd1.manage-unit-files', disable: 'org.freedesktop.systemd1.manage-unit-files', mask: 'org.freedesktop.systemd1.manage-unit-files', unmask: 'org.freedesktop.systemd1.manage-unit-files',
};

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function systemctlMain(ctx, args, { fromService = false } = {}) {
  const flags = { now: false, noPager: false, quiet: false, type: null, state: null, all: false, property: null, noLegend: false, full: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--now') flags.now = true;
    else if (a === '--no-pager') flags.noPager = true;
    else if (a === '-q' || a === '--quiet') flags.quiet = true;
    else if (a === '--no-legend') flags.noLegend = true;
    else if (a === '-a' || a === '--all') flags.all = true;
    else if (a === '-l' || a === '--full') flags.full = true;
    else if (a.startsWith('--type=')) flags.type = a.slice(7);
    else if (a === '-t' || a === '--type') flags.type = args[++i];
    else if (a.startsWith('--state=')) flags.state = a.slice(8);
    else if (a === '--failed') flags.state = 'failed';
    else if (a === '--user' || a === '--system' || a === '--no-ask-password' || a === '--no-block' || a === '--runtime' || a === '--force' || a === '-f') { /* accepted */ }
    else if (a === '-p' || a === '--property') flags.property = args[++i];
    else if (a.startsWith('--property=')) flags.property = a.slice(11);
    else if (a === '--version') { ctx.out('systemd 249 (249.11-0ubuntu3.12)\n+PAM +AUDIT +SELINUX +APPARMOR +IMA +SMACK +SECCOMP +GCRYPT +GNUTLS +OPENSSL +ACL +BLKID +CURL +ELFUTILS +FIDO2 +IDN2 -IDN +IPTC +KMOD +LIBCRYPTSETUP +LIBFDISK +PCRE2 -PWQUALITY -P11KIT -QRENCODE +BZIP2 +LZ4 +XZ +ZLIB +ZSTD -XKBCOMMON +UTMP +SYSVINIT default-hierarchy=unified\n'); return 0; }
    else if (a === '-h' || a === '--help') { ctx.out('systemctl [OPTIONS...] COMMAND ...\n\nQuery or send control commands to the system manager.\n'); return 0; }
    else if (a.startsWith('-') && a.length > 1 && !a.startsWith('--')) { for (const c of a.slice(1)) { if (c === 'q') flags.quiet = true; else if (c === 'a') flags.all = true; else if (c === 'l') flags.full = true; else if (c === 'f') { /* force */ } else { ctx.err(`systemctl: invalid option -- '${c}'\n`); return 1; } } }
    else if (a.startsWith('--')) { ctx.err(`systemctl: unrecognized option '${a}'\n`); return 1; }
    else rest.push(a);
  }
  const sys = ctx.sys;
  const verb = rest[0] ?? 'list-units';
  const names = rest.slice(1);

  const need = (n = 1) => { if (names.length < n) { ctx.err('Too few arguments.\n'); return false; } return true; };

  switch (verb) {
    case 'status': {
      if (!names.length) { ctx.out(`● ${sys.hostname}\n    State: running\n    Units: 312 loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: 0 units\n    Since: ${services.fmtUnitTime(sys.bootTime)}; ${services.relAgo(sys.bootTime, sys.now())}\n`); return 0; }
      let rc = 0;
      names.forEach((n, i) => {
        const r = services.statusText(sys, n);
        if (i > 0) ctx.out('\n');
        if (r.code === 4) ctx.err(r.text); else ctx.out(r.text);
        rc = Math.max(rc, r.code);
      });
      return rc;
    }
    case 'start': case 'stop': case 'restart': case 'reload': case 'try-restart': case 'reload-or-restart': case 'enable': case 'disable': case 'mask': case 'unmask': {
      if (!need()) return 1;
      const isFile = ['enable', 'disable', 'mask', 'unmask'].includes(verb);
      const first = sysUnitName(names[0]);
      const bad = (verb === 'start' || verb === 'stop' || verb === 'restart' || verb === 'reload') ? `Failed to ${verb} ${first}.service: Access denied\nSee system logs and 'systemctl status ${first}.service' for details.` : 'Failed to ' + verb + ' unit: Access denied';
      const msg = isFile ? 'Authentication is required to manage system service or unit files.' : `Authentication is required to ${verb} '${first}.service'.`;
      if (!(await polkitAuth(ctx, ACTIONS[verb], msg, bad))) return 1;
      let rc = 0;
      for (const n of names) {
        try {
          const unit = sysUnitName(n);
          if (verb === 'start') services.startUnit(sys, n);
          else if (verb === 'stop') services.stopUnit(sys, n);
          else if (verb === 'restart' || verb === 'reload-or-restart') services.restartUnit(sys, n);
          else if (verb === 'try-restart') { if (services.isActive(sys, n)) services.restartUnit(sys, n); }
          else if (verb === 'reload') services.reloadUnit(sys, n);
          else if (verb === 'enable') { for (const m of services.enableUnit(sys, n)) ctx.err(m + '\n'); if (flags.now) services.startUnit(sys, n); }
          else if (verb === 'disable') { for (const m of services.disableUnit(sys, n)) ctx.err(m + '\n'); if (flags.now) services.stopUnit(sys, n); }
          else if (verb === 'mask') { for (const m of services.maskUnit(sys, n)) ctx.err(m + '\n'); if (flags.now) services.stopUnit(sys, n); }
          else if (verb === 'unmask') { for (const m of services.unmaskUnit(sys, n)) ctx.err(m + '\n'); }
          void unit;
        } catch (e) {
          if (e instanceof CmdError) { ctx.err(e.message + '\n'); rc = e.code || 1; } else throw e;
        }
      }
      return rc;
    }
    case 'is-active': case 'is-enabled': case 'is-failed': {
      if (!need()) return 1;
      let rc = 0;
      for (const n of names) {
        const c = services.canonical(n);
        const st = c && sys.svcState[c];
        let text; let ok;
        if (verb === 'is-active') { text = st ? (st.enabled === 'masked' && st.active !== 'active' ? 'inactive' : st.active) : 'inactive'; ok = text === 'active'; }
        else if (verb === 'is-failed') { text = st ? (st.active === 'failed' ? 'failed' : st.active) : 'inactive'; ok = text === 'failed'; }
        else { if (!st) { ctx.err(`Failed to get unit file state for ${sysUnitName(n)}.service: No such file or directory\n`); rc = 1; continue; } text = st.enabled; ok = ['enabled', 'static'].includes(text); }
        if (!flags.quiet) ctx.out(text + '\n');
        if (!ok) rc = verb === 'is-active' || verb === 'is-failed' ? 3 : 1;
      }
      return rc;
    }
    case 'list-units': case 'list-unit-files': case 'list-sockets': case 'list-timers': case 'list-dependencies': {
      if (verb === 'list-timers') { ctx.out('NEXT                        LEFT          LAST                        PASSED       UNIT                         ACTIVATES                     \nSat 2026-10-24 17:00:00 EDT 11min left    Sat 2026-10-24 16:00:00 EDT 48min ago    anacron.timer                anacron.service\n\n1 timers listed.\nPass --all to see loaded but inactive timers, too.\n'); return 0; }
      if (verb === 'list-sockets') { ctx.out('LISTEN                          UNIT                         ACTIVATES\n/run/dbus/system_bus_socket     dbus.socket                  dbus.service\n/run/systemd/journal/socket     systemd-journald.socket      systemd-journald.service\n/run/udev/control               systemd-udevd-control.socket systemd-udevd.service\n\n3 sockets listed.\n'); return 0; }
      if (verb === 'list-dependencies') { ctx.out('default.target\n○ ├─display-manager.service\n● ├─lightdm.service\n● └─multi-user.target\n'); return 0; }
      let list = services.listUnits(sys);
      if (flags.type && flags.type !== 'service') list = [];
      if (verb === 'list-unit-files') {
        const rows = list.map((u) => ({ unit: u.unit, state: u.enabled }));
        if (!flags.noLegend) ctx.out(pad('UNIT FILE', 44) + 'STATE           VENDOR PRESET\n');
        for (const r of rows) ctx.out(pad(r.unit, 44) + pad(r.state, 16) + (SERVICES[sysUnitName(r.unit)]?.enabledByDefault === false ? 'disabled' : 'enabled') + '\n');
        if (!flags.noLegend) ctx.out(`\n${rows.length} unit files listed.\n`);
        return 0;
      }
      if (flags.state) list = list.filter((u) => u.active === flags.state || u.sub === flags.state);
      else if (!flags.all) list = list.filter((u) => u.active === 'active' || u.active === 'failed');
      if (!flags.noLegend) ctx.out(pad('  UNIT', 44) + pad('LOAD', 7) + pad('ACTIVE', 7) + pad('SUB', 10) + 'DESCRIPTION\n');
      for (const u of list) ctx.out(`${u.active === 'failed' ? '\u001b[0;1;31m●\u001b[0m' : ' '} ${pad(u.unit, 42)}${pad(u.load, 7)}${pad(u.active, 7)}${pad(u.sub, 10)}${u.desc}\n`);
      if (!flags.noLegend) ctx.out(`\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n\n${list.length} loaded units listed.${flags.all ? '' : ' Pass --all to see loaded but inactive units, too.\nTo show all installed unit files use \'systemctl list-unit-files\'.'}\n`);
      return 0;
    }
    case 'show': {
      if (!need()) return 1;
      const c = services.canonical(names[0]);
      const st = c && sys.svcState[c];
      if (!st) { ctx.out(`Id=${sysUnitName(names[0])}.service\nNames=${sysUnitName(names[0])}.service\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n`); return 0; }
      const d = SERVICES[c];
      const props = { Id: d.unit, Names: d.unit, Description: d.desc, LoadState: st.enabled === 'masked' ? 'masked' : 'loaded', ActiveState: st.active, SubState: st.active === 'active' ? 'running' : 'dead', UnitFileState: st.enabled, MainPID: st.pid || 0, FragmentPath: `${services.UNIT_DIR}/${d.unit}` };
      if (flags.property) { for (const p of flags.property.split(',')) if (p in props) ctx.out(`${p}=${props[p]}\n`); } else for (const [k, v] of Object.entries(props)) ctx.out(`${k}=${v}\n`);
      return 0;
    }
    case 'cat': {
      if (!need()) return 1;
      const c = services.canonical(names[0]);
      if (!c) { ctx.err(`No files found for ${sysUnitName(names[0])}.service.\n`); return 1; }
      ctx.out(`# ${services.UNIT_DIR}/${SERVICES[c].unit}\n`);
      try { ctx.out(sys.vfs.readFile(`${services.UNIT_DIR}/${SERVICES[c].unit}`)); } catch { /* none */ }
      return 0;
    }
    case 'daemon-reload': case 'daemon-reexec': {
      if (!(await polkitAuth(ctx, 'org.freedesktop.systemd1.reload-daemon', 'Authentication is required to reload the systemd state.', 'Failed to reload daemon: Access denied'))) return 1;
      return 0;
    }
    case 'reset-failed': return 0;
    case 'get-default': ctx.out('graphical.target\n'); return 0;
    case 'is-system-running': ctx.out('running\n'); return 0;
    case 'reboot': case 'poweroff': case 'halt': case 'suspend': {
      if (!(await polkitAuth(ctx, 'org.freedesktop.login1.reboot', 'Authentication is required to reboot the system.', 'Failed to reboot system via logind: Access denied'))) return 1;
      return powerAction(ctx, verb);
    }
    default:
      ctx.err(`Unknown command verb ${verb}.\n`);
      return 1;
  }
}

function powerAction(ctx, kind) {
  if (kind === 'reboot') ctx.term.power?.('reboot');
  else if (kind === 'suspend') ctx.out('');
  else ctx.term.power?.('poweroff');
  return 0;
}

cmd('systemctl', (ctx) => systemctlMain(ctx, ctx.args), { usage: 'systemctl [OPTIONS...] COMMAND ...', noHelp: true });

cmd('service', async (ctx) => {
  const a = ctx.args;
  if (a[0] === '--status-all') {
    const list = services.listUnits(ctx.sys).filter((u) => u.enabled !== 'masked');
    for (const u of list) ctx.out(` [ ${u.active === 'active' ? '+' : '-'} ]  ${u.name}\n`);
    return 0;
  }
  if (a.length < 2) { ctx.err('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]\n'); return 1; }
  const [name, action] = a;
  if (!services.canonical(name) || !ctx.sys.svcState[services.canonical(name)]) { ctx.err(`${name}: unrecognized service\n`); return 1; }
  if (action === 'status') { const r = services.statusText(ctx.sys, name); ctx.out(r.text); return r.code; }
  if (action === '--full-restart') return systemctlMain(ctx, ['restart', name]);
  if (!['start', 'stop', 'restart', 'reload', 'force-reload', 'try-restart'].includes(action)) { ctx.err(`Usage: ${name} {start|stop|restart|reload|force-reload|status}\n`); return 1; }
  return systemctlMain(ctx, [action === 'force-reload' ? 'reload' : action, name], { fromService: true });
}, { usage: 'service SCRIPT COMMAND', noHelp: true });

cmd('systemd-analyze', (ctx) => { ctx.out('Startup finished in 3.512s (kernel) + 11.204s (userspace) = 14.716s \ngraphical.target reached after 11.021s in userspace\n'); return 0; });

cmd(['reboot', 'poweroff', 'halt', 'shutdown'], async (ctx) => {
  if (!ctx.isRoot) {
    if (!(await polkitAuth(ctx, 'org.freedesktop.login1.reboot', 'Authentication is required to reboot the system.', ctx.name === 'shutdown' ? 'Failed to set wall message, ignoring: Interactive authentication required.\nFailed to call ScheduleShutdown in logind, proceeding with immediate shutdown: Interactive authentication required.\nCall to PowerOff failed: Access denied' : `Failed to ${ctx.name} system via logind: Access denied`))) return 1;
  }
  const kind = ctx.name === 'reboot' || ctx.args.includes('-r') ? 'reboot' : 'poweroff';
  ctx.out(ctx.name === 'shutdown' ? `Shutdown scheduled for ${fmtDate(ctx.sys.now() + 60000)}, use 'shutdown -c' to cancel.\n` : '');
  return powerAction(ctx, kind);
});

cmd('loginctl', (ctx) => {
  const v = ctx.args[0];
  if (v === 'list-sessions') ctx.out('SESSION  UID USER    SEAT  TTY\n      c2 1000 student seat0 tty7\n\n1 sessions listed.\n');
  else if (v === 'list-users') ctx.out('UID USER\n1000 student\n\n1 users listed.\n');
  else ctx.out('SESSION  UID USER    SEAT  TTY\n      c2 1000 student seat0 tty7\n\n1 sessions listed.\n');
  return 0;
});

// ---------------------------------------------------------------- processes
function ttyOf(ctx) { return `pts/${(ctx.sh.ttyNo ?? 1)}`; }

function fmtStart(ctx, ms) {
  const d = new Date(ms); const n = new Date(ctx.sys.now());
  if (d.toDateString() === n.toDateString()) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${MON[d.getMonth()]}${pad2(d.getDate())}`;
}
function cpuTime(p, now) { const secs = Math.floor(((now - p.start) / 1000) * (p.cpu || 0) / 100); return `${Math.floor(secs / 60)}:${pad2(secs % 60)}`; }

/** All processes the shell can see, including this terminal's own bash and the command being run. */
export function allProcs(ctx, { includeSelf = true } = {}) {
  const sys = ctx.sys;
  const list = sys.processes.slice();
  if (includeSelf) {
    const t = ttyOf(ctx);
    const bashPid = ctx.sh.pid;
    if (!list.some((p) => p.pid === bashPid)) list.push({ pid: bashPid, ppid: 1190, user: ctx.sh.frames[0].user, cmd: 'bash', comm: 'bash', tty: t, stat: 'Ss', start: sys.now() - 60000, cpu: 0, mem: 0.1, vsz: 19000, rss: 5100 });
    list.push({ pid: sys.nextPid + 1000 + (list.length % 500), ppid: bashPid, user: ctx.user, cmd: ctx.argv.join(' ').replace(/^ps/, 'ps'), comm: ctx.name, tty: t, stat: 'R+', start: sys.now(), cpu: 0, mem: 0, vsz: 13000, rss: 3500 });
  }
  return list;
}
const userCol = (u, w = 8) => (u.length > w ? u.slice(0, w - 1) + '+' : u);

cmd('ps', (ctx) => {
  const sys = ctx.sys;
  let args = ctx.args.slice();
  const opt = { e: false, f: false, a: false, u: false, x: false, l: false, F: false, j: false, forest: false, sort: null, o: null, users: null, pids: null, comm: null, h: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a === '--forest') { opt.forest = true; continue; }
    if (a.startsWith('--sort=')) { opt.sort = a.slice(7); continue; }
    if (a === '--sort') { opt.sort = args[++i]; continue; }
    if (a === '--no-headers') { opt.h = true; continue; }
    if (a.startsWith('--')) { ctx.err(`ps: unrecognized option '${a}'\n`); return 1; }
    if (a[0] === '-') {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if ('eAfFlxjaTrwNh'.includes(c)) { if (c === 'A') opt.e = true; else if (c === 'a') opt.a = true; else if (c === 'h') opt.h = true; else opt[c] = true; }
        else if (c === 'u' || c === 'U') { const v = a.slice(j + 1) || args[++i]; opt.users = (v || '').split(','); break; }
        else if (c === 'p') { const v = a.slice(j + 1) || args[++i]; opt.pids = (v || '').split(',').map(Number); break; }
        else if (c === 'C') { const v = a.slice(j + 1) || args[++i]; opt.comm = (v || '').split(','); break; }
        else if (c === 'o' || c === 'O') { const v = a.slice(j + 1) || args[++i]; opt.o = v; break; }
        else if (c === 't') { const v = a.slice(j + 1) || args[++i]; opt.tty = v; break; }
        else { ctx.err(`ps: invalid option -- '${c}'\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).\n`); return 1; }
      }
      continue;
    }
    rest.push(a);
  }
  // BSD style words: "aux", "auxww", "axjf"
  let bsd = false;
  for (const w of rest) {
    if (/^[auxwfeljv]+$/.test(w)) { bsd = true; if (w.includes('a')) opt.a = true; if (w.includes('u')) opt.u = true; if (w.includes('x')) opt.x = true; if (w.includes('f')) opt.forest = true; if (w.includes('e')) opt.e = true; if (w.includes('l')) opt.l = true; }
    else if (/^\d+$/.test(w)) opt.pids = [...(opt.pids || []), Number(w)];
  }
  const now = sys.now();
  const procs = allProcs(ctx);
  const myTty = ttyOf(ctx);
  let sel;
  if (opt.pids) sel = procs.filter((p) => opt.pids.includes(p.pid));
  else if (opt.comm) sel = procs.filter((p) => opt.comm.includes(p.comm));
  else if (opt.users) sel = procs.filter((p) => opt.users.includes(p.user) || opt.users.includes(String(users.getUser(sys, p.user)?.uid)));
  else if (opt.e || (opt.a && opt.x) || (bsd && opt.x && opt.a)) sel = procs;
  else if (opt.a) sel = procs.filter((p) => p.tty !== '?');
  else if (bsd && opt.x) sel = procs.filter((p) => p.user === ctx.user);
  else if (bsd && opt.u && !opt.a) sel = procs.filter((p) => p.user === ctx.user && p.tty !== '?');
  else sel = procs.filter((p) => p.tty === myTty && p.user === ctx.sh.frames[0].user || (p.tty === myTty));
  if (opt.sort) {
    const key = opt.sort.replace(/^[+-]/, ''); const dir = opt.sort[0] === '-' ? -1 : 1;
    const get = { pid: (p) => p.pid, '%cpu': (p) => p.cpu, pcpu: (p) => p.cpu, '%mem': (p) => p.mem, pmem: (p) => p.mem, rss: (p) => p.rss, vsz: (p) => p.vsz, user: (p) => p.user, comm: (p) => p.comm, ppid: (p) => p.ppid }[key] || ((p) => p.pid);
    sel = sel.slice().sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * dir);
  } else sel = sel.slice().sort((a, b) => a.pid - b.pid);
  const lines = [];
  const header = (s) => { if (!opt.h) lines.push(s); };
  if (opt.o) {
    const cols = opt.o.split(/[, ]+/).filter(Boolean).map((c) => c.split('=')[0]);
    const spec = {
      pid: ['PID', (p) => p.pid, 7, 1], ppid: ['PPID', (p) => p.ppid, 7, 1], user: ['USER', (p) => userCol(p.user, 8), 8], uid: ['UID', (p) => users.getUser(sys, p.user)?.uid ?? 0, 5, 1], comm: ['COMMAND', (p) => p.comm, 0], command: ['COMMAND', (p) => p.cmd, 0], args: ['COMMAND', (p) => p.cmd, 0], cmd: ['CMD', (p) => p.cmd, 0],
      '%cpu': ['%CPU', (p) => p.cpu.toFixed(1), 4, 1], pcpu: ['%CPU', (p) => p.cpu.toFixed(1), 4, 1], '%mem': ['%MEM', (p) => p.mem.toFixed(1), 4, 1], pmem: ['%MEM', (p) => p.mem.toFixed(1), 4, 1], rss: ['RSS', (p) => p.rss, 6, 1], vsz: ['VSZ', (p) => p.vsz, 7, 1],
      tty: ['TT', (p) => p.tty, 8], stat: ['STAT', (p) => p.stat, 4], time: ['TIME', (p) => '00:' + cpuTime(p, now).padStart(5, '0'), 8, 1], start: ['STARTED', (p) => fmtStart(ctx, p.start), 8, 1], etime: ['ELAPSED', (p) => { const s = Math.floor((now - p.start) / 1000); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; }, 11, 1], nice: ['NI', () => 0, 3, 1], group: ['GROUP', (p) => users.getGroupByGid(sys, users.getUser(sys, p.user)?.gid)?.name ?? p.user, 8],
    };
    const used = cols.map((c) => spec[c.toLowerCase()]).filter(Boolean);
    if (used.length !== cols.length) { ctx.err('error: unknown user-defined format specifier "' + cols.find((c) => !spec[c.toLowerCase()]) + '"\n'); return 1; }
    const fmtRow = (vals) => vals.map((v, i) => { const [, , w, right] = used[i]; const isLast = i === used.length - 1; if (isLast && !right) return String(v); return right ? String(v).padStart(w) : String(v).padEnd(w); }).join(' ');
    const names = opt.o.split(/[, ]+/).filter(Boolean).map((c, i) => (c.includes('=') ? c.split('=')[1] : used[i][0]));
    header(fmtRow(names));
    for (const p of sel) lines.push(fmtRow(used.map((u) => u[1](p))));
  } else if (bsd && opt.u || opt.u) {
    header('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
    for (const p of sel) lines.push(`${userCol(p.user, 12).padEnd(12)} ${String(p.pid).padStart(5)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(p.vsz).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${p.stat.padEnd(4)} ${fmtStart(ctx, p.start).padEnd(5)} ${cpuTime(p, now).padStart(6)} ${p.cmd}`);
  } else if (opt.f || opt.F) {
    if (opt.F) header('UID          PID    PPID  C    SZ   RSS PSR STIME TTY          TIME CMD');
    else header('UID          PID    PPID  C STIME TTY          TIME CMD');
    for (const p of sel) {
      const t = '00:' + cpuTime(p, now).padStart(5, '0');
      if (opt.F) lines.push(`${userCol(p.user).padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  0 ${String(Math.floor(p.vsz / 4)).padStart(5)} ${String(p.rss).padStart(5)}   0 ${fmtStart(ctx, p.start).padEnd(5)} ${p.tty.padEnd(8)} ${t} ${p.cmd}`);
      else lines.push(`${userCol(p.user).padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  ${p.cpu >= 1 ? Math.round(p.cpu) : 0} ${fmtStart(ctx, p.start).padEnd(5)} ${p.tty.padEnd(8)} ${t} ${p.cmd}`);
    }
  } else if (opt.l) {
    header('F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD');
    for (const p of sel) lines.push(`4 ${p.stat[0]} ${String(users.getUser(sys, p.user)?.uid ?? 0).padStart(5)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)}  0  80   0 - ${String(Math.floor(p.vsz / 4)).padStart(5)} -      ${p.tty.padEnd(8)} 00:00:00 ${p.comm}`);
  } else if (opt.e || opt.a || opt.users || opt.pids || opt.comm) {
    header('    PID TTY          TIME CMD');
    for (const p of sel) lines.push(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:${cpuTime(p, now).padStart(5, '0')} ${p.comm}`);
  } else {
    header('    PID TTY          TIME CMD');
    for (const p of sel) lines.push(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:00 ${p.comm}`);
  }
  const wide = ctx.cols || 80;
  ctx.out(lines.map((l) => (/\bww?\b/.test(args.join(' ')) || !ctx.tty ? l : l.slice(0, Math.max(wide, 20)))).join('\n') + '\n');
  return 0;
}, { usage: 'ps [options]' });

cmd('top', async (ctx) => {
  const { o } = parseOpts(ctx.args, { bool: 'b', val: 'ndpu' });
  const sys = ctx.sys;
  const procs = allProcs(ctx, { includeSelf: false }).sort((a, b) => b.cpu - a.cpu || a.pid - b.pid);
  const m = memInfo(sys);
  const mb = (k) => (k / 1024).toFixed(1).padStart(8);
  const l = loadavg(sys).map((x) => x.toFixed(2)).join(', ');
  const { d, h, m: mm } = uptimeParts(sys);
  const upShort = d ? `${d} days, ${pad2(h)}:${pad2(mm)}` : h ? `${h}:${pad2(mm)}` : `${mm} min`;
  const running = procs.filter((p) => p.stat.startsWith('R')).length + 1;
  let t = `top - ${clock(sys.now())} up ${upShort},  1 user,  load average: ${l}\n`;
  t += `Tasks: ${String(procs.length).padStart(3)} total,   ${running} running, ${String(procs.length - running).padStart(3)} sleeping,   0 stopped,   0 zombie\n`;
  t += '%Cpu(s):  2.3 us,  0.7 sy,  0.0 ni, 96.6 id,  0.3 wa,  0.0 hi,  0.1 si,  0.0 st \n';
  t += `MiB Mem : ${mb(m.total)} total, ${mb(m.free)} free, ${mb(m.used)} used, ${mb(m.buff)} buff/cache\n`;
  t += `MiB Swap: ${mb(m.swapTotal)} total, ${mb(m.swapTotal)} free, ${mb(0)} used. ${mb(m.avail)} avail Mem \n\n`;
  t += '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n';
  const lim = o.b ? procs.length : Math.max(5, (ctx.term.rows || 24) - 8);
  for (const p of procs.slice(0, lim)) t += `${String(p.pid).padStart(7)} ${p.user.slice(0, 9).padEnd(9)} 20   0 ${String(p.vsz).padStart(7)} ${String(p.rss).padStart(6)} ${String(Math.floor(p.rss / 3)).padStart(6)} ${p.stat[0]} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)}   0:${pad2(Math.floor(p.pid % 60))}.${pad2(p.pid % 100)} ${p.comm}\n`;
  if (o.b) { ctx.out(t); return 0; }
  ctx.term.clear?.();
  ctx.out(t);
  for (;;) { const a = await ctx.term.readLine('', { echo: false, key: true }); if (a == null || /^q/i.test(a)) break; }
  ctx.term.clear?.();
  return 0;
});

// ---------------------------------------------------------------- kill & friends
const SIGNALS = { HUP: 1, INT: 2, QUIT: 3, ILL: 4, TRAP: 5, ABRT: 6, BUS: 7, FPE: 8, KILL: 9, USR1: 10, SEGV: 11, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, STKFLT: 16, CHLD: 17, CONT: 18, STOP: 19, TSTP: 20, TTIN: 21, TTOU: 22 };
function parseSignal(s) {
  const t = String(s).replace(/^SIG/i, '').toUpperCase();
  if (/^\d+$/.test(t)) return Number(t);
  return SIGNALS[t] ?? null;
}

function deliver(ctx, p, sig) {
  const sys = ctx.sys;
  if (sig === 0) return true;
  if (p.pid === 1) return true;
  if (sig === 19 || sig === 20) { p.stat = 'T'; sys.touch('proc'); return true; }
  if (sig === 18) { if (p.stat.startsWith('T')) p.stat = 'S'; sys.touch('proc'); return true; }
  if (sig === 1 && /sshd|rsyslog|cron|apache|nginx/.test(p.comm)) return true;
  if (sig === 17 || sig === 28) return true;
  // a process we model ignores nothing: any terminating signal ends it
  sys.killProc(p.pid);
  return true;
}

function killPid(ctx, pid, sig, label = 'kill') {
  const p = ctx.sys.findProc(pid) || (pid === ctx.sh.pid ? { pid, user: ctx.sh.frames[0].user, virtual: true } : null);
  if (!p) { ctx.err(`${label === 'kill' ? 'bash: kill' : label}: (${pid}) - No such process\n`); return 1; }
  if (!ctx.isRoot && p.user !== ctx.user) { ctx.err(`${label === 'kill' ? 'bash: kill' : label}: (${pid}) - Operation not permitted\n`); return 1; }
  if (p.virtual) return 0;
  deliver(ctx, p, sig);
  return 0;
}

cmd('kill', (ctx) => {
  let a = ctx.args.slice();
  let sig = 15;
  if (a[0] === '-l' || a[0] === '-L') {
    if (a[1]) { const n = parseSignal(a[1]); const name = Object.entries(SIGNALS).find(([, v]) => v === n)?.[0]; ctx.out((name ?? '') + '\n'); return 0; }
    ctx.out(Object.entries(SIGNALS).map(([k, v]) => `${String(v).padStart(2)}) SIG${k}`).join('\t') + '\n'); return 0;
  }
  if (!a.length) { ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
  if (a[0] === '-s' || a[0] === '-n') { sig = parseSignal(a[1]); if (sig == null) { ctx.err(`bash: kill: ${a[1]}: invalid signal specification\n`); return 1; } a = a.slice(2); }
  else if (/^-[A-Za-z0-9]+$/.test(a[0])) { sig = parseSignal(a[0].slice(1)); if (sig == null) { ctx.err(`bash: kill: ${a[0].slice(1)}: invalid signal specification\n`); return 1; } a = a.slice(1); }
  if (!a.length) { ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
  let rc = 0;
  for (const x of a) {
    if (!/^-?\d+$/.test(x)) { ctx.err(`bash: kill: ${x}: arguments must be process or job IDs\n`); rc = 1; continue; }
    rc = Math.max(rc, killPid(ctx, Number(x), sig));
  }
  return rc;
});

function matchProcs(ctx, pattern, o) {
  let re;
  try { re = new RegExp(o.x ? `^(?:${pattern})$` : pattern, o.i ? 'i' : ''); } catch { re = null; }
  const me = ctx.sh.pid;
  return ctx.sys.processes.filter((p) => {
    if (p.pid === me) return false;
    if (o.u && !o.u.split(',').includes(p.user)) return false;
    const hay = o.f ? p.cmd : p.comm;
    return re ? re.test(hay) : hay.includes(pattern);
  });
}

function pgrepLike(ctx, kill) {
  const spec = { bool: 'flxivwonc', val: 'uUstgGP', long: { signal: { key: 'S', val: true } } };
  const raw = ctx.args.slice();
  let sig = 15;
  if (kill && raw.length && /^-[A-Za-z0-9]+$/.test(raw[0]) && parseSignal(raw[0].slice(1)) != null && !/^-[flxivwonc]+$/.test(raw[0])) sig = parseSignal(raw.shift().slice(1));
  else if (kill && raw.length && /^-\d+$/.test(raw[0])) sig = Number(raw.shift().slice(1));
  const { o, rest, err } = parseOpts(raw, spec);
  if (err) return usageError(ctx, err);
  if (!rest.length && !o.u && !o.U) { ctx.err(`${ctx.name}: no matching criteria specified\nTry \`${ctx.name} --help' for more information.\n`); return 2; }
  if (o.U && !o.u) o.u = o.U;
  const procs = matchProcs(ctx, rest[0] ?? '', o);
  if (!procs.length) return 1;
  if (kill) {
    let rc = 0;
    for (const p of procs) rc = Math.max(rc, killPid(ctx, p.pid, sig, ctx.name));
    return rc;
  }
  if (o.c) { ctx.out(procs.length + '\n'); return 0; }
  ctx.out(procs.map((p) => (o.l ? `${p.pid} ${p.comm}` : o.a ? `${p.pid} ${p.cmd}` : String(p.pid))).join(o.d ? o.d : '\n') + '\n');
  return 0;
}
cmd('pgrep', (ctx) => pgrepLike(ctx, false));
cmd('pkill', (ctx) => pgrepLike(ctx, true));

cmd(['killall', 'killall5'], (ctx) => {
  let args = ctx.args.slice();
  let sig = 15;
  const { o } = parseOpts(args.filter((a) => /^-[a-zA-Z]+$/.test(a) && !SIGNALS[a.slice(1).replace(/^SIG/, '')]), { bool: 'qvwiu' });
  args = args.filter((a) => { if (/^-\d+$/.test(a)) { sig = Number(a.slice(1)); return false; } if (/^-(SIG)?[A-Z]+\d?$/.test(a) && SIGNALS[a.slice(1).replace(/^SIG/, '')]) { sig = SIGNALS[a.slice(1).replace(/^SIG/, '')]; return false; } return !a.startsWith('-') ; });
  if (!args.length) { ctx.err('Usage: killall [OPTION]... [--] NAME...\n'); return 1; }
  let rc = 0;
  for (const n of args) {
    const ps = ctx.sys.processes.filter((p) => p.comm === n || p.comm.startsWith(n.slice(0, 15)) && n.length > 15);
    if (!ps.length) { if (!o.q) ctx.err(`${n}: no process found\n`); rc = 1; continue; }
    for (const p of ps) { const r = killPid(ctx, p.pid, sig, 'killall'); if (r) rc = r; }
  }
  return rc;
});

cmd('nice', async (ctx) => { const a = ctx.args.filter((x, i) => !(i === 0 && x.startsWith('-')) && !(i === 1 && ctx.args[0] === '-n')); return a.length ? ctx.exec(a.slice(ctx.args[0] === '-n' ? 1 : 0)) : (ctx.out('0\n'), 0); });
cmd(['renice', 'ionice', 'nohup'], async (ctx) => { if (ctx.name === 'nohup' && ctx.args.length) return ctx.exec(ctx.args); return 0; });
cmd('timeout', async (ctx) => { const a = ctx.args.filter((x) => !x.startsWith('-')); if (a.length < 2) { ctx.err('timeout: missing operand\nTry \'timeout --help\' for more information.\n'); return 125; } return ctx.exec(a.slice(1)); });

// ---------------------------------------------------------------- logs
function logLines(ctx, files) {
  const out = [];
  for (const f of files) { try { out.push(...ctx.sys.vfs.readFile(f).split('\n').filter(Boolean)); } catch { /* skip */ } }
  const MONI = Object.fromEntries(MON.map((m, i) => [m, i]));
  const yr = new Date(ctx.sys.now()).getFullYear();
  const key = (l) => { const m = /^(\w{3}) +(\d+) (\d\d):(\d\d):(\d\d)/.exec(l); return m ? new Date(yr, MONI[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).getTime() : 0; };
  return out.map((l, i) => ({ l, k: key(l), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.l);
}

cmd('journalctl', (ctx) => {
  const sys = ctx.sys;
  const a = ctx.args;
  let unit = null; let n = null; let rev = false; let ident = null; let grep = null; let kernel = false; let priority = null;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-u' || x === '--unit') unit = a[++i];
    else if (x.startsWith('--unit=')) unit = x.slice(7);
    else if (x === '-n' || x === '--lines') n = Number(a[++i]);
    else if (/^-n\d+$/.test(x)) n = Number(x.slice(2));
    else if (x.startsWith('--lines=')) n = Number(x.slice(8));
    else if (x === '-r' || x === '--reverse') rev = true;
    else if (x === '-t' || x === '--identifier') ident = a[++i];
    else if (x === '-g' || x === '--grep') grep = a[++i];
    else if (x === '-k' || x === '--dmesg') kernel = true;
    else if (x === '-p' || x === '--priority') priority = a[++i];
    else if (['-f', '--follow'].includes(x)) { /* follow ends immediately here */ }
    else if (x.startsWith('_COMM=')) ident = x.slice(6);
    else if (x === '--vacuum-size' || x.startsWith('--vacuum')) { ctx.out('Vacuuming done, freed 0B of archived journals from /var/log/journal.\n'); return 0; }
  }
  const cu = ctx.cred;
  if (!ctx.isRoot && !cu.gids.includes(4) && !cu.gids.includes(users.getGroup(sys, 'systemd-journal')?.gid ?? -1)) {
    ctx.out("Hint: You are currently not seeing messages from other users and the system.\n      Users in groups 'adm', 'systemd-journal' can see all messages.\n      Pass -q to turn off this notice.\n-- No entries --\n");
    return 0;
  }
  let lines = kernel ? logLines(ctx, ['/var/log/kern.log']) : logLines(ctx, ['/var/log/syslog', '/var/log/auth.log']);
  if (unit) {
    const c = services.canonical(unit);
    const key = c ? [c, SERVICES[c].unit, SERVICES[c].comm || c, (SERVICES[c].exec || '').split('/').pop().split(' ')[0]].filter(Boolean) : [sysUnitName(unit)];
    lines = lines.filter((l) => key.some((k) => l.includes(` ${k}[`) || l.includes(` ${k}:`) || l.includes(SERVICES[c]?.unit || '@@')));
  }
  if (ident) lines = lines.filter((l) => l.includes(` ${ident}[`) || l.includes(` ${ident}:`));
  if (grep) { try { const re = new RegExp(grep); lines = lines.filter((l) => re.test(l)); } catch { /* ignore */ } }
  if (n != null && !Number.isNaN(n)) lines = lines.slice(-n);
  else if (!unit && !ident && !grep && lines.length > 200) lines = lines.slice(-200);
  if (rev) lines = lines.slice().reverse();
  const first = new Date(sys.bootTime);
  ctx.out(lines.length ? `-- Journal begins at ${DAY[first.getDay()]} ${strftime('%F %T', sys.bootTime)} ${tzAbbrev(sys.bootTime)}, ends at ${DAY[new Date(sys.now()).getDay()]} ${strftime('%F %T', sys.now())} ${tzAbbrev(sys.now())}. --\n` + lines.join('\n') + '\n' : '-- No entries --\n');
  return 0;
}, { usage: 'journalctl [OPTIONS...] [MATCHES...]', noHelp: true });

cmd('dmesg', (ctx) => {
  const restrict = ctx.sys.sysctl['kernel.dmesg_restrict'] ?? '1';
  if (!ctx.isRoot && String(restrict) === '1') { ctx.err('dmesg: read kernel buffer failed: Operation not permitted\n'); return 1; }
  const lines = [
    'Linux version 5.15.0-126-generic (buildd@lcy02-amd64-060) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0, GNU ld (GNU Binutils for Ubuntu) 2.38) #136-Ubuntu SMP Wed Nov 6 10:38:22 UTC 2024 (Ubuntu 5.15.0-126.136-generic 5.15.168)',
    'Command line: BOOT_IMAGE=/boot/vmlinuz-5.15.0-126-generic root=UUID=5c5b0b1a-2c1e-4a52-8d0e-9f6c2f6ad2a1 ro quiet splash',
    'BIOS-provided physical RAM map:', 'DMI: innotek GmbH VirtualBox/VirtualBox, BIOS VirtualBox 12/01/2006', 'Hypervisor detected: KVM', 'tsc: Detected 1799.998 MHz processor',
    'ACPI: Core revision 20210730', 'PCI: Using configuration type 1 for base access', 'NET: Registered PF_INET protocol family', 'EXT4-fs (sda2): mounted filesystem with ordered data mode. Opts: (null). Quota mode: none.',
    'systemd[1]: Inserted module \'autofs4\'', 'e1000 0000:00:03.0 eth0: (PCI:33MHz:32-bit) 08:00:27:5d:9e:41', 'e1000: eth0 NIC Link is Up 1000 Mbps Full Duplex, Flow Control: RX', 'IPv6: ADDRCONF(NETDEV_CHANGE): enp0s3: link becomes ready',
    'Bluetooth: Core ver 2.22', 'audit: type=1400 audit(1.215:2): apparmor="STATUS" operation="profile_load" profile="unconfined" name="/usr/bin/man" pid=651 comm="apparmor_parser"', 'rfkill: input handler disabled',
  ];
  const t0 = 0.0;
  ctx.out(lines.map((l, i) => `[${(t0 + i * 0.37 + (i > 8 ? 4 : 0)).toFixed(6).padStart(12)}] ${l}`).join('\n') + '\n');
  return 0;
});

// ---------------------------------------------------------------- man / help
const MAN = {
  sudo: ['sudo - execute a command as another user', 'sudo [-u user] command', 'sudo allows a permitted user to execute a command as the superuser or another user, as specified by the security policy (/etc/sudoers).'],
  passwd: ['passwd - change user password', 'passwd [options] [LOGIN]', 'The passwd command changes passwords for user accounts. Options: -l lock, -u unlock, -d delete, -e expire, -S status.'],
  chmod: ['chmod - change file mode bits', 'chmod [OPTION]... MODE[,MODE]... FILE...', 'chmod changes the file mode bits of each given file according to mode, which can be either a symbolic representation of changes to make, or an octal number.'],
  chown: ['chown - change file owner and group', 'chown [OPTION]... [OWNER][:[GROUP]] FILE...', 'chown changes the user and/or group ownership of each given file.'],
  useradd: ['useradd - create a new user or update default new user information', 'useradd [options] LOGIN', 'useradd is a low level utility for adding users. On Debian, administrators should usually use adduser(8) instead.'],
  usermod: ['usermod - modify a user account', 'usermod [options] LOGIN', 'The usermod command modifies the system account files to reflect the changes specified on the command line. Options: -aG append to groups, -L lock, -U unlock, -s shell.'],
  userdel: ['userdel - delete a user account and related files', 'userdel [options] LOGIN', 'The userdel command modifies the system account files, deleting all entries that refer to the user name LOGIN. -r removes the home directory.'],
  ufw: ['ufw - program for managing a netfilter firewall', 'ufw [--dry-run] enable|disable|reload\nufw allow|deny|reject|limit [in|out] PORT[/PROTOCOL]\nufw delete RULE|NUM\nufw status [verbose|numbered]', 'This program is for managing a Linux firewall and aims to provide an easy to use interface for the user.'],
  apt: ['apt - command-line interface', 'apt [options] command', 'apt provides a high-level commandline interface for the package management system. Commands: update, upgrade, install, remove, purge, autoremove, list, search, show.'],
  systemctl: ['systemctl - Control the systemd system and service manager', 'systemctl [OPTIONS...] COMMAND [UNIT...]', 'systemctl may be used to introspect and control the state of the "systemd" system and service manager.'],
  crontab: ['crontab - maintains crontab files for individual users', 'crontab [-u user] file\ncrontab [-u user] [-l | -r | -e]', 'Crontab is the program used to install, deinstall or list the tables used to drive the cron(8) daemon.'],
  find: ['find - search for files in a directory hierarchy', 'find [-H] [-L] [-P] [path...] [expression]', 'This manual page documents the GNU version of find. Useful tests: -name, -type, -user, -perm, -mtime, -size. Actions: -print, -exec, -delete.'],
  sshd_config: ['sshd_config - OpenSSH daemon configuration file', '/etc/ssh/sshd_config', 'sshd(8) reads configuration data from /etc/ssh/sshd_config. Keywords: PermitRootLogin, PermitEmptyPasswords, PasswordAuthentication, Protocol, X11Forwarding, MaxAuthTries. For each keyword, the first obtained value will be used.'],
  sudoers: ['sudoers - default sudo security policy plugin', '/etc/sudoers', 'The sudoers policy plugin determines a user\'s sudo privileges. Always edit with visudo(8). NOPASSWD: lets a user run commands without authenticating.'],
  'login.defs': ['login.defs - shadow password suite configuration', '/etc/login.defs', 'PASS_MAX_DAYS, PASS_MIN_DAYS, PASS_WARN_AGE, UMASK, ENCRYPT_METHOD, ... apply to accounts created after the change; use chage(1) for existing accounts.'],
  pam_pwquality: ['pam_pwquality - PAM module to perform password quality checking', 'pam_pwquality.so [...]', 'Options include minlen, dcredit, ucredit, lcredit, ocredit, difok, retry, enforce_for_root. Settings in /etc/security/pwquality.conf are overridden by arguments on the PAM line.'],
  pam_faillock: ['pam_faillock - Module counting authentication failures during a specified interval', 'pam_faillock.so', 'Use deny=N to lock accounts after N failed attempts and unlock_time=SECONDS. Place preauth before pam_unix and authfail after in common-auth.'],
  sysctl: ['sysctl - configure kernel parameters at runtime', 'sysctl [options] [variable[=value]] [...]\nsysctl -p [file]', 'sysctl is used to modify kernel parameters at runtime. -w writes a value, -p loads settings from /etc/sysctl.conf, -a displays all.'],
  ss: ['ss - another utility to investigate sockets', 'ss [options] [ FILTER ]', 'ss is used to dump socket statistics. -t TCP, -u UDP, -l listening, -n numeric, -p show processes.'],
};
cmd('man', (ctx) => {
  const a = ctx.args.filter((x) => !x.startsWith('-') && !/^\d$/.test(x));
  if (!a.length) { ctx.err('What manual page do you want?\nFor example, try \'man man\'.\n'); return 1; }
  const name = a[0];
  let m = MAN[name];
  if (!m && commands.has(name)) {
    const def = commands.get(name);
    m = [`${name} - ${name}`, def.usage || name, `See the online documentation for the full description of ${name}.`];
  }
  if (!m) { ctx.err(`No manual entry for ${name}\nSee 'man 7 undocumented' for help when manual pages are not available.\n`); return 16; }
  const up = name.toUpperCase();
  ctx.out(`${up}(1)${' '.repeat(Math.max(1, 30 - up.length * 2))}User Commands${' '.repeat(Math.max(1, 30 - up.length * 2))}${up}(1)\n\nNAME\n       ${m[0]}\n\nSYNOPSIS\n       ${m[1].split('\n').join('\n       ')}\n\nDESCRIPTION\n       ${m[2]}\n\n(Press q to quit — this is a shortened simulated manual page.)\n`);
  return 0;
}, { usage: 'man [OPTION...] [SECTION] PAGE...' });
cmd(['whatis', 'apropos'], (ctx) => { const n = ctx.args[0]; const m = MAN[n]; if (!m) { ctx.err(`${n}: nothing appropriate.\n`); return 16; } ctx.out(`${n} (1) - ${m[0].split(' - ')[1]}\n`); return 0; });

// ---------------------------------------------------------------- editors
async function editFile(ctx, kind, args) {
  const files = args.filter((a) => !a.startsWith('-') && !a.startsWith('+'));
  const startLine = Number((args.find((a) => /^\+\d+$/.test(a)) || '+1').slice(1));
  if (!ctx.tty && !ctx.term.editor) { ctx.err(`${ctx.name}: Error opening terminal: unknown.\n`); return 1; }
  const path = files[0] ? ctx.resolve(files[0]) : null;
  let text = ''; let isNew = false; let readErr = null;
  if (path) {
    try {
      if (ctx.fs.isDir(path)) { ctx.err(`${ctx.name}: ${files[0]}: Is a directory\n`); return 1; }
      if (ctx.fs.exists(path)) text = ctx.fs.readFile(path);
      else { isNew = true; }
    } catch (e) { if (e instanceof FsError) readErr = e.text; else throw e; }
  }
  const save = (newText) => {
    if (!path) return { ok: false, err: 'No file name' };
    try {
      ctx.fs.writeFile(path, newText);
      ctx.sys.log('syslog', ctx.name, `edited ${path}`);
      return { ok: true };
    } catch (e) { if (e instanceof FsError) return { ok: false, err: e.text }; throw e; }
  };
  await ctx.term.editor?.({ path: path, display: files[0] || null, text, kind, isNew, readErr, save, startLine, user: ctx.user, readOnly: ctx.name === 'view' });
  return 0;
}
cmd(['nano', 'pico'], (ctx) => editFile(ctx, 'nano', ctx.args), { pkg: 'nano' });
cmd(['vi', 'vim', 'view', 'vim.tiny', 'ex', 'rvim'], (ctx) => editFile(ctx, 'vi', ctx.args), { pkg: 'vim-tiny' });
cmd('ed', (ctx) => { ctx.err('?\n'); return 1; });
cmd('sudoedit', async (ctx) => { return ctx.exec(['sudo', '-e', ...ctx.args]); });
cmd('editor', (ctx) => editFile(ctx, 'nano', ctx.args));

// ---------------------------------------------------------------- GUI launchers
const LAUNCH = {
  nautilus: 'nemo', gedit: 'xed', 'gnome-control-center': 'settings', 'update-manager': 'update', 'software-properties-gtk': 'swprops', 'gnome-software': 'software', 'gnome-session-properties': 'startup', eog: 'generic', evince: 'generic', totem: 'generic', 'gnome-screenshot': 'generic', 'gnome-disk-utility': 'generic', snap: 'generic',
  firefox: 'firefox', chromium: 'chromium', 'chromium-browser': 'chromium', xed: 'xed', nemo: 'nemo', gufw: 'gufw', 'gnome-terminal': 'terminal', 'x-terminal-emulator': 'terminal',
  'cinnamon-settings': 'settings', 'mintupdate': 'update', mintinstall: 'software', mintsources: 'sources', 'gnome-system-monitor': 'monitor',
  'lightdm-settings': 'login', 'cinnamon-session-properties': 'startup', 'users-admin': 'users', 'system-config-printer': 'printers', 'gnome-calculator': 'generic', libreoffice: 'generic', thunderbird: 'generic', celluloid: 'generic', rhythmbox: 'generic', pix: 'generic', xreader: 'generic', timeshift: 'generic', 'transmission-gtk': 'generic',
  'mintreport': 'generic', 'cinnamon': 'generic', 'mintbackup': 'generic', 'mintstick': 'generic', 'bulky': 'generic', 'drawing': 'generic', 'seahorse': 'generic', 'warpinator': 'generic', 'hypnotix': 'generic', 'mintwelcome': 'generic',
};
const pkgOfBin = (bin) => Object.values(PACKAGES).find((d) => (d.bins || []).some((b) => b.split('/').pop() === bin))?.name;
for (const [bin, app] of Object.entries(LAUNCH)) {
  cmd(bin, (ctx) => {
    if (!ctx.env.DISPLAY) { ctx.err(`Unable to init server: Could not connect: Connection refused\n(${bin}:1): Gtk-WARNING **: cannot open display\n`); return 1; }
    if (ctx.isRoot && ctx.sh.frames[0].user !== 'root' && (bin === 'firefox' || bin === 'chromium')) {
      ctx.err("Running Firefox as root in a regular user's session is not supported.  ($HOME is /home/student which is owned by student.)\n");
      return 1;
    }
    ctx.term.launch?.(app, { name: bin, args: ctx.args.filter((a) => a !== '&'), user: ctx.user, cwd: ctx.cwd, cmdline: ctx.argv.join(' ') });
    return 0;
  }, { pkg: pkgOfBin(bin), usage: `${bin} [OPTION...]` });
}

cmd('sudoedit-internal', (ctx) => editFile(ctx, 'nano', ctx.args));

cmd('pkexec', async (ctx) => {
  const args = ctx.args.filter((a) => !a.startsWith('--'));
  const uidx = ctx.args.indexOf('--user');
  const target = uidx >= 0 ? ctx.args[uidx + 1] : 'root';
  const command = uidx >= 0 ? ctx.args.slice(uidx + 2) : args;
  if (!command.length) { ctx.err('Usage: pkexec --version |\n       pkexec --help |\n       pkexec [--disable-internal-agent] [--user username] PROGRAM [ARGUMENTS...]\n'); return 126; }
  if (!ctx.isRoot) {
    const prog = command[0].startsWith('/') ? command[0] : `/usr/bin/${command[0]}`;
    if (!(await polkitAuth(ctx, 'org.freedesktop.policykit.exec', `Authentication is required to run ${prog} as the super user`, 'Error executing command as another user: Not authorized\n\nThis incident has been reported.'))) return 127;
  }
  return ctx.exec(command, ctx.stdio, { asUser: target });
}, { usage: 'pkexec [--user username] PROGRAM [ARGUMENTS...]', noHelp: true });

cmd('xdg-open', (ctx) => {
  const target = ctx.args[0];
  if (!target) { ctx.err('xdg-open: no file or URL specified\n'); return 1; }
  const isUrl = /^[a-z]+:\/\//i.test(target);
  const path = isUrl ? target : ctx.resolve(target);
  if (!isUrl && !ctx.fs.exists(path)) { ctx.err(`xdg-open: file '${target}' does not exist\n`); return 3; }
  const app = isUrl || /\.html?$/i.test(path) ? 'firefox' : ctx.fs.isDir(path) ? 'nemo' : /\.(txt|md|conf|cfg|log|sh|py|ini)$/i.test(path) ? 'xed' : 'generic';
  ctx.term.launch?.(app, { name: 'xdg-open', args: [path], user: ctx.user, cwd: ctx.cwd });
  return 0;
});
cmd('notify-send', (ctx) => { ctx.term.notify?.(ctx.args.filter((a) => !a.startsWith('-'))); return 0; });
cmd('xhost', (ctx) => { ctx.out('access control enabled, only authorized clients can connect\n'); return 0; });
cmd(['gsettings', 'dconf', 'xdg-settings'], (ctx) => { ctx.out(''); return 0; });

export { LAUNCH, pk, posix };
