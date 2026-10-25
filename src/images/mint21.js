// Builds a fresh Linux Mint 21.3 "Virginia" (Ubuntu 22.04 / jammy base) machine as a System.
// Everything is real files in the virtual FS; scenarios then break things on top of this image.
import { System } from '../core/system.js';
import * as users from '../core/users.js';
import * as pk from '../core/packages.js';
import * as sv from '../core/services.js';
import { SYSCTL_DEFAULTS } from '../core/sysctl.js';
import { sysctlPath } from '../core/sysctl.js';
import { PACKAGES, SERVICES } from './catalog.js';
import * as C from './configs.js';

/** Small seeded PRNG so images are reproducible in tests. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const KERNEL = '5.15.0-126-generic';
const KERNEL_BUILD = '#136-Ubuntu SMP Wed Nov 6 10:38:22 UTC 2024';

// name, uid, gid, gecos, home, shell
const SYSTEM_USERS = [
  ['root', 0, 0, 'root', '/root', '/bin/bash'], ['daemon', 1, 1, 'daemon', '/usr/sbin', '/usr/sbin/nologin'],
  ['bin', 2, 2, 'bin', '/bin', '/usr/sbin/nologin'], ['sys', 3, 3, 'sys', '/dev', '/usr/sbin/nologin'],
  ['sync', 4, 65534, 'sync', '/bin', '/bin/sync'], ['games', 5, 60, 'games', '/usr/games', '/usr/sbin/nologin'],
  ['man', 6, 12, 'man', '/var/cache/man', '/usr/sbin/nologin'], ['lp', 7, 7, 'lp', '/var/spool/lpd', '/usr/sbin/nologin'],
  ['mail', 8, 8, 'mail', '/var/mail', '/usr/sbin/nologin'], ['news', 9, 9, 'news', '/var/spool/news', '/usr/sbin/nologin'],
  ['uucp', 10, 10, 'uucp', '/var/spool/uucp', '/usr/sbin/nologin'], ['proxy', 13, 13, 'proxy', '/bin', '/usr/sbin/nologin'],
  ['www-data', 33, 33, 'www-data', '/var/www', '/usr/sbin/nologin'], ['backup', 34, 34, 'backup', '/var/backups', '/usr/sbin/nologin'],
  ['list', 38, 38, 'Mailing List Manager', '/var/list', '/usr/sbin/nologin'], ['irc', 39, 39, 'ircd', '/run/ircd', '/usr/sbin/nologin'],
  ['gnats', 41, 41, 'Gnats Bug-Reporting System (admin)', '/var/lib/gnats', '/usr/sbin/nologin'],
  ['nobody', 65534, 65534, 'nobody', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-network', 100, 102, 'systemd Network Management,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['systemd-resolve', 101, 103, 'systemd Resolver,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['messagebus', 102, 105, '', '/nonexistent', '/usr/sbin/nologin'], ['systemd-timesync', 103, 106, 'systemd Time Synchronization,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['syslog', 104, 110, '', '/home/syslog', '/usr/sbin/nologin'], ['_apt', 105, 65534, '', '/nonexistent', '/usr/sbin/nologin'],
  ['tss', 106, 111, 'TPM software stack,,,', '/var/lib/tpm', '/bin/false'], ['uuidd', 107, 112, '', '/run/uuidd', '/usr/sbin/nologin'],
  ['tcpdump', 108, 113, '', '/nonexistent', '/usr/sbin/nologin'], ['avahi-autoipd', 109, 114, 'Avahi autoip daemon,,,', '/var/lib/avahi-autoipd', '/usr/sbin/nologin'],
  ['usbmux', 110, 46, 'usbmux daemon,,,', '/var/lib/usbmux', '/usr/sbin/nologin'], ['rtkit', 111, 117, 'RealtimeKit,,,', '/proc', '/usr/sbin/nologin'],
  ['dnsmasq', 112, 65534, 'dnsmasq,,,', '/var/lib/misc', '/usr/sbin/nologin'], ['cups-pk-helper', 113, 120, 'user for cups-pk-helper service,,,', '/home/cups-pk-helper', '/usr/sbin/nologin'],
  ['speech-dispatcher', 114, 29, 'Speech Dispatcher,,,', '/run/speech-dispatcher', '/bin/false'], ['avahi', 115, 121, 'Avahi mDNS daemon,,,', '/run/avahi-daemon', '/usr/sbin/nologin'],
  ['kernoops', 116, 65534, 'Kernel Oops Tracking Daemon,,,', '/', '/usr/sbin/nologin'], ['saned', 117, 123, '', '/var/lib/saned', '/usr/sbin/nologin'],
  ['nm-openvpn', 118, 124, 'NetworkManager OpenVPN,,,', '/var/lib/openvpn/chroot', '/usr/sbin/nologin'], ['hplip', 119, 7, 'HPLIP system user,,,', '/run/hplip', '/bin/false'],
  ['whoopsie', 120, 125, '', '/nonexistent', '/bin/false'], ['colord', 121, 126, 'colord colour management daemon,,,', '/var/lib/colord', '/usr/sbin/nologin'],
  ['geoclue', 122, 127, '', '/var/lib/geoclue', '/usr/sbin/nologin'], ['pulse', 123, 128, 'PulseAudio daemon,,,', '/run/pulse', '/usr/sbin/nologin'],
  ['gnome-initial-setup', 124, 65534, '', '/run/gnome-initial-setup/', '/bin/false'], ['lightdm', 125, 129, 'Light Display Manager', '/var/lib/lightdm', '/bin/false'],
  ['polkitd', 997, 997, 'polkit', '/nonexistent', '/usr/sbin/nologin'],
];

const SYSTEM_GROUPS = [
  ['root', 0], ['daemon', 1], ['bin', 2], ['sys', 3], ['adm', 4], ['tty', 5], ['disk', 6], ['lp', 7], ['mail', 8], ['news', 9], ['uucp', 10], ['man', 12],
  ['proxy', 13], ['kmem', 15], ['dialout', 20], ['fax', 21], ['voice', 22], ['cdrom', 24], ['floppy', 25], ['tape', 26], ['sudo', 27], ['audio', 29], ['dip', 30],
  ['www-data', 33], ['backup', 34], ['operator', 37], ['list', 38], ['irc', 39], ['src', 40], ['gnats', 41], ['shadow', 42], ['utmp', 43], ['video', 44], ['sasl', 45],
  ['plugdev', 46], ['staff', 50], ['games', 60], ['users', 100], ['systemd-journal', 101], ['systemd-network', 102], ['systemd-resolve', 103], ['input', 104],
  ['messagebus', 105], ['systemd-timesync', 106], ['kvm', 107], ['render', 108], ['crontab', 109], ['syslog', 110], ['tss', 111], ['uuidd', 112], ['tcpdump', 113],
  ['avahi-autoipd', 114], ['netdev', 115], ['bluetooth', 116], ['rtkit', 117], ['ssl-cert', 118], ['lpadmin', 119], ['scanner', 122], ['avahi', 121], ['saned', 123],
  ['nm-openvpn', 124], ['whoopsie', 125], ['colord', 126], ['geoclue', 127], ['pulse', 128], ['pulse-access', 130], ['lightdm', 129], ['nopasswdlogin', 131],
  ['sambashare', 132], ['polkitd', 997], ['nogroup', 65534],
];

const INSTALL_DAYS_AGO = 45;
const BOOT_MIN_AGO = 38;

const dir = (sys, p, mode = 0o755, uid = 0, gid = 0) => { if (!sys.vfs.exists(p)) sys.vfs.mkdir(p, { parents: true, mode, uid, gid }); };
const put = (sys, p, data, mode = 0o644, uid = 0, gid = 0) => {
  dir(sys, p.slice(0, p.lastIndexOf('/')) || '/');
  return sys.vfs.writeFile(p, data, { mode, uid, gid });
};

/** (Re)attach virtual /proc, /dev and /proc/sys nodes. Call again after System.restore(): generated nodes are not serialized. */
export function mountVirtual(sys) {
  const v = sys.vfs;
  const gen = (p, fn, set) => { const n = put(sys, p, '', set ? 0o644 : 0o444); n.gen = fn; if (set) n.set = set; };
  for (const [name, kind] of [['null', 'null'], ['zero', 'zero'], ['urandom', 'urandom'], ['random', 'urandom'], ['full', 'zero']]) {
    if (!v.exists(`/dev/${name}`)) { const n = put(sys, `/dev/${name}`, '', 0o666); n.dev = kind; }
    else v.lookup(`/dev/${name}`).dev = kind;
  }
  const up = () => (sys.now() - sys.bootTime) / 1000;
  gen('/proc/version', () => `Linux version ${KERNEL} (buildd@lcy02-amd64-051) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0, GNU ld (GNU Binutils for Ubuntu) 2.38) ${KERNEL_BUILD}\n`);
  gen('/proc/uptime', () => `${up().toFixed(2)} ${(up() * 3.7).toFixed(2)}\n`);
  gen('/proc/loadavg', () => `0.${String(12 + (sys.processes.length % 40)).padStart(2, '0')} 0.15 0.11 1/${sys.processes.length + 380} ${sys.nextPid - 1}\n`);
  gen('/proc/cmdline', () => `BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=3b9c5a1e-7a52-4e0c-9d0f-5f1c3b2a7d10 ro quiet splash\n`);
  gen('/proc/meminfo', () => {
    const used = 1_100_000 + sys.processes.length * 900;
    return `MemTotal:        4015436 kB\nMemFree:         ${2400000 - used + 1_100_000} kB\nMemAvailable:    ${3012000 - used + 1_100_000} kB\nBuffers:           98304 kB\nCached:          1240312 kB\nSwapCached:            0 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n`;
  });
  gen('/proc/cpuinfo', () => ['0', '1'].map((i) => `processor\t: ${i}\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel\t\t: 158\nmodel name\t: Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz\ncpu MHz\t\t: 1800.000\ncache size\t: 6144 KB\ncpu cores\t: 2\n`).join('\n'));
  for (const key of Object.keys(SYSCTL_DEFAULTS)) {
    gen(sysctlPath(key), () => `${sys.sysctl[key]}\n`, (val) => { sys.sysctl[key] = String(val).trim(); sys.touch('sysctl'); });
  }
}

