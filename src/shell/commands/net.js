// Networking and firewall: ufw, ss, netstat, lsof, ip, ifconfig, ping, sysctl, nmap, curl, wget, ...
import { cmd, parseOpts, usageError } from '../registry.js';
import { CmdError } from '../../core/errors.js';
import * as fw from '../../core/firewall.js';
import * as services from '../../core/services.js';
import * as pk from '../../core/packages.js';
import * as sc from '../../core/sysctl.js';
import { FsError } from '../../core/vfs.js';
import { posix } from '../../core/util.js';

const IP = '10.0.2.15';
const MAC = '08:00:27:5d:9e:41';
const PORT_NAMES = { 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 68: 'bootpc', 80: 'http', 110: 'pop3', 111: 'sunrpc', 123: 'ntp', 137: 'netbios-ns', 138: 'netbios-dgm', 139: 'netbios-ssn', 143: 'imap', 161: 'snmp', 443: 'https', 445: 'microsoft-ds', 631: 'ipp', 2049: 'nfs', 3306: 'mysql', 5353: 'mdns', 5432: 'postgresql', 8000: 'http-alt', 8080: 'http-alt' };

// ---------------------------------------------------------------- ufw
async function confirmYN(ctx, prompt) {
  let a;
  if (ctx.stdin) a = ctx.readLine(); else a = await ctx.term.readLine(prompt, { echo: true });
  if (ctx.stdin && a != null) ctx.out(prompt + a + '\n');
  return a != null && /^y/i.test(a.trim());
}

