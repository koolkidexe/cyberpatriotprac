// Scenario: "Mint Practice Round 1" — 100 points. See docs/scenarios.md for how to write one.
import { buildMint21 } from '../../images/mint21.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as sv from '../../core/services.js';
import { ufwActive } from '../../core/firewall.js';
import { compareVersions } from '../../core/util.js';
import * as K from '../../core/checks.js';
import { readmeHtml, AUTHORIZED_ADMINS, AUTHORIZED_USERS } from './readme.js';

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
  { n: 1, answer: 'Bluebird-2291', text: 'A user left a note somewhere in /home with the password for the company FTP server.\nWhat is that password?' },
  { n: 2, answer: 'PINEAPPLE-47', text: 'The file /home/alex/Documents/message.b64 holds a Base64-encoded message.\nDecode it. What is the secret codeword?' },
];

function apply(sys) {
  const v = sys.vfs;

  // ---- accounts -------------------------------------------------------------------------
  users.setPassword(sys, 'student', STUDENT.password);
  const add = (name, uid, pw, groups = [], gecos = '') => users.userAdd(sys, { name, uid, password: pw, groups, gecos: gecos || `${name[0].toUpperCase()}${name.slice(1)},,,` });
  add('dana', 1001, DANA.password, ['cdrom', 'plugdev'], 'Dana Whitfield,,,');
  add('alex', 1002, 'Quartz&River77', [], 'Alex Moreno,,,');
  add('jordan', 1003, 'Bl@ckHorse!42', [], 'Jordan Lee,,,');
  add('riley', 1004, 'riley123', [], 'Riley Chen,,,');
  add('morgan', 1005, 'morgan', [], 'Morgan Patel,,,');
  add('casey', 1006, 'Casey$Park2026', ['sudo', 'adm'], 'Casey Brooks,,,');
  add('kali', 1007, 'kali', ['sudo'], 'k4li,,,');
  add('zerocool', 1008, 'zerocool', ['sudo'], 'Zero Cool,,,');
  users.userAdd(sys, { name: 'toor', uid: 0, gid: 0, nonUnique: true, home: '/root', createHome: false, shell: '/bin/bash', password: 'toor', gecos: 'toor' });
  sys.misc.initialHashes = {};
  for (const n of ['riley', 'morgan']) sys.misc.initialHashes[n] = users.getShadow(sys, n).hash;
  // password-aging fields the way a fresh install would have them
  for (const u of ['student', 'dana', 'alex', 'jordan', 'riley', 'morgan', 'casey', 'kali', 'zerocool']) users.chage(sys, u, { max: 99999 });

  // ---- software and services -----------------------------------------------------------
  pk.installPackage(sys, 'vsftpd');
  pk.installPackage(sys, 'samba');
  pk.installPackage(sys, 'john-data', { auto: true });
  pk.installPackage(sys, 'john');
  pk.installPackage(sys, 'wireshark');

  // ---- configuration mistakes ------------------------------------------------------------
  v.writeFile('/etc/sudoers.d/99-wheel-nopasswd', '# Created by a contractor "to make scripts easier"\n%sudo ALL=(ALL) NOPASSWD: ALL\n', { mode: 0o440, uid: 0, gid: 0 });
  v.writeFile('/etc/lightdm/lightdm.conf.d/70-linuxmint.conf', '[Seat:*]\nuser-session=cinnamon\nallow-guest=true\n');
  replaceInFile(sys, '/etc/pam.d/common-password', /pam_pwquality\.so retry=3/, 'pam_pwquality.so retry=3 minlen=4');
  replaceInFile(sys, '/etc/ssh/sshd_config', /^#PermitRootLogin .*$/m, 'PermitRootLogin yes');
  v.writeFile('/etc/ssh/sshd_config.d/99-local.conf', '# local overrides\nPermitEmptyPasswords yes\n', { mode: 0o644, uid: 0, gid: 0 });
  v.writeFile('/etc/sysctl.conf', v.readFile('/etc/sysctl.conf').replace(/\n*$/, '\n') + '\n# tuning\nnet.ipv4.tcp_syncookies=0\n');
  sys.sysctl['net.ipv4.tcp_syncookies'] = '0';
  v.writeFile('/etc/apt/apt.conf.d/10periodic', 'APT::Periodic::Update-Package-Lists "0";\nAPT::Periodic::Download-Upgradeable-Packages "0";\nAPT::Periodic::AutocleanInterval "0";\n');
  v.chmod('/etc/shadow', 0o666);

  // ---- malware and persistence -----------------------------------------------------------
  const ncCmd = '/bin/nc.traditional -l -p 4444 -e /bin/bash';
  v.writeFile('/etc/cron.d/sys-update-check', `# system update checker\nSHELL=/bin/sh\n* * * * * root ${ncCmd} >/dev/null 2>&1 &\n`, { mode: 0o644, uid: 0, gid: 0 });
  const bd = { user: 'root', cmd: ncCmd, comm: 'nc.traditional', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 4444 }] };
  sys.respawn.push({ id: 'backdoor4444', match: 'nc.traditional -l -p 4444', proc: bd });
  sys.spawn({ ...bd, respawnId: 'backdoor4444' });
  sys.spawn({ user: 'zerocool', cmd: 'python3 -m http.server 8000', comm: 'python3', tty: 'pts/1', stat: 'Sl', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 8000 }] });
  put(sys, 'student', '/home/student/.config/autostart/update-helper.desktop', '[Desktop Entry]\nType=Application\nName=System Update Helper\nComment=Checks for system updates\nExec=/usr/local/bin/.updatehelper\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n');
  v.writeFile('/usr/local/bin/.updatehelper', '#!/bin/sh\n# phone home\nsleep 30 && /bin/nc.traditional -l -p 4444 -e /bin/bash &\n', { mode: 0o755, uid: 0, gid: 0 });

  // ---- prohibited files, evidence and decoys -----------------------------------------------
  put(sys, 'riley', '/home/riley/Music/summer_mix.mp3', 'ID3\u0003\u0000\u0000\u0000\u0000\u0000(simulated mp3 data)', { size: 7132412 });
  put(sys, 'alex', '/home/alex/Videos/movie_night.mp4', '\u0000\u0000\u0000\u0018ftypmp42(simulated video data)', { size: 48713220 });
  put(sys, 'morgan', '/home/morgan/Documents/passwords.txt', 'MY PASSWORDS (do not share!!)\n\nemail:    morgan.patel@apexrobotics.example / morgan2019\nbank:     hunter22\nwifi:     ApexGuest!2024\nvpn:      morgan / Winter#Is#Coming\n');
  put(sys, 'jordan', '/home/jordan/Documents/old/ftp_server_notes.txt', 'FTP server migration notes\n---------------------------\nhost:  backup.apexrobotics.example\nlogin: backup\npass:  Bluebird-2291\n\nTODO: move everything to SFTP and delete this file.\n');
  put(sys, 'jordan', '/home/jordan/Documents/lunch_order.txt', 'Tuesday: pad thai\nWednesday: tacos\nFriday: pizza (team meeting)\n');
  put(sys, 'alex', '/home/alex/Documents/message.b64', b64('The secret codeword is: PINEAPPLE-47\n') + '\n');
  put(sys, 'alex', '/home/alex/Documents/shopping.txt', 'milk\neggs\nsoldering flux\n');
  put(sys, 'riley', '/home/riley/Documents/robot_design_notes.txt', 'Gripper v3: 40mm stroke, servo MG996R.\nNeed more M3 screws.\n');
  put(sys, 'kali', '/home/kali/.bash_history', 'ls\nnmap -sV 10.0.2.0/24\njohn --wordlist=/usr/share/john/password.lst /tmp/shadow.txt\nsudo useradd -o -u 0 -g 0 toor\ncrontab -l\nnc.traditional -l -p 4444 -e /bin/bash\nsudo chmod 666 /etc/shadow\nexit\n');
  put(sys, 'zerocool', '/home/zerocool/notes.txt', 'serving files from the box on :8000, no one will notice\n');
  put(sys, 'casey', '/home/casey/Documents/budget.csv', 'item,cost\nservos,420\nbatteries,310\n');

  // ---- the competitor's desktop -----------------------------------------------------------
  const desk = '/home/student/Desktop';
  v.mkdir('/opt/CyberPatriot', { parents: true, mode: 0o755 });
  v.writeFile('/opt/CyberPatriot/README.html', readmeHtml(), { mode: 0o644, uid: 0, gid: 0 });
  v.writeFile('/opt/CyberPatriot/ScoringReport.html', '<html><body>Scoring report (live; open it from the Desktop shortcut)</body></html>', { mode: 0o644, uid: 0, gid: 0 });
  put(sys, 'student', `${desk}/Scenario README.desktop`, '[Desktop Entry]\nType=Application\nName=Scenario README\nExec=chromium file:///opt/CyberPatriot/README.html\nIcon=cyberpatriot\nTerminal=false\n', { mode: 0o755 });
  put(sys, 'student', `${desk}/Scoring Report.desktop`, '[Desktop Entry]\nType=Application\nName=Scoring Report\nExec=chromium file:///opt/CyberPatriot/ScoringReport.html\nIcon=cyberpatriot\nTerminal=false\n', { mode: 0o755 });
  for (const q of FQ) {
    put(sys, 'student', `${desk}/Forensics Question ${q.n}.txt`, `FORENSICS QUESTION ${q.n}\n\n${q.text}\n\nType your answer after "ANSWER:" below and save this file.\n\nANSWER: \n`, { mode: 0o644 });
  }
  put(sys, 'student', '/home/student/.bash_history', '');
  sys.dirty = false;
}