function seedLogs(sys, installAt, bootAt) {
  const at = (ms, prog, msg, pid) => {
    const d = new Date(ms);
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    const p2 = (n) => String(n).padStart(2, '0');
    return `${M} ${String(d.getDate()).padStart(2, ' ')} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${sys.hostname} ${prog}${pid ? `[${pid}]` : ''}: ${msg}\n`;
  };
  const sysl = [
    at(bootAt, 'kernel', `Linux version ${KERNEL} (buildd@lcy02-amd64-051)`),
    at(bootAt + 1000, 'systemd', 'Started Journal Service.', 1), at(bootAt + 3000, 'systemd', 'Reached target Multi-User System.', 1),
    at(bootAt + 5000, 'NetworkManager', '<info>  [1] device (enp0s3): state change: config -> ip-config', 612),
    at(bootAt + 9000, 'systemd', 'Started Light Display Manager.', 1),
  ].join('');
  put(sys, '/var/log/syslog', sysl, 0o640, 104, 4);
  put(sys, '/var/log/kern.log', at(bootAt, 'kernel', 'Linux version ' + KERNEL), 0o640, 104, 4);
  put(sys, '/var/log/auth.log', at(bootAt + 12000, 'lightdm', 'pam_unix(lightdm:session): session opened for user student(uid=1000) by (uid=0)', 1288) + at(bootAt + 12100, 'systemd-logind', 'New session c1 of user student.', 700), 0o640, 104, 4);
  put(sys, '/var/log/dpkg.log', `${new Date(installAt).toISOString().replace('T', ' ').slice(0, 19)} startup archives unpack\n`, 0o644, 0, 4);
  put(sys, '/var/log/apt/history.log', '', 0o644);
  put(sys, '/var/log/ufw.log', '', 0o640, 104, 4);
  put(sys, '/var/log/faillog', '', 0o644);
  put(sys, '/var/log/lastlog', '', 0o644);
  // utmp / wtmp: one line per record, "user<TAB>tty<TAB>host<TAB>epoch_ms<TAB>kind"
  const rec = (u, tty, host, ms, kind) => `${u}\t${tty}\t${host}\t${ms}\t${kind}\n`;
  put(sys, '/var/run/utmp', rec('student', ':0', ':0', bootAt + 12000, 'login'), 0o664, 0, 43);
  put(sys, '/var/log/wtmp', rec('reboot', 'system boot', KERNEL, bootAt, 'boot') + rec('student', ':0', ':0', bootAt + 12000, 'login'), 0o664, 0, 43);
  put(sys, '/var/log/btmp', '', 0o660, 0, 43);
}

