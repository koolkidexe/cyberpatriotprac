// Kernel parameters: the runtime table (what /proc/sys holds) and the config files that set them at boot.
import { posix } from './util.js';

export const SYSCTL_DEFAULTS = {
  'net.ipv4.ip_forward': '0',
  'net.ipv4.tcp_syncookies': '1',
  'net.ipv4.conf.all.accept_redirects': '1',
  'net.ipv4.conf.default.accept_redirects': '1',
  'net.ipv4.conf.all.secure_redirects': '1',
  'net.ipv4.conf.all.send_redirects': '1',
  'net.ipv4.conf.default.send_redirects': '1',
  'net.ipv4.conf.all.accept_source_route': '0',
  'net.ipv4.conf.default.accept_source_route': '0',
  'net.ipv4.conf.all.rp_filter': '2',
  'net.ipv4.conf.default.rp_filter': '2',
  'net.ipv4.conf.all.log_martians': '0',
  'net.ipv4.icmp_echo_ignore_broadcasts': '1',
  'net.ipv4.icmp_ignore_bogus_error_responses': '1',
  'net.ipv4.tcp_max_syn_backlog': '512',
  'net.ipv6.conf.all.disable_ipv6': '0',
  'net.ipv6.conf.all.accept_redirects': '1',
  'net.ipv6.conf.all.accept_source_route': '0',
  'net.ipv6.conf.all.forwarding': '0',
  'net.core.somaxconn': '4096',
  'kernel.randomize_va_space': '2',
  'kernel.dmesg_restrict': '1',
  'kernel.kptr_restrict': '1',
  'kernel.sysrq': '176',
  'kernel.yama.ptrace_scope': '1',
  'kernel.ostype': 'Linux',
  'kernel.osrelease': '5.15.0-126-generic',
  'fs.suid_dumpable': '2',
  'fs.protected_hardlinks': '1',
  'fs.protected_symlinks': '1',
  'vm.swappiness': '60',
};

const CONF_DIRS = ['/etc/sysctl.d', '/run/sysctl.d', '/usr/local/lib/sysctl.d', '/usr/lib/sysctl.d', '/lib/sysctl.d'];

/** Parse "key = value" lines from sysctl config text. */
export function parseSysctlText(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith(';')) continue;
    const m = /^-?([A-Za-z0-9_.\-/]+)\s*=\s*(.*)$/.exec(l);
    if (m) out.push([m[1].replace(/\//g, '.'), m[2].trim()]);
  }
  return out;
}

/** Files in the order `sysctl --system` applies them (later wins). */
export function sysctlFiles(sys) {
  const byName = new Map();
  for (const dir of CONF_DIRS) {
    if (!sys.vfs.isDir(dir)) continue;
    for (const name of sys.vfs.readdir(dir)) {
      if (!name.endsWith('.conf')) continue;
      if (!byName.has(name)) byName.set(name, `${dir}/${name}`);
    }
  }
  const files = [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[1]);
  files.push('/etc/sysctl.conf');
  return files.filter((f) => sys.vfs.isFile(f));
}

/** Values the configuration files will set at boot (last assignment wins). */
export function sysctlConfEffective(sys) {
  const eff = {};
  for (const f of sysctlFiles(sys)) {
    for (const [k, v] of parseSysctlText(sys.vfs.readFile(f))) eff[k] = v;
  }
  return eff;
}

export function sysctlGet(sys, key) {
  return sys.sysctl[key];
}

export function sysctlSet(sys, key, value) {
  if (!(key in sys.sysctl)) return false;
  sys.sysctl[key] = String(value);
  sys.touch('sysctl');
  return true;
}

/** Apply configuration files to the runtime table (sysctl --system / sysctl -p). */
export function sysctlApply(sys, files) {
  const applied = [];
  for (const f of files) {
    if (!sys.vfs.isFile(f)) continue;
    for (const [k, v] of parseSysctlText(sys.vfs.readFile(f))) {
      if (k in sys.sysctl) { sys.sysctl[k] = v; applied.push([k, v]); }
    }
  }
  sys.touch('sysctl');
  return applied;
}

export const sysctlPath = (key) => '/proc/sys/' + key.split('.').join('/');
export { posix };
