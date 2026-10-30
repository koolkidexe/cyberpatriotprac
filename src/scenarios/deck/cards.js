// The deck: every card is one kind of CyberPatriot task (modelled on real round reports). A card's plan(ctx) runs
// with the round's seeded random generator and declares, through ctx:
//   ctx.apply(fn)             a change to make to the freshly built machine (the misconfiguration)
//   ctx.vuln({...})           a scored check: { id, title, pts, check(sys) }  (category comes from the card)
//   ctx.solve(phase, cmd, ...input)   the terminal fix, used by the automated test that solves every random round
//   ctx.readme.notes/policy   extra README lines the task needs (a new hire, a group to create, ...)
// Phases: 0 forensics, 1 general fixes, 2 user removal, 3 account creation, 4 things that need the new accounts.
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as fw from '../../core/firewall.js';
import * as K from '../../core/checks.js';
import { sha256hex } from '../../core/util.js';
import { WEAK, WORDS, SERVICES_FOR_NOTES, GROUPS, HIDDEN_ROOT, PORTS } from './names.js';

const b64 = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'));
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function put(sys, owner, path, data, { mode = 0o644, size, days = 3 } = {}) {
  const u = users.getUser(sys, owner) || { uid: 0, gid: 0 };
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (!sys.vfs.exists(dir)) sys.vfs.mkdir(dir, { parents: true, mode: 0o755, uid: u.uid, gid: u.gid });
  const n = sys.vfs.writeFile(path, data, { mode, uid: u.uid, gid: u.gid, mtime: sys.now() - days * 86400000 });
  if (size != null) n.size = size;
  return n;
}
function replaceIn(sys, path, re, to) {
  const t = sys.vfs.readFile(path);
  if (!re.test(t)) throw new Error(`deck: pattern ${re} not found in ${path}`);
  sys.vfs.writeFile(path, t.replace(re, to));
}
function appendLine(sys, path, line) {
  const t = sys.vfs.exists(path) ? sys.vfs.readFile(path) : '';
  sys.vfs.writeFile(path, t.replace(/\n*$/, '\n') + line + '\n');
}
function setPeriodic(sys, key, v) {
  const p = '/etc/apt/apt.conf.d/10periodic';
  let t = sys.vfs.exists(p) ? sys.vfs.readFile(p) : '';
  const line = `APT::Periodic::${key} "${v}";`;
  t = new RegExp(`APT::Periodic::${key}\\b`).test(t) ? t.replace(new RegExp(`APT::Periodic::${key}[^\\n]*`), line) : t.replace(/\n*$/, '\n') + line + '\n';
  sys.vfs.writeFile(p, t.replace(/^\n/, ''));
}
const sysctlSet = (sys, key, v) => { appendLine(sys, '/etc/sysctl.conf', `${key}=${v}`); sys.sysctl[key] = String(v); };