// ---------------------------------------------------------------- scoring definitions
const fq = (q) => ({
  id: `fq${q.n}`, category: 'Forensics', points: 8, title: `Forensics Question ${q.n} correct`,
  check: (sys) => K.answerOf(sys, `/home/student/Desktop/Forensics Question ${q.n}.txt`).toLowerCase() === q.answer.toLowerCase(),
});

const gone = (id, path, title, pts, category = 'Prohibited Files') => ({ id, category, points: pts, title, check: (s) => !s.vfs.exists(path) });

export const vulns = [
  fq(FQ[0]), fq(FQ[1]),
  { id: 'rm-kali', category: 'User Auditing', points: 3, title: 'Removed unauthorized user kali', check: (s) => !users.getUser(s, 'kali') },
  { id: 'rm-zerocool', category: 'User Auditing', points: 3, title: 'Removed unauthorized user zerocool', check: (s) => !users.getUser(s, 'zerocool') },
  { id: 'rm-toor', category: 'User Auditing', points: 3, title: 'Removed hidden UID 0 account toor', check: (s) => !users.getUser(s, 'toor') },
  { id: 'casey-std', category: 'User Auditing', points: 3, title: 'User casey is not an administrator', check: (s) => !!users.getUser(s, 'casey') && !users.isAdmin(s, 'casey') },
  { id: 'dana-admin', category: 'User Auditing', points: 3, title: 'User dana is an administrator', check: (s) => !!users.getUser(s, 'dana') && users.isAdmin(s, 'dana') },
  { id: 'pw-riley', category: 'User Auditing', points: 3, title: 'Changed insecure password for user riley', check: (s) => !!users.getUser(s, 'riley') && K.passwordIsSecure(s, 'riley') },
  { id: 'pw-morgan', category: 'User Auditing', points: 3, title: 'Changed insecure password for user morgan', check: (s) => !!users.getUser(s, 'morgan') && K.passwordIsSecure(s, 'morgan') },
  { id: 'guest-off', category: 'Account Policy', points: 3, title: 'Guest account is disabled', check: (s) => !K.guestAllowed(s) },
  { id: 'max-days', category: 'Account Policy', points: 3, title: 'A maximum password age is set (90 days or less)', check: (s) => { const n = Number(K.loginDefs(s).PASS_MAX_DAYS); return n >= 1 && n <= 90; } },
  { id: 'min-len', category: 'Account Policy', points: 3, title: 'A minimum password length of 10 or more is required', check: (s) => K.effectiveMinLen(s) >= 10 },
  { id: 'lockout', category: 'Account Policy', points: 3, title: 'An account lockout policy is configured', check: (s) => { const d = K.lockoutDeny(s); return d != null && d >= 1 && d <= 10; } },
  { id: 'nullok', category: 'Account Policy', points: 3, title: 'Empty passwords no longer authenticate', check: (s) => !K.nullokPresent(s) },
  { id: 'sudo-auth', category: 'Account Policy', points: 3, title: 'sudo requires a password', check: (s) => !K.sudoNeedsNoPassword(s) },
  { id: 'ufw', category: 'Defensive Countermeasures', points: 4, title: 'Firewall protection has been enabled', check: (s) => ufwActive(s) },
  { id: 'auto-upd', category: 'Defensive Countermeasures', points: 3, title: 'Automatic checking for updates is enabled', check: (s) => K.aptPeriodic(s, 'Update-Package-Lists') >= 1 },
  { id: 'upd-chromium', category: 'Defensive Countermeasures', points: 3, title: 'Chromium has been updated', check: (s) => pk.isInstalled(s, 'chromium') && compareVersions(pk.installedVersion(s, 'chromium'), pk.def('chromium').avail) >= 0 },
  { id: 'ssh-root', category: 'Application Security', points: 4, title: 'SSH root login has been disabled', check: (s) => ['no', 'prohibit-password', 'without-password', 'forced-commands-only'].includes(K.sshdValue(s, 'PermitRootLogin')) && pk.isInstalled(s, 'openssh-server') },
  { id: 'ssh-empty', category: 'Application Security', points: 3, title: 'SSH does not permit empty passwords', check: (s) => K.sshdValue(s, 'PermitEmptyPasswords') === 'no' && pk.isInstalled(s, 'openssh-server') },
  { id: 'syncookies', category: 'Application Security', points: 2, title: 'IPv4 TCP SYN cookies have been enabled', check: (s) => K.sysctlConfValue(s, 'net.ipv4.tcp_syncookies') === '1' },
  { id: 'ftp-off', category: 'Service Auditing', points: 3, title: 'FTP service has been disabled or removed', check: (s) => K.serviceOff(s, 'vsftpd', 'vsftpd') },
  { id: 'smb-off', category: 'Service Auditing', points: 3, title: 'Samba service has been disabled or removed', check: (s) => K.serviceOff(s, 'smbd', 'samba') && K.serviceOff(s, 'nmbd', 'samba') },
  { id: 'rm-john', category: 'Prohibited Software', points: 2, title: 'Prohibited software John the Ripper removed', check: (s) => !pk.isInstalled(s, 'john') },
  { id: 'rm-wireshark', category: 'Prohibited Software', points: 2, title: 'Prohibited software Wireshark removed', check: (s) => !pk.isInstalled(s, 'wireshark') },
  { id: 'rm-media', category: 'Prohibited Files', points: 2, title: 'Removed prohibited media files', check: (s) => !s.vfs.exists('/home/riley/Music/summer_mix.mp3') && !s.vfs.exists('/home/alex/Videos/movie_night.mp4') },
  gone('rm-passwords', '/home/morgan/Documents/passwords.txt', 'Removed plaintext password file', 3),
  { id: 'shadow-perms', category: 'Malware', points: 4, title: 'Insecure permissions on /etc/shadow fixed', check: (s) => { const m = K.fileMode(s, '/etc/shadow'); return m != null && (m & ~0o640) === 0; } },
  gone('rm-cron-bd', '/etc/cron.d/sys-update-check', 'Removed backdoor cron job', 3, 'Malware'),
  { id: 'bd-listener', category: 'Malware', points: 2, title: 'Stopped backdoor listening on port 4444', check: (s) => !K.portListening(s, 4444) },
  { id: 'rm-autostart', category: 'Malware', points: 2, title: 'Removed malicious startup entry', check: (s) => !s.vfs.exists('/home/student/.config/autostart/update-helper.desktop') },
];

