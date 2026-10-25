// "Mint Practice Round 1": the misconfigurations applied on top of a clean Mint 21 image, and the exact
// 100-point vulnerability table.
import { buildMint21, seededRng } from '../../images/mint21.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as sv from '../../core/services.js';
import * as ck from '../../core/checks.js';
import { cronEntries } from '../../core/cron.js';
import { verifyPassword, fmtDate } from '../../core/util.js';
import { readmeHtml, ADMINS, AUTHORIZED } from './readme.js';

export const ID = 'mint-round1';
const STUDENT_PW = 'cyberpatriot';
const NC_CMD = 'nc.traditional -lp 4444 -e /bin/bash';

// Plain-text answers: given in the forensic files so the scenario is solvable and testable.
export const ANSWERS = { fq1: 'Bluebird-2291', fq2: 'PINEAPPLE-47', fq3: '4444' };

const WEAK = (name) => weakList(name).flatMap((w) => [w, w[0].toUpperCase() + w.slice(1)]);
const weakList = (name) => [name, name + '1', name + '123', name + '1234', name + '!', name.toUpperCase(), name + name, '123456', '12345678', '123456789', 'password', 'Password1', 'password1', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'changeme', 'cyberpatriot', 'abc123', 'iloveyou', 'riley123', 'morgan', 'summer2024', 'sunshine'];

function seedUsers(sys) {
  const mk = (name, extra = {}) => users.userAdd(sys, { name, gecos: extra.gecos ?? `${name[0].toUpperCase()}${name.slice(1)},,,`, password: extra.password, groups: extra.groups || [], uid: extra.uid, gid: extra.gid, nonUnique: extra.nonUnique, home: extra.home });
  mk('alex', { password: 'Hq7!rain-Dock' });
  mk('jordan', { password: 'Mango#Tide4421' });
  mk('riley', { password: 'riley123' });
  mk('morgan', { password: 'morgan' });
  mk('casey', { password: 'Cedar$Lamp9027', groups: ['sudo'] });
  mk('dana', { password: 'Pine&Field8830' });
  mk('kali', { password: 'kali', groups: ['sudo'] });
  mk('zerocool', { password: 'hacktheplanet' });
  mk('toor', { password: 'toor', uid: 0, gid: 0, nonUnique: true, home: '/home/toor' });
  sys.misc.initialHashes = Object.fromEntries(['riley', 'morgan'].map((n) => [n, users.getShadow(sys, n).hash]));
  for (const n of [...AUTHORIZED, 'dana', 'kali', 'zerocool']) sys.vfs.chmod(`/home/${n}`, 0o755);
}

