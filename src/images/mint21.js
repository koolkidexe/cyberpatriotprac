// Builds a clean, freshly installed Linux Mint 21.3 "Virginia" (Cinnamon, Ubuntu 22.04 base) machine.
// A scenario then breaks it on purpose (see src/scenarios/*).
import { System } from '../core/system.js';
import * as C from './configs.js';
import { PACKAGES, SERVICES } from './catalog.js';
import * as pk from '../core/packages.js';
import * as sv from '../core/services.js';
import * as users from '../core/users.js';
import { daysSinceEpoch, fmtSyslog } from '../core/util.js';
import { sysctlPath, sysctlSet } from '../core/sysctl.js';

export const IMAGE_ID = 'mint21';
export const KERNEL = '5.15.0-126-generic';

const SYSTEM_GROUPS = [
  ['root', 0], ['daemon', 1], ['bin', 2], ['sys', 3], ['adm', 4], ['tty', 5], ['disk', 6], ['lp', 7], ['mail', 8], ['news', 9],
  ['uucp', 10], ['man', 12], ['proxy', 13], ['kmem', 15], ['dialout', 20], ['fax', 21], ['voice', 22], ['cdrom', 24], ['floppy', 25],
  ['tape', 26], ['sudo', 27], ['audio', 29], ['dip', 30], ['www-data', 33], ['backup', 34], ['operator', 37], ['list', 38], ['irc', 39],
  ['src', 40], ['gnats', 41], ['shadow', 42], ['utmp', 43], ['video', 44], ['sasl', 45], ['plugdev', 46], ['staff', 50], ['games', 60],
  ['users', 100], ['systemd-journal', 101], ['systemd-network', 102], ['systemd-resolve', 103], ['crontab', 104], ['messagebus', 105],
  ['syslog', 106], ['avahi', 107], ['lpadmin', 108], ['lightdm', 109], ['nopasswdlogin', 110], ['sambashare', 111], ['polkitd', 112],
  ['ssl-cert', 113], ['rtkit', 114], ['pulse', 115], ['pulse-access', 116], ['render', 117], ['input', 118], ['netdev', 119],
  ['bluetooth', 120], ['kvm', 121], ['colord', 122], ['geoclue', 123], ['scanner', 124], ['fwupd-refresh', 125], ['systemd-timesync', 126],
  ['nogroup', 65534],
];

