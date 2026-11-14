// "Windows Practice Round 1": the Northstar Tabletop scenario (a small game-design studio). Adapted from
// Krishna Ajay's Windows practice simulation (users, groups, forensics, the 32 scored checks and their points),
// rebuilt on this simulator's real Windows model so every check is fixed the way it would be on a real image.
// Changes from the original: the signed-in admin is `student` (as on every image here), Firefox replaces Chrome,
// and two tasks the original image planted but never scored (the music file and the tini.exe backdoor) are scored.
import * as S from '../../win/state.js';
import { putFile } from '../../win/image.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lc = (s) => String(s).toLowerCase();
const BIN = (n) => `MZ\u0090\u0000(simulated ${n})`;
const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const secure = (pw) => `(ConvertTo-SecureString ${q(pw)} -AsPlainText -Force)`;
const regPS = (k) => `HKLM:\\${S.regKey(k).slice(5)}`;

export const ORG = ['Northstar Tabletop', 'a small studio that designs tabletop and video games', 'the design team'];
const USERS = [['jhopper', 'password'], ['jbyers', 'Hawk!n5Lab#22'], ['rtoken', ''], ['dustin', 'Mw7#kLq2!zp'], ['lucas', '123456'], ['will', 'Zr8$pNv3@Lm'], ['max', 'Q4!hTz9#cWe'], ['nancy', 'bE5&vKd1^Yx'], ['jonathan', 'Lg3@Fp7!sRt'], ['steve', ''], ['robin', 'Yc6#Hn2$wQa'], ['erica', 'Pd9!Mx4&kVu'], ['suzie', 'Ts1%Gb8@nZe'], ['murray', 'Jf4$Rw6!cLm'], ['joyce', 'Aq2#Vh7^pXd'], ['bob', 'Nk5!Ct9&yEs'], ['argyle', 'Wz8@Lu3$hTb'], ['eddie', 'Gm6^Qd1!rFo']];
const UNAUTH = [['raven', 'Pass1234', true, 3], ['vecna', 'Upside!Down9', false, 3], ['brenner', 'Papa#Lab84', true, 3], ['svc-update', 'Sv9!updt#44', false, 2]];
const NOTES = '/Users/mwheeler/Documents/Archive/shipment-notes.txt';

/** People of the round (replaces the random admins/users). */
export function people(ctx) {
  let rid = 1001;
  ctx.admins = [{ name: 'student', full: 'Student', pw: ctx.studentPw, note: 'you', rid: rid++ }, { name: 'mwheeler', full: '', pw: 'p4Lac|In11', note: 'Lead Designer', rid: rid++ }];
  ctx.users = USERS.map(([name, pw]) => ({ name, full: '', pw: pw || 'Temp#Pass2026', rid: rid++, taken: true }));
  ctx.org = ORG;
  ctx.wireshark = true;
  ctx.rdpRequired = false;
  ctx.critical = [{ name: 'sshd', display: 'OpenSSH SSH Server' }];
}