function seedFiles(sys) {
  const v = sys.vfs;
  const put = (p, data, owner, mode = 0o644, size) => {
    const u = users.getUser(sys, owner);
    const dir = p.slice(0, p.lastIndexOf('/'));
    if (!v.exists(dir)) v.mkdir(dir, { parents: true, mode: 0o755, uid: u.uid, gid: u.gid });
    const n = v.writeFile(p, data, { mode, uid: u.uid, gid: u.gid });
    if (size) n.size = size;
  };
  // forensics
  put('/home/jordan/Documents/old/ftp_server_notes.txt', 'Print shop FTP box - notes\n--------------------------\nhost: 192.168.1.40\nftp user: shopadmin\nftp password: ' + ANSWERS.fq1 + '\n(remember to move this to the password manager someday)\n', 'jordan');
  put('/home/alex/Documents/message.b64', btoa('Reminder: the codeword for the Friday delivery is ' + ANSWERS.fq2 + '. Do not tell anyone.') + '\n', 'alex');
  const q = (n, text) => `FORENSICS QUESTION ${n}\n${'='.repeat(20)}\n\n${text}\n\nType your answer after the ANSWER: line below, then save this file.\n\nANSWER:\n`;
  put('/home/student/Desktop/Forensics Question 1.txt', q(1, 'A contractor left an old notes file for the shop\'s FTP server in one of the users\' home folders.\nWhat is the FTP password written in it?'), 'student');
  put('/home/student/Desktop/Forensics Question 2.txt', q(2, 'Alex saved a message in a Base64-encoded file in his Documents folder.\nDecode it. What is the codeword in the message?'), 'student');
  put('/home/student/Desktop/Forensics Question 3.txt', q(3, 'Something on this computer is listening for incoming connections that should not be.\nWhat TCP port number is the backdoor listener using?'), 'student');
  // policy violations
  put('/home/riley/Music/summer_mix.mp3', 'ID3\u0003[simulated audio]', 'riley', 0o644, 4_483_211);
  put('/home/alex/Videos/movie_night.mp4', '\u0000\u0000\u0000 ftypmp42[simulated video]', 'alex', 0o644, 58_204_117);
  put('/home/morgan/Documents/passwords.txt', 'MY PASSWORDS\n------------\nemail: morgan2000\nbank: Dragon$1999\nwifi: shopguest77\n', 'morgan');
  put('/home/alex/Documents/inventory.csv', 'item,qty\ntoner-black,14\ntoner-cyan,6\nreams-letter,40\n', 'alex');
  put('/home/riley/Documents/schedule.txt', 'Mon: opening shift\nTue: off\nWed: closing shift\n', 'riley');
  // persistence: autostart + the script it launches
  put('/home/student/.local/share/update-helper/update-helper.sh', `#!/bin/sh\nsleep 30 && ${NC_CMD} &\n`, 'student', 0o755);
  put('/home/student/.config/autostart/update-helper.desktop', '[Desktop Entry]\nType=Application\nName=System Update Helper\nExec=/home/student/.local/share/update-helper/update-helper.sh\nHidden=false\nX-GNOME-Autostart-enabled=true\n', 'student');
  v.writeFile('/etc/cron.d/sys-update-check', `# check for system updates\n* * * * * root pgrep -f "nc.traditional -lp 4444" >/dev/null || ${NC_CMD} &\n`, { mode: 0o644, uid: 0, gid: 0 });
  // desktop launchers + documents the competition ships
  const root = { uid: 0, gid: 0 };
  v.mkdir('/opt/CyberPatriot', { parents: true, mode: 0o755, ...root });
  v.writeFile('/opt/CyberPatriot/README.html', readmeHtml({ studentPassword: STUDENT_PW }), { mode: 0o644, ...root });
  const stu = users.getUser(sys, 'student');
  v.writeFile('/home/student/Desktop/README.desktop', '[Desktop Entry]\nType=Application\nName=README\nComment=Read the scenario README\nExec=firefox /opt/CyberPatriot/README.html\nIcon=text-x-generic\nTerminal=false\n', { mode: 0o755, uid: stu.uid, gid: stu.gid });
  v.writeFile('/home/student/Desktop/Scoring Report.desktop', '[Desktop Entry]\nType=Application\nName=Scoring Report\nComment=View your current score\nExec=firefox sim://scoring-report\nIcon=x-office-document\nTerminal=false\n', { mode: 0o755, uid: stu.uid, gid: stu.gid });
}

function seedConfig(sys) {
  const v = sys.vfs;
  const edit = (p, fn) => v.writeFile(p, fn(v.readFile(p)));
  // OpenSSH: root login in the main file, and a drop-in that overrides PermitEmptyPasswords (sshd: first value wins, Include is on top)
  edit('/etc/ssh/sshd_config', (t) => t.replace(/^#?PermitRootLogin .*$/m, 'PermitRootLogin yes'));
  v.writeFile('/etc/ssh/sshd_config.d/99-local.conf', '# local overrides for the contractor\nPermitEmptyPasswords yes\n', { mode: 0o644, uid: 0, gid: 0 });
  // password policy
  edit('/etc/security/pwquality.conf', (t) => t.replace(/\s*$/, '\n') + 'minlen = 4\n');
  v.writeFile('/etc/sudoers.d/99-wheel-nopasswd', '%sudo ALL=(ALL) NOPASSWD: ALL\n', { mode: 0o440, uid: 0, gid: 0 });
  v.writeFile('/etc/apt/apt.conf.d/10periodic', 'APT::Periodic::Update-Package-Lists "0";\nAPT::Periodic::Download-Upgradeable-Packages "0";\nAPT::Periodic::AutocleanInterval "0";\n');
  edit('/etc/sysctl.conf', (t) => t.replace(/\s*$/, '\n') + '\n# network tuning\nnet.ipv4.tcp_syncookies=0\n');
  sys.sysctl['net.ipv4.tcp_syncookies'] = '0';
  v.chmod('/etc/shadow', 0o666);
}

function seedSoftware(sys) {
  for (const names of [['vsftpd'], ['samba'], ['john'], ['wireshark'], ['aisleriot']]) {
    const plan = pk.planInstall(sys, names);
    for (const n of plan.toInstall) pk.installPackage(sys, n, { auto: !names.includes(n) });
  }
}

function seedProcesses(sys) {
  const zc = users.getUser(sys, 'zerocool');
  void zc;
  sys.spawn({ user: 'zerocool', cmd: 'python3 -m http.server 8000', comm: 'python3', ppid: 1, tty: 'pts/1', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 8000 }] });
  const nc = { user: 'root', cmd: NC_CMD, comm: 'nc.traditional', ppid: 1, tty: '?', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 4444 }] };
  sys.spawn({ ...nc, respawnId: 'backdoor-4444' });
  sys.respawn.push({ id: 'backdoor-4444', match: 'nc.traditional -lp 4444', proc: nc });
}