cmd('ufw', async (ctx) => {
  const sys = ctx.sys;
  let args = ctx.args.slice();
  let force = false; let dry = false;
  args = args.filter((a) => { if (a === '--force') { force = true; return false; } if (a === '--dry-run') { dry = true; return false; } return true; });
  if (!args.length) {
    ctx.err('ERROR: not enough args\n');
    ctx.out('\nUsage: ufw COMMAND\n\nCommands:\n enable                          enables the firewall\n disable                         disables the firewall\n default ARG                     set default policy\n logging LEVEL                   set logging to LEVEL\n allow ARGS                      add allow rule\n deny ARGS                       add deny rule\n reject ARGS                     add reject rule\n limit ARGS                      add limit rule\n delete RULE|NUM                 delete RULE\n insert NUM RULE                 insert RULE at NUM\n reload                          reload firewall\n reset                           reset firewall\n status                          show firewall status\n status numbered                 show firewall status as numbered list of RULES\n status verbose                  show verbose firewall status\n show ARG                        show firewall report\n version                         display version information\n\nApplication profile commands:\n app list                        list application profiles\n app info PROFILE                show information on PROFILE\n');
    return 1;
  }
  const verb = args[0];
  if (verb === 'version' || verb === '--version') { ctx.out('ufw 0.36.1\nCopyright 2008-2021 Canonical Ltd.\n'); return 0; }
  if (!ctx.isRoot) { ctx.err('ERROR: You need to be root to run this script\n'); return 1; }
  try {
    switch (verb) {
      case 'enable': {
        if (!force && ctx.tty && !(await confirmYN(ctx, 'Command may disrupt existing ssh connections. Proceed with operation (y|n)? '))) { ctx.out('Aborted\n'); return 0; }
        if (!dry) fw.ufwEnable(sys);
        ctx.out('Firewall is active and enabled on system startup\n');
        return 0;
      }
      case 'disable': fw.ufwDisable(sys); ctx.out('Firewall stopped and disabled on system startup\n'); return 0;
      case 'reload': if (!fw.ufwActive(sys)) { ctx.out('Firewall not enabled (skipping reload)\n'); return 0; } ctx.out('Firewall reloaded\n'); return 0;
      case 'reset': {
        if (!force && !(await confirmYN(ctx, 'Resetting all rules to installed defaults. Proceed with operation (y|n)? '))) { ctx.out('Aborted\n'); return 0; }
        const stamp = new Date(sys.now()).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
        fw.resetRules(sys);
        ctx.out(`Backing up 'user.rules' to '/etc/ufw/user.rules.${stamp}'\n\nBacking up 'before.rules' to '/etc/ufw/before.rules.${stamp}'\n\nBacking up 'after.rules' to '/etc/ufw/after.rules.${stamp}'\n\n`);
        return 0;
      }
      case 'status': {
        const mode = args[1];
        const lines = fw.statusLines(sys, { verbose: mode === 'verbose', numbered: mode === 'numbered' });
        ctx.out(lines.join('\n') + '\n');
        return 0;
      }
      case 'default': {
        const pol = args[1]; const dir = args[2] || 'incoming';
        if (!['allow', 'deny', 'reject'].includes(pol)) { ctx.err(`ERROR: Invalid default policy '${pol ?? ''}'\n`); return 1; }
        const d = { incoming: 'incoming', outgoing: 'outgoing', routed: 'routed' }[dir];
        if (!d) { ctx.err(`ERROR: Invalid direction '${dir}'\n`); return 1; }
        fw.setDefault(sys, d, pol);
        ctx.out(`Default ${d} policy changed to '${pol}'\n(be sure to update your rules accordingly)\n`);
        return 0;
      }
      case 'logging': {
        const lv = args[1];
        if (!['on', 'off', 'low', 'medium', 'high', 'full'].includes(lv)) { ctx.err('ERROR: Invalid log level \'' + (lv ?? '') + '\'\n'); return 1; }
        fw.setLogging(sys, lv === 'on' ? 'low' : lv);
        ctx.out(lv === 'off' ? 'Logging disabled\n' : 'Logging enabled\n');
        return 0;
      }
      case 'allow': case 'deny': case 'reject': case 'limit': {
        const rule = fw.parseRule(verb, args.slice(1));
        for (const l of fw.addRule(sys, rule)) ctx.out(l + '\n');
        return 0;
      }
      case 'delete': {
        let rest = args.slice(1);
        if (!rest.length) { ctx.err('ERROR: Wrong number of arguments\n'); return 1; }
        if (/^\d+$/.test(rest[0])) {
          const n = Number(rest[0]);
          const rows = fw.displayRules(sys);
          const row = rows[n - 1];
          if (!row) { ctx.err(`ERROR: Could not find rule '${n}'\n`); return 1; }
          if (!force && !(await confirmYN(ctx, `Deleting:\n ${fw.describeRule(row.rule)}\nProceed with operation (y|n)? `))) { ctx.out('Aborted\n'); return 0; }
          for (const l of fw.deleteRule(sys, n)) ctx.out(l + '\n');
          return 0;
        }
        const act = rest[0];
        if (!['allow', 'deny', 'reject', 'limit'].includes(act)) { ctx.err('ERROR: Invalid syntax\n'); return 1; }
        const rule = fw.parseRule(act, rest.slice(1));
        for (const l of fw.deleteRule(sys, rule)) ctx.out(l + '\n');
        return 0;
      }
      case 'insert': {
        const n = Number(args[1]);
        const act = args[2];
        if (!n || !['allow', 'deny', 'reject', 'limit'].includes(act)) { ctx.err('ERROR: Invalid syntax\n'); return 1; }
        const rule = fw.parseRule(act, args.slice(3));
        for (const l of fw.addRule(sys, rule)) ctx.out(l + '\n');
        const r = sys.ufw.rules; const last = r.pop(); r.splice(Math.max(0, n - 1), 0, last); fw.writeUserRules(sys);
        return 0;
      }
      case 'app': {
        if (args[1] === 'list') { ctx.out('Available applications:\n' + Object.keys(fw.APP_PROFILES).sort().map((a) => `  ${a}`).join('\n') + '\n'); return 0; }
        if (args[1] === 'info') { const k = Object.keys(fw.APP_PROFILES).find((a) => a.toLowerCase() === String(args[2]).toLowerCase()); if (!k) { ctx.err(`ERROR: Could not find profile '${args[2]}'\n`); return 1; } ctx.out(`Profile: ${k}\nTitle: ${k} server\nDescription: ${k} service\n\nPort:\n  ${fw.APP_PROFILES[k]}\n`); return 0; }
        return 0;
      }
      case 'show': {
        if (args[1] === 'added') {
          const rules = sys.ufw.rules;
          ctx.out(rules.length ? 'Added user rules (see \'ufw status\' for running firewall):\n' + rules.map((r) => `ufw ${fw.describeRule(r)}`).join('\n') + '\n' : 'Added user rules (see \'ufw status\' for running firewall):\n(None)\n');
          return 0;
        }
        ctx.out('');
        return 0;
      }
      default:
        ctx.err(`ERROR: Invalid syntax\n`);
        return 1;
    }
  } catch (e) {
    if (e instanceof CmdError) { ctx.err(e.message + '\n'); return e.code || 1; }
    throw e;
  }
}, { pkg: 'ufw', usage: 'ufw COMMAND', noHelp: true });

// ---------------------------------------------------------------- sockets
const fdOf = (pid, i = 0) => 3 + ((pid + i) % 9);

function visibleSockets(ctx) {
  return ctx.sys.sockets().map((s) => ({ ...s, own: ctx.isRoot || s.user === ctx.user }));
}
const isV6 = (s) => s.proto === 'tcp6' || s.proto === 'udp6' || (s.addr || '').startsWith('[') || s.addr === '*';
const baseProto = (s) => (s.proto.startsWith('tcp') ? 'tcp' : 'udp');
const portName = (p) => PORT_NAMES[p] || String(p);

