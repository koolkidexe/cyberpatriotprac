// Processes, sockets, networking and system information.
import { def } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as fw from '../../core/firewall.js';
import { KERNEL } from '../../images/mint21.js';
import { fmtDate, tzAbbrev } from '../../core/util.js';
import { getopt, padL, padR, lines } from './util.js';

const p2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const upText = (ctx) => { const m = Math.floor((ctx.now() - ctx.sys.bootTime) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${p2(m % 60)}`; };

// ------------------------------------------------------------------ ps / top / pgrep
const startOf = (p, now) => { const d = new Date(p.start); return now - p.start > 86400000 ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}${p2(d.getDate())}` : `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const cpuTime = (p) => `0:${p2(p.pid % 59)}`;
const userCol = (u) => (u.length > 8 ? u.slice(0, 7) + '+' : u);

def('ps', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args.map((a) => (/^[a-zA-Z]{2,}$/.test(a) && !/^(ps)$/.test(a) ? '-' + a : a)), { flags: 'aAefxlwuUH', withArg: 'puCoOUt', long: { 'no-headers': 'nh' } });
  const sys = ctx.sys; const now = ctx.now();
  let procs = [...sys.processes];
  const bsd = ctx.args.some((a) => /^[aux]+$/.test(a)) && !ctx.args.some((a) => a.startsWith('-'));
  const everything = opts.e || opts.A || opts.a || (bsd && ctx.args.some((a) => /x/.test(a)));
  if (!everything && !opts.p && !opts.C && !opts.U && !(opts.u && !bsd)) {
    // default: this terminal's processes
    procs = procs.filter((p) => p.tty === 'pts/0' && p.user === ctx.shell.euser);
    procs.push({ pid: ctx.shell.pid + 100, ppid: ctx.shell.pid, user: ctx.user, cmd: 'ps', comm: 'ps', tty: 'pts/0', stat: 'R+', start: now, cpu: 0, mem: 0, vsz: 12000, rss: 3300 });
  }
  if (opts.p) { const ids = opts.p.split(',').map(Number); procs = procs.filter((p) => ids.includes(p.pid)); }
  if (opts.C) procs = procs.filter((p) => p.comm === opts.C);
  if (opts.u && !bsd) { const names = opts.u.split(','); procs = procs.filter((p) => names.includes(p.user)); }
  if (opts.U) procs = procs.filter((p) => p.user === opts.U);
  const wide = (opts.w || ctx.args.includes('-ww')) || !ctx.tty;
  const cut = (s) => (wide ? s : s.slice(0, ctx.cols));
  const hdr = !opts.nh;
  if (opts.o || opts.O) {
    const cols = (opts.o || opts.O).split(',').map((c) => c.split('=')[0].trim());
    const get = { pid: (p) => p.pid, ppid: (p) => p.ppid, user: (p) => p.user, uid: (p) => users.getUser(sys, p.user)?.uid ?? 0, comm: (p) => p.comm, cmd: (p) => p.cmd, args: (p) => p.cmd, '%cpu': (p) => p.cpu.toFixed(1), '%mem': (p) => p.mem.toFixed(1), tty: (p) => p.tty, stat: (p) => p.stat, start: (p) => startOf(p, now), time: (p) => cpuTime(p), etime: (p) => `${p2(Math.floor((now - p.start) / 60000))}:${p2(Math.floor(((now - p.start) % 60000) / 1000))}`, rss: (p) => p.rss, vsz: (p) => p.vsz };
    const w = cols.map((c) => (['comm', 'cmd', 'args'].includes(c) ? 0 : 7));
    if (hdr) ctx.out(cut(cols.map((c, i) => (w[i] ? padL(c.toUpperCase(), w[i]) : c === 'args' ? 'COMMAND' : c.toUpperCase())).join(' ')) + '\n');
    for (const p of procs) ctx.out(cut(cols.map((c, i) => { const v = String((get[c] || (() => ''))(p)); return w[i] ? padL(v, w[i]) : v; }).join(' ')) + '\n');
    return 0;
  }
  if (opts.f) {
    if (hdr) ctx.out(cut('UID          PID    PPID  C STIME TTY          TIME CMD') + '\n');
    for (const p of procs) ctx.out(cut(`${padR(userCol(p.user), 8)} ${padL(p.pid, 7)} ${padL(p.ppid, 7)}  0 ${padL(startOf(p, now), 5)} ${padR(p.tty, 8)} ${padL('00:00:' + p2(p.pid % 59), 8)} ${p.cmd}`) + '\n');
    return 0;
  }
  if (opts.u && !bsd || bsd || ctx.args.some((a) => /^-?[aux]{2,}$/.test(a)) || opts.l === undefined && (opts.a && opts.u !== undefined)) {
    if (hdr) ctx.out(cut('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND') + '\n');
    for (const p of procs) ctx.out(cut(`${padR(userCol(p.user), 8)} ${padL(p.pid, 6)} ${padL(p.cpu.toFixed(1), 4)} ${padL(p.mem.toFixed(1), 4)} ${padL(p.vsz, 6)} ${padL(p.rss, 5)} ${padR(p.tty, 8)} ${padR(p.stat, 4)} ${padL(startOf(p, now), 5)} ${padL(cpuTime(p), 6)} ${p.cmd}`) + '\n');
    return 0;
  }
  if (hdr) ctx.out('    PID TTY          TIME CMD\n');
  for (const p of procs) ctx.out(`${padL(p.pid, 7)} ${padR(p.tty, 8)} ${padL('00:00:' + p2(p.pid % 59), 8)} ${p.comm}\n`);
  return 0;
});

def('top', (ctx) => {
  const sys = ctx.sys; const now = ctx.now(); const ps = sys.processes;
  const mem = 3921.3; const used = 1100 + ps.length * 1.4;
  ctx.out(`top - ${clock(now)} up ${upText(ctx)},  1 user,  load average: 0.15, 0.15, 0.11\nTasks: ${String(ps.length).padStart(3)} total,   1 running, ${String(ps.length - 1).padStart(3)} sleeping,   0 stopped,   0 zombie\n%Cpu(s):  1.2 us,  0.6 sy,  0.0 ni, 98.0 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st\nMiB Mem :${mem.toFixed(1).padStart(9)} total,${(mem - used - 1240).toFixed(1).padStart(9)} free,${used.toFixed(1).padStart(9)} used,${(1240).toFixed(1).padStart(9)} buff/cache\nMiB Swap:   2048.0 total,   2048.0 free,      0.0 used.${(mem - used).toFixed(1).padStart(9)} avail Mem \n\n    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n`);
  const rows = [...ps].filter((p) => !p.cmd.startsWith('[')).sort((a, b) => b.cpu - a.cpu).slice(0, ctx.args.includes('-b') ? 25 : 18);
  for (const p of rows) ctx.out(`${padL(p.pid, 7)} ${padR(userCol(p.user), 9)} 20   0 ${padL(p.vsz, 7)} ${padL(p.rss, 6)} ${padL(Math.floor(p.rss / 2), 6)} ${p.stat[0]} ${padL(p.cpu.toFixed(1), 5)} ${padL(p.mem.toFixed(1), 5)} ${padL('0:' + p2(p.pid % 59) + '.' + p2(p.pid % 97), 9)} ${p.comm}\n`);
});

function matchProcs(ctx, pattern, { full, user, exact }) {
  let re; try { re = new RegExp(pattern); } catch { throw new CmdError(`${ctx.name}: invalid pattern`, 2); }
  return ctx.sys.processes.filter((p) => (user ? p.user === user : true) && (exact ? p.comm === pattern : re.test(full ? p.cmd : p.comm)) && p.pid !== ctx.shell.pid + 100 && !p.cmd.startsWith('['));
}
def('pgrep', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'flxan', withArg: 'u' });
  if (!rest.length && !opts.u) throw new CmdError('pgrep: no matching criteria specified\nTry `pgrep --help\' for more information.', 2);
  const ps = matchProcs(ctx, rest[0] ?? '', { full: opts.f, user: opts.u, exact: opts.x });
  for (const p of ps) ctx.out(opts.l ? `${p.pid} ${p.comm}\n` : `${p.pid}\n`);
  return ps.length ? 0 : 1;
});
const SIG = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15, STOP: 19, CONT: 18, USR1: 10, USR2: 12 };
function deliver(ctx, p, sig, who) {
  if (ctx.uid !== 0 && p.user !== ctx.user) { ctx.err(`${who}(${p.pid}) - Operation not permitted\n`); return 1; }
  if (p.pid === 1 || p.cmd.startsWith('[')) return 0;
  if ([1, 10, 12, 18].includes(sig) && sig !== 1) return 0;
  if (sig === 19 || sig === 0) return 0;
  ctx.sys.killProc(p.pid);
  return 0;
}
const parseSig = (s) => (/^\d+$/.test(s) ? Number(s) : SIG[s.replace(/^SIG/, '').toUpperCase()]);
def('kill', (ctx) => {
  const a = [...ctx.args]; let sig = 15;
  if (a[0] === '-l') { ctx.out('HUP INT QUIT KILL TERM STOP CONT USR1 USR2\n'); return 0; }
  if (a[0] === '-s' || a[0] === '-n') { a.shift(); sig = parseSig(a.shift() ?? 'TERM'); } else if (/^-[A-Za-z0-9]+$/.test(a[0] || '')) sig = parseSig(a.shift().slice(1));
  if (sig === undefined) { ctx.err('bash: kill: invalid signal specification\n'); return 1; }
  if (!a.length) { ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
  let code = 0;
  for (const t of a) {
    const pid = Number(t); if (!Number.isInteger(pid)) { ctx.err(`bash: kill: ${t}: arguments must be process or job IDs\n`); code = 1; continue; }
    const p = ctx.sys.findProc(pid); if (!p) { ctx.err(`bash: kill: (${pid}) - No such process\n`); code = 1; continue; }
    code = deliver(ctx, p, sig, 'bash: kill: (') ? 1 : code;
  }
  return code;
});
def(['pkill', 'killall'], (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args.map((a) => (/^-\d+$/.test(a) ? a : a)), { flags: 'fxqvu', withArg: 'u', numeric: true });
  let sigName = null; const a = [...rest];
  const sigArg = ctx.args.find((x) => /^-(\d+|[A-Z]{3,6})$/.test(x)); if (sigArg) sigName = sigArg.slice(1);
  const sig = sigName ? parseSig(sigName) ?? 15 : 15;
  const pat = a.find((x) => !/^-/.test(x)); if (!pat) throw new CmdError(`${ctx.name}: no process specified`, 1);
  const ps = ctx.name === 'killall' ? ctx.sys.processes.filter((p) => p.comm === pat || p.comm.startsWith(pat.slice(0, 15))) : matchProcs(ctx, pat, { full: opts.f, user: opts.u, exact: opts.x });
  if (!ps.length) { if (ctx.name === 'killall') ctx.err(`${pat}: no process found\n`); return ctx.name === 'killall' ? 1 : 1; }
  let code = 0; for (const p of ps) if (deliver(ctx, p, sig, `${ctx.name}: (`)) code = 1;
  return code;
});