function seedProcesses(sys, hostIp = '10.0.2.15') {
  void hostIp;
  sys.nextPid = 1;
  const init = sys.spawn({ user: 'root', cmd: '/sbin/init splash', comm: 'systemd', ppid: 0, stat: 'Ss' });
  sys.nextPid = 2;
  const kt = sys.spawn({ user: 'root', cmd: '[kthreadd]', comm: 'kthreadd', ppid: 0, stat: 'S' });
  for (const [pid, name] of [[3, 'rcu_gp'], [4, 'rcu_par_gp'], [6, 'kworker/0:0H-events_highpri'], [9, 'mm_percpu_wq'], [10, 'rcu_tasks_rude_'], [12, 'ksoftirqd/0'], [13, 'rcu_sched'], [14, 'migration/0'], [15, 'cpuhp/0'], [18, 'kdevtmpfs'], [19, 'netns'], [24, 'kauditd'], [26, 'khungtaskd'], [28, 'oom_reaper'], [30, 'kcompactd0'], [33, 'kblockd'], [51, 'kswapd0'], [96, 'scsi_eh_0'], [160, 'jbd2/sda1-8']]) {
    sys.nextPid = pid;
    sys.spawn({ user: 'root', cmd: `[${name}]`, comm: name.slice(0, 15), ppid: kt.pid, stat: 'I<', cpu: 0, mem: 0 });
  }
  sys.nextPid = 320;
  const base = [
    ['root', '/lib/systemd/systemd-journald', 'systemd-journald'],
    ['root', '/lib/systemd/systemd-udevd', 'systemd-udevd'],
    ['systemd-timesync', '/lib/systemd/systemd-timesyncd', 'systemd-timesyn'],
    ['root', '/lib/systemd/systemd-logind', 'systemd-logind'],
  ];
  for (const [user, cmd, comm] of base) sys.spawn({ user, cmd, comm, ppid: init.pid });
  return init;
}