// ------------------------------------------------------------------ scoring tables
const V = (id, category, points, title, check) => ({ id, category, points, title, check });
const P = (id, points, title, check) => ({ id, points, title, check });

const passwordFixed = (name) => {
  const memo = new Map();
  return (sys) => {
    const sh = users.getShadow(sys, name);
    if (!sh || !sh.hash || sh.hash.startsWith('!') || sh.hash.startsWith('*')) return false;
    if (sh.hash === sys.misc.initialHashes?.[name]) return false;
    if (!memo.has(sh.hash)) memo.set(sh.hash, !WEAK(name).some((w) => verifyPassword(w, sh.hash)));
    return memo.get(sh.hash);
  };
};

export const vulns = [
  V('fq1', 'Forensics', 5, 'Forensics Question 1 correct', (s) => ck.answered(s, '/home/student/Desktop/Forensics Question 1.txt', new RegExp(`^${ANSWERS.fq1}$`, 'i'))),
  V('fq2', 'Forensics', 5, 'Forensics Question 2 correct', (s) => ck.answered(s, '/home/student/Desktop/Forensics Question 2.txt', new RegExp(`^${ANSWERS.fq2}$`, 'i'))),
  V('fq3', 'Forensics', 5, 'Forensics Question 3 correct', (s) => ck.answered(s, '/home/student/Desktop/Forensics Question 3.txt', new RegExp(`^${ANSWERS.fq3}$`))),
  V('rm-kali', 'User Auditing', 3, 'Removed unauthorized user kali', (s) => !ck.userExists(s, 'kali')),
  V('rm-zerocool', 'User Auditing', 3, 'Removed unauthorized user zerocool', (s) => !ck.userExists(s, 'zerocool')),
  V('rm-toor', 'User Auditing', 3, 'Removed hidden root-equivalent user toor', (s) => !ck.userExists(s, 'toor')),
  V('casey-not-admin', 'User Auditing', 3, 'User casey is not an administrator', (s) => ck.userExists(s, 'casey') && !users.isAdmin(s, 'casey')),
  V('dana-admin', 'User Auditing', 3, 'User dana is an administrator', (s) => ck.userExists(s, 'dana') && users.isAdmin(s, 'dana')),
  V('pw-riley', 'Account Policy', 3, 'Changed insecure password for riley', passwordFixed('riley')),
  V('pw-morgan', 'Account Policy', 3, 'Changed insecure password for morgan', passwordFixed('morgan')),
  V('guest-off', 'Account Policy', 3, 'Guest account is disabled', (s) => pk.isInstalled(s, 'lightdm') && !ck.lightdmAllowGuest(s)),
  V('pass-max-days', 'Account Policy', 3, 'A maximum password age is set', (s) => { const n = Number(ck.loginDefs(s, 'PASS_MAX_DAYS')); return n >= 1 && n <= 90; }),
  V('pass-min-len', 'Account Policy', 3, 'A minimum password length is required', (s) => ck.effectiveMinlen(s) >= 10),
  V('lockout', 'Account Policy', 3, 'Account lockout policy is configured', (s) => { const t = ck.lockoutThreshold(s); return t !== null && t >= 1 && t <= 10; }),
  V('nullok', 'Account Policy', 3, 'Null passwords do not authenticate', (s) => !ck.hasNullok(s) && s.vfs.isFile('/etc/pam.d/common-auth')),
  V('sudo-auth', 'Account Policy', 3, 'sudo requires a password', (s) => !ck.sudoWithoutPassword(s)),
  V('ufw', 'Defensive Countermeasures', 4, 'Firewall protection has been enabled', (s) => ck.ufwOn(s)),
  V('auto-updates', 'Defensive Countermeasures', 3, 'The system checks for updates daily', (s) => Number(ck.aptConfValue(s, 'APT::Periodic::Update-Package-Lists')) >= 1),
  V('upd-firefox', 'Application Updates', 3, 'Firefox has been updated', (s) => pk.isInstalled(s, 'firefox') && !pk.upgradable(s).some((u) => u.name === 'firefox')),
  V('ssh-root', 'Service Auditing', 4, 'SSH root login has been disabled', (s) => s.vfs.isFile('/etc/ssh/sshd_config') && ck.sshdValue(s, 'PermitRootLogin') !== 'yes'),
  V('ssh-empty', 'Service Auditing', 3, 'SSH does not permit empty passwords', (s) => s.vfs.isFile('/etc/ssh/sshd_config') && ck.sshdValue(s, 'PermitEmptyPasswords') !== 'yes'),
  V('syncookies', 'Operating System Settings', 2, 'TCP SYN cookies are enabled in sysctl configuration', (s) => ck.sysctlConf(s, 'net.ipv4.tcp_syncookies') === '1'),
  V('vsftpd', 'Service Auditing', 3, 'FTP service has been disabled or removed', (s) => !pk.isInstalled(s, 'vsftpd') || ck.svcOff(s, 'vsftpd')),
  V('smbd', 'Service Auditing', 3, 'Samba file sharing has been disabled or removed', (s) => !pk.isInstalled(s, 'samba') || (ck.svcOff(s, 'smbd') && ck.svcOff(s, 'nmbd'))),
  V('john', 'Prohibited Software', 3, 'Prohibited software John the Ripper removed', (s) => ck.pkgGone(s, 'john')),
  V('wireshark', 'Prohibited Software', 2, 'Prohibited software Wireshark removed', (s) => ck.pkgGone(s, 'wireshark')),
  V('media', 'Prohibited Files', 2, 'Prohibited media files removed', (s) => !s.vfs.exists('/home/riley/Music/summer_mix.mp3') && !s.vfs.exists('/home/alex/Videos/movie_night.mp4')),
  V('passwords-txt', 'Prohibited Files', 3, 'Plain-text password file removed', (s) => !s.vfs.exists('/home/morgan/Documents/passwords.txt')),
  V('shadow-perms', 'Operating System Settings', 4, '/etc/shadow is not world-readable or writable', (s) => { const m = ck.fileMode(s, '/etc/shadow'); return m !== null && (m & 0o027) === 0 && (m & 0o006) === 0; }),
  V('cron-backdoor', 'Malware', 3, 'Backdoor cron job removed', (s) => !s.vfs.exists('/etc/cron.d/sys-update-check') && !cronEntries(s).some((e) => e.command.includes('nc.traditional -lp 4444'))),
  V('listener', 'Malware', 2, 'Backdoor listener on port 4444 stopped', (s) => !ck.listeningOn(s, 4444)),
  V('autostart', 'Malware', 2, 'Malicious autostart entry removed', (s) => !s.vfs.isDir('/home/student/.config/autostart') || !s.vfs.readdir('/home/student/.config/autostart').some((n) => /update-helper/.test(n))),
];