// name, uid, gid, gecos, home, shell
const SYSTEM_USERS = [
  ['root', 0, 0, 'root', '/root', '/bin/bash'],
  ['daemon', 1, 1, 'daemon', '/usr/sbin', '/usr/sbin/nologin'],
  ['bin', 2, 2, 'bin', '/bin', '/usr/sbin/nologin'],
  ['sys', 3, 3, 'sys', '/dev', '/usr/sbin/nologin'],
  ['sync', 4, 65534, 'sync', '/bin', '/bin/sync'],
  ['games', 5, 60, 'games', '/usr/games', '/usr/sbin/nologin'],
  ['man', 6, 12, 'man', '/var/cache/man', '/usr/sbin/nologin'],
  ['lp', 7, 7, 'lp', '/var/spool/lpd', '/usr/sbin/nologin'],
  ['mail', 8, 8, 'mail', '/var/mail', '/usr/sbin/nologin'],
  ['news', 9, 9, 'news', '/var/spool/news', '/usr/sbin/nologin'],
  ['uucp', 10, 10, 'uucp', '/var/spool/uucp', '/usr/sbin/nologin'],
  ['proxy', 13, 13, 'proxy', '/bin', '/usr/sbin/nologin'],
  ['www-data', 33, 33, 'www-data', '/var/www', '/usr/sbin/nologin'],
  ['backup', 34, 34, 'backup', '/var/backups', '/usr/sbin/nologin'],
  ['list', 38, 38, 'Mailing List Manager', '/var/list', '/usr/sbin/nologin'],
  ['irc', 39, 39, 'ircd', '/run/ircd', '/usr/sbin/nologin'],
  ['gnats', 41, 41, 'Gnats Bug-Reporting System (admin)', '/var/lib/gnats', '/usr/sbin/nologin'],
  ['nobody', 65534, 65534, 'nobody', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-network', 100, 102, 'systemd Network Management,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['systemd-resolve', 101, 103, 'systemd Resolver,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['messagebus', 102, 105, '', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-timesync', 103, 126, 'systemd Time Synchronization,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['syslog', 104, 106, '', '/home/syslog', '/usr/sbin/nologin'],
  ['_apt', 105, 65534, '', '/nonexistent', '/usr/sbin/nologin'],
  ['avahi', 106, 107, 'Avahi mDNS daemon,,,', '/run/avahi-daemon', '/usr/sbin/nologin'],
  ['polkitd', 107, 112, 'PolicyKit daemon,,,', '/nonexistent', '/usr/sbin/nologin'],
  ['lightdm', 108, 109, 'Light Display Manager', '/var/lib/lightdm', '/bin/false'],
  ['rtkit', 109, 114, 'RealtimeKit,,,', '/proc', '/usr/sbin/nologin'],
  ['pulse', 110, 115, 'PulseAudio daemon,,,', '/run/pulse', '/usr/sbin/nologin'],
  ['colord', 111, 122, 'colord colour management daemon,,,', '/var/lib/colord', '/usr/sbin/nologin'],
  ['geoclue', 112, 123, '', '/var/lib/geoclue', '/usr/sbin/nologin'],
  ['cups-pk-helper', 113, 108, 'user for cups-pk-helper service,,,', '/home/cups-pk-helper', '/usr/sbin/nologin'],
  ['saned', 114, 124, '', '/var/lib/saned', '/usr/sbin/nologin'],
  ['fwupd-refresh', 115, 125, 'fwupd-refresh user,,,', '/run/systemd', '/usr/sbin/nologin'],
  ['usbmux', 116, 46, 'usbmux daemon,,,', '/var/lib/usbmux', '/usr/sbin/nologin'],
];

const DIRS = [
  ['/', 0o755], ['/usr', 0o755], ['/usr/bin', 0o755], ['/usr/sbin', 0o755], ['/usr/lib', 0o755], ['/usr/share', 0o755], ['/usr/games', 0o755],
  ['/usr/local', 0o755], ['/usr/local/bin', 0o755], ['/usr/local/sbin', 0o755], ['/usr/local/share', 0o755], ['/usr/share/applications', 0o755],
  ['/etc', 0o755], ['/etc/pam.d', 0o755], ['/etc/security', 0o755], ['/etc/ssh', 0o755], ['/etc/ssh/sshd_config.d', 0o755], ['/etc/sudoers.d', 0o750],
  ['/etc/cron.d', 0o755], ['/etc/cron.hourly', 0o755], ['/etc/cron.daily', 0o755], ['/etc/cron.weekly', 0o755], ['/etc/cron.monthly', 0o755],
  ['/etc/sysctl.d', 0o755], ['/etc/apt', 0o755], ['/etc/apt/apt.conf.d', 0o755], ['/etc/apt/sources.list.d', 0o755], ['/etc/default', 0o755],
  ['/etc/skel', 0o755], ['/etc/systemd/system/multi-user.target.wants', 0o755], ['/etc/lightdm', 0o755], ['/etc/lightdm/lightdm.conf.d', 0o755],
  ['/etc/xdg/autostart', 0o755], ['/etc/init.d', 0o755], ['/etc/ufw', 0o755],
  ['/var', 0o755], ['/var/log', 0o775], ['/var/log/apt', 0o755], ['/var/lib', 0o755], ['/var/lib/dpkg', 0o755], ['/var/cache', 0o755], ['/var/backups', 0o755],
  ['/var/spool', 0o755], ['/var/spool/cron', 0o755], ['/var/spool/cron/crontabs', 0o1730], ['/var/mail', 0o2775], ['/var/www', 0o755], ['/var/tmp', 0o1777],
  ['/tmp', 0o1777], ['/run', 0o755], ['/run/systemd/resolve', 0o755], ['/run/lock', 0o1777], ['/srv', 0o755], ['/opt', 0o755], ['/mnt', 0o755], ['/media', 0o755],
  ['/home', 0o755], ['/root', 0o700], ['/boot', 0o755], ['/dev', 0o755], ['/proc', 0o555], ['/sys', 0o555], ['/lost+found', 0o700],
];

function seedFile(sys, path, data, { mode = 0o644, uid = 0, gid = 0, mtime } = {}) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  if (!sys.vfs.exists(dir)) sys.vfs.mkdir(dir, { parents: true, mode: 0o755 });
  sys.vfs.writeFile(path, data, { mode, uid, gid, mtime });
}

const cmdlineOf = (p) => p;

/** Mount /dev and /proc nodes. Safe to call again after System.restore (generated nodes aren't serialized). */
export function mountVirtual(sys) {
  const v = sys.vfs;
  const dev = (path, kind, mode = 0o666) => {
    if (v.exists(path)) return;
    const n = v.writeFile(path, '', { mode, uid: 0, gid: 0 });
    n.dev = kind;
  };
  if (!v.exists('/dev')) v.mkdir('/dev');
  dev('/dev/null', 'null'); dev('/dev/zero', 'zero'); dev('/dev/urandom', 'random'); dev('/dev/random', 'random'); dev('/dev/tty', 'null');
  const gen = (path, fn, set, mode) => {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!v.exists(dir)) v.mkdir(dir, { parents: true, mode: 0o555 });
    let n = v.lookup(path, { follow: false });
    if (!n) n = v.writeFile(path, '', { mode: mode ?? (set ? 0o644 : 0o444), uid: 0, gid: 0 });
    n.gen = fn;
    if (set) n.set = set;
    return n;
  };
  const up = () => (sys.now() - sys.bootTime) / 1000;
  gen('/proc/uptime', () => `${up().toFixed(2)} ${(up() * 1.7).toFixed(2)}\n`);
  gen('/proc/loadavg', () => `0.${12 + (sys.processes.length % 30)} 0.18 0.14 1/${sys.processes.length + 220} ${sys.nextPid}\n`);
  gen('/proc/version', () => `Linux version ${KERNEL} (buildd@lcy02-amd64-044) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0, GNU ld (GNU Binutils for Ubuntu) 2.38) #136-Ubuntu SMP Wed Nov 6 10:38:22 UTC 2024\n`);
  gen('/proc/cmdline', () => `BOOT_IMAGE=/boot/vmlinuz-${KERNEL} root=UUID=6f1a1c6e-2c7d-4c0e-9a5a-7d0d6c2c9b11 ro quiet splash\n`);
  gen('/proc/meminfo', () => {
    const used = 1400000 + sys.processes.length * 3100;
    return `MemTotal:        4017828 kB\nMemFree:         ${4017828 - used - 900000} kB\nMemAvailable:    ${4017828 - used} kB\nBuffers:           98204 kB\nCached:           802120 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n`;
  });
  gen('/proc/cpuinfo', () => [0, 1].map((i) => `processor\t: ${i}\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel name\t: Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz\ncpu MHz\t\t: 1800.000\ncache size\t: 6144 KB\ncpu cores\t: 2\n`).join('\n'));
  gen('/proc/mounts', () => '/dev/sda2 / ext4 rw,relatime,errors=remount-ro 0 0\nproc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\nsysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0\ntmpfs /run tmpfs rw,nosuid,nodev,noexec,relatime,size=401784k,mode=755 0 0\n/dev/sda1 /boot/efi vfat rw,relatime,umask=0077 0 0\n');
  for (const key of Object.keys(sys.sysctl)) {
    gen(sysctlPath(key), () => `${sys.sysctl[key]}\n`, (val) => sysctlSet(sys, key, String(val).trim()));
  }
}