// ================================================================= user auditing
const USER = 'User Auditing';
export const CARDS = [
  { id: 'unauth', cat: USER, pts: 4, take: [1, 3], plan(ctx) {
    const n = ctx.int(1, 3);
    for (let i = 0; i < n; i++) {
      const u = ctx.person();
      const sudo = ctx.chance(0.5);
      const proc = i === 0 && ctx.chance(0.35) ? 8000 + ctx.int(0, 899) : null;
      ctx.apply((sys) => {
        users.userAdd(sys, { name: u.name, password: ctx.pick(WEAK(u.name)), groups: sudo ? ['sudo'] : [], gecos: `${u.full},,,` });
        if (proc) sys.spawn({ user: u.name, cmd: `python3 -m http.server ${proc}`, comm: 'python3', tty: 'pts/1', stat: 'Sl', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: proc }] });
      });
      ctx.unauthorized.push(u.name);
      ctx.vuln({ id: `rm-${u.name}`, title: `Removed unauthorized user ${u.name}`, check: (s) => !users.getUser(s, u.name) });
      ctx.solve(2, `sudo pkill -u ${u.name}`);
      ctx.solve(2, `sudo userdel -r ${u.name}`);
    }
  } },
  { id: 'uid0', cat: USER, pts: 4, plan(ctx) {
    const name = ctx.pick(HIDDEN_ROOT);
    ctx.hiddenRoot = name;
    ctx.apply((sys) => users.userAdd(sys, { name, uid: 0, gid: 0, nonUnique: true, home: '/root', createHome: false, shell: '/bin/bash', password: name, gecos: name }));
    ctx.vuln({ id: `rm-${name}`, title: `Removed hidden root account ${name}`, check: (s) => !users.getUser(s, name) });
    ctx.solve(2, `sudo userdel ${name}`);
  } },
  { id: 'notadmin', cat: USER, pts: 4, plan(ctx) {
    for (let i = 0, n = ctx.int(1, 2); i < n; i++) {
      const u = ctx.takeUser(); if (!u) return;
      const adm = ctx.chance(0.5);
      ctx.apply((sys) => { users.addMember(sys, 'sudo', u); if (adm) users.addMember(sys, 'adm', u); });
      ctx.vuln({ id: `std-${u}`, title: `User ${u} is not an administrator`, check: (s) => !!users.getUser(s, u) && !users.isAdmin(s, u) });
      ctx.solve(1, `sudo gpasswd -d ${u} sudo`);
    }
  } },
  { id: 'mkadmin', cat: USER, pts: 4, plan(ctx) {
    const a = ctx.admins.find((x) => x.name !== 'student' && !x.taken);
    if (!a) return;
    a.taken = true; a.noSudo = true;
    ctx.vuln({ id: `admin-${a.name}`, title: `User ${a.name} is an administrator`, check: (s) => !!users.getUser(s, a.name) && users.isAdmin(s, a.name) });
    ctx.solve(1, `sudo usermod -aG sudo ${a.name}`);
  } },
  { id: 'weakpw', cat: USER, pts: 3, plan(ctx) {
    for (let i = 0, n = ctx.int(1, 2); i < n; i++) {
      const u = ctx.takeUser(); if (!u) return;
      const pw = ctx.pick(WEAK(u));
      ctx.apply((sys) => { users.setPassword(sys, u, pw); sys.misc.initialHashes = { ...(sys.misc.initialHashes || {}), [u]: users.getShadow(sys, u).hash }; });
      ctx.vuln({ id: `pw-${u}`, title: `Changed insecure password for user ${u}`, check: (s) => !!users.getUser(s, u) && K.passwordIsSecure(s, u) });
      const np = ctx.strongPw();
      ctx.solve(1, `sudo passwd ${u}`, np, np);
    }
  } },
  { id: 'nopw', cat: USER, pts: 3, plan(ctx) {
    const u = ctx.takeUser(); if (!u) return;
    ctx.apply((sys) => users.deletePassword(sys, u));
    ctx.vuln({ id: `haspw-${u}`, title: `User ${u} has a password`, check: (s) => { const sh = users.getShadow(s, u); return !!sh && /^\$/.test(sh.hash); } });
    const np = ctx.strongPw();
    ctx.solve(1, `sudo passwd ${u}`, np, np);
  } },
  { id: 'newhire', cat: USER, pts: 4, plan(ctx) {
    const u = ctx.person();
    const admin = ctx.chance(0.5);
    ctx.newHire = { ...u, admin };
    ctx.readme.notes.push(`<b>New hire:</b> ${u.full} starts this week. Create ${admin ? 'an <b>administrator</b>' : 'a standard (non-administrator)'} account named <code>${u.name}</code> for them.`);
    ctx.lateAdmins.push(admin ? u.name : null);
    ctx.vuln(admin
      ? { id: `new-${u.name}`, title: `Created new administrator account for ${u.name}`, check: (s) => !!users.getUser(s, u.name) && users.getUser(s, u.name).uid >= 1000 && users.isAdmin(s, u.name) }
      : { id: `new-${u.name}`, title: `Created user account ${u.name}`, check: (s) => K.standardUserExists(s, u.name) });
    ctx.solve(3, `sudo useradd -m -s /bin/bash -c ${sq(u.full)}${admin ? ' -G sudo' : ''} ${u.name}`);
    const np = ctx.strongPw();
    ctx.solve(3, `sudo passwd ${u.name}`, np, np);
  } },
  { id: 'mustchange', cat: USER, pts: 4, plan(ctx) {
    const u = ctx.newHire && ctx.chance(0.6) ? ctx.newHire.name : ctx.takeUser();
    if (!u) return;
    ctx.readme.notes.push(u === ctx.newHire?.name ? `The new account for <code>${u}</code> must require a password change the first time they log in.` : `User <code>${u}</code> may have had their password seen by someone else. Make sure <code>${u}</code> has to choose a new password at their next login.`);
    ctx.vuln({ id: `expire-${u}`, title: `User ${u} must change password at next login`, check: (s) => !!users.getUser(s, u) && K.mustChangePassword(s, u) });
    ctx.solve(4, `sudo passwd -e ${u}`);
  } },
  { id: 'group', cat: USER, pts: 3, plan(ctx) {
    const g = ctx.pick(GROUPS);
    const members = ctx.shuffle(ctx.users.map((x) => x.name)).slice(0, ctx.int(2, 3));
    ctx.readme.notes.push(`Create a group named <code>${g}</code> and add these users to it: ${members.map((m) => `<code>${m}</code>`).join(', ')}.`);
    ctx.vuln({ id: `grp-${g}`, title: `Created group ${g}`, check: (s) => !!users.getGroup(s, g) });
    ctx.vuln({ id: `grpm-${g}`, title: `Added users to group ${g}`, check: (s) => { const gr = users.getGroup(s, g); return !!gr && members.every((m) => gr.members.includes(m)); } });
    ctx.solve(1, `sudo groupadd ${g}`);
    for (const m of members) ctx.solve(1, `sudo usermod -aG ${g} ${m}`);
  } },

  // ================================================================= account policy
  { id: 'guest', cat: 'Account Policy', os: 'mint', pts: 3, plan(ctx) {
    ctx.apply((sys) => sys.vfs.writeFile('/etc/lightdm/lightdm.conf.d/70-linuxmint.conf', '[Seat:*]\nuser-session=cinnamon\nallow-guest=true\n'));
    ctx.vuln({ id: 'guest-off', title: 'Guest account is disabled', check: (s) => !K.guestAllowed(s) });
    ctx.solve(1, "sudo sed -i 's/allow-guest=true/allow-guest=false/' /etc/lightdm/lightdm.conf.d/70-linuxmint.conf");
  } },
  { id: 'autologin', cat: 'Account Policy', pts: 3, plan(ctx) {
    if (ctx.os === 'ubuntu') {
      ctx.apply((sys) => { replaceIn(sys, '/etc/gdm3/custom.conf', /^#\s*AutomaticLoginEnable = true$/m, 'AutomaticLoginEnable = true'); replaceIn(sys, '/etc/gdm3/custom.conf', /^#\s*AutomaticLogin = user1$/m, 'AutomaticLogin = student'); });
      ctx.solve(1, "sudo sed -i 's/^AutomaticLoginEnable = true/AutomaticLoginEnable = false/' /etc/gdm3/custom.conf");
    } else {
      ctx.apply((sys) => sys.vfs.writeFile('/etc/lightdm/lightdm.conf.d/80-autologin.conf', '[Seat:*]\nautologin-user=student\nautologin-user-timeout=0\n'));
      ctx.solve(1, 'sudo rm /etc/lightdm/lightdm.conf.d/80-autologin.conf');
    }
    ctx.vuln({ id: 'autologin-off', title: 'Automatic login is disabled', check: (s) => !K.autologinUser(s) });
  } },
  { id: 'maxdays', cat: 'Account Policy', pts: 3, plan(ctx) {
    ctx.vuln({ id: 'max-days', title: 'A secure maximum password age exists', check: (s) => { const n = Number(K.loginDefs(s).PASS_MAX_DAYS); return n >= 1 && n <= 90; } });
    ctx.solve(1, "sudo sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS\\t90/' /etc/login.defs");
  } },
  { id: 'mindays', cat: 'Account Policy', pts: 3, plan(ctx) {
    ctx.vuln({ id: 'min-days', title: 'A secure minimum password age exists', check: (s) => { const n = Number(K.loginDefs(s).PASS_MIN_DAYS); return n >= 1 && n <= 30; } });
    ctx.solve(1, "sudo sed -i 's/^PASS_MIN_DAYS.*/PASS_MIN_DAYS\\t7/' /etc/login.defs");
  } },
  { id: 'minlen', cat: 'Account Policy', pts: 4, plan(ctx) {
    ctx.apply((sys) => replaceIn(sys, '/etc/pam.d/common-password', /pam_pwquality\.so retry=3/, 'pam_pwquality.so retry=3 minlen=4'));
    ctx.vuln({ id: 'min-len', title: 'A minimum password length is required', check: (s) => K.effectiveMinLen(s) >= 10 });
    ctx.solve(1, "sudo sed -i 's/minlen=4/minlen=12/' /etc/pam.d/common-password");
  } },
  { id: 'history', cat: 'Account Policy', pts: 3, plan(ctx) {
    ctx.vuln({ id: 'pw-history', title: 'Previous passwords are remembered', check: (s) => users.rememberCount(s) >= 5 });
    ctx.solve(1, "sudo sed -i '/pam_unix.so/ s/$/ remember=5/' /etc/pam.d/common-password");
  } },
  { id: 'lockout', cat: 'Account Policy', pts: 4, plan(ctx) {
    ctx.vuln({ id: 'lockout', title: 'A secure account lockout threshold exists', check: (s) => { const d = K.lockoutDeny(s); return d != null && d >= 1 && d <= 10; } });
    ctx.solve(1, "echo 'auth required pam_faillock.so deny=5 unlock_time=900' | sudo tee -a /etc/pam.d/common-auth");
  } },
  { id: 'nullok', cat: 'Account Policy', pts: 3, plan(ctx) {
    ctx.vuln({ id: 'nullok', title: 'Null passwords do not authenticate', check: (s) => !K.nullokPresent(s) });
    ctx.solve(1, "sudo sed -i 's/ nullok//' /etc/pam.d/common-auth /etc/pam.d/common-password");
  } },
  { id: 'nopasswd', cat: 'Account Policy', pts: 4, plan(ctx) {
    const f = ctx.pick(['99-wheel-nopasswd', '90-contractor', 'zz-admins', 'README-local']);
    ctx.apply((sys) => sys.vfs.writeFile(`/etc/sudoers.d/${f}`, '# Created by a contractor "to make scripts easier"\n%sudo ALL=(ALL) NOPASSWD: ALL\n', { mode: 0o440, uid: 0, gid: 0 }));
    ctx.vuln({ id: 'sudo-auth', title: 'sudo requires authentication', check: (s) => !K.sudoNeedsNoPassword(s) });
    ctx.solve(1, `sudo rm /etc/sudoers.d/${f}`);
  } },

  // ================================================================= defensive countermeasures
  { id: 'ufw', cat: 'Defensive Countermeasures', pts: 5, weight: 3, plan(ctx) {
    ctx.vuln({ id: 'ufw', title: 'Uncomplicated Firewall (UFW) protection has been enabled', check: (s) => K.ufwActive(s) });
    ctx.solve(1, 'sudo ufw enable', 'y');
  } },
  { id: 'ufwdefault', cat: 'Defensive Countermeasures', pts: 3, plan(ctx) {
    ctx.apply((sys) => fw.setDefault(sys, 'incoming', 'allow'));
    ctx.vuln({ id: 'ufw-deny-in', title: 'The firewall denies incoming connections by default', check: (s) => ['deny', 'reject'].includes(fw.getDefaults(s).incoming) });
    ctx.solve(1, 'sudo ufw default deny incoming');
  } },
  { id: 'autocheck', cat: 'Defensive Countermeasures', pts: 3, plan(ctx) {
    ctx.apply((sys) => setPeriodic(sys, 'Update-Package-Lists', 0));
    ctx.vuln({ id: 'auto-check', title: 'The system automatically checks for updates daily', check: (s) => K.aptPeriodic(s, 'Update-Package-Lists') >= 1 });
    ctx.solve(1, "sudo sed -i 's/Update-Package-Lists \"0\"/Update-Package-Lists \"1\"/' /etc/apt/apt.conf.d/10periodic");
  } },
  { id: 'autoinstall', cat: 'Defensive Countermeasures', pts: 4, plan(ctx) {
    ctx.apply((sys) => sys.vfs.writeFile('/etc/apt/apt.conf.d/20auto-upgrades', 'APT::Periodic::Unattended-Upgrade "0";\n'));
    ctx.vuln({ id: 'auto-install', title: ctx.os === 'mint' ? 'The update manager installs updates automatically' : 'Security updates are installed automatically', check: (s) => K.aptPeriodic(s, 'Unattended-Upgrade') >= 1 });
    ctx.solve(1, "sudo sed -i 's/Unattended-Upgrade \"0\"/Unattended-Upgrade \"1\"/' /etc/apt/apt.conf.d/20auto-upgrades");
  } },
  { id: 'secupd', cat: 'Defensive Countermeasures', pts: 5, plan(ctx) {
    ctx.readme.policy.push('Install important security updates.');
    ctx.vuln({ id: 'sec-updates', title: 'Install updates from important security updates', check: (s) => K.upToDate(s, ['openssl', 'libssl3']) });
    ctx.solve(1, 'sudo apt install --only-upgrade -y openssl libssl3');
  } },
  { id: 'browserupd', cat: 'Defensive Countermeasures', pts: 4, plan(ctx) {
    const b = ctx.browser; const nm = b === 'chromium' ? 'Chromium' : 'Firefox';
    ctx.vuln({ id: `upd-${b}`, title: `${nm} has been updated`, check: (s) => pk.isInstalled(s, b) && K.upToDate(s, [b]) });
    ctx.solve(1, `sudo apt install --only-upgrade -y ${b}`);
  } },
  { id: 'sshupd', cat: 'Defensive Countermeasures', pts: 4, plan(ctx) {
    ctx.vuln({ id: 'upd-openssh', title: 'OpenSSH has been updated', check: (s) => K.upToDate(s, ['openssh-server']) });
    ctx.solve(1, 'sudo apt install --only-upgrade -y openssh-server openssh-client openssh-sftp-server');
  } },
  { id: 'systemdupd', cat: 'Defensive Countermeasures', pts: 4, plan(ctx) {
    ctx.vuln({ id: 'upd-systemd', title: 'Systemd has been updated', check: (s) => K.upToDate(s, ['systemd']) });
    ctx.solve(1, 'sudo apt install --only-upgrade -y systemd');
  } },
  { id: 'sudoupd', cat: 'Defensive Countermeasures', pts: 4, plan(ctx) {
    ctx.vuln({ id: 'upd-sudo', title: 'sudo has been updated', check: (s) => K.upToDate(s, ['sudo']) });
    ctx.solve(1, 'sudo apt install --only-upgrade -y sudo');
  } },

  // ================================================================= application / OS security
  { id: 'sshroot', cat: 'Application Security', pts: 5, weight: 2, plan(ctx) {
    ctx.apply((sys) => replaceIn(sys, '/etc/ssh/sshd_config', /^#PermitRootLogin .*$/m, 'PermitRootLogin yes'));
    ctx.vuln({ id: 'ssh-root', title: 'SSH root login has been disabled', check: (s) => pk.isInstalled(s, 'openssh-server') && ['no', 'prohibit-password', 'without-password', 'forced-commands-only'].includes(K.sshdValue(s, 'PermitRootLogin')) });
    ctx.solve(1, "sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config");
  } },
  { id: 'sshempty', cat: 'Application Security', pts: 4, plan(ctx) {
    ctx.apply((sys) => sys.vfs.writeFile('/etc/ssh/sshd_config.d/99-local.conf', '# local overrides\nPermitEmptyPasswords yes\n', { mode: 0o644, uid: 0, gid: 0 }));
    ctx.vuln({ id: 'ssh-empty', title: 'SSH does not permit empty passwords', check: (s) => pk.isInstalled(s, 'openssh-server') && K.sshdValue(s, 'PermitEmptyPasswords') === 'no' });
    ctx.solve(1, "sudo sed -i 's/PermitEmptyPasswords yes/PermitEmptyPasswords no/' /etc/ssh/sshd_config.d/99-local.conf");
  } },
  { id: 'sshx11', cat: 'Application Security', pts: 3, plan(ctx) {
    ctx.vuln({ id: 'ssh-x11', title: 'SSH X11 forwarding has been disabled', check: (s) => pk.isInstalled(s, 'openssh-server') && K.sshdValue(s, 'X11Forwarding') === 'no' });
    ctx.solve(1, "sudo sed -i 's/^X11Forwarding yes/X11Forwarding no/' /etc/ssh/sshd_config");
  } },
  { id: 'syncookies', cat: 'Application Security', pts: 4, plan(ctx) {
    ctx.apply((sys) => sysctlSet(sys, 'net.ipv4.tcp_syncookies', 0));
    ctx.vuln({ id: 'syncookies', title: 'IPv4 TCP SYN cookies have been enabled', check: (s) => K.sysctlConfValue(s, 'net.ipv4.tcp_syncookies') === '1' });
    ctx.solve(1, "sudo sed -i 's/tcp_syncookies=0/tcp_syncookies=1/' /etc/sysctl.conf");
  } },
  { id: 'ipforward', cat: 'Application Security', pts: 3, plan(ctx) {
    ctx.apply((sys) => sysctlSet(sys, 'net.ipv4.ip_forward', 1));
    ctx.vuln({ id: 'ip-forward', title: 'IPv4 forwarding has been disabled', check: (s) => K.sysctlConfValue(s, 'net.ipv4.ip_forward') !== '1' });
    ctx.solve(1, "sudo sed -i 's/ip_forward=1/ip_forward=0/' /etc/sysctl.conf");
  } },
  { id: 'aslr', cat: 'Application Security', pts: 3, plan(ctx) {
    ctx.apply((sys) => sysctlSet(sys, 'kernel.randomize_va_space', 0));
    ctx.vuln({ id: 'aslr', title: 'Address space layout randomization is enabled', check: (s) => { const v = K.sysctlConfValue(s, 'kernel.randomize_va_space'); return v == null || v === '2'; } });
    ctx.solve(1, "sudo sed -i 's/randomize_va_space=0/randomize_va_space=2/' /etc/sysctl.conf");
  } },
  { id: 'brpopups', cat: 'Application Security', pts: 4, plan(ctx) {
    if (ctx.browser === 'chromium') {
      ctx.vuln({ id: 'chr-popups', title: 'Chromium blocks pop-ups and redirects', check: (s) => pk.isInstalled(s, 'chromium') && K.chromiumPopupsBlocked(s) });
      ctx.solve(1, `sed -i 's/"popups":1/"popups":2/' ~/.config/chromium/Default/Preferences`);
    } else {
      ctx.vuln({ id: 'ff-popups', title: 'Firefox blocks pop-up windows', check: (s) => pk.isInstalled(s, 'firefox') && K.firefoxPopupsBlocked(s) });
      ctx.solve(1, "sed -i '/disable_open_during_load/s/false/true/' ~/.mozilla/firefox/*.default-release/prefs.js");
    }
    ctx.readme.programs.push('block pop-ups');
  } },
  { id: 'brsafe', cat: 'Application Security', pts: 4, plan(ctx) {
    if (ctx.browser === 'chromium') {
      ctx.vuln({ id: 'chr-safebrowsing', title: 'Chromium Safe Browsing protection is enabled', check: (s) => pk.isInstalled(s, 'chromium') && K.chromiumSafeBrowsing(s) });
      ctx.solve(1, `sed -i 's/"safebrowsing":{"enabled":false/"safebrowsing":{"enabled":true/' ~/.config/chromium/Default/Preferences`);
    } else {
      ctx.vuln({ id: 'ff-safebrowsing', title: 'Firefox blocks dangerous and deceptive content', check: (s) => pk.isInstalled(s, 'firefox') && K.firefoxSafeBrowsing(s) });
      ctx.solve(1, "sed -i '/safebrowsing.\\(malware\\|phishing\\)/s/false/true/' ~/.mozilla/firefox/*.default-release/prefs.js");
    }
    ctx.readme.programs.push('warn about dangerous sites');
  } },

  // ================================================================= services
  { id: 'service', cat: 'Service Auditing', pts: 5, weight: 2, plan(ctx) {
    const pool = [['vsftpd', 'vsftpd', 'FTP', 'FTP service'], ['samba', 'smbd', 'Windows file sharing (Samba)', 'Samba service'], ['apache2', 'apache2', 'web server (Apache)', 'Apache2 service'], ['nginx', 'nginx', 'web server (nginx)', 'nginx service'],
      ['inetutils-telnetd', 'telnetd', 'Telnet', 'Telnet service'], ['snmpd', 'snmpd', 'SNMP', 'SNMP service'], ['nfs-kernel-server', 'nfs-server', 'NFS file sharing', 'NFS service']];
    const picks = ctx.shuffle(pool.filter((p) => !ctx.critical.includes(p[1]) && !ctx.usedPkgs.has(p[0]))).slice(0, ctx.int(1, 3));
    for (const [pkg, svc, what, label] of picks) {
      ctx.usedPkgs.add(pkg);
      ctx.apply((sys) => pk.installPackage(sys, pkg));
      ctx.readme.notServices.push(what);
      ctx.vuln({ id: `svc-${svc}`, title: `${label} has been disabled or removed`, check: (s) => K.serviceOff(s, svc, pkg) && (svc !== 'smbd' || K.serviceOff(s, 'nmbd', pkg)) });
      ctx.solve(1, `sudo systemctl disable --now ${svc}${svc === 'smbd' ? ' nmbd' : ''}`);
    }
  } },

  // ================================================================= prohibited software
  { id: 'software', cat: 'Prohibited Software', pts: 4, weight: 2, plan(ctx) {
    const pool = [['john', 'John the Ripper', 'john-data'], ['wireshark', 'Wireshark'], ['hydra', 'THC Hydra'], ['nmap', 'Nmap'], ['ophcrack', 'ophcrack'], ['aisleriot', 'aisleriot'], ['zangband', 'Zangband'], ['gnome-mines', 'Mines'], ['deluge', 'Deluge']];
    for (const [pkg, nm, extra] of ctx.shuffle(pool).slice(0, ctx.int(2, 4))) {
      ctx.apply((sys) => { if (extra) pk.installPackage(sys, extra, { auto: true }); pk.installPackage(sys, pkg); });
      ctx.vuln({ id: `rm-${pkg}`, title: `Prohibited software ${nm} removed`, check: (s) => !pk.isInstalled(s, pkg) });
      ctx.solve(1, `sudo apt purge -y ${pkg}`);
    }
  } },

  // ================================================================= prohibited files
  { id: 'media', cat: 'Prohibited Files', pts: 4, plan(ctx) {
    const files = [];
    for (let i = 0, n = ctx.int(1, 3); i < n; i++) {
      const owner = ctx.pick(ctx.users).name;
      const f = `/home/${owner}/${ctx.pick(['Music', 'Music', 'Downloads', 'Videos'])}/${ctx.pick(['summer_mix', 'roadtrip', 'top40', 'chill_beats', 'gym_playlist', 'track07'])}_${ctx.int(1, 99)}.mp3`;
      if (files.includes(f)) continue;
      files.push(f);
      const size = 3000000 + ctx.int(0, 6000000);
      ctx.apply((sys) => put(sys, owner, f, 'ID3\u0003\u0000\u0000\u0000(simulated mp3 data)', { size }));
    }
    ctx.vuln({ id: 'rm-mp3', title: 'Prohibited MP3 files are removed', check: (s) => files.every((f) => !s.vfs.exists(f)) });
    ctx.solve(1, `sudo rm -f ${files.join(' ')}`);
  } },
  { id: 'pwfile', cat: 'Prohibited Files', pts: 4, plan(ctx) {
    const owner = ctx.pick(ctx.users).name;
    const f = `/home/${owner}/${ctx.pick(['Documents', 'Desktop', 'Documents/old'])}/${ctx.pick(['passwords.txt', 'logins.txt', 'accounts.csv', 'my_pws.txt'])}`;
    ctx.apply((sys) => put(sys, owner, f, `MY PASSWORDS (do not share!!)\n\nemail: ${owner}@example.org / ${owner}2019\nbank:  hunter22\nwifi:  Guest!2024\n`));
    ctx.vuln({ id: 'rm-pwfile', title: 'Removed plaintext password file', check: (s) => !s.vfs.exists(f) });
    ctx.solve(1, `sudo rm ${f}`);
  } },

  // ================================================================= malware / backdoors
  { id: 'shadowperm', cat: 'Malware', pts: 4, plan(ctx) {
    ctx.apply((sys) => sys.vfs.chmod('/etc/shadow', 0o666));
    ctx.vuln({ id: 'shadow-perms', title: 'Insecure permissions on shadow file fixed', check: (s) => { const m = K.fileMode(s, '/etc/shadow'); return m != null && (m & ~0o640) === 0; } });
    ctx.solve(1, 'sudo chmod 640 /etc/shadow');
  } },
  { id: 'passwdperm', cat: 'Malware', pts: 3, plan(ctx) {
    ctx.apply((sys) => sys.vfs.chmod('/etc/passwd', 0o666));
    ctx.vuln({ id: 'passwd-perms', title: 'Insecure permissions on passwd file fixed', check: (s) => { const m = K.fileMode(s, '/etc/passwd'); return m != null && (m & 0o022) === 0; } });
    ctx.solve(1, 'sudo chmod 644 /etc/passwd');
  } },
  { id: 'cron', cat: 'Malware', pts: 4, plan(ctx) {
    const port = ctx.pick(PORTS.filter((p) => p !== ctx.autostartPort));
    const file = ctx.pick(['sys-update-check', 'popularity-sync', 'logrotate-helper', 'apt-refresh']);
    ctx.backdoorPort = port;
    const cmd = `/bin/nc.traditional -l -p ${port} -e /bin/bash`;
    ctx.apply((sys) => {
      sys.vfs.writeFile(`/etc/cron.d/${file}`, `# system maintenance\nSHELL=/bin/sh\n* * * * * root ${cmd} >/dev/null 2>&1 &\n`, { mode: 0o644, uid: 0, gid: 0 });
      const bd = { user: 'root', cmd, comm: 'nc.traditional', stat: 'S', listen: [{ proto: 'tcp', addr: '0.0.0.0', port }] };
      sys.respawn.push({ id: `backdoor${port}`, match: `nc.traditional -l -p ${port}`, proc: bd });
      sys.spawn({ ...bd, respawnId: `backdoor${port}` });
    });
    ctx.vuln({ id: 'rm-cron-bd', title: 'Removed netcat backdoor cron job', check: (s) => !s.vfs.exists(`/etc/cron.d/${file}`) });
    ctx.vuln({ id: 'bd-listener', title: `Stopped backdoor listening on port ${port}`, pts: 3, check: (s) => !K.portListening(s, port) });
    ctx.solve(1, `sudo rm /etc/cron.d/${file}`);
    ctx.solve(1, `sudo pkill -f 'nc.traditional -l -p ${port}'`);
  } },
  { id: 'autostart', cat: 'Malware', pts: 3, plan(ctx) {
    const name = ctx.pick(['update-helper', 'gnome-update-helper', 'sys-tray-sync', 'cinnamon-helper']);
    const port = ctx.pick(PORTS.filter((p) => p !== ctx.backdoorPort));
    ctx.autostartPort = port;
    ctx.apply((sys) => {
      put(sys, 'student', `/home/student/.config/autostart/${name}.desktop`, `[Desktop Entry]\nType=Application\nName=System Update Helper\nComment=Checks for system updates\nExec=/usr/local/bin/.${name}\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n`);
      sys.vfs.writeFile(`/usr/local/bin/.${name}`, `#!/bin/sh\n# phone home\nsleep 30 && /bin/nc.traditional -l -p ${port} -e /bin/bash &\n`, { mode: 0o755, uid: 0, gid: 0 });
    });
    ctx.vuln({ id: 'rm-autostart', title: 'Removed malicious startup application', check: (s) => !s.vfs.exists(`/home/student/.config/autostart/${name}.desktop`) });
    ctx.solve(1, `rm ~/.config/autostart/${name}.desktop`);
  } },
  { id: 'suid', cat: 'Malware', pts: 4, plan(ctx) {
    const path = ctx.pick(['/usr/local/sbin/.syslogd', '/var/tmp/.cache-helper', '/usr/lib/x86_64-linux-gnu/.dbus-shell', '/opt/.backup/bash']);
    ctx.suidPath = path;
    ctx.apply((sys) => { const d = path.slice(0, path.lastIndexOf('/')); if (!sys.vfs.exists(d)) sys.vfs.mkdir(d, { parents: true, mode: 0o755 }); sys.vfs.copy('/usr/bin/bash', path); sys.vfs.chmod(path, 0o4755); });
    ctx.vuln({ id: 'rm-suid', title: 'Removed SUID root shell backdoor', check: (s) => { const m = K.fileMode(s, path); return m == null || !(m & 0o4000); } });
    ctx.solve(1, `sudo rm ${path}`);
  } },

  // ================================================================= forensics (chosen after the other cards)
  { id: 'fq-note', cat: 'Forensics', forensic: true, plan(ctx) {
    const owner = ctx.pick(ctx.users).name; const svc = ctx.pick(SERVICES_FOR_NOTES);
    const ans = `${ctx.pick(WORDS)[0]}${ctx.pick(WORDS).slice(1).toLowerCase()}-${ctx.int(1000, 9999)}`;
    const path = `/home/${owner}/${ctx.pick(['Documents/old', 'Documents/notes', '.local/share/notes', 'Pictures/.misc'])}/${svc.replace(/\W+/g, '_').toLowerCase()}_notes.txt`;
    ctx.apply((sys) => put(sys, owner, path, `${svc} server notes\n----------------\nlogin: admin\npass:  ${ans}\n\nTODO: delete this file.\n`, { days: 40 }));
    ctx.forensic(`A user left a note somewhere in /home with the password for the company ${svc} server.\nWhat is that password?`, ans);
  } },
  { id: 'fq-b64', cat: 'Forensics', forensic: true, plan(ctx) {
    const owner = ctx.pick(ctx.users).name; const ans = `${ctx.pick(WORDS)}-${ctx.int(10, 99)}`;
    const path = `/home/${owner}/Documents/${ctx.pick(['message', 'secret', 'memo'])}.b64`;
    ctx.apply((sys) => put(sys, owner, path, b64(`The secret codeword is: ${ans}\n`) + '\n'));
    ctx.forensic(`The file ${path} holds a Base64-encoded message.\nDecode it. What is the secret codeword?`, ans);
  } },
  { id: 'fq-port', cat: 'Forensics', forensic: true, requires: 'cron', plan(ctx) {
    ctx.forensic('A backdoor on this computer is listening for incoming network connections.\nWhat TCP port is it listening on?', String(ctx.backdoorPort));
  } },
  { id: 'fq-sha', cat: 'Forensics', forensic: true, plan(ctx) {
    const owner = ctx.pick(ctx.users).name; const name = ctx.pick(['budget_q3.csv', 'inventory.txt', 'schedule.txt', 'minutes.txt']);
    const path = `/home/${owner}/Documents/${name}`;
    const data = `${name}\n${Array.from({ length: 4 }, () => `${ctx.pick(WORDS).toLowerCase()},${ctx.int(10, 999)}`).join('\n')}\n`;
    ctx.apply((sys) => put(sys, owner, path, data));
    ctx.forensic(`What is the SHA256 hash of the file ${path}?`, sha256hex(data));
  } },
  { id: 'fq-find', cat: 'Forensics', forensic: true, plan(ctx) {
    const name = ctx.pick(['exfil_list.txt', 'targets.lst', 'stolen_cards.csv', '.loot.tar']);
    const path = `${ctx.pick(['/var/lib/.cache', '/usr/share/doc/.misc', '/opt/.tmp', '/var/backups/.old'])}/${name}`;
    ctx.apply((sys) => { const d = path.slice(0, path.lastIndexOf('/')); sys.vfs.mkdir(d, { parents: true, mode: 0o755 }); sys.vfs.writeFile(path, 'collected data (simulated)\n', { mode: 0o644 }); });
    ctx.forensic(`An attacker hid a file named "${name}" somewhere on this computer.\nWhat is the full path of that file?`, path);
  } },
  { id: 'fq-uid0', cat: 'Forensics', forensic: true, requires: 'uid0', plan(ctx) {
    ctx.forensic('Besides root, one account on this computer has user ID 0.\nWhat is the name of that account?', ctx.hiddenRoot);
  } },
  { id: 'fq-suid', cat: 'Forensics', forensic: true, requires: 'suid', plan(ctx) {
    ctx.forensic('Someone left a copy of a shell with the SUID bit set, owned by root.\nWhat is the full path of that file?', ctx.suidPath);
  } },
];
