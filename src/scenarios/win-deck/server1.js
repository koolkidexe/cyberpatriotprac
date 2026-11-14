// "Server 2022 Practice Round 1": a file server for a small architecture firm. The 26 checks, their names and point
// values follow a real Windows Server competition scoring report (3 forensics at 7 points, unauthorized users,
// an SMB group and share to create, a hidden share, audit policy, SMB 1.x, application updates, TightVNC) plus the
// task types of the CyberPatriot Server 2019 training image (blank passwords, password age, firewall, automatic
// updates, FTP and SMTP services). All people, names and files are original.
import * as S from '../../win/state.js';
import { putFile } from '../../win/image.js';
import { sha256hex } from '../../core/util.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lc = (s) => String(s).toLowerCase();
const BIN = (n) => `MZ\u0090\u0000(simulated ${n})`;
const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const secure = (pw) => `(ConvertTo-SecureString ${q(pw)} -AsPlainText -Force)`;
const regPS = (k) => `HKLM:\\${S.regKey(k).slice(5)}`;

export const ORG = ['Kestrel & Pine Architects', 'a small architecture firm', 'the project teams'];
const ADMINS = [['mkestrel', 'Tr@cing!Paper88', 'Managing Partner'], ['opine', 'Bluepr1nt#Vault', 'IT Lead']];
const USERS = [['dscott', 'summer'], ['sbeaumont', 'Arch#way2026!'], ['cotter', 'L1ntel$Beam44'], ['balgrove', ''], ['hnakamura', 'C0rnice!Row71'], ['jferreira', 'Gable^End2025'], ['pwhitlock', 'Tr3llis&Vine9'], ['rmbeki', 'Par@pet#Wall3'], ['lstrand', 'Mull1on!Glass'], ['vdraper', 'Fa$cia-Board6']];
const UNAUTH = [['ttanner', 'Password1', true], ['fgianno', 'letmein', false]];
const GROUP = 'Exec SMB Users';
const MEMBERS = ['mkestrel', 'hnakamura', 'jferreira'];
const SHARE = { name: 'Executive', path: 'C:\\Shares\\Executive' };
const HIDDEN = { name: 'Private$', path: 'C:\\Users\\cotter\\Documents\\Archive' };
const JPG = '/Users/student/Desktop/site-plan.png';
const JPG_DATA = '\u0089PNG\r\n\u001a\n(simulated PNG: site plan, lot 14, revision C)';

export function people(ctx) {
  let rid = 1001;
  ctx.admins = [{ name: 'student', full: 'Student', pw: ctx.studentPw, note: 'you', rid: rid++ }, ...ADMINS.map(([name, pw, note]) => ({ name, full: '', pw, note, rid: rid++ }))];
  ctx.users = USERS.map(([name, pw]) => ({ name, full: '', pw: pw || 'Temp#Pass2026', rid: rid++, taken: true }));
  ctx.org = ORG;
  ctx.wireshark = true;
  ctx.rdpRequired = true;
  ctx.fileServer = true;
}