/** Standard processes of a running Mint session. */
function spawnBaseProcesses(sys) {
  const boot = sys.bootTime;
  const mk = (o) => { const p = sys.spawn(o); p.start = boot + (o.delay || 0); return p; };
  sys.nextPid = 1;
  mk({ cmd: '/sbin/init splash', comm: 'systemd', ppid: 0, stat: 'Ss' });
  sys.nextPid = 2;
  mk({ cmd: '[kthreadd]', comm: 'kthreadd', ppid: 0, stat: 'S' });
  for (const k of ['rcu_gp', 'rcu_par_gp', 'netns', 'kworker/0:0H-events_highpri', 'mm_percpu_wq', 'ksoftirqd/0', 'rcu_sched', 'migration/0', 'cpuhp/0', 'kswapd0', 'kworker/u4:3-events_unbound', 'jbd2/sda2-8']) {
    mk({ cmd: `[${k}]`, comm: k.split('/')[0], ppid: 2, stat: 'I<', cpu: 0, mem: 0 });
  }
  sys.nextPid = 330;
  mk({ cmd: '/lib/systemd/systemd-journald', comm: 'systemd-journal', stat: 'S<s' });
  mk({ cmd: '/lib/systemd/systemd-udevd', comm: 'systemd-udevd', stat: 'Ss' });
  mk({ cmd: '/lib/systemd/systemd-timesyncd', comm: 'systemd-timesyn', user: 'systemd-timesync', stat: 'Ssl' });
  mk({ cmd: '/lib/systemd/systemd-networkd', comm: 'systemd-network', user: 'systemd-network', stat: 'Ss' });
  mk({ cmd: '/lib/systemd/systemd-logind', comm: 'systemd-logind', stat: 'Ss' });
}