function procName(ctx, s) {
  const p = ctx.sys.findProc(s.pid);
  return p ? p.comm : s.comm;
}

cmd('ss', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'tulnpaH46sreoOmx', long: { tcp: 't', udp: 'u', listening: 'l', numeric: 'n', processes: 'p', all: 'a', 'no-header': 'H', summary: 's' } });
  if (err) return usageError(ctx, err);
  if (o.s) { ctx.out(`Total: ${ctx.sys.sockets().length + 340}\nTCP:   ${ctx.sys.sockets().filter((s) => baseProto(s) === 'tcp').length} (estab 0, closed 0, orphaned 0, timewait 0)\n`); return 0; }
  let socks = visibleSockets(ctx);
  const wantT = o.t; const wantU = o.u;
  if (wantT || wantU) socks = socks.filter((s) => (wantT && baseProto(s) === 'tcp') || (wantU && baseProto(s) === 'udp'));
  else if (!o.a && !o.l) socks = [];
  if (!o.l && !o.a) socks = [];
  if (o['4']) socks = socks.filter((s) => !isV6(s));
  if (o['6']) socks = socks.filter((s) => isV6(s));
  const filt = rest.join(' ');
  const mp = /(?:sport|dport)\s*(?:=|==|eq)?\s*:?(\d+)/.exec(filt);
  if (mp) socks = socks.filter((s) => s.port === Number(mp[1]));
  socks.sort((a, b) => (baseProto(a) === baseProto(b) ? 0 : baseProto(a) === 'tcp' ? -1 : 1) || a.port - b.port);
  const showNetid = wantT && wantU || (!wantT && !wantU);
  const rows = socks.map((s) => {
    const udp = baseProto(s) === 'udp';
    const addr = s.addr === '*' ? '*' : s.addr;
    const local = `${addr}:${o.n ? s.port : portName(s.port)}`;
    const peer = udp ? (isV6(s) && s.addr !== '*' ? '[::]:*' : '*:*') : (s.addr === '*' ? '*:*' : isV6(s) ? '[::]:*' : '0.0.0.0:*');
    const proc = o.p && s.own ? `users:(("${procName(ctx, s)}",pid=${s.pid},fd=${fdOf(s.pid)}))` : '';
    return { netid: baseProto(s), state: udp ? 'UNCONN' : 'LISTEN', rq: 0, sq: udp ? 0 : (s.port === 53 ? 4096 : s.port === 4444 ? 1 : s.port === 8000 ? 5 : 128), local, peer, proc };
  });
  const w = { local: Math.max(18, ...rows.map((r) => r.local.length)), peer: Math.max(18, ...rows.map((r) => r.peer.length)) };
  if (!o.H) {
    ctx.out(`${showNetid ? 'Netid ' : ''}State  Recv-Q Send-Q ${'Local Address:Port'.padStart(w.local)} ${'Peer Address:Port'.padStart(w.peer)} ${o.p ? 'Process' : ''}`.trimEnd() + '\n');
  }
  for (const r of rows) ctx.out(`${showNetid ? r.netid.padEnd(6) : ''}${r.state.padEnd(6)} ${String(r.rq).padEnd(6)} ${String(r.sq).padEnd(6)} ${r.local.padStart(w.local)} ${r.peer.padStart(w.peer)}${r.proc ? ' ' + r.proc : ''}`.trimEnd() + '\n');
  return 0;
}, { pkg: 'iproute2' });