// ------------------------------------------------------------------ sockets
const PORT_NAMES = { 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 68: 'bootpc', 80: 'http', 123: 'ntp', 137: 'netbios-ns', 138: 'netbios-dgm', 139: 'netbios-ssn', 443: 'https', 445: 'microsoft-ds', 631: 'ipp', 5353: 'mdns', 2049: 'nfs' };
function listSockets(ctx, { tcp, udp }) {
  return ctx.sys.sockets().filter((s) => (s.proto.startsWith('tcp') ? tcp : udp)).sort((a, b) => (a.proto.startsWith('tcp') === b.proto.startsWith('tcp') ? 0 : a.proto.startsWith('tcp') ? -1 : 1) || a.pid - b.pid);
}
const i0 = () => ' ';
def('ss', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'tulnpa46HreSsOo', long: { listening: 'l', numeric: 'n', processes: 'p', tcp: 't', udp: 'u', all: 'a' } });
  const both = !opts.t && !opts.u; const rows = [];
  const show = opts.l || opts.a;
  if (show) for (const s of listSockets(ctx, { tcp: opts.t || both, udp: opts.u || both })) {
    const v6 = s.proto.endsWith('6') || s.addr.startsWith('['); if ((opts[4] && v6) || (opts[6] && !v6)) continue;
    const port = opts.n ? String(s.port) : PORT_NAMES[s.port] || String(s.port);
    const local = `${s.addr}:${port}`;
    const peer = s.addr.startsWith('[') ? '[::]:*' : s.addr === '*' ? '*:*' : '0.0.0.0:*';
    const mine = ctx.uid === 0 || s.user === ctx.user;
    rows.push([s.proto.startsWith('tcp') ? 'tcp' : 'udp', s.proto.startsWith('tcp') ? 'LISTEN' : 'UNCONN', '0', s.proto.startsWith('tcp') ? (s.port === 631 || s.port === 25 ? '5' : s.port === 4444 || s.port === 8000 ? '1' : '128') : '0', local, peer, opts.p && mine ? `users:(("${s.comm}",pid=${s.pid},fd=${3 + (s.pid % 12)}))` : '']);
  }
  const head = ['Netid', 'State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', 'Process'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  w[4] = Math.max(19, ...rows.map((r) => r[4].length)); w[5] = 17;
  const fmtRow = (r) => r.map((c, i) => (i === 6 ? c : padR(c, w[i]))).join(' ').replace(/ +$/, '');
  if (!opts.H) ctx.out(head.map((h, i) => (i === 6 ? h : i === 5 ? h : padR(h, w[i]))).join(i0(head, w)).replace(/ +$/, '') + '\n');
  for (const r of rows) ctx.out(fmtRow(r.map((c, i) => (i === 5 ? padR(c, 17) : c))).replace(/ {2,}$/, '') + '\n');
});
def('netstat', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'tulnpaer4' });
  const both = !opts.t && !opts.u;
  ctx.out(opts.a ? 'Active Internet connections (servers and established)\n' : 'Active Internet connections (only servers)\n');
  ctx.out(`Proto Recv-Q Send-Q Local Address           Foreign Address         State       ${opts.p ? 'PID/Program name' : ''}\n`.replace(/ +\n/, '\n'));
  if (opts.p && ctx.uid !== 0) ctx.err('(Not all processes could be identified, non-owned process info\n will not be shown, you would have to be root to see it all.)\n');
  for (const s of listSockets(ctx, { tcp: opts.t || both, udp: opts.u || both })) {
    const v6 = s.proto.endsWith('6') || s.addr.startsWith('['); const addr = s.addr === '*' ? ':::' : s.addr.replace(/^\[(.*)\]$/, '$1');
    const local = `${v6 ? (s.addr === '*' ? ':::' : addr) : addr}${v6 && s.addr !== '*' ? '' : ''}${s.addr === '*' ? s.port : ':' + s.port}`.replace(/^:::(\d+)$/, ':::$1');
    const mine = ctx.uid === 0 || s.user === ctx.user;
    ctx.out(`${padR(s.proto, 5)} ${padL(0, 6)} ${padL(0, 6)} ${padR(local, 23)} ${padR(v6 ? ':::*' : '0.0.0.0:*', 23)} ${padR(s.proto.startsWith('tcp') ? 'LISTEN' : '', 11)} ${opts.p ? (mine ? `${s.pid}/${s.comm}` : '-') : ''}`.trimEnd() + '\n');
  }
});
def('lsof', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: 'nPtl', withArg: 'iuc' });
  const want = opts.i; const port = want && /:(\d+)$/.exec(want)?.[1];
  const rows = ctx.sys.sockets().filter((s) => (want === undefined || (port ? s.port === Number(port) : true)) && (ctx.uid === 0 || s.user === ctx.user));
  void rest;
  if (!rows.length) return 1;
  ctx.out('COMMAND     PID     USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n');
  for (const s of rows) ctx.out(`${padR(s.comm, 11)} ${padL(s.pid, 4)} ${padR(s.user.slice(0, 8), 8)}    ${padR(String(3 + (s.pid % 12)) + 'u', 3)} ${padR(s.proto.endsWith('6') || s.addr.startsWith('[') || s.addr === '*' ? 'IPv6' : 'IPv4', 5)} ${padL(20000 + s.pid * 3, 6)}      0t0  ${s.proto.startsWith('tcp') ? 'TCP' : 'UDP'} ${s.addr === '*' ? '*' : s.addr.replace(/^\[.*\]$/, '*')}:${opts.P || opts.n ? s.port : PORT_NAMES[s.port] || s.port}${s.proto.startsWith('tcp') ? ' (LISTEN)' : ''}\n`);
});