export const penalties = [
  ...AUTHORIZED.concat(['dana']).map((n) => P(`pen-user-${n}`, 5, `Removed authorized user ${n}`, (s) => !ck.userExists(s, n))),
  P('pen-student-sudo', 5, 'Authorized administrator student lost sudo access', (s) => ck.userExists(s, 'student') && !users.isAdmin(s, 'student')),
  P('pen-ssh', 5, 'Critical service OpenSSH was stopped, disabled or removed', (s) => !pk.isInstalled(s, 'openssh-server') || !sv.isActive(s, 'ssh') || !sv.isEnabled(s, 'ssh')),
  P('pen-firefox', 5, 'Critical application Firefox was removed', (s) => !pk.isInstalled(s, 'firefox')),
];

export const scenario = {
  id: ID,
  title: 'Mint Practice Round 1',
  os: 'Linux Mint 21.3',
  hostname: 'mint-vm',
  timeLimitMin: 120,
  vulns,
  penalties,
  authorized: { admins: ADMINS, users: AUTHORIZED },
  studentPassword: STUDENT_PW,
};

/** Build a fresh, vulnerable machine for this scenario. */
export function buildScenario({ now = () => Date.now(), rng = seededRng(7) } = {}) {
  const sys = buildMint21({ now, rng, hostname: scenario.hostname, studentPassword: STUDENT_PW });
  sys.misc.scenario = ID;
  const real = sys._now;
  sys._now = () => real() - 20 * 86400000; // user files look a few weeks old
  seedUsers(sys);
  seedFiles(sys);
  seedConfig(sys);
  seedSoftware(sys);
  sys._now = real;
  seedProcesses(sys);
  sys.misc.startedAt = real();
  void fmtDate;
  return { sys, scenario };
}