export function plan(ctx, card) {
  const V = (cat, pts, v) => ctx.vuln({ ...v, category: cat, pts });
  const USER = 'User Auditing';
  const OSSET = 'Uncategorized Operating System Settings';

  // ------------------------------------------------------------- base image
  ctx.apply((sys) => {
    for (const [n, pw] of USERS) if (!pw) { S.setPassword(sys, n, '', { checkPolicy: false }); sys.misc.initialWinHashes[n] = ''; }
    for (const m of ['mkestrel', 'opine']) S.addMember(sys, 'Remote Desktop Users', m, { quiet: true });
    // file shares the firm really uses
    for (const d of ['/Shares/Projects/Lot 14', '/Shares/Projects/Harbor Row', '/Shares/Templates', '/Shares/Executive']) if (!sys.vfs.exists(d)) sys.vfs.mkdir(d, { parents: true, mode: 0o777 });
    putFile(sys, '/Shares/Projects/Lot 14/elevations.dwg', '(simulated drawing)', { size: 2400000, days: 12 });
    putFile(sys, '/Shares/Projects/Harbor Row/schedule.xlsx', 'PK\u0003\u0004(simulated workbook)', { size: 48000, days: 5 });
    putFile(sys, '/Shares/Templates/title-block.dwt', '(simulated template)', { size: 310000, days: 200 });
    putFile(sys, '/Shares/Executive/partner-minutes.docx', 'PK\u0003\u0004(simulated document)', { size: 36000, days: 8 });
    sys.win.shares.push({ name: 'Projects', path: 'C:\\Shares\\Projects', desc: 'Project files' }, { name: 'Templates', path: 'C:\\Shares\\Templates', desc: 'Drawing templates' });
    // Wireshark is a required tool here, and it is out of date
    const w = S.listPrograms(sys).find((p) => p.id === 'WiresharkFoundation.Wireshark');
    if (w) { w.version = '4.0.6'; w.name = 'Wireshark 4.0.6 x64'; w.latest = '4.4.5'; }
    putFile(sys, JPG, JPG_DATA, { size: 184320, days: 6 });
    putFile(sys, '/Users/cotter/Documents/Archive/old-bids.txt', 'Bids 2019-2021 (archived)\n', { days: 300 });
    putFile(sys, '/Users/cotter/Documents/Archive/door-codes.txt', 'side door 4471\nplot room 9020\n', { days: 21 });
    putFile(sys, '/inetpub/ftproot/readme.txt', 'Upload folder for the print shop.\n', { days: 90 });
  });

  // ------------------------------------------------------------- Forensics (3 x 7)
  ctx.forensic('A folder on this server is shared over the network through a hidden share that nobody authorized.\n\nWhat is the absolute path of the folder it shares?\n\n(Example: C:\\Windows\\Temp)', HIDDEN.path,
    (answers) => answers.some((a) => lc(a.replace(/^"|"$/g, '').replace(/\//g, '\\').replace(/\\+$/, '')) === lc(HIDDEN.path)));
  ctx.forensic(`What is the SHA256 hash of the file ${S.toWin(JPG).split('\\').pop()} on your desktop?`, sha256hex(JPG_DATA).toUpperCase());
  const note = '/Users/vdraper/Documents/handover.txt';
  ctx.apply((sys) => putFile(sys, note, b64('Handover note: the plotter service account password is Vellum-58. Change it after the move.') + '\n', { days: 9 }));
  ctx.forensic(`The file ${S.toWin(note)} contains a Base64-encoded note.\n\nWhat is the plotter service account password?\n\n(Example: Toaster-12)`, 'Vellum-58');
  ctx.fqPoints = 7;

  // ------------------------------------------------------------- User Auditing (29)
  for (const [name, pw, admin] of UNAUTH) {
    ctx.apply((sys) => { S.addUser(sys, { name, password: pw, groups: admin ? ['Administrators', 'Users'] : ['Users'], noTouch: true }); ctx.makeProfile(sys, name); });
    ctx.unauthorized.push(name);
    V(USER, 3, { id: `rm-${name}`, title: `Removed unauthorized user ${name}`, check: (s) => !S.getUser(s, name) });
    ctx.solve(2, `Remove-LocalUser -Name ${name}`);
  }
  for (const name of ['sbeaumont', 'cotter']) {
    ctx.apply((sys) => S.addMember(sys, 'Administrators', name, { quiet: true }));
    V(USER, 3, { id: `notadmin-${name}`, title: `User ${name} is not an administrator`, check: (s) => !!S.getUser(s, name) && !S.isAdmin(s, name) });
    ctx.solve(1, `Remove-LocalGroupMember -Group Administrators -Member ${name}`);
  }
  ctx.apply((sys) => { S.setPassword(sys, 'dscott', 'summer', { checkPolicy: false }); sys.misc.initialWinHashes.dscott = S.getUser(sys, 'dscott').hash; });
  V(USER, 3, { id: 'pw-dscott', title: 'Changed insecure password for user dscott', check: (s) => S.passwordIsSecure(s, 'dscott', ['summer']) });
  ctx.solve(2, `Set-LocalUser -Name dscott -Password ${secure('Dr@fting#Table7')}`);
  V(USER, 3, { id: 'haspw-balgrove', title: 'User balgrove has a password', check: (s) => !!S.getUser(s, 'balgrove')?.hash });
  ctx.solve(2, `Set-LocalUser -Name balgrove -Password ${secure('R1dge!Beam#52')}`);
  ctx.readme.notes.push(`The partners need a private file share. Create a local group named <code>${GROUP}</code> and add <code>${MEMBERS.join('</code>, <code>')}</code> to it. Then share the existing folder <code>${SHARE.path}</code> over SMB with the share name <code>${SHARE.name}</code>.`);
  V(USER, 4, { id: 'grp-create', title: `Created group ${GROUP}`, check: (s) => !!S.getGroup(s, GROUP) });
  V(USER, 4, { id: 'grp-members', title: `Added users to group ${GROUP}`, check: (s) => { const g = S.getGroup(s, GROUP); return !!g && MEMBERS.every((m) => g.members.some((y) => lc(y) === m)); } });
  ctx.solve(3, `New-LocalGroup -Name ${q(GROUP)}`);
  ctx.solve(4, `Add-LocalGroupMember -Group ${q(GROUP)} -Member ${MEMBERS.join(',')}`);

  // ------------------------------------------------------------- Account Policy (9) and Local Policy (6)
  card('lockout', 3); card('maxage', 3); card('reversible', 3);
  card('so-blankpw', 3);
  ctx.apply((sys) => { sys.win.audit['Object Access'].success = false; });
  V('Local Policy', 3, { id: 'audit-file-share', title: 'Audit File Share [Success]', check: (s) => !!s.win.audit['Object Access']?.success });
  ctx.solve(1, 'auditpol /set /subcategory:"File Share" /success:enable');

  // ------------------------------------------------------------- Defensive Countermeasures (4)
  ctx.apply((sys) => { for (const p of ['Private', 'Public']) sys.win.firewall[p].enabled = false; });
  V('Defensive Countermeasures', 4, { id: 'firewall', title: 'Firewall protection has been enabled', check: (s) => S.firewallAllOn(s) });
  ctx.solve(1, 'Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True');

  // ------------------------------------------------------------- OS settings: shares and SMB (13)
  ctx.apply((sys) => sys.win.shares.push({ name: HIDDEN.name, path: HIDDEN.path, desc: '' }));
  V(OSSET, 4, { id: 'hiddenshare', title: `File sharing disabled for hidden share ${HIDDEN.name}`, check: (s) => !s.win.shares.some((x) => lc(x.name) === lc(HIDDEN.name)) });
  ctx.solve(2, `Remove-SmbShare -Name ${q(HIDDEN.name)} -Force`);
  V(OSSET, 4, { id: 'share-exec', title: `Created ${SHARE.name} SMB Share`, check: (s) => s.win.shares.some((x) => lc(x.name) === lc(SHARE.name) && lc(String(x.path).replace(/\\+$/, '')) === lc(SHARE.path)) });
  ctx.solve(4, `New-SmbShare -Name ${SHARE.name} -Path ${q(SHARE.path)}`);
  ctx.apply((sys) => { sys.win.features.SMB1Protocol.state = 'Enabled'; S.regSet(sys, S.KEYS.lanman, 'SMB1', 1, 'REG_DWORD', { noTouch: true }); });
  V(OSSET, 5, { id: 'smb1', title: 'SMB 1.x removed or disabled', check: (s) => !S.smb1On(s) });
  ctx.solve(1, 'Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart');
  ctx.solve(1, 'Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force');

  // ------------------------------------------------------------- Service Auditing (8)
  ctx.readme.notServices.push('FTP', 'e-mail (SMTP)');
  const svcs = [
    { name: 'FTPSVC', display: 'Microsoft FTP Service', title: 'FTP service has been stopped and disabled', desc: 'Enables this server to be a File Transfer Protocol (FTP) server.', port: 21 },
    { name: 'SMTPSVC', display: 'Simple Mail Transfer Protocol (SMTP)', title: 'Simple Mail Transfer Protocol (SMTP) service has been stopped and disabled', desc: 'Transports electronic mail across the network.', port: 25 },
  ];
  for (const x of svcs) {
    ctx.apply((sys) => { S.listServices(sys).push({ name: x.name, display: x.display, desc: x.desc, startType: 'Automatic', status: 'Running', exe: 'inetinfo.exe', group: '', account: 'Local System', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: x.port }] }); S.spawnFor(sys, S.getService(sys, x.name)); });
    V('Service Auditing', 4, { id: `svc-${lc(x.name)}`, title: x.title, check: (s) => S.serviceOff(s, x.name) });
    ctx.solve(1, `Stop-Service -Name ${x.name} -Force`);
    ctx.solve(1, `Set-Service -Name ${x.name} -StartupType Disabled`);
  }

  // ------------------------------------------------------------- Operating System Updates (4)
  ctx.apply((sys) => S.regSet(sys, S.KEYS.wuAU, 'NoAutoUpdate', 1, 'REG_DWORD', { noTouch: true }));
  V('Operating System Updates', 4, { id: 'autoupd', title: 'Windows automatically checks for updates', check: (s) => S.autoUpdatesOn(s) });
  ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(S.KEYS.wuAU))} -Name NoAutoUpdate -Value 0`);

  // ------------------------------------------------------------- Application Updates (6), Unwanted Software (3)
  card('nppupd', 3);
  V('Application Updates', 3, { id: 'wsupd', title: 'Wireshark has been updated', check: (s) => S.programUpToDate(s, 'WiresharkFoundation.Wireshark') });
  ctx.solve(1, 'winget upgrade --id WiresharkFoundation.Wireshark --silent');
  ctx.apply((sys) => {
    S.listPrograms(sys).push({ id: 'GlavSoft.TightVNC', name: 'TightVNC', publisher: 'GlavSoft LLC.', version: '2.8.81.0', latest: '2.8.81.0', size: 5, dir: '/Program Files/TightVNC', exe: 'tvnserver.exe', installed: '10/21/2026' });
    for (const f of ['tvnserver.exe', 'tvnviewer.exe']) putFile(sys, `/Program Files/TightVNC/${f}`, BIN(f), { size: 2100000, days: 23 });
    S.listServices(sys).push({ name: 'tvnserver', display: 'TightVNC Server', desc: 'Lets other computers view and control this desktop.', startType: 'Automatic', status: 'Running', exe: 'tvnserver.exe', cmdline: '"C:\\Program Files\\TightVNC\\tvnserver.exe" -service', group: '', account: 'Local System', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 5900 }] });
    S.spawnFor(sys, S.getService(sys, 'tvnserver'));
  });
  V('Unwanted Software', 3, { id: 'sw-tightvnc', title: 'Removed TightVNC Server', check: (s) => !S.listPrograms(s).some((p) => p.id === 'GlavSoft.TightVNC') || !s.vfs.exists('/Program Files/TightVNC/tvnserver.exe') });
  ctx.solve(1, 'Stop-Service -Name tvnserver -Force');
  ctx.solve(1, 'winget uninstall --id GlavSoft.TightVNC --silent');
}