cmd('netstat', (ctx) => {
  const { o, err } = parseOpts(ctx.args, { bool: 'tulnpaeraisg46Wc', long: { tcp: 't', udp: 'u', listening: 'l', numeric: 'n', programs: 'p', all: 'a', route: 'r', interfaces: 'i', statistics: 's' } });
  if (err) return usageError(ctx, err);
  if (o.r) { ctx.out(`Kernel IP routing table\nDestination     Gateway         Genmask         Flags   MSS Window  irtt Iface\n0.0.0.0         10.0.2.2        0.0.0.0         UG        0 0          0 enp0s3\n10.0.2.0        0.0.0.0         255.255.255.0   U         0 0          0 enp0s3\n169.254.0.0     0.0.0.0         255.255.0.0     U         0 0          0 enp0s3\n`); return 0; }
  if (o.i) { ctx.out('Kernel Interface table\nIface      MTU    RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg\nenp0s3    1500     8213      0      0 0          4101      0      0      0 BMRU\nlo       65536     2412      0      0 0          2412      0      0      0 LRU\n'); return 0; }
  let socks = visibleSockets(ctx);
  if (o.t || o.u) socks = socks.filter((s) => (o.t && baseProto(s) === 'tcp') || (o.u && baseProto(s) === 'udp'));
  if (!o.t && !o.u) { /* default: all inet */ }
  socks.sort((a, b) => (baseProto(a) === baseProto(b) ? 0 : baseProto(a) === 'tcp' ? -1 : 1) || a.port - b.port);
  ctx.out(`Active Internet connections (${o.a ? 'servers and established' : 'only servers'})\n`);
  if (o.p && !ctx.isRoot) ctx.out('(Not all processes could be identified, non-owned process info\n will not be shown, you would have to be root to see it all.)\n');
  ctx.out(`Proto Recv-Q Send-Q Local Address           Foreign Address         State       ${o.p ? 'PID/Program name    ' : ''}\n`.replace(/\s+$/, (m) => m.replace(/\s+$/, ' ')).replace(/ $/, '') + '\n');
  for (const s of socks) {
    const udp = baseProto(s) === 'udp';
    const v6 = isV6(s);
    const proto = (udp ? 'udp' : 'tcp') + (v6 ? '6' : '');
    const laddr = v6 ? (s.addr === '*' ? ':::' : s.addr.replace(/^\[(.*)\]$/, '$1')) : s.addr.replace(/%.*/, '');
    const local = `${s.addr === '*' || v6 ? (s.addr === '*' ? '::' : laddr) : laddr}:${o.n ? s.port : portName(s.port)}`;
    const foreign = v6 ? ':::*' : '0.0.0.0:*';
    const state = udp ? '' : 'LISTEN';
    const prog = o.p && (ctx.isRoot || s.user === ctx.user) ? `${s.pid}/${procName(ctx, s)}` : (o.p ? '-' : '');
    ctx.out(`${proto.padEnd(5)} ${'0'.padStart(6)} ${'0'.padStart(6)} ${local.padEnd(23)} ${foreign.padEnd(23)} ${state.padEnd(11)} ${prog}`.trimEnd() + '\n');
  }
  return 0;
}, { pkg: 'net-tools' });

cmd('lsof', (ctx) => {
  const { o, rest } = parseOpts(ctx.args, { bool: 'inPtlUV', val: 'ipuc' });
  const socks = visibleSockets(ctx).filter((s) => s.own);
  let list = socks;
  const iArg = ctx.args.find((a, i) => a.startsWith('-i') && a.length > 2) || null;
  const m = iArg && /:(\d+)/.exec(iArg);
  if (m) list = list.filter((s) => s.port === Number(m[1]));
  if (!ctx.args.some((a) => a.startsWith('-i'))) { ctx.out(''); return 0; }
  if (!list.length) return 1;
  ctx.out('COMMAND     PID     USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n');
  for (const s of list) ctx.out(`${procName(ctx, s).slice(0, 9).padEnd(9)} ${String(s.pid).padStart(5)} ${s.user.slice(0, 8).padEnd(8)} ${String(fdOf(s.pid)).padStart(3)}u  ${isV6(s) ? 'IPv6' : 'IPv4'}  ${20000 + s.pid}      0t0  ${baseProto(s).toUpperCase()} ${(s.addr === '*' ? '*' : s.addr)}:${o.n || o.P ? s.port : portName(s.port)}${baseProto(s) === 'tcp' ? ' (LISTEN)' : ''}\n`);
  void rest;
  return 0;
});

// ---------------------------------------------------------------- ip / ifconfig / ping
function ipAddrText(brief) {
  if (brief) return `lo               UNKNOWN        127.0.0.1/8 ::1/128 \nenp0s3           UP             ${IP}/24 fe80::a00:27ff:fe5d:9e41/64 \n`;
  return `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n    inet6 ::1/128 scope host \n       valid_lft forever preferred_lft forever\n2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether ${MAC} brd ff:ff:ff:ff:ff:ff\n    inet ${IP}/24 brd 10.0.2.255 scope global dynamic noprefixroute enp0s3\n       valid_lft 86213sec preferred_lft 86213sec\n    inet6 fe80::a00:27ff:fe5d:9e41/64 scope link noprefixroute \n       valid_lft forever preferred_lft forever\n`;
}
cmd('ip', (ctx) => {
  const a = ctx.args.filter((x) => !x.startsWith('-') || x === '-br' || x === '-brief');
  const brief = ctx.args.includes('-br') || ctx.args.includes('-brief') || ctx.args.includes('-4') && false;
  const obj = (a.find((x) => !x.startsWith('-')) || 'addr');
  if (['a', 'addr', 'address'].includes(obj)) { ctx.out(ipAddrText(brief)); return 0; }
  if (['l', 'link'].includes(obj)) { ctx.out(brief ? 'lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> \nenp0s3           UP             08:00:27:5d:9e:41 <BROADCAST,MULTICAST,UP,LOWER_UP> \n' : `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether ${MAC} brd ff:ff:ff:ff:ff:ff\n`); return 0; }
  if (['r', 'route'].includes(obj)) { ctx.out(`default via 10.0.2.2 dev enp0s3 proto dhcp metric 100 \n10.0.2.0/24 dev enp0s3 proto kernel scope link src ${IP} metric 100 \n169.254.0.0/16 dev enp0s3 scope link metric 1000 \n`); return 0; }
  if (['n', 'neigh', 'neighbour'].includes(obj)) { ctx.out('10.0.2.2 dev enp0s3 lladdr 52:54:00:12:35:02 REACHABLE\n'); return 0; }
  if (obj === 'help') { ctx.out('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n'); return 0; }
  ctx.err(`Object "${obj}" is unknown, try "ip help".\n`);
  return 1;
}, { pkg: 'iproute2' });