function spawnSession(sys) {
  const boot = sys.bootTime;
  const mk = (o) => { const p = sys.spawn({ user: 'student', ...o }); p.start = boot + 40000 + (o.delay || 0); return p; };
  sys.nextPid = 1150;
  const dm = sys.spawn({ cmd: '/usr/lib/xorg/Xorg -core :0 -seat seat0 -auth /var/run/lightdm/root/:0 -nolisten tcp vt7 -novtswitch', comm: 'Xorg', tty: 'tty7', stat: 'Ssl+' });
  dm.start = boot + 30000;
  const sess = sys.spawn({ cmd: 'lightdm --session-child 12 19', comm: 'lightdm', stat: 'Sl' });
  sess.start = boot + 38000;
  const cs = mk({ cmd: '/usr/bin/cinnamon-session-cinnamon', comm: 'cinnamon-sessio', stat: 'Ssl' });
  mk({ cmd: '/usr/bin/dbus-daemon --session --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only', comm: 'dbus-daemon', stat: 'Ss', ppid: 1 });
  mk({ cmd: 'cinnamon --replace', comm: 'cinnamon', stat: 'Sl', ppid: cs.pid, cpu: 2.1, mem: 4.8 });
  mk({ cmd: 'nemo-desktop', comm: 'nemo-desktop', stat: 'Sl', ppid: cs.pid, mem: 1.7 });
  mk({ cmd: '/usr/libexec/csd-power', comm: 'csd-power', stat: 'Sl', ppid: cs.pid });
  mk({ cmd: '/usr/bin/pipewire', comm: 'pipewire', stat: 'Ssl', ppid: 1 });
  mk({ cmd: '/usr/bin/pulseaudio --daemonize=no --log-target=journal', comm: 'pulseaudio', stat: 'S<sl', ppid: 1 });
  mk({ cmd: '/usr/libexec/gnome-terminal-server', comm: 'gnome-terminal-', stat: 'Ssl', ppid: 1, mem: 1.1 });
  const sh = mk({ cmd: 'bash', comm: 'bash', tty: 'pts/0', stat: 'Ss', delay: 120000 });
  return sh;
}