/** Scored checks, setup and fixes. `card(id, pts)` plays a deck card with a fixed point value. */
export function plan(ctx, card) {
  const V = (cat, pts, v) => ctx.vuln({ ...v, category: cat, pts });
  const USER = 'User Auditing';

  // ------------------------------------------------------------- base image: services, files, programs
  ctx.apply((sys) => {
    for (const [n, pw] of USERS) if (!pw) { S.setPassword(sys, n, '', { checkPolicy: false }); sys.misc.initialWinHashes[n] = ''; }
    if (!S.getGroup(sys, 'Event Log Readers')) S.addGroup(sys, 'Event Log Readers', 'Members of this group can read event logs from local machine');
    for (const m of ['jhopper', 'rtoken']) S.addMember(sys, 'Event Log Readers', m, { quiet: true });
    for (const m of ['jhopper', 'dustin']) S.addMember(sys, 'Remote Desktop Users', m, { quiet: true });
    // OpenSSH Server (critical)
    S.listServices(sys).push({ name: 'sshd', display: 'OpenSSH SSH Server', desc: 'SSH protocol based service to provide secure encrypted communications between two untrusted hosts over an insecure network.', startType: 'Automatic', status: 'Running', exe: 'sshd.exe', cmdline: 'C:\\Windows\\System32\\OpenSSH\\sshd.exe', group: '', account: 'Local System', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 22 }] });
    S.spawnFor(sys, S.getService(sys, 'sshd'));
    putFile(sys, '/Windows/System32/OpenSSH/sshd.exe', BIN('sshd.exe'), { size: 1093632, days: 90 });
    putFile(sys, '/ProgramData/ssh/sshd_config', '# This is the sshd server system-wide configuration file.\n#Port 22\n#PermitRootLogin prohibit-password\nPasswordAuthentication yes\nSubsystem\tsftp\tsftp-server.exe\n\nMatch Group administrators\n       AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys\n', { days: 90 });
    // CCleaner is installed (not on the authorized list, not scored)
    S.listPrograms(sys).push({ id: 'Piriform.CCleaner', name: 'CCleaner', publisher: 'Piriform', version: '6.12', latest: '6.12', size: 82, dir: '/Program Files/CCleaner', exe: 'CCleaner64.exe', installed: '9/14/2026' });
    putFile(sys, '/Program Files/CCleaner/CCleaner64.exe', BIN('CCleaner64.exe'), { size: 3500000, days: 50 });
    putFile(sys, '/Users/Public/Desktop/CCleaner.lnk', '[shortcut] C:\\Program Files\\CCleaner\\CCleaner64.exe', { days: 50 });
    // evidence and clutter
    putFile(sys, NOTES, 'Shipment notes - Q4 convention kit\n\nPallets 3 and 4 go to the east dock.\nReminder: the blue meeple protocol applies to every prototype that leaves the studio.\nNo photos of unreleased boxes.\n', { days: 16 });
    putFile(sys, '/Users/student/Pictures/nina.jpg', '\u00ff\u00d8\u00ff\u00e0(simulated JPEG: lab photo)', { size: 184320, days: 30 });
    putFile(sys, '/Users/student/Pictures/boardgame-launch.jpg', '\u00ff\u00d8\u00ff\u00e0(simulated JPEG: launch photo)', { size: 241664, days: 22 });
    putFile(sys, '/Users/student/Downloads/nmap-7.94-setup.exe', BIN('nmap-7.94-setup.exe'), { size: 31457280, days: 35 });
    putFile(sys, '/Users/student/Downloads/Jellyfin.Server_10.8.13.exe', BIN('Jellyfin installer'), { size: 92274688, days: 35 });
    putFile(sys, '/Users/student/Desktop/Setup installers/Firefox Setup 133.0.3.exe', BIN('Firefox Setup 133.0.3.exe'), { size: 57671680, days: 4 });
    putFile(sys, '/Users/student/Desktop/Setup installers/npp.8.6.2.Installer.x64.exe', BIN('npp.8.6.2.Installer.x64.exe'), { size: 4718592, days: 4 });
    putFile(sys, '/Users/student/Desktop/network-tool.zip', 'PK\u0003\u0004(simulated zip: readme.txt)', { size: 18432, days: 9 });
    // the capture for the Wireshark question
    const pk = [
      ['0.000000', '10.0.0.37', '10.0.0.1', 'DNS', 74, 'Standard query 0x4a1b A assets.northstar.local'],
      ['0.004113', '10.0.0.1', '10.0.0.37', 'DNS', 90, 'Standard query response 0x4a1b A assets.northstar.local A 10.0.0.12'],
      ['0.122561', '192.168.202.138', '10.0.0.37', 'TCP', 60, '4444 → 51322 [SYN] Seq=0 Win=1024 Len=0'],
      ['0.128751', '10.0.0.37', '192.168.202.138', 'TCP', 54, '51322 → 4444 [RST, ACK] Seq=1 Ack=1 Win=0 Len=0'],
      ['0.301877', '10.0.0.37', '10.0.0.12', 'HTTP', 344, 'GET /builds/meeple-quest-0.9.zip HTTP/1.1'],
      ['0.355402', '10.0.0.12', '10.0.0.37', 'HTTP', 512, 'HTTP/1.1 200 OK  (application/zip)'],
      ['0.402090', '10.0.0.37', '10.0.0.1', 'ARP', 42, 'Who has 10.0.0.1? Tell 10.0.0.37'],
    ];
    putFile(sys, '/Users/student/Desktop/capture-2026.pcapng', 'PCAPSIM1:' + b64(JSON.stringify({ linktype: 'Ethernet', packets: pk })), { size: 4096 + pk.length * 96, days: 2 });
  });

  // ------------------------------------------------------------- User Auditing (34)
  for (const [name, pw, admin, pts] of UNAUTH) {
    ctx.apply((sys) => { S.addUser(sys, { name, password: pw, groups: admin ? ['Administrators', 'Users'] : ['Users'], noTouch: true }); ctx.makeProfile(sys, name); if (name === 'raven') S.addMember(sys, 'Remote Desktop Users', name, { quiet: true }); });
    ctx.unauthorized.push(name);
    V(USER, pts, { id: `rm-${name}`, title: `Removed unauthorized user ${name}`, check: (s) => !S.getUser(s, name) });
    ctx.solve(2, `Remove-LocalUser -Name ${name}`);
  }
  card('guest', 3);
  ctx.apply((sys) => S.addMember(sys, 'Administrators', 'jbyers', { quiet: true }));
  V(USER, 3, { id: 'notadmin-jbyers', title: 'User jbyers is not an administrator', check: (s) => !!S.getUser(s, 'jbyers') && !S.isAdmin(s, 'jbyers') });
  ctx.solve(1, 'Remove-LocalGroupMember -Group Administrators -Member jbyers');
  for (const [name, weak] of [['jhopper', 'password'], ['lucas', '123456']]) {
    ctx.apply((sys) => { S.setPassword(sys, name, weak, { checkPolicy: false }); sys.misc.initialWinHashes[name] = S.getUser(sys, name).hash; });
    V(USER, 2, { id: `pw-${name}`, title: `Changed insecure password for user ${name}`, check: (s) => S.passwordIsSecure(s, name, [weak]) });
    ctx.solve(2, `Set-LocalUser -Name ${name} -Password ${secure('Gr8!Meeple#2026')}`);
  }
  for (const [name, pts] of [['rtoken', 3], ['steve', 2]]) {
    V(USER, pts, { id: `haspw-${name}`, title: `User ${name} has a password`, check: (s) => !!S.getUser(s, name)?.hash });
    ctx.solve(2, `Set-LocalUser -Name ${name} -Password ${secure('Dice!Tower#77')}`);
  }
  ctx.apply((sys) => S.setUserFlags(sys, 'mwheeler', { neverExpires: true }));
  V(USER, 2, { id: 'expire-mwheeler', title: 'User mwheeler password expires', check: (s) => !!S.getUser(s, 'mwheeler') && !S.getUser(s, 'mwheeler').neverExpires });
  ctx.solve(1, 'Set-LocalUser -Name mwheeler -PasswordNeverExpires $false');
  ctx.newHires.push('kmeeple');
  ctx.readme.notes.push('Following the studio\'s growth, a new game designer has joined. Create a standard user account named <code>kmeeple</code>, create a local group named <code>Game Designers</code>, and add <code>kmeeple</code>, <code>rtoken</code> and <code>jhopper</code> to it.');
  V(USER, 3, { id: 'new-kmeeple', title: 'Created user account kmeeple', check: (s) => { const x = S.getUser(s, 'kmeeple'); return !!x && x.enabled && !S.isAdmin(s, 'kmeeple'); } });
  V(USER, 3, { id: 'grp-designers', title: 'Game Designers group created and populated', check: (s) => { const g = S.getGroup(s, 'Game Designers'); return !!g && ['kmeeple', 'rtoken', 'jhopper'].every((m) => g.members.some((y) => lc(y) === m)); } });
  ctx.solve(3, `New-LocalUser -Name kmeeple -Password ${secure('Meeple#New2026')}`);
  ctx.solve(3, 'Add-LocalGroupMember -Group Users -Member kmeeple');
  ctx.solve(3, "New-LocalGroup -Name 'Game Designers'");
  ctx.solve(4, "Add-LocalGroupMember -Group 'Game Designers' -Member kmeeple,rtoken,jhopper");

  // ------------------------------------------------------------- Account Policy (10) and Local Policy (8)
  card('minlen', 3); card('complexity', 3); card('lockdur', 2); card('reversible', 2);
  card('so-anonsam', 2); card('so-blankpw', 2); card('so-cad', 2); card('so-smbclient', 2);

  // ------------------------------------------------------------- Defensive Countermeasures (9), OS settings (6)
  ctx.apply((sys) => { for (const p of ['Domain', 'Private', 'Public']) sys.win.firewall[p].enabled = false; });
  V('Defensive Countermeasures', 5, { id: 'firewall', title: 'Firewall protection has been enabled', check: (s) => S.firewallAllOn(s) });
  ctx.solve(1, 'Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True');
  card('defender', 4);
  card('rdpoff', 3); card('nla', 3);

  // ------------------------------------------------------------- Application Updates (6), Unwanted Software (6)
  card('ffupd', 3); card('nppupd', 3);
  const SOFT = 'Unwanted Software';
  ctx.apply((sys) => {
    S.listPrograms(sys).push({ id: 'Insecure.Nmap', name: 'Nmap 7.94', publisher: 'Nmap Project', version: '7.94', latest: '7.94', size: 41, dir: '/Program Files (x86)/Nmap', exe: 'nmap.exe', installed: '10/02/2026' });
    S.listPrograms(sys).push({ id: 'Insecure.Npcap', name: 'Npcap', publisher: 'Nmap Project', version: '1.79', latest: '1.79', size: 1, dir: '/Program Files/Npcap', exe: 'NPFInstall.exe', installed: '9/14/2026' });
    S.listPrograms(sys).push({ id: 'Jellyfin.Server', name: 'Jellyfin Server 10.8.13', publisher: 'Jellyfin Project', version: '10.8.13', latest: '10.8.13', size: 98, dir: '/Program Files/Jellyfin/Server', exe: 'jellyfin.exe', installed: '10/02/2026' });
    for (const [f, n] of [['/Program Files (x86)/Nmap/nmap.exe', 'nmap.exe'], ['/Program Files (x86)/Nmap/zenmap.exe', 'zenmap.exe'], ['/Program Files/Npcap/NPFInstall.exe', 'NPFInstall.exe'], ['/Program Files/Jellyfin/Server/jellyfin.exe', 'jellyfin.exe']]) putFile(sys, f, BIN(n), { size: 3500000, days: 35 });
    putFile(sys, '/Users/Public/Desktop/Nmap - Zenmap GUI.lnk', '[shortcut] C:\\Program Files (x86)\\Nmap\\zenmap.exe', { days: 35 });
    S.listServices(sys).push({ name: 'JellyfinServer', display: 'Jellyfin Server', desc: 'The Free Software Media System.', startType: 'Automatic', status: 'Running', exe: 'jellyfin.exe', cmdline: '"C:\\Program Files\\Jellyfin\\Server\\jellyfin.exe" --service', group: '', account: 'Local Service', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 8096 }] });
    S.spawnFor(sys, S.getService(sys, 'JellyfinServer'));
  });
  V(SOFT, 3, { id: 'sw-nmap', title: 'Removed Nmap', check: (s) => !S.listPrograms(s).some((p) => p.id === 'Insecure.Nmap') || !s.vfs.exists('/Program Files (x86)/Nmap') });
  V(SOFT, 3, { id: 'sw-jellyfin', title: 'Removed Jellyfin Server', check: (s) => !S.listPrograms(s).some((p) => p.id === 'Jellyfin.Server') || !s.vfs.exists('/Program Files/Jellyfin/Server/jellyfin.exe') });
  ctx.solve(1, 'winget uninstall --id Insecure.Nmap --silent');
  ctx.solve(1, 'Stop-Service -Name JellyfinServer -Force');
  ctx.solve(1, 'winget uninstall --id Jellyfin.Server --silent');

  // ------------------------------------------------------------- Service Auditing (3)
  ctx.readme.notServices.push('remote registry');
  ctx.apply((sys) => { const s = S.getService(sys, 'RemoteRegistry'); s.startType = 'Automatic'; s.status = 'Running'; S.spawnFor(sys, s); });
  V('Service Auditing', 3, { id: 'svc-remoteregistry', title: 'Remote Registry service has been stopped and disabled', check: (s) => S.serviceOff(s, 'RemoteRegistry') });
  ctx.solve(1, 'Stop-Service -Name RemoteRegistry -Force');
  ctx.solve(1, 'Set-Service -Name RemoteRegistry -StartupType Disabled');

  // ------------------------------------------------------------- Prohibited Files (2) and Malware (4)
  const song = '/Users/student/Desktop/theme-song.mp3';
  ctx.apply((sys) => putFile(sys, song, '(binary mp3 data)', { size: 4718592, days: 12 }));
  V('Prohibited Files', 2, { id: 'media', title: 'Removed prohibited MP3 file', check: (s) => !s.vfs.exists(song) });
  ctx.solve(1, `Remove-Item -Path ${q(S.toWin(song))}`);
  const exe = '/ProgramData/Tini/tini.exe';
  const proc = { user: 'SYSTEM', cmd: `"${S.toWin(exe)}" -l -p 4444 -e cmd.exe`, comm: 'tini.exe', stat: 'Running', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 4444 }] };
  ctx.apply((sys) => {
    putFile(sys, exe, BIN('netcat'), { size: 45272, days: 6 });
    sys.win.tasks.push({ path: '\\', name: 'TiniUpdate', author: `${sys.hostname}\\brenner`, action: `${S.toWin(exe)} -l -p 4444 -e cmd.exe`, trigger: 'At system startup', enabled: true, desc: '' });
    S.regSet(sys, S.KEYS.run, 'TiniHelper', `"${S.toWin(exe)}" -l -p 4444 -e cmd.exe`, 'REG_SZ', { noTouch: true });
    sys.win.respawn.push({ id: 'bd-tini', task: 'TiniUpdate', exe, proc });
    sys.spawn({ ...proc, respawnId: 'bd-tini' });
  });
  V('Malware', 4, { id: 'backdoor', title: 'Removed tini.exe backdoor and its persistence', check: (s) => !S.portListening(s, 4444) && !s.vfs.exists(exe) && !S.getTask(s, 'TiniUpdate') && S.regGet(s, S.KEYS.run, 'TiniHelper') == null });
  ctx.solve(1, 'Unregister-ScheduledTask -TaskName TiniUpdate -Confirm:$false');
  ctx.solve(1, `Remove-ItemProperty -Path ${q(regPS(S.KEYS.run))} -Name TiniHelper`);
  ctx.solve(1, 'Stop-Process -Name tini -Force');
  ctx.solve(1, "Remove-Item -Path 'C:\\ProgramData\\Tini' -Recurse -Force");

  // ------------------------------------------------------------- Forensics (12)
  ctx.forensic('The Event Log Readers local group has members who can read this computer\'s audit logs.\n\nList the user names of every member of the Event Log Readers group, separated by commas.\n\n(Example: alice, bob)', 'jhopper, rtoken',
    (answers) => { const got = answers.join(',').split(/[,\s]+/).map(lc).filter(Boolean).sort(); return got.join(',') === 'jhopper,rtoken'; });
  ctx.forensic('During an audit, a suspicious document was found in another authorized user\'s profile. It contains the text "blue meeple protocol".\n\nWhat is the complete Windows path of that file?\n\n(Example: C:\\Users\\alice\\Desktop\\file.txt)', S.toWin(NOTES),
    (answers) => answers.some((a) => lc(a.replace(/^"|"$/g, '').replace(/\//g, '\\')) === lc(S.toWin(NOTES))));
  ctx.fqPoints = 6;
}