cmd('ifconfig', (ctx) => {
  ctx.out(`enp0s3: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet ${IP}  netmask 255.255.255.0  broadcast 10.0.2.255\n        inet6 fe80::a00:27ff:fe5d:9e41  prefixlen 64  scopeid 0x20<link>\n        ether ${MAC}  txqueuelen 1000  (Ethernet)\n        RX packets 8213  bytes 8924712 (8.9 MB)\n        RX errors 0  dropped 0  overruns 0  frame 0\n        TX packets 4101  bytes 391223 (391.2 KB)\n        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        inet6 ::1  prefixlen 128  scopeid 0x10<host>\n        loop  txqueuelen 1000  (Local Loopback)\n        RX packets 2412  bytes 213322 (213.3 KB)\n        RX errors 0  dropped 0  overruns 0  frame 0\n        TX packets 2412  bytes 213322 (213.3 KB)\n        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0\n\n`);
  return 0;
}, { pkg: 'net-tools' });
cmd('route', (ctx) => { ctx.out(`Kernel IP routing table\nDestination     Gateway         Genmask         Flags Metric Ref    Use Iface\ndefault         10.0.2.2        0.0.0.0         UG    100    0        0 enp0s3\n10.0.2.0        0.0.0.0         255.255.255.0   U     100    0        0 enp0s3\n169.254.0.0     0.0.0.0         255.255.0.0     U     1000   0        0 enp0s3\n`); return 0; }, { pkg: 'net-tools' });
cmd('arp', (ctx) => { ctx.out('Address                  HWtype  HWaddress           Flags Mask            Iface\n_gateway                 ether   52:54:00:12:35:02   C                     enp0s3\n'); return 0; }, { pkg: 'net-tools' });

function resolveHost(sys, h) {
  const host = h.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { ip: host === '::1' ? '::1' : '127.0.0.1', local: true, name: 'localhost' };
  if (host === sys.hostname || host === IP) return { ip: IP, local: true, name: sys.hostname };
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return { ip: host, local: false };
  const table = { 'google.com': '142.250.80.46', 'www.google.com': '142.250.80.46', 'ubuntu.com': '185.125.190.20', 'linuxmint.com': '151.101.2.132', 'archive.ubuntu.com': '91.189.91.82', 'example.com': '93.184.216.34' };
  if (table[host]) return { ip: table[host], local: false };
  return null;
}

cmd('ping', async (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: '46qnv', val: 'cWwisI' });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err('ping: usage error: Destination address required\n'); return 2; }
  const host = rest[0];
  const r = resolveHost(ctx.sys, host);
  if (!r) { ctx.err(`ping: ${host}: Temporary failure in name resolution\n`); return 2; }
  const count = o.c ? Number(o.c) : 1000;
  const name = r.name && r.name !== host ? `${r.name} (${r.ip})` : r.ip;
  ctx.out(`PING ${host} (${r.ip}) 56(84) bytes of data.\n`);
  let sent = 0; const times = [];
  for (let i = 0; i < count && !ctx.aborted(); i++) {
    const t = r.local ? 0.03 + (i % 5) * 0.011 : 18 + (i * 7) % 11 + 0.3;
    times.push(t);
    ctx.out(`64 bytes from ${r.local && host !== r.ip ? `${name}` : r.ip}: icmp_seq=${i + 1} ttl=${r.local ? 64 : 114} time=${t.toFixed(r.local ? 3 : 1)} ms\n`);
    sent++;
    if (i < count - 1) await ctx.sleep(o.i ? Number(o.i) * 1000 : 1000);
  }
  const min = Math.min(...times); const max = Math.max(...times); const avg = times.reduce((a, b) => a + b, 0) / times.length;
  ctx.out(`\n--- ${host} ping statistics ---\n${sent} packets transmitted, ${sent} received, 0% packet loss, time ${(sent - 1) * 1001}ms\nrtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/0.0${Math.floor(max - min) % 9}0 ms\n`);
  return 0;
}, { pkg: 'iputils-ping' });