/**
 * @param {{now?: () => number, rng?: () => number, hostname?: string, studentPassword?: string}} opts
 */
export function buildMint21({ now = () => Date.now(), rng = seededRng(21), hostname = 'mint', studentPassword = 'cyberpatriot' } = {}) {
  const realNow = now;
  const t0 = realNow();
  const installAt = t0 - INSTALL_DAYS_AGO * 86400000;
  const bootAt = t0 - BOOT_MIN_AGO * 60000;
  let clock = installAt;
  const sys = new System({ now: () => clock, rng, hostname });
  sys.bootTime = bootAt;
  const v = sys.vfs;

  // ---- directory skeleton (usrmerge: /bin /sbin /lib /lib64 are symlinks)
  for (const d of ['usr/bin', 'usr/sbin', 'usr/lib', 'usr/lib64', 'usr/local/bin', 'usr/local/sbin', 'usr/local/lib', 'usr/share/applications', 'usr/share/backgrounds/linuxmint', 'usr/games', 'usr/libexec', 'usr/include', 'usr/src']) dir(sys, '/' + d);
  for (const [l, t] of [['bin', 'usr/bin'], ['sbin', 'usr/sbin'], ['lib', 'usr/lib'], ['lib64', 'usr/lib64']]) v.symlink(t, '/' + l);
  for (const d of ['boot', 'media', 'mnt', 'opt', 'srv', 'etc', 'run', 'var/lib', 'var/cache', 'var/spool', 'var/mail', 'var/backups', 'var/local', 'var/opt', 'var/www', 'var/crash', 'proc', 'sys', 'dev/pts', 'dev/shm', 'home']) dir(sys, '/' + d);
  v.chmod('/var/www', 0o755);
  dir(sys, '/root', 0o700);
  dir(sys, '/tmp', 0o1777);
  dir(sys, '/var/tmp', 0o1777);
  dir(sys, '/var/log', 0o775, 0, 4);
  dir(sys, '/var/log/apt');
  dir(sys, '/var/spool/cron/crontabs', 0o1730, 0, 109);
  dir(sys, '/var/mail', 0o2775, 0, 8);
  v.symlink('/run', '/var/run');
  v.symlink('/run/lock', '/var/lock');
  dir(sys, '/run/lock', 0o1777);
  dir(sys, '/etc/skel');
  dir(sys, '/etc/cron.d'); dir(sys, '/etc/cron.hourly'); dir(sys, '/etc/cron.daily'); dir(sys, '/etc/cron.weekly'); dir(sys, '/etc/cron.monthly');
  dir(sys, '/etc/ssh/sshd_config.d'); dir(sys, '/etc/sudoers.d', 0o750); dir(sys, '/etc/pam.d'); dir(sys, '/etc/security'); dir(sys, '/etc/sysctl.d');
  dir(sys, '/etc/apt/apt.conf.d'); dir(sys, '/etc/apt/sources.list.d'); dir(sys, '/etc/lightdm/lightdm.conf.d'); dir(sys, '/etc/systemd/system/multi-user.target.wants');
  dir(sys, '/etc/xdg/autostart'); dir(sys, '/usr/share/doc'); dir(sys, '/var/lib/dpkg'); dir(sys, '/var/lib/apt/lists'); dir(sys, '/lib/systemd/system');

  // ---- accounts: /etc/passwd, group, shadow, gshadow
  const passwd = SYSTEM_USERS.map(([n, uid, gid, gecos, home, shell]) => `${n}:x:${uid}:${gid}:${gecos}:${home}:${shell}`).join('\n') + '\n';
  const group = SYSTEM_GROUPS.map(([n, gid]) => `${n}:x:${gid}:`).join('\n') + '\n';
  put(sys, '/etc/passwd', passwd, 0o644);
  put(sys, '/etc/group', group, 0o644);
  const lc = String(Math.floor(installAt / 86400000));
  const shadow = SYSTEM_USERS.map(([n, , , , , shell]) => `${n}:${n === 'root' ? '!' : shell.endsWith('nologin') || shell === '/bin/false' || shell === '/bin/sync' ? '*' : '!'}:${lc}:0:99999:7:::`).join('\n') + '\n';
  put(sys, '/etc/shadow', shadow, 0o640, 0, 42);
  put(sys, '/etc/gshadow', SYSTEM_GROUPS.map(([n]) => `${n}:*::`).join('\n') + '\n', 0o640, 0, 42);
  put(sys, '/etc/subuid', 'student:100000:65536\n'); put(sys, '/etc/subgid', 'student:100000:65536\n');

  // ---- /etc content that is not owned by a package
  put(sys, '/etc/os-release', C.OS_RELEASE); v.symlink('../etc/os-release', '/usr/lib/os-release');
  put(sys, '/etc/lsb-release', C.LSB_RELEASE);
  put(sys, '/etc/issue', 'Linux Mint 21.3 \\n \\l\n\n'); put(sys, '/etc/issue.net', 'Linux Mint 21.3\n');
  put(sys, '/etc/linuxmint/info', 'RELEASE=21.3\nCODENAME=virginia\nEDITION="Cinnamon"\nDESCRIPTION="Linux Mint 21.3 Virginia"\nDESKTOP=Gtk\nTOOLKIT=GTK\nNEW_FEATURES_URL=https://www.linuxmint.com/rel_virginia_cinnamon.php\nRELEASE_NOTES_URL=https://www.linuxmint.com/rel_virginia_cinnamon.php\nUSER_GUIDE_URL=help:linuxmint\nGRUB_TITLE=Linux Mint 21.3 Cinnamon\n');
  put(sys, '/etc/hostname', hostname + '\n'); put(sys, '/etc/hosts', C.HOSTS(hostname));
  put(sys, '/etc/fstab', C.FSTAB); put(sys, '/etc/shells', C.SHELLS); put(sys, '/etc/nsswitch.conf', C.NSSWITCH);
  put(sys, '/etc/login.defs', C.LOGIN_DEFS);
  put(sys, '/etc/crontab', C.CRONTAB);
  put(sys, '/etc/bash.bashrc', C.BASH_BASHRC); put(sys, '/etc/gai.conf', C.GAI_CONF);
  put(sys, '/etc/profile', 'if [ "${PS1-}" ]; then\n  if [ "${BASH-}" ] && [ "$BASH" != "/bin/sh" ]; then\n    if [ -f /etc/bash.bashrc ]; then\n      . /etc/bash.bashrc\n    fi\n  fi\nfi\n');
  put(sys, '/etc/resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n');
  put(sys, '/etc/timezone', 'America/New_York\n'); put(sys, '/etc/machine-id', 'b1c47dd5a3f94c1e8d0a6f5c2e7b9a13\n');
  put(sys, '/etc/security/limits.conf', C.LIMITS_CONF); put(sys, '/etc/security/pwquality.conf', C.PWQUALITY_CONF); put(sys, '/etc/security/faillock.conf', C.FAILLOCK_CONF);
  put(sys, '/etc/security/opasswd', '', 0o600);
  put(sys, '/etc/sysctl.conf', C.SYSCTL_CONF); put(sys, '/etc/sysctl.d/10-network-security.conf', C.SYSCTL_NETWORK_SECURITY);
  put(sys, '/etc/apt/apt.conf.d/10periodic', C.APT_PERIODIC);
  put(sys, '/etc/apt/sources.list', '# This file is intentionally empty. See /etc/apt/sources.list.d/\n');
  put(sys, '/etc/apt/sources.list.d/official-package-repositories.list', C.SOURCES_LIST);
  put(sys, '/etc/sudoers.d/README', '#\n# As of Debian version 1.7.2p1-1, this directory is no longer used for local changes.\n#\n', 0o440);
  for (const [f, text] of [['common-auth', C.COMMON_AUTH], ['common-password', C.COMMON_PASSWORD], ['common-account', C.COMMON_ACCOUNT], ['common-session', C.COMMON_SESSION], ['sudo', C.PAM_SUDO], ['su', C.PAM_SU]]) put(sys, `/etc/pam.d/${f}`, text);
  put(sys, '/etc/pam.d/login', 'auth       optional   pam_faildelay.so  delay=3000000\nauth       requisite  pam_nologin.so\n@include common-auth\n@include common-account\n@include common-session\n@include common-password\n');
  put(sys, '/etc/pam.d/sshd', '@include common-auth\naccount    required     pam_nologin.so\n@include common-account\nsession [success=ok ignore=ignore module_unknown=ignore default=bad]        pam_selinux.so close\n@include common-session\n@include common-password\n');
  put(sys, '/etc/pam.d/lightdm', 'auth    requisite       pam_nologin.so\nauth    sufficient      pam_succeed_if.so user ingroup nopasswdlogin\n@include common-auth\naccount required pam_access.so\n@include common-account\n@include common-session\n@include common-password\n');
  put(sys, '/etc/skel/.bashrc', C.BASHRC, 0o644); put(sys, '/etc/skel/.profile', C.PROFILE, 0o644); put(sys, '/etc/skel/.bash_logout', C.BASH_LOGOUT, 0o644);
  put(sys, '/usr/share/backgrounds/linuxmint/default_background.jpg', '\xff\xd8\xff[simulated image]\n', 0o644);
  put(sys, '/boot/vmlinuz-' + KERNEL, '[simulated kernel]\n', 0o644); put(sys, '/boot/initrd.img-' + KERNEL, '[simulated initrd]\n', 0o644);
  put(sys, '/etc/localtime', 'TZif2\n'); put(sys, '/etc/mtab', 'rootfs / ext4 rw 0 0\n');
  put(sys, '/etc/mime.types', 'text/plain\ttxt text conf def list log in ini\n'); put(sys, '/etc/environment', 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin"\n');

  // ---- installed packages (base + filler) in catalog order
  for (const p of Object.values(PACKAGES)) if (p.installed) pk.installPackage(sys, p.name, { boot: true });

  // ---- processes + services (everything below happened at boot, not at install time)
  clock = bootAt;
  seedProcesses(sys);
  sys.nextPid = 400;
  const boot = ['systemd-resolved', 'rsyslog', 'dbus', 'polkit', 'accounts-daemon', 'apparmor', 'udisks2', 'NetworkManager', 'wpa_supplicant', 'bluetooth', 'ModemManager', 'avahi-daemon', 'cups', 'cups-browsed', 'cron', 'ssh', 'ufw', 'lightdm'];
  for (const name of boot) {
    const d = SERVICES[name];
    if (!d) continue;
    const pkgOk = d.package === 'systemd' || pk.isInstalled(sys, d.package);
    if (!pkgOk) continue;
    if (!v.exists(`/lib/systemd/system/${d.unit}`)) put(sys, `/lib/systemd/system/${d.unit}`, pk.unitFileText(d));
    sv.registerUnit(sys, name, { start: true });
  }

  // ---- the logged-in desktop session
  clock = bootAt + 12000;
  const lightdm = sys.processes.find((p) => p.svc === 'lightdm');
  sys.nextPid = 1288;
  const sess = sys.spawn({ user: 'root', cmd: 'lightdm --session-child 12 19', comm: 'lightdm', ppid: lightdm?.pid ?? 1, tty: '?', stat: 'Sl' });
  sys.nextPid = 1301;
  const xorg = sys.spawn({ user: 'root', cmd: '/usr/lib/xorg/Xorg -core :0 -seat seat0 -auth /var/run/lightdm/root/:0 -nolisten tcp vt7 -novtswitch', comm: 'Xorg', ppid: lightdm?.pid ?? 1, tty: 'tty7', stat: 'Ssl+' });
  void xorg;
  sys.nextPid = 1342;
  const sesn = sys.spawn({ user: 'student', cmd: 'cinnamon-session --session cinnamon', comm: 'cinnamon-sessio', ppid: sess.pid, stat: 'Ssl' });
  for (const [cmd, comm, stat] of [['/usr/bin/dbus-daemon --session --address=systemd: --nofork --nopidfile --systemd-activation', 'dbus-daemon', 'Ss'], ['cinnamon --replace', 'cinnamon', 'Sl'], ['nemo-desktop', 'nemo-desktop', 'Sl'], ['/usr/libexec/csd-power', 'csd-power', 'Sl'], ['/usr/bin/pulseaudio --daemonize=no --log-target=journal', 'pulseaudio', 'S<sl'], ['nm-applet', 'nm-applet', 'Sl'], ['mintUpdate', 'mintUpdate', 'Sl'], ['/usr/bin/python3 /usr/bin/blueman-applet', 'blueman-applet', 'Sl']]) {
    sys.spawn({ user: 'student', cmd, comm, ppid: sesn.pid, stat });
  }
  sys.nextPid = 2210;
  const gt = sys.spawn({ user: 'student', cmd: 'gnome-terminal-server', comm: 'gnome-terminal-', ppid: 1, stat: 'Ssl' });
  sys.nextPid = 2231;
  sys.spawn({ user: 'student', cmd: '-bash', comm: 'bash', ppid: gt.pid, tty: 'pts/0', stat: 'Ss' });

  // ---- the student account and its home
  clock = installAt;
  users.userAdd(sys, { name: 'student', uid: 1000, gecos: 'Student,,,', password: studentPassword, groups: ['adm', 'cdrom', 'sudo', 'dip', 'plugdev', 'lpadmin', 'sambashare'] });
  v.chmod('/home/student', 0o750);

  mountVirtual(sys);
  seedLogs(sys, installAt, bootAt);
  clock = null;
  sys._now = realNow;
  sys.misc.image = { os: 'Linux Mint 21.3 Virginia', kernel: KERNEL, installAt, builtAt: t0 };
  return sys;
}