// ------------------------------------------------------------------ network
const IFACE = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host 
       valid_lft forever preferred_lft forever
2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 08:00:27:3a:5c:1d brd ff:ff:ff:ff:ff:ff
    inet 10.0.2.15/24 brd 10.0.2.255 scope global dynamic noprefixroute enp0s3
       valid_lft 86021sec preferred_lft 86021sec
    inet6 fe80::a00:27ff:fe3a:5c1d/64 scope link noprefixroute 
       valid_lft forever preferred_lft forever
`;
def('ip', (ctx) => {
  const a = ctx.args.filter((x) => !x.startsWith('-')); const o = a[0] || 'addr';
  if (/^a(ddr(ess)?)?$/.test(o)) ctx.out(IFACE);
  else if (/^r(oute)?$/.test(o)) ctx.out('default via 10.0.2.2 dev enp0s3 proto dhcp metric 100 \n10.0.2.0/24 dev enp0s3 proto kernel scope link src 10.0.2.15 metric 100 \n169.254.0.0/16 dev enp0s3 scope link metric 1000 \n');
  else if (/^l(ink)?$/.test(o)) ctx.out(IFACE.split('\n').filter((l) => /^\d|link\//.test(l)).join('\n') + '\n');
  else { ctx.err(`Object "${o}" is unknown, try "ip help".\n`); return 1; }
});
def('ifconfig', (ctx) => { ctx.out('enp0s3: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 10.0.2.15  netmask 255.255.255.0  broadcast 10.0.2.255\n        inet6 fe80::a00:27ff:fe3a:5c1d  prefixlen 64  scopeid 0x20<link>\n        ether 08:00:27:3a:5c:1d  txqueuelen 1000  (Ethernet)\n        RX packets 4521  bytes 4213377 (4.2 MB)\n        TX packets 2210  bytes 301288 (301.2 KB)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        inet6 ::1  prefixlen 128  scopeid 0x10<host>\n        loop  txqueuelen 1000  (Local Loopback)\n\n'); });
def('ping', (ctx) => {
  const { opts, rest } = getopt(ctx, ctx.args, { flags: '', withArg: 'cWwi' });
  const host = rest[0]; if (!host) throw new CmdError('ping: usage error: Destination address required', 2);
  const ip = { localhost: '127.0.0.1', '127.0.0.1': '127.0.0.1', mint: '127.0.1.1', [ctx.sys.hostname]: '127.0.1.1', '10.0.2.15': '10.0.2.15', '10.0.2.2': '10.0.2.2' }[host];
  if (!ip) { if (/^[\d.]+$/.test(host)) { ctx.out(`PING ${host} (${host}) 56(84) bytes of data.\n\n--- ${host} ping statistics ---\n${opts.c || 1} packets transmitted, 0 received, 100% packet loss, time 0ms\n\n`); return 1; } throw new CmdError(`ping: ${host}: Temporary failure in name resolution`, 2); }
  const n = Number(opts.c || 4);
  ctx.out(`PING ${host} (${ip}) 56(84) bytes of data.\n`);
  for (let i = 1; i <= n; i++) ctx.out(`64 bytes from ${host === ip ? ip : `${host} (${ip})`}: icmp_seq=${i} ttl=64 time=0.0${40 + i} ms\n`);
  ctx.out(`\n--- ${host} ping statistics ---\n${n} packets transmitted, ${n} received, 0% packet loss, time ${(n - 1) * 1001}ms\nrtt min/avg/max/mdev = 0.041/0.044/0.049/0.003 ms\n`);
});
def('nmap', (ctx) => {
  const target = ctx.args.find((a) => !a.startsWith('-')); if (!target) throw new CmdError('WARNING: No targets were specified, so 0 hosts scanned.', 0);
  if (!['localhost', '127.0.0.1', '10.0.2.15', ctx.sys.hostname].includes(target)) { ctx.out(`Starting Nmap 7.94 ( https://nmap.org ) at ${fmtDate(ctx.now())}\nNote: Host seems down. If it is really up, but blocking our ping probes, try -Pn\nNmap done: 1 IP address (0 hosts up) scanned in 3.02 seconds\n`); return 0; }
  const ports = ctx.sys.sockets().filter((s) => s.proto.startsWith('tcp') && !/127\./.test(s.addr) || (target !== '10.0.2.15' && s.proto.startsWith('tcp'))).filter((s) => target === '10.0.2.15' ? !/^127\.|^\[::1\]/.test(s.addr) : true);
  const uniq = [...new Map(ports.map((s) => [s.port, s])).values()].sort((a, b) => a.port - b.port);
  ctx.out(`Starting Nmap 7.94 ( https://nmap.org ) at ${fmtDate(ctx.now())}\nNmap scan report for ${target === '127.0.0.1' ? 'localhost (127.0.0.1)' : target}\nHost is up (0.00012s latency).\nNot shown: ${1000 - uniq.length} closed tcp ports (conn-refused)\nPORT      STATE SERVICE\n`);
  for (const s of uniq) ctx.out(`${padR(s.port + '/tcp', 9)} open  ${PORT_NAMES[s.port] || 'unknown'}\n`);
  ctx.out('\nNmap done: 1 IP address (1 host up) scanned in 0.05 seconds\n');
}, { bin: '/usr/bin/nmap' });
def(['nc', 'netcat', 'nc.traditional'], (ctx) => {
  const a = ctx.args.filter((x) => !x.startsWith('-')); const flags = ctx.args.filter((x) => x.startsWith('-')).join('');
  if (flags.includes('l')) { ctx.err('nc: listening is not supported in this simulator\n'); return 1; }
  if (a.length < 2) { ctx.err('usage: nc [-options] hostname port[s] [ports] ... \n'); return 1; }
  const port = Number(a[1]); const open = ctx.sys.sockets().some((s) => s.port === port && s.proto.startsWith('tcp'));
  if (flags.includes('z')) { if (open) { ctx.err(`${a[0]} [127.0.0.1] ${port} (${PORT_NAMES[port] || '?'}) open\n`); return 0; } ctx.err(`${a[0]} [127.0.0.1] ${port} (?) : Connection refused\n`); return 1; }
  ctx.err(open ? '' : `${a[0]} [127.0.0.1] ${port} (?) : Connection refused\n`); return open ? 0 : 1;
});
def(['curl', 'wget'], (ctx) => {
  const url = ctx.args.find((a) => /^(https?|ftp):/.test(a) || /^[\w.-]+\.\w+/.test(a));
  if (url && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:(\d+))?/.test(url)) { const m = /:(\d+)/.exec(url.replace(/^https?:\/\//, '')); const port = m ? Number(m[1]) : 80; if (!ctx.sys.sockets().some((s) => s.port === port)) { ctx.err(`curl: (7) Failed to connect to localhost port ${port} after 0 ms: Connection refused\n`); return 7; } ctx.out('<!DOCTYPE HTML>\n<html><head><title>Directory listing for /</title></head></html>\n'); return 0; }
  ctx.err(ctx.name === 'curl' ? `curl: (6) Could not resolve host: ${(url || '').replace(/^\w+:\/\//, '').split('/')[0]}\n` : `--${clock(ctx.now())}--  ${url}\nResolving ${(url || '').replace(/^\w+:\/\//, '').split('/')[0]}... failed: Temporary failure in name resolution.\nwget: unable to resolve host address ‘${(url || '').replace(/^\w+:\/\//, '').split('/')[0]}’\n`);
  return ctx.name === 'curl' ? 6 : 4;
});

// ------------------------------------------------------------------ system information
def('uname', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'asnrvmpio', long: { 'kernel-name': 's', 'nodename': 'n', 'kernel-release': 'r', 'kernel-version': 'v', machine: 'm', 'operating-system': 'o', 'all': 'a' } });
  const parts = { s: 'Linux', n: ctx.sys.hostname, r: KERNEL, v: '#136-Ubuntu SMP Wed Nov 6 10:38:22 UTC 2024', m: 'x86_64', p: 'x86_64', i: 'x86_64', o: 'GNU/Linux' };
  if (opts.a) { ctx.out(`Linux ${parts.n} ${parts.r} ${parts.v} x86_64 x86_64 x86_64 GNU/Linux\n`); return; }
  const sel = Object.keys(parts).filter((k) => opts[k]); ctx.out((sel.length ? sel.map((k) => parts[k]).join(' ') : 'Linux') + '\n');
});
def('hostname', (ctx) => { const { opts } = getopt(ctx, ctx.args, { flags: 'fisIdA' }); ctx.out((opts.i || opts.I ? '127.0.1.1' : opts.s ? ctx.sys.hostname.split('.')[0] : ctx.sys.hostname) + '\n'); });
def('hostnamectl', (ctx) => ctx.out(`   Static hostname: ${ctx.sys.hostname}\n         Icon name: computer-vm\n           Chassis: vm\n        Machine ID: b1c47dd5a3f94c1e8d0a6f5c2e7b9a13\n  Operating System: Linux Mint 21.3\n            Kernel: Linux ${KERNEL}\n      Architecture: x86-64\n`));
def('uptime', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'ps' });
  const m = Math.floor((ctx.now() - ctx.sys.bootTime) / 60000);
  if (opts.p) { ctx.out(`up ${m < 60 ? m + ' minutes' : Math.floor(m / 60) + ' hours, ' + (m % 60) + ' minutes'}\n`); return; }
  if (opts.s) { ctx.out(fmtDate(ctx.sys.bootTime).replace(/^\w+ /, '').replace(/ ?[A-Z]{3}.*$/, '') + '\n'); return; }
  ctx.out(` ${clock(ctx.now())} up ${upText(ctx)},  1 user,  load average: 0.15, 0.15, 0.11\n`);
});
const STRF = { Y: (d) => d.getFullYear(), m: (d) => p2(d.getMonth() + 1), d: (d) => p2(d.getDate()), H: (d) => p2(d.getHours()), M: (d) => p2(d.getMinutes()), S: (d) => p2(d.getSeconds()), a: (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], b: (d) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()], F: (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, T: (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, s: (d) => Math.floor(d / 1000), Z: (d) => tzAbbrev(+d), y: (d) => p2(d.getFullYear() % 100), j: (d) => '001', A: (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()], B: (d) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()], e: (d) => String(d.getDate()).padStart(2), I: (d) => p2(d.getHours() % 12 || 12), p: (d) => (d.getHours() < 12 ? 'AM' : 'PM'), '%': () => '%' };
def('date', (ctx) => { const f = ctx.args.find((a) => a.startsWith('+')); const d = new Date(ctx.now()); ctx.out((f ? f.slice(1).replace(/%([a-zA-Z%])/g, (m, c) => (STRF[c] ? STRF[c](d) : m)) : fmtDate(ctx.now())) + '\n'); });
def('cal', (ctx) => ctx.out('   October 2026\nSu Mo Tu We Th Fr Sa\n             1  2  3\n 4  5  6  7  8  9 10\n11 12 13 14 15 16 17\n18 19 20 21 22 23 24\n25 26 27 28 29 30 31\n'));
def('free', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'hmgkbt' });
  const used = 1100000 + ctx.sys.processes.length * 900; const total = 4015436; const sw = 2097148;
  const f = (kb) => (opts.h ? (kb >= 1048576 ? (kb / 1048576).toFixed(1) + 'Gi' : Math.round(kb / 1024) + 'Mi') : opts.m ? String(Math.round(kb / 1024)) : String(kb));
  const w = opts.h ? 11 : opts.m ? 11 : 12;
  ctx.out(`${' '.repeat(14)}${['total', 'used', 'free', 'shared', 'buff/cache', 'available'].map((h) => padL(h, w)).join('')}\n`);
  ctx.out(`${padR('Mem:', 14)}${[total, used, total - used - 1240000, 14336, 1240000, total - used].map((v) => padL(f(v), w)).join('')}\n`);
  ctx.out(`${padR('Swap:', 14)}${[sw, 0, sw].map((v) => padL(f(v), w)).join('')}\n`);
});
def('lsb_release', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'aidrcs' });
  const rows = [['Distributor ID', 'LinuxMint', 'i'], ['Description', 'Linux Mint 21.3', 'd'], ['Release', '21.3', 'r'], ['Codename', 'virginia', 'c']];
  if (opts.a) { ctx.out('No LSB modules are available.\n'); for (const r of rows) ctx.out(`${r[0]}:\t${r[1]}\n`); return; }
  for (const r of rows) if (opts[r[2]]) ctx.out(opts.s ? r[1] + '\n' : `${r[0]}:\t${r[1]}\n`);
});
def('nproc', (ctx) => ctx.out('2\n'));
def('lscpu', (ctx) => ctx.out('Architecture:                         x86_64\nCPU(s):                              2\nModel name:                          Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz\n'));
def('lsmod', (ctx) => ctx.out('Module                  Size  Used by\nsnd_intel8x0          49152  2\nvboxguest             49152  1\n'));
def('dmesg', (ctx) => { if (ctx.uid !== 0 && ctx.sys.sysctl['kernel.dmesg_restrict'] === '1') throw new CmdError('dmesg: read kernel buffer failed: Operation not permitted', 1); ctx.out(ctx.sys.vfs.readFile('/var/log/kern.log').replace(/^\w+ +\d+ [\d:]+ \S+ kernel: /gm, '[    0.000000] ')); });
def('journalctl', (ctx) => {
  const { opts } = getopt(ctx, ctx.args, { flags: 'xeabfkr', withArg: 'unpSUo', long: { 'no-pager': 'np', unit: ['u', true], lines: ['n', true], boot: 'b' } });
  const inGroup = ctx.uid === 0 || users.userGroups(ctx.sys, ctx.user).some((g) => g.name === 'adm' || g.name === 'systemd-journal');
  if (!inGroup) ctx.err('Hint: You are currently not seeing messages from other users and the system.\n      Users in groups \'adm\', \'systemd-journal\' can see all messages.\n      Pass -q to turn off this notice.\n');
  let ls = lines(ctx.sys.vfs.readFile('/var/log/syslog'));
  if (opts.u) ls = ls.filter((l) => l.includes(opts.u));
  if (opts.n) ls = ls.slice(-Number(opts.n));
  ctx.out(`-- Journal begins at ${fmtDate(ctx.sys.bootTime).split(' ').slice(0, 4).join(' ')} --\n` + ls.join('\n') + '\n');
});
def('man', (ctx) => { const c = ctx.args.find((a) => !a.startsWith('-')); if (!c) throw new CmdError('What manual page do you want?\nFor example, try \'man man\'.', 1); throw new CmdError(`No manual entry for ${c}`, 16); });
def('help', (ctx) => ctx.out('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\nThese shell commands are defined internally.  Type `help\' to see this list.\n'));
def(['less', 'more', 'pager'], (ctx) => { const f = ctx.args.filter((a) => !a.startsWith('-')); if (!f.length) ctx.out(ctx.stdin); else for (const x of f) ctx.out(ctx.fs.readFile(ctx.abs(x))); });
def('watch', (ctx) => ctx.exec(ctx.args.filter((a) => !a.startsWith('-'))));
def('lspci', (ctx) => ctx.out('00:00.0 Host bridge: Intel Corporation 440FX - 82441FX PMC [Natoma] (rev 02)\n00:02.0 VGA compatible controller: VMware SVGA II Adapter\n'));
def(['reboot', 'shutdown', 'poweroff', 'halt'], (ctx) => { if (ctx.uid !== 0) throw new CmdError(`Failed to ${ctx.name} system via logind: Interactive authentication required.`, 1); ctx.out('Sorry, rebooting is disabled in the simulator. Use the Simulator menu → Reset image.\n'); });
void pk; void fw;