cmd(['nslookup', 'dig', 'host'], (ctx) => {
  const h = ctx.args.find((a) => !a.startsWith('-') && !a.startsWith('@')) || '';
  const r = resolveHost(ctx.sys, h);
  if (ctx.name === 'host') { if (!r) { ctx.out(`Host ${h} not found: 3(NXDOMAIN)\n`); return 1; } ctx.out(`${h} has address ${r.ip}\n`); return 0; }
  if (!r) { ctx.out(`;; connection timed out; no servers could be reached\n`); return 1; }
  ctx.out(`Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\nNon-authoritative answer:\nName:\t${h}\nAddress: ${r.ip}\n\n`);
  return 0;
});

cmd('iptables', (ctx) => {
  if (!ctx.isRoot) { ctx.err('iptables v1.8.7 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)\n'); return 4; }
  const on = fw.ufwActive(ctx.sys);
  const pol = fw.getDefaults(ctx.sys);
  if (ctx.args.includes('-S')) { ctx.out(`-P INPUT ${on ? (pol.incoming === 'deny' ? 'DROP' : 'ACCEPT') : 'ACCEPT'}\n-P FORWARD ${on ? 'DROP' : 'ACCEPT'}\n-P OUTPUT ACCEPT\n`); return 0; }
  ctx.out(`Chain INPUT (policy ${on ? (pol.incoming === 'deny' ? 'DROP' : 'ACCEPT') : 'ACCEPT'})\ntarget     prot opt source               destination         \n${on ? 'ufw-before-logging-input  all  --  anywhere             anywhere            \nufw-before-input  all  --  anywhere             anywhere            \nufw-after-input  all  --  anywhere             anywhere            \n' : ''}\nChain FORWARD (policy ${on ? 'DROP' : 'ACCEPT'})\ntarget     prot opt source               destination         \n\nChain OUTPUT (policy ACCEPT)\ntarget     prot opt source               destination         \n`);
  return 0;
}, { pkg: 'iptables' });
cmd(['ip6tables', 'iptables-save', 'iptables-restore'], (ctx) => { if (!ctx.isRoot) { ctx.err(`${ctx.name}: Permission denied (you must be root)\n`); return 4; } ctx.out(''); return 0; }, { pkg: 'iptables' });

// ---------------------------------------------------------------- sysctl
cmd('sysctl', (ctx) => {
  const sys = ctx.sys;
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'awpnNeqV', val: 'pwf', long: { all: 'a', write: 'w', system: 'S', load: { key: 'p', val: true, optional: true }, quiet: 'q', values: 'n', 'no-pager': 'P', version: 'V' } });
  if (err && !/invalid option -- 'p'/.test(err)) return usageError(ctx, err);
  if (o.V) { ctx.out('sysctl from procps-ng 3.3.17\n'); return 0; }
  const fmtVal = (k) => `${o.n ? '' : k + ' = '}${sys.sysctl[k]}\n`;
  const noKey = (k) => { ctx.err(`sysctl: cannot stat /proc/sys/${k.split('.').join('/')}: No such file or directory\n`); return 255; };
  if (o.S) {
    if (!ctx.isRoot) { ctx.err('sysctl: permission denied on key \'fs.protected_fifos\'\n'); return 0; }
    const files = sc.sysctlFiles(sys);
    for (const f of files) {
      ctx.out(`* Applying ${f} ...\n`);
      for (const [k, v] of sc.parseSysctlText(sys.vfs.readFile(f))) { if (k in sys.sysctl) { sys.sysctl[k] = v; ctx.out(`${k} = ${v}\n`); } else ctx.err(`sysctl: cannot stat /proc/sys/${k.split('.').join('/')}: No such file or directory\n`); }
    }
    sys.touch('sysctl');
    return 0;
  }
  if (o.p !== undefined || ctx.args.includes('-p') || ctx.args.some((a) => a.startsWith('--load'))) {
    if (!ctx.isRoot) { ctx.err('sysctl: permission denied on key \'net.ipv4.ip_forward\', ignoring\n'); return 255; }
    const file = (typeof o.p === 'string' && o.p) ? o.p : (rest[0] || '/etc/sysctl.conf');
    const path = ctx.resolve(file);
    if (!sys.vfs.isFile(path)) { ctx.err(`sysctl: cannot open "${path}": No such file or directory\n`); return 255; }
    for (const [k, v] of sc.parseSysctlText(sys.vfs.readFile(path))) {
      if (k in sys.sysctl) { sys.sysctl[k] = v; if (!o.q) ctx.out(`${k} = ${v}\n`); } else ctx.err(`sysctl: cannot stat /proc/sys/${k.split('.').join('/')}: No such file or directory\n`);
    }
    sys.touch('sysctl');
    return 0;
  }
  if (o.a) { for (const k of Object.keys(sys.sysctl).sort()) ctx.out(fmtVal(k)); return 0; }
  if (!rest.length) { ctx.err('sysctl: no variables specified\nTry `sysctl --help\' for more information.\n'); return 255; }
  let rc = 0;
  for (const item of rest) {
    const eq = item.indexOf('=');
    const key = (eq < 0 ? item : item.slice(0, eq)).replace(/\//g, '.');
    if (eq < 0) {
      if (!(key in sys.sysctl)) { rc = noKey(key); continue; }
      ctx.out(fmtVal(key));
    } else {
      const val = item.slice(eq + 1);
      if (!(key in sys.sysctl)) { rc = noKey(key); continue; }
      if (!ctx.isRoot) { ctx.err(`sysctl: setting key "${key}": Permission denied\n`); rc = 255; continue; }
      sys.sysctl[key] = val;
      sys.touch('sysctl');
      if (!o.q) ctx.out(`${key} = ${val}\n`);
    }
  }
  return rc;
}, { usage: 'sysctl [options] [variable[=value] ...]' });