export const penalties = [
  ...[STUDENT.name, DANA.name, ...AUTHORIZED_USERS].map((name) => ({ id: `auth-${name}`, points: 5, title: `Authorized user ${name} was removed`, check: (s) => !users.getUser(s, name) })),
  { id: 'student-sudo', points: 5, title: 'Authorized administrator student lost administrator rights', check: (s) => !!users.getUser(s, 'student') && !users.isAdmin(s, 'student') },
  { id: 'ssh-crit', points: 5, title: 'Critical service OpenSSH is stopped, disabled or removed', check: (s) => !pk.isInstalled(s, 'openssh-server') || !sv.isActive(s, 'ssh') || !sv.isEnabled(s, 'ssh') },
  { id: 'chromium-crit', points: 5, title: 'Required program Chromium was removed', check: (s) => !pk.isInstalled(s, 'chromium') },
];

export default {
  id: 'mint-round1',
  title: 'Mint Practice Round 1',
  image: 'mint21',
  imageName: 'Linux Mint 21.3 Cinnamon',
  teamId: 'MNT2-1R01-PRAC',
  user: 'student',
  password: STUDENT.password,
  readmeHtml,
  vulns,
  penalties,
  forensics: FQ,
  createMachine(opts) {
    const sys = buildMint21(opts);
    apply(sys);
    return sys;
  },
};