export function buildMint21({ now = () => Date.now(), rng = Math.random, hostname = 'mint' } = {}) {
  const sys = new System({ now, rng, hostname });
  const v = sys.vfs;
  const t0 = sys.now();
  const installed = t0 - 40 * 86400000;
  sys.bootTime = t0 - 47 * 60000;
  sys.misc.image = IMAGE_ID;

  // --- directory skeleton, usr-merge symlinks
  for (const [p, m] of DIRS) if (p !== '/') v.mkdir(p, { parents: true, mode: m & 0o7777, uid: 0, gid: p === '/var/log' ? 4 : 0 });
  v.root.mode = 0o755;
  for (const [l, t] of [['/bin', 'usr/bin'], ['/sbin', 'usr/sbin'], ['/lib', 'usr/lib'], ['/lib64', 'usr/lib64']]) v.symlink(t, l);
  v.mkdir('/usr/lib64', { mode: 0o755 });
  v.chown('/var/spool/cron/crontabs', 0, 104);
  v.chown('/var/mail', 0, 8);

  // --- accounts
  const gnames = new Map(SYSTEM_GROUPS.map(([n, g]) => [n, g]));
  const gmembers = { adm: ['syslog'], dialout: [], www_data: [] };
  v.writeFile('/etc/group', SYSTEM_GROUPS.map(([n, g]) => `${n}:x:${g}:${(gmembers[n] || []).join(',')}`).join('\n') + '\n', { mode: 0o644 });
  v.writeFile('/etc/gshadow', SYSTEM_GROUPS.map(([n]) => `${n}:!::${(gmembers[n] || []).join(',')}`).join('\n') + '\n', { mode: 0o640, gid: 42 });
  v.writeFile('/etc/passwd', SYSTEM_USERS.map(([n, u, g, gecos, h, sh]) => `${n}:x:${u}:${g}:${gecos}:${h}:${sh}`).join('\n') + '\n', { mode: 0o644 });
  const day = daysSinceEpoch(installed);
  v.writeFile('/etc/shadow', SYSTEM_USERS.map(([n]) => `${n}:${n === 'root' ? '!' : '*'}:${day}:0:99999:7:::`).join('\n') + '\n', { mode: 0o640, gid: 42 });
  void gnames;

  // --- skeleton + core config files (before any user home is created)
  seedFile(sys, '/etc/skel/.bashrc', C.BASHRC);
  seedFile(sys, '/etc/skel/.profile', C.PROFILE);
  seedFile(sys, '/etc/skel/.bash_logout', C.BASH_LOGOUT);
  seedFile(sys, '/root/.bashrc', C.BASHRC, { mode: 0o644 });
  seedFile(sys, '/root/.profile', C.PROFILE, { mode: 0o644 });

  // --- packages (files + default configuration + .desktop launchers)
  for (const d of Object.values(PACKAGES)) if (d.installed) pk.installPackage(sys, d.name, { boot: true, auto: !!d.auto });

  // --- Cinnamon / Mint launchers that are not tied to one catalog package
  const extraApps = [
    ['cinnamon-settings-users', 'Users and Groups', 'Add or remove users and groups', 'cinnamon-settings user', 'System;Settings;', 'system-users'],
    ['cinnamon-session-properties', 'Startup Applications', 'Choose what applications to start when you log in', 'cinnamon-session-properties', 'System;Settings;', 'system-run'],
    ['mintlightdm-settings', 'Login Window', 'Configure the login window', 'pkexec lightdm-settings', 'System;Settings;', 'preferences-system-login'],
    ['system-config-printer', 'Print Settings', 'Configure printers', 'system-config-printer', 'System;Settings;', 'printer'],
  ];
  for (const [file, name, comment, exec, cats, icon] of extraApps) {
    seedFile(sys, `/usr/share/applications/${file}.desktop`, `[Desktop Entry]\nName=${name}\nComment=${comment}\nExec=${exec}\nIcon=${icon}\nTerminal=false\nType=Application\nCategories=${cats}\n`);
  }

  // --- system configuration that is not owned by a package in the catalog
  seedFile(sys, '/etc/hostname', hostname + '\n');
  seedFile(sys, '/etc/hosts', C.HOSTS(hostname));
  seedFile(sys, '/etc/os-release', C.OS_RELEASE);
  v.symlink('../etc/os-release', '/usr/lib/os-release');
  seedFile(sys, '/etc/lsb-release', C.LSB_RELEASE);
  seedFile(sys, '/etc/issue', 'Linux Mint 21.3 \\n \\l\n\n');
  seedFile(sys, '/etc/issue.net', 'Linux Mint 21.3\n');
  seedFile(sys, '/etc/shells', C.SHELLS);
  seedFile(sys, '/etc/fstab', C.FSTAB);
  seedFile(sys, '/etc/nsswitch.conf', C.NSSWITCH);
  seedFile(sys, '/etc/gai.conf', C.GAI_CONF);
  seedFile(sys, '/etc/crontab', C.CRONTAB);
  seedFile(sys, '/etc/login.defs', C.LOGIN_DEFS);
  seedFile(sys, '/etc/bash.bashrc', C.BASH_BASHRC);
  seedFile(sys, '/etc/machine-id', 'b4b0e1d0c5a14d0b9a3a2f6e7d8c9b01\n');
  seedFile(sys, '/etc/timezone', 'America/New_York\n');
  seedFile(sys, '/etc/resolv.conf', 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n');
  seedFile(sys, '/etc/sysctl.conf', C.SYSCTL_CONF);
  seedFile(sys, '/etc/sysctl.d/10-network-security.conf', C.SYSCTL_NETWORK_SECURITY);
  seedFile(sys, '/etc/security/limits.conf', C.LIMITS_CONF);
  seedFile(sys, '/etc/security/pwquality.conf', C.PWQUALITY_CONF);
  seedFile(sys, '/etc/security/faillock.conf', C.FAILLOCK_CONF);
  seedFile(sys, '/etc/security/opasswd', '', { mode: 0o600 });
  seedFile(sys, '/etc/pam.d/common-auth', C.COMMON_AUTH);
  seedFile(sys, '/etc/pam.d/common-password', C.COMMON_PASSWORD);
  seedFile(sys, '/etc/pam.d/common-account', C.COMMON_ACCOUNT);
  seedFile(sys, '/etc/pam.d/common-session', C.COMMON_SESSION);
  seedFile(sys, '/etc/pam.d/sudo', C.PAM_SUDO);
  seedFile(sys, '/etc/pam.d/su', C.PAM_SU);
  seedFile(sys, '/etc/apt/apt.conf.d/10periodic', C.APT_PERIODIC);
  seedFile(sys, '/etc/apt/sources.list.d/official-package-repositories.list', C.SOURCES_LIST);
  seedFile(sys, '/etc/sudoers.d/README', '#\n# As of Debian version 1.7.2p1-1, the default /etc/sudoers file created on\n# installation of the package now includes the directive:\n#\n# \t#includedir /etc/sudoers.d\n#\n# This will cause sudo to read and parse any files in the /etc/sudoers.d\n# directory that do not end in \'~\' or contain a \'.\' character.\n#\n# Note that there must be at least one file in the sudoers.d directory (this\n# one will do), and all files in this directory should be mode 0440.\n#\n', { mode: 0o440 });
  seedFile(sys, '/etc/cron.d/e2scrub_all', '30 3 * * 0 root test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/x86_64-linux-gnu/e2fsprogs/e2scrub_all_cron\n10 3 * * * root test -e /run/systemd/system || SERVICE_MODE=1 /sbin/e2scrub_all -A -r\n');
  for (const n of ['apt-compat', 'dpkg', 'logrotate', 'man-db']) seedFile(sys, `/etc/cron.daily/${n}`, `#!/bin/sh\n# ${n} daily job\nexit 0\n`, { mode: 0o755 });
  seedFile(sys, '/run/systemd/resolve/stub-resolv.conf', 'nameserver 127.0.0.53\n');
  seedFile(sys, '/etc/ssh/ssh_config', 'Include /etc/ssh/ssh_config.d/*.conf\n\nHost *\n    SendEnv LANG LC_*\n    HashKnownHosts yes\n    GSSAPIAuthentication yes\n');
  seedFile(sys, '/etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN3kQ2yPq0o3m1b3Qk8XcJt0wq9Vf6gO6z4h8Y1v5pLa root@mint\n');
  seedFile(sys, '/etc/ssh/ssh_host_ed25519_key', '-----BEGIN OPENSSH PRIVATE KEY-----\n(simulated)\n-----END OPENSSH PRIVATE KEY-----\n', { mode: 0o600 });

  // --- the student account (the competitor)
  users.userAdd(sys, { name: 'student', gecos: 'Student,,,', password: 'student', groups: ['adm', 'cdrom', 'sudo', 'dip', 'plugdev', 'lpadmin', 'sambashare'] });
  seedFile(sys, '/home/student/.config/user-dirs.dirs', 'XDG_DESKTOP_DIR="$HOME/Desktop"\nXDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_TEMPLATES_DIR="$HOME/Templates"\nXDG_PUBLICSHARE_DIR="$HOME/Public"\nXDG_DOCUMENTS_DIR="$HOME/Documents"\nXDG_MUSIC_DIR="$HOME/Music"\nXDG_PICTURES_DIR="$HOME/Pictures"\nXDG_VIDEOS_DIR="$HOME/Videos"\n', { uid: 1000, gid: 1000 });

  // --- services (everything enabled by default is also running)
  sys.nextPid = 300;
  for (const d of Object.values(PACKAGES)) if (d.installed) for (const s of d.svc) sv.registerUnit(sys, s, { start: false });
  sv.registerUnit(sys, 'systemd-resolved', { start: false });
  spawnBaseProcesses(sys);
  sys.nextPid = 620;
  for (const name of Object.keys(sys.svcState)) { try { sv.startUnit(sys, name); } catch { /* ignore */ } }
  for (const p of sys.processes) if (p.svc) p.start = sys.bootTime + 20000;
  spawnSession(sys);
  sys.nextPid = 2100;

  // --- logs
  const stamp = (ms) => fmtSyslog(ms);
  const log = (file, lines, mode = 0o640) => seedFile(sys, `/var/log/${file}`, lines.join('\n') + '\n', { mode, uid: 104, gid: 4 });
  const b = sys.bootTime;
  log('syslog', [
    `${stamp(b)} ${hostname} kernel: [    0.000000] Linux version ${KERNEL} (buildd@lcy02-amd64-044)`,
    `${stamp(b + 6000)} ${hostname} systemd[1]: Started Journal Service.`,
    `${stamp(b + 21000)} ${hostname} systemd[1]: Started OpenBSD Secure Shell server.`,
    `${stamp(b + 24000)} ${hostname} systemd[1]: Started Light Display Manager.`,
    `${stamp(b + 41000)} ${hostname} lightdm: pam_unix(lightdm-greeter:session): session opened for user lightdm(uid=108) by (uid=0)`,
  ]);
  log('auth.log', [
    `${stamp(b + 38000)} ${hostname} lightdm: pam_unix(lightdm:session): session opened for user student(uid=1000) by (uid=0)`,
    `${stamp(b + 38100)} ${hostname} systemd-logind[540]: New session c1 of user student.`,
  ]);
  log('kern.log', [`${stamp(b)} ${hostname} kernel: [    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-${KERNEL} ro quiet splash`]);
  log('dpkg.log', []);
  seedFile(sys, '/var/log/apt/history.log', '', { mode: 0o644 });
  seedFile(sys, '/run/utmp', `student  tty7  :0  ${new Date(b + 41000).toISOString().slice(0, 16).replace('T', ' ')}\n`, { mode: 0o664 });
  seedFile(sys, '/var/log/wtmp', `student  tty7  :0  ${new Date(b + 41000).toISOString().slice(0, 16).replace('T', ' ')}  still logged in\nreboot   system boot  ${KERNEL}  ${new Date(b).toISOString().slice(0, 16).replace('T', ' ')}  still running\n`, { mode: 0o664, gid: 43 });

  // --- Firefox profile
  const prof = '/home/student/.mozilla/firefox/k7m2x9qa.default-release';
  seedFile(sys, '/home/student/.mozilla/firefox/profiles.ini', '[Profile0]\nName=default-release\nIsRelative=1\nPath=k7m2x9qa.default-release\nDefault=1\n\n[General]\nStartWithLastProfile=1\nVersion=2\n', { uid: 1000, gid: 1000 });
  seedFile(sys, `${prof}/prefs.js`, '// Mozilla User Preferences\n\n// DO NOT EDIT THIS FILE.\n//\n// If you make changes to this file while the application is running,\n// the changes will be overwritten when the application exits.\n//\n// To change a preference value, you can either:\n// - modify it via the UI (e.g. via about:config in the browser); or\n// - set it within a user.js file in your profile.\n\nuser_pref("app.normandy.first_run", false);\nuser_pref("browser.startup.homepage", "https://www.linuxmint.com/start/virginia/");\n', { uid: 1000, gid: 1000 });

  mountVirtual(sys);
  // reset noisy bookkeeping created while building
  sys.dirty = false;
  return sys;
}

export { cmdlineOf, SERVICES };