// ---------------------------------------------------------------- nmap / curl / wget / ssh / nc
cmd('nmap', async (ctx) => {
  const { o, rest } = parseOpts(ctx.args, { bool: 'sSVAnvPT', val: 'pT' });
  const target = rest.find((a) => !a.startsWith('-')) || '';
  if (!target) { ctx.out('Nmap 7.80 ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n'); return 0; }
  const r = resolveHost(ctx.sys, target);
  if (!r) { ctx.err(`Failed to resolve "${target}".\nWARNING: No targets were specified, so 0 hosts scanned.\nNmap done: 0 IP addresses (0 hosts up) scanned in 0.03 seconds\n`); return 0; }
  if (!r.local) { ctx.out(`Starting Nmap 7.80 ( https://nmap.org ) at ${new Date(ctx.sys.now()).toISOString().slice(0, 16).replace('T', ' ')} EDT\nNote: Host seems down. If it is really up, but blocking our ping probes, try -Pn\nNmap done: 1 IP address (0 hosts up) scanned in 3.04 seconds\n`); return 0; }
  const loop = r.ip.startsWith('127');
  let socks = ctx.sys.sockets().filter((s) => baseProto(s) === 'tcp');
  if (!loop) socks = socks.filter((s) => !/^127\./.test(s.addr) && !/^\[::1\]/.test(s.addr));
  const seen = new Set();
  const ports = socks.filter((s) => (seen.has(s.port) ? false : (seen.add(s.port), true))).sort((a, b) => a.port - b.port);
  ctx.out(`Starting Nmap 7.80 ( https://nmap.org ) at ${new Date(ctx.sys.now()).toISOString().slice(0, 16).replace('T', ' ')} EDT\nNmap scan report for ${r.name === 'localhost' ? 'localhost (127.0.0.1)' : `${ctx.sys.hostname} (${r.ip})`}\nHost is up (0.000092s latency).\n`);
  ctx.out(`Not shown: ${(o.p === '-' ? 65535 : 1000) - ports.length} closed ports\n`);
  if (ports.length) {
    ctx.out(`PORT${' '.repeat(6)}STATE SERVICE${o.V ? '  VERSION' : ''}\n`);
    for (const s of ports) ctx.out(`${(s.port + '/tcp').padEnd(9)} open  ${(PORT_NAMES[s.port] || 'unknown').padEnd(10)}${o.V ? ' ' + (s.comm || '') : ''}\n`.replace(/\s+\n/, '\n'));
  }
  ctx.out(`\nNmap done: 1 IP address (1 host up) scanned in 0.08 seconds\n`);
  return 0;
}, { pkg: 'nmap' });

function httpFetch(ctx, url) {
  const m = /^(?:(\w+):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return { err: 3, msg: `curl: (3) URL using bad/illegal format or missing URL` };
  const host = m[2]; const port = Number(m[3] || (m[1] === 'https' ? 443 : 80));
  const r = resolveHost(ctx.sys, host);
  if (!r) return { err: 6, msg: `curl: (6) Could not resolve host: ${host}` };
  if (!r.local) return { err: 7, msg: `curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server` };
  const s = ctx.sys.sockets().find((x) => x.port === port && baseProto(x) === 'tcp');
  if (!s) return { err: 7, msg: `curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Connection refused` };
  if (s.comm === 'python3') return { body: '<!DOCTYPE HTML>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Directory listing for /</title>\n</head>\n<body>\n<h1>Directory listing for /</h1>\n<hr>\n<ul>\n<li><a href=".bash_history">.bash_history</a></li>\n<li><a href="notes.txt">notes.txt</a></li>\n</ul>\n<hr>\n</body>\n</html>\n' };
  if (port === 80) return { body: '<!DOCTYPE html>\n<html><head><title>Apache2 Ubuntu Default Page: It works</title></head>\n<body><h1>Apache2 Default Page</h1></body></html>\n' };
  return { err: 52, msg: 'curl: (52) Empty reply from server' };
}
cmd('curl', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'sSLkIvO', val: 'oXHdA', long: { silent: 's', location: 'L', head: 'I', output: { key: 'o', val: true }, 'remote-name': 'O' } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err('curl: try \'curl --help\' or \'curl --manual\' for more information\n'); return 2; }
  const r = httpFetch(ctx, rest[0]);
  if (r.err) { if (!o.s || o.S) ctx.err(r.msg + '\n'); return r.err; }
  if (o.o) { try { ctx.fs.writeFile(ctx.resolve(o.o), r.body); } catch (e) { if (e instanceof FsError) { ctx.err(`curl: (23) Failure writing output to destination\n`); return 23; } throw e; } return 0; }
  ctx.out(r.body);
  return 0;
}, { pkg: 'curl' });
cmd('wget', (ctx) => {
  const { o, rest, err } = parseOpts(ctx.args, { bool: 'qcrv', val: 'OP', long: { quiet: 'q', 'output-document': { key: 'O', val: true } } });
  if (err) return usageError(ctx, err);
  if (!rest.length) { ctx.err('wget: missing URL\nUsage: wget [OPTION]... [URL]...\n'); return 1; }
  const u = rest[0];
  const r = httpFetch(ctx, u);
  const host = u.replace(/^\w+:\/\//, '').split(/[/:]/)[0];
  if (r.err) { if (!o.q) ctx.err(r.err === 6 ? `--${posix.basename('')}-- ${u}\nResolving ${host} (${host})... failed: Temporary failure in name resolution.\nwget: unable to resolve host address ‘${host}’\n` : `Connecting to ${host}... failed: Connection refused.\n`); return 4; }
  const name = o.O || 'index.html';
  try { ctx.fs.writeFile(ctx.resolve(name), r.body); } catch (e) { if (e instanceof FsError) { ctx.err(`${name}: ${e.text}\nCannot write to ‘${name}’ (${e.text}).\n`); return 3; } throw e; }
  if (!o.q) ctx.out(`HTTP request sent, awaiting response... 200 OK\nSaving to: ‘${name}’\n\n${name}  100%[===================>]   ${r.body.length}  --.-KB/s    in 0s\n\n‘${name}’ saved [${r.body.length}/${r.body.length}]\n`);
  return 0;
}, { pkg: 'wget' });

cmd('ssh', async (ctx) => {
  const dest = ctx.args.filter((a) => !a.startsWith('-')).pop();
  if (!dest) { ctx.err('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface]\n           [-b bind_address] [-c cipher_spec] [-D [bind_address:]port]\n'); return 255; }
  const host = dest.includes('@') ? dest.split('@')[1] : dest;
  const r = resolveHost(ctx.sys, host);
  if (!r) { ctx.err(`ssh: Could not resolve hostname ${host}: Temporary failure in name resolution\n`); return 255; }
  if (!r.local) { ctx.err(`ssh: connect to host ${host} port 22: Connection timed out\n`); return 255; }
  if (!ctx.sys.sockets().some((s) => s.port === 22)) { ctx.err(`ssh: connect to host ${host} port 22: Connection refused\n`); return 255; }
  ctx.err('This simulator does not open nested remote sessions. (The SSH server is reachable on port 22.)\n');
  return 255;
}, { pkg: 'openssh-client' });
cmd(['scp', 'sftp', 'ssh-keygen', 'ssh-add', 'ssh-copy-id'], (ctx) => { ctx.err(`${ctx.name}: not supported in this simulator\n`); return 1; }, { pkg: 'openssh-client' });
cmd('telnet', (ctx) => { const h = ctx.args[0] || ''; const p = Number(ctx.args[1] || 23); const r = resolveHost(ctx.sys, h); if (!r || !r.local || !ctx.sys.sockets().some((s) => s.port === p)) { ctx.out(`Trying ${r?.ip ?? h}...\n`); ctx.err(`telnet: Unable to connect to remote host: Connection refused\n`); return 1; } ctx.out(`Trying ${r.ip}...\nConnected to ${h}.\nEscape character is '^]'.\n`); return 0; }, { pkg: 'telnet' });

export { pk, services };
