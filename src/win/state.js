// Windows 11 system model (DOM-free). Everything lives on sys.win and is persisted with the System snapshot, so the
// terminal (PowerShell / cmd tools), every GUI app (Computer Management, Local Security Policy, Settings, Control
// Panel, Registry Editor, ...) and the scoring engine all read and write the same state.
//
// Paths: the virtual filesystem's "/" is the C: drive. "C:\Users\student" is stored as "/Users/student".
// Windows paths are case-insensitive; resolve() maps a typed path onto the real (case-preserving) one.
import { hashPassword } from '../core/util.js';

export const W = (sys) => sys.win;
const touch = (sys, k = 'win') => sys.touch(k);
const lc = (s) => String(s ?? '').toLowerCase();

// ================================================================= paths
export function toWin(p) { return 'C:' + (p === '/' ? '\\' : String(p).replace(/\//g, '\\')); }
/** Turn a typed Windows path into a vfs path (not yet case-resolved). cwd is a vfs path. */
export function fromWin(input, cwd = '/', env = {}) {
  let s = String(input ?? '').trim().replace(/^["']|["']$/g, '');
  s = s.replace(/%([^%]+)%/g, (m, v) => env[v.toUpperCase()] ?? m).replace(/\$env:(\w+)/gi, (m, v) => env[v.toUpperCase()] ?? m);
  if (s === '~' || s.startsWith('~\\') || s.startsWith('~/')) s = (env.USERPROFILE || 'C:\\Users\\student') + s.slice(1);
  s = s.replace(/\//g, '\\');
  let abs;
  if (/^[a-z]:\\?/i.test(s)) abs = '/' + s.replace(/^[a-z]:\\?/i, '');
  else if (s.startsWith('\\')) abs = s;
  else abs = (cwd === '/' ? '' : cwd) + '/' + s;
  const parts = [];
  for (const part of abs.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return '/' + parts.join('/');
}
/** Case-insensitive lookup of a vfs path; returns the real path (or the input when it does not exist). */
export function resolve(sys, p) {
  if (sys.vfs.exists(p)) return p;
  let cur = '';
  const parts = p.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const dir = cur || '/';
    let names = [];
    try { names = sys.vfs.isDir(dir) ? sys.vfs.readdir(dir) : []; } catch { names = []; }
    const hit = names.find((n) => lc(n) === lc(parts[i]));
    if (!hit) return [cur, ...parts.slice(i)].join('/') || '/';
    cur += '/' + hit;
  }
  return cur || '/';
}

// ================================================================= accounts
export const BUILTIN_GROUPS = [
  ['Administrators', 'Administrators have complete and unrestricted access to the computer/domain', 544],
  ['Backup Operators', 'Backup Operators can override security restrictions for the sole purpose of backing up or restoring files', 551],
  ['Cryptographic Operators', 'Members are authorized to perform cryptographic operations.', 569],
  ['Device Owners', 'Members of this group can change system-wide settings.', 583],
  ['Distributed COM Users', 'Members are allowed to launch, activate and use Distributed COM objects on this machine.', 562],
  ['Event Log Readers', 'Members of this group can read event logs from local machine', 573],
  ['Guests', 'Guests have the same access as members of the Users group by default, except for the Guest account which is further restricted', 546],
  ['Hyper-V Administrators', 'Members of this group have complete and unrestricted access to all features of Hyper-V.', 578],
  ['IIS_IUSRS', 'Built-in group used by Internet Information Services.', 568],
  ['Network Configuration Operators', 'Members in this group can have some administrative privileges to manage configuration of networking features', 556],
  ['Performance Log Users', 'Members of this group may schedule logging of performance counters, enable trace providers, and collect event traces both locally and via remote access to this computer', 559],
  ['Performance Monitor Users', 'Members of this group can access performance counter data locally and remotely', 558],
  ['Power Users', 'Power Users are included for backwards compatibility and possess limited administrative powers', 547],
  ['Remote Desktop Users', 'Members in this group are granted the right to logon remotely', 555],
  ['Remote Management Users', 'Members of this group can access WMI resources over management protocols (such as WS-Management via the Windows Remote Management service).', 580],
  ['Replicator', 'Supports file replication in a domain', 552],
  ['System Managed Accounts Group', 'Members of this group are managed by the system.', 581],
  ['Users', 'Users are prevented from making accidental or intentional system-wide changes and can run most applications', 545],
];
export const MACHINE_SID = 'S-1-5-21-3290174852-1841527397-2894172208';
const salt = (sys) => sys.salt();

export const listUsers = (sys) => W(sys).users;
export const getUser = (sys, name) => W(sys).users.find((u) => lc(u.name) === lc(name)) || null;
export const listGroups = (sys) => W(sys).groups;
export const getGroup = (sys, name) => W(sys).groups.find((g) => lc(g.name) === lc(name)) || null;
export const userGroups = (sys, name) => W(sys).groups.filter((g) => g.members.some((m) => lc(m) === lc(name)));
export const isAdmin = (sys, name) => !!getGroup(sys, 'Administrators')?.members.some((m) => lc(m) === lc(name));
export const sidOf = (sys, u) => `${MACHINE_SID}-${u.rid}`;

export class WinError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

export function addUser(sys, { name, password = '', full = '', desc = '', groups = ['Users'], enabled = true, rid, neverExpires = false, noTouch } = {}) {
  if (!name || /[\\/[\]:;|=,+*?<>"@]/.test(name) || name.length > 20) throw new WinError('The user name could not be found.', 2221);
  if (getUser(sys, name)) throw new WinError('The account already exists.', 2224);
  if (getGroup(sys, name)) throw new WinError(`The account already exists.`, 2224);
  const w = W(sys);
  const u = { name, full, desc, rid: rid ?? w.nextRid++, enabled, hash: '', pwSet: sys.now(), neverExpires, mustChange: false, cannotChange: false, lastLogon: 0, locked: false };
  u.hash = password ? hashPassword(password, salt(sys)) : '';
  w.users.push(u);
  for (const g of groups) addMember(sys, g, name, { quiet: true });
  if (!noTouch) touch(sys);
  return u;
}
export function removeUser(sys, name) {
  const u = getUser(sys, name);
  if (!u) throw new WinError('The user name could not be found.', 2221);
  if (u.rid === 500 || u.rid === 501) throw new WinError('Cannot perform this operation on built-in accounts.', 2);
  const w = W(sys);
  w.users = w.users.filter((x) => x !== u);
  for (const g of w.groups) g.members = g.members.filter((m) => lc(m) !== lc(name));
  for (const k of Object.keys(w.rights)) w.rights[k] = w.rights[k].filter((m) => lc(m) !== lc(name));
  touch(sys);
}
export function renameUser(sys, name, to) {
  const u = getUser(sys, name); if (!u) throw new WinError('The user name could not be found.', 2221);
  if (getUser(sys, to)) throw new WinError('The account already exists.', 2224);
  for (const g of W(sys).groups) g.members = g.members.map((m) => (lc(m) === lc(name) ? to : m));
  u.name = to; touch(sys);
}
export function setPassword(sys, name, password, { checkPolicy = true } = {}) {
  const u = getUser(sys, name); if (!u) throw new WinError('The user name could not be found.', 2221);
  if (checkPolicy) { const err = passwordProblem(sys, u, password); if (err) throw new WinError(err, 2245); }
  u.hash = password ? hashPassword(password, salt(sys)) : '';
  u.pwSet = sys.now(); u.mustChange = false;
  u.history = [u.hash, ...(u.history || [])].slice(0, 24);
  touch(sys);
}
export function checkPassword(sys, name, password) {
  const u = getUser(sys, name);
  if (!u || !u.enabled) return false;
  if (!u.hash) return password === '';
  const s = /^\$y\$j9T\$([^$]+)\$/.exec(u.hash)?.[1];
  return hashPassword(password, s) === u.hash;
}
export function passwordProblem(sys, u, pw) {
  const p = W(sys).policy;
  const msg = 'The password does not meet the password policy requirements. Check the minimum password length, password complexity and password history requirements.';
  if (pw.length < p.minLen) return msg;
  if (p.complexity) {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (classes < 3 || (u && u.name.length > 2 && lc(pw).includes(lc(u.name)))) return msg;
  }
  if (p.history > 0 && u && (u.history || []).slice(0, p.history).some((h) => { const s = /^\$y\$j9T\$([^$]+)\$/.exec(h)?.[1]; return s && hashPassword(pw, s) === h; })) return msg;
  return null;
}
export function setUserFlags(sys, name, flags) {
  const u = getUser(sys, name); if (!u) throw new WinError('The user name could not be found.', 2221);
  Object.assign(u, flags); touch(sys);
}
export function addGroup(sys, name, desc = '') {
  if (getGroup(sys, name) || getUser(sys, name)) throw new WinError('The account already exists.', 2224);
  W(sys).groups.push({ name, desc, rid: W(sys).nextRid++, members: [] }); touch(sys);
}
export function removeGroup(sys, name) {
  const g = getGroup(sys, name); if (!g) throw new WinError('The group name could not be found.', 2220);
  if (g.rid < 1000) throw new WinError('Cannot perform this operation on built-in accounts.', 2);
  W(sys).groups = W(sys).groups.filter((x) => x !== g); touch(sys);
}
export function addMember(sys, group, member, { quiet } = {}) {
  const g = getGroup(sys, group); if (!g) throw new WinError('The specified local group does not exist.', 1376);
  const u = getUser(sys, member);
  if (!u && !/^(Everyone|Authenticated Users|INTERACTIVE|NT AUTHORITY\\.*)$/i.test(member)) throw new WinError('There is no such global user or group: ' + member + '.', 1789);
  if (g.members.some((m) => lc(m) === lc(member))) { if (quiet) return; throw new WinError('The specified account name is already a member of the group.', 1378); }
  g.members.push(u ? u.name : member);
  if (!quiet) touch(sys);
}
export function removeMember(sys, group, member) {
  const g = getGroup(sys, group); if (!g) throw new WinError('The specified local group does not exist.', 1376);
  if (!g.members.some((m) => lc(m) === lc(member))) throw new WinError('The specified account name is not a member of the group.', 1377);
  g.members = g.members.filter((m) => lc(m) !== lc(member)); touch(sys);
}
/** Is a user's current password still the weak one the scenario gave them (or another obvious one)? */
export function passwordIsSecure(sys, name, weakList = []) {
  const u = getUser(sys, name); if (!u || !u.hash) return false;
  if (sys.misc.initialWinHashes?.[lc(name)] === u.hash) return false;
  const s = /^\$y\$j9T\$([^$]+)\$/.exec(u.hash)?.[1];
  const cands = ['password', 'Password1', 'P@ssw0rd', '123456', 'qwerty', 'letmein', 'welcome', 'changeme', 'admin', name, `${name}123`, `${name}1`, `${name}!`, ...weakList];
  return !cands.some((c) => hashPassword(c, s) === u.hash);
}

// ================================================================= account / audit policy and user rights
export const POLICY_DEFAULTS = { history: 0, maxAge: 42, minAge: 0, minLen: 0, complexity: false, reversible: false, lockoutThreshold: 10, lockoutDuration: 10, lockoutWindow: 10, forceLogoff: 'Never' };
export function setPolicy(sys, patch) { Object.assign(W(sys).policy, patch); touch(sys); }
export const AUDIT_CATEGORIES = ['System', 'Logon/Logoff', 'Object Access', 'Privilege Use', 'Detailed Tracking', 'Policy Change', 'Account Management', 'DS Access', 'Account Logon'];
/** Legacy (secpol "Audit Policy") names → auditpol categories. */
export const AUDIT_LEGACY = [
  ['Audit account logon events', 'Account Logon'], ['Audit account management', 'Account Management'], ['Audit directory service access', 'DS Access'],
  ['Audit logon events', 'Logon/Logoff'], ['Audit object access', 'Object Access'], ['Audit policy change', 'Policy Change'],
  ['Audit privilege use', 'Privilege Use'], ['Audit process tracking', 'Detailed Tracking'], ['Audit system events', 'System'],
];
export const auditText = (a) => (a.success && a.failure ? 'Success and Failure' : a.success ? 'Success' : a.failure ? 'Failure' : 'No Auditing');
export function setAudit(sys, cat, { success, failure }) {
  const a = W(sys).audit[cat]; if (!a) throw new WinError(`Error 0x00000057 occurred:\nThe parameter is incorrect.`, 87);
  if (success != null) a.success = success; if (failure != null) a.failure = failure; touch(sys);
}
export const RIGHTS = [
  ['SeNetworkLogonRight', 'Access this computer from the network'], ['SeTcbPrivilege', 'Act as part of the operating system'],
  ['SeInteractiveLogonRight', 'Allow log on locally'], ['SeRemoteInteractiveLogonRight', 'Allow log on through Remote Desktop Services'],
  ['SeBackupPrivilege', 'Back up files and directories'], ['SeChangeNotifyPrivilege', 'Bypass traverse checking'], ['SeSystemtimePrivilege', 'Change the system time'],
  ['SeCreatePagefilePrivilege', 'Create a pagefile'], ['SeCreateTokenPrivilege', 'Create a token object'], ['SeDebugPrivilege', 'Debug programs'],
  ['SeDenyNetworkLogonRight', 'Deny access to this computer from the network'], ['SeDenyInteractiveLogonRight', 'Deny log on locally'],
  ['SeDenyRemoteInteractiveLogonRight', 'Deny log on through Remote Desktop Services'], ['SeRemoteShutdownPrivilege', 'Force shutdown from a remote system'],
  ['SeLoadDriverPrivilege', 'Load and unload device drivers'], ['SeSecurityPrivilege', 'Manage auditing and security log'], ['SeRestorePrivilege', 'Restore files and directories'],
  ['SeShutdownPrivilege', 'Shut down the system'], ['SeTakeOwnershipPrivilege', 'Take ownership of files or other objects'],
];
export const RIGHT_NAME = Object.fromEntries(RIGHTS);
export function setRight(sys, priv, members) { W(sys).rights[priv] = [...members]; touch(sys); }

// ================================================================= registry
const HIVE = { hkey_local_machine: 'HKLM', hklm: 'HKLM', 'hklm:': 'HKLM', hkey_current_user: 'HKCU', hkcu: 'HKCU', 'hkcu:': 'HKCU', hkey_users: 'HKU', hku: 'HKU', hkey_classes_root: 'HKCR', hkcr: 'HKCR', hkey_current_config: 'HKCC', hkcc: 'HKCC' };
export const HIVE_LONG = { HKLM: 'HKEY_LOCAL_MACHINE', HKCU: 'HKEY_CURRENT_USER', HKU: 'HKEY_USERS', HKCR: 'HKEY_CLASSES_ROOT', HKCC: 'HKEY_CURRENT_CONFIG' };
/** Normalise "HKEY_LOCAL_MACHINE\x", "HKLM:\x", "Registry::HKLM\x" → "HKLM\x" (null if not a registry path). */
export function regKey(path) {
  let s = String(path).trim().replace(/^["']|["']$/g, '').replace(/^Registry::/i, '').replace(/\//g, '\\').replace(/\\+$/, '');
  const m = /^([^\\]+)(\\.*)?$/.exec(s);
  if (!m) return null;
  const h = HIVE[lc(m[1])];
  if (!h) return null;
  return h + (m[2] || '').replace(/\\+/g, '\\');
}
const R = (sys) => W(sys).reg;
export function regFind(sys, key) { const k = regKey(key); return k ? R(sys)[lc(k)] || null : null; }
export function regEnsure(sys, key) {
  const k = regKey(key); if (!k) throw new WinError('ERROR: Invalid key name.', 1);
  const parts = k.split('\\');
  let node = null;
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('\\');
    if (!R(sys)[lc(sub)]) R(sys)[lc(sub)] = { path: sub, values: {} };
    node = R(sys)[lc(sub)];
  }
  return node;
}
export function regGet(sys, key, name) {
  const n = regFind(sys, key); if (!n) return undefined;
  const hit = Object.keys(n.values).find((v) => lc(v) === lc(name));
  return hit ? n.values[hit].data : undefined;
}
export function regSet(sys, key, name, data, type = 'REG_DWORD', { noTouch } = {}) {
  const n = regEnsure(sys, key);
  const hit = Object.keys(n.values).find((v) => lc(v) === lc(name));
  if (hit && hit !== name) delete n.values[hit];
  n.values[name] = { type, data: type === 'REG_DWORD' || type === 'REG_QWORD' ? Number(data) : data };
  if (!noTouch) touch(sys);
}
export function regDeleteValue(sys, key, name) {
  const n = regFind(sys, key); if (!n) throw new WinError('ERROR: The system was unable to find the specified registry key or value.', 1);
  const hit = Object.keys(n.values).find((v) => lc(v) === lc(name));
  if (!hit) throw new WinError('ERROR: The system was unable to find the specified registry key or value.', 1);
  delete n.values[hit]; touch(sys);
}
export function regDeleteKey(sys, key) {
  const k = regKey(key); if (!k || !regFind(sys, k)) throw new WinError('ERROR: The system was unable to find the specified registry key or value.', 1);
  for (const kk of Object.keys(R(sys))) if (kk === lc(k) || kk.startsWith(lc(k) + '\\')) delete R(sys)[kk];
  touch(sys);
}
export function regSubkeys(sys, key) {
  const k = lc(regKey(key)); const out = new Set();
  for (const n of Object.values(R(sys))) { const l = lc(n.path); if (l.startsWith(k + '\\')) out.add(n.path.slice(k.length + 1).split('\\')[0]); }
  return [...out].sort((a, b) => a.localeCompare(b));
}
export const KEYS = {
  lsa: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa',
  sysPol: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
  explorerPol: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
  ts: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server',
  rdpTcp: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp',
  lanman: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
  wuAU: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU',
  defenderRtp: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
  run: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  runUser: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  winlogon: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon',
  smartscreen: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer',
  lanmanWks: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters',
  tsPolicy: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services',
  winrmService: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WinRM\\Service',
  winrmClient: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WinRM\\Client',
  installer: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer',
};
/** Local Security Policy → Security Options, each backed by a registry value (like the real thing). */
export const SECOPTS = [
  { id: 'adminStatus', name: 'Accounts: Administrator account status', kind: 'account', rid: 500 },
  { id: 'guestStatus', name: 'Accounts: Guest account status', kind: 'account', rid: 501 },
  { id: 'blankPw', name: 'Accounts: Limit local account use of blank passwords to console logon only', key: KEYS.lsa, value: 'LimitBlankPasswordUse', on: 1, off: 0, dflt: 1 },
  { id: 'renameAdmin', name: 'Accounts: Rename administrator account', kind: 'rename', rid: 500 },
  { id: 'renameGuest', name: 'Accounts: Rename guest account', kind: 'rename', rid: 501 },
  { id: 'auditForce', name: 'Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings', key: KEYS.lsa, value: 'SCENoApplyLegacyAuditPolicy', on: 1, off: 0, dflt: 0 },
  { id: 'noCAD', name: 'Interactive logon: Do not require CTRL+ALT+DEL', key: KEYS.sysPol, value: 'DisableCAD', on: 1, off: 0, dflt: 1 },
  { id: 'netClientSign', name: 'Microsoft network client: Digitally sign communications (always)', key: KEYS.lanmanWks, value: 'RequireSecuritySignature', on: 1, off: 0, dflt: 0 },
  { id: 'netClientPlain', name: 'Microsoft network client: Send unencrypted password to third-party SMB servers', key: KEYS.lanmanWks, value: 'EnablePlainTextPassword', on: 1, off: 0, dflt: 0 },
  { id: 'netServerSign', name: 'Microsoft network server: Digitally sign communications (always)', key: KEYS.lanman, value: 'RequireSecuritySignature', on: 1, off: 0, dflt: 0 },
  { id: 'lastUser', name: 'Interactive logon: Don\'t display last signed-in', key: KEYS.sysPol, value: 'DontDisplayLastUserName', on: 1, off: 0, dflt: 0 },
  { id: 'anonSAM', name: 'Network access: Do not allow anonymous enumeration of SAM accounts', key: KEYS.lsa, value: 'RestrictAnonymousSAM', on: 1, off: 0, dflt: 1 },
  { id: 'anonShares', name: 'Network access: Do not allow anonymous enumeration of SAM accounts and shares', key: KEYS.lsa, value: 'RestrictAnonymous', on: 1, off: 0, dflt: 0 },
  { id: 'everyoneAnon', name: 'Network access: Let Everyone permissions apply to anonymous users', key: KEYS.lsa, value: 'EveryoneIncludesAnonymous', on: 1, off: 0, dflt: 0 },
  { id: 'lmHash', name: 'Network security: Do not store LAN Manager hash value on next password change', key: KEYS.lsa, value: 'NoLMHash', on: 1, off: 0, dflt: 1 },
  { id: 'shutdownNoLogon', name: 'Shutdown: Allow system to be shut down without having to log on', key: KEYS.sysPol, value: 'ShutdownWithoutLogon', on: 1, off: 0, dflt: 1 },
  { id: 'uacAdminMode', name: 'User Account Control: Admin Approval Mode for the Built-in Administrator account', key: KEYS.sysPol, value: 'FilterAdministratorToken', on: 1, off: 0, dflt: 0 },
  { id: 'uacLua', name: 'User Account Control: Run all administrators in Admin Approval Mode', key: KEYS.sysPol, value: 'EnableLUA', on: 1, off: 0, dflt: 1 },
  { id: 'uacSecureDesktop', name: 'User Account Control: Switch to the secure desktop when prompting for elevation', key: KEYS.sysPol, value: 'PromptOnSecureDesktop', on: 1, off: 0, dflt: 1 },
  { id: 'uacPrompt', name: 'User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode', key: KEYS.sysPol, value: 'ConsentPromptBehaviorAdmin', choices: [[0, 'Elevate without prompting'], [1, 'Prompt for credentials on the secure desktop'], [2, 'Prompt for consent on the secure desktop'], [3, 'Prompt for credentials'], [4, 'Prompt for consent'], [5, 'Prompt for consent for non-Windows binaries']], dflt: 5 },
];
export function secoptValue(sys, o) {
  if (o.kind === 'account') { const u = W(sys).users.find((x) => x.rid === o.rid); return u?.enabled ? 'Enabled' : 'Disabled'; }
  if (o.kind === 'rename') return W(sys).users.find((x) => x.rid === o.rid)?.name || '';
  const v = regGet(sys, o.key, o.value) ?? o.dflt;
  if (o.choices) return o.choices.find((c) => c[0] === Number(v))?.[1] || String(v);
  return Number(v) === o.on ? 'Enabled' : 'Disabled';
}
export function setSecopt(sys, o, val) {
  if (o.kind === 'account') { const u = W(sys).users.find((x) => x.rid === o.rid); if (u) { u.enabled = val === 'Enabled'; touch(sys); } return; }
  if (o.kind === 'rename') { const u = W(sys).users.find((x) => x.rid === o.rid); if (u && val && val !== u.name) renameUser(sys, u.name, val); return; }
  if (o.choices) { const c = o.choices.find((x) => x[1] === val || x[0] === Number(val)); regSet(sys, o.key, o.value, c ? c[0] : Number(val)); return; }
  regSet(sys, o.key, o.value, val === 'Enabled' ? o.on : o.off);
}
export const secopt = (sys, id) => { const o = SECOPTS.find((x) => x.id === id); return secoptValue(sys, o); };

// ================================================================= services
export const listServices = (sys) => W(sys).services;
export const getService = (sys, name) => W(sys).services.find((s) => lc(s.name) === lc(name) || lc(s.display) === lc(name)) || null;
export function startService(sys, name) {
  const s = getService(sys, name); if (!s) throw new WinError('The specified service does not exist as an installed service.', 1060);
  if (s.startType === 'Disabled') throw new WinError(`The service cannot be started, either because it is disabled or because it has no enabled devices associated with it.`, 1058);
  if (s.status === 'Running') return;
  s.status = 'Running';
  spawnFor(sys, s);
  touch(sys);
}
export function stopService(sys, name) {
  const s = getService(sys, name); if (!s) throw new WinError('The specified service does not exist as an installed service.', 1060);
  if (s.status !== 'Running') return;
  if (s.critical) throw new WinError('The requested control is not valid for this service.', 1052);
  s.status = 'Stopped';
  for (const p of sys.processes.filter((q) => q.svc === `win:${s.name}`)) sys.killProc(p.pid);
  touch(sys);
}
export function setStartType(sys, name, type) {
  const s = getService(sys, name); if (!s) throw new WinError('The specified service does not exist as an installed service.', 1060);
  const map = { auto: 'Automatic', automatic: 'Automatic', 'delayed-auto': 'Automatic (Delayed Start)', automaticdelayedstart: 'Automatic (Delayed Start)', demand: 'Manual', manual: 'Manual', disabled: 'Disabled' };
  const t = map[lc(type).replace(/[\s()]/g, '')] || map[lc(type)] || type;
  if (!['Automatic', 'Automatic (Delayed Start)', 'Manual', 'Disabled'].includes(t)) throw new WinError('The parameter is incorrect.', 87);
  s.startType = t; touch(sys);
}
export function spawnFor(sys, s) {
  if (sys.processes.some((p) => p.svc === `win:${s.name}`)) return;
  const exe = s.exe || 'svchost.exe';
  sys.spawn({ user: s.account || 'SYSTEM', cmd: s.cmdline || `C:\\Windows\\System32\\${exe} -k ${s.group || 'netsvcs'} -p -s ${s.name}`, comm: exe, svc: `win:${s.name}`, listen: s.listen || [], stat: 'Running' });
}
export const serviceOff = (sys, name) => { const s = getService(sys, name); return !s || (s.status !== 'Running' && s.startType === 'Disabled'); };
export const serviceOn = (sys, name) => { const s = getService(sys, name); return !!s && s.status === 'Running' && s.startType !== 'Disabled'; };

// ================================================================= firewall, defender, remote desktop, features
export function setFirewall(sys, profiles, enabled) {
  for (const p of profiles) { const k = Object.keys(W(sys).firewall).find((x) => lc(x) === lc(p)); if (!k) throw new WinError('The parameter is incorrect.', 87); W(sys).firewall[k].enabled = enabled; }
  touch(sys);
}
export const firewallAllOn = (sys) => Object.values(W(sys).firewall).every((p) => p.enabled);
export function realtimeOn(sys) {
  if (Number(regGet(sys, KEYS.defenderRtp, 'DisableRealtimeMonitoring') ?? 0) === 1) return false;
  return !!W(sys).defender.realtime;
}
export const realtimeManaged = (sys) => Number(regGet(sys, KEYS.defenderRtp, 'DisableRealtimeMonitoring') ?? 0) === 1;
export function setDefender(sys, patch) { Object.assign(W(sys).defender, patch); touch(sys); }
/** Group Policy (HKLM\\SOFTWARE\\Policies) wins over the local setting, like on real Windows. */
export const rdpEnabled = (sys) => Number(regGet(sys, KEYS.tsPolicy, 'fDenyTSConnections') ?? regGet(sys, KEYS.ts, 'fDenyTSConnections') ?? 1) === 0;
export const rdpPolicyManaged = (sys) => regGet(sys, KEYS.tsPolicy, 'fDenyTSConnections') != null;
export const nlaRequired = (sys) => Number(regGet(sys, KEYS.tsPolicy, 'UserAuthentication') ?? regGet(sys, KEYS.rdpTcp, 'UserAuthentication') ?? 1) === 1;
export const winrmUnencryptedAllowed = (sys) => Number(regGet(sys, KEYS.winrmService, 'AllowUnencryptedTraffic') ?? 0) === 1;
export function featureState(sys, name) { const k = Object.keys(W(sys).features).find((f) => lc(f) === lc(name)); return k ? { name: k, ...W(sys).features[k] } : null; }
export function setFeature(sys, name, enabled) {
  const f = featureState(sys, name); if (!f) throw new WinError(`Feature name ${name} is unknown.`, 0x800f080c);
  W(sys).features[f.name].state = enabled ? 'Enabled' : 'Disabled';
  if (lc(f.name) === 'smb1protocol') regSet(sys, KEYS.lanman, 'SMB1', enabled ? 1 : 0, 'REG_DWORD', { noTouch: true });
  touch(sys);
}
export const smb1On = (sys) => featureState(sys, 'SMB1Protocol')?.state === 'Enabled' || Number(regGet(sys, KEYS.lanman, 'SMB1') ?? 0) === 1;
export const autoUpdatesOn = (sys) => Number(regGet(sys, KEYS.wuAU, 'NoAutoUpdate') ?? 0) === 0;

// ================================================================= programs, updates
export const listPrograms = (sys) => W(sys).programs;
export function findProgram(sys, q) {
  const s = lc(q).replace(/^"|"$/g, '');
  return W(sys).programs.find((p) => lc(p.id) === s || lc(p.name) === s) || W(sys).programs.find((p) => lc(p.name).includes(s) || lc(p.id).includes(s)) || null;
}
export function uninstallProgram(sys, q) {
  const p = typeof q === 'object' ? q : findProgram(sys, q);
  if (!p) throw new WinError('No installed package found matching input criteria.', 0x8a150014);
  if (p.system) throw new WinError('This app is part of Windows and cannot be uninstalled.', 1);
  W(sys).programs = W(sys).programs.filter((x) => x !== p);
  if (p.dir) { const d = resolve(sys, p.dir); try { if (sys.vfs.exists(d)) sys.vfs.rmrf(d); } catch { /* ignore */ } }
  for (const n of ['/Users/Public/Desktop', '/Users/student/Desktop']) { const f = `${n}/${p.name}.lnk`; if (sys.vfs.exists(f)) sys.vfs.unlink(f); }
  for (const pr of sys.processes.filter((x) => p.exe && lc(x.comm) === lc(p.exe))) sys.killProc(pr.pid);
  W(sys).services = W(sys).services.filter((s) => s.program !== p.id);
  touch(sys);
  return p;
}
export function upgradeProgram(sys, q) {
  const p = typeof q === 'object' ? q : findProgram(sys, q);
  if (!p) throw new WinError('No installed package found matching input criteria.', 0x8a150014);
  if (!p.latest || p.latest === p.version) return false;
  p.version = p.latest; p.restart = true; touch(sys); return true;
}
export const programUpToDate = (sys, id) => { const p = W(sys).programs.find((x) => x.id === id); return !!p && (!p.latest || p.latest === p.version); };
/** Updated and the PC has been restarted since (updates only score after a restart). */
export const programUpdated = (sys, id) => programUpToDate(sys, id) && !W(sys).programs.find((x) => x.id === id).restart;
export const updatesApplied = (sys) => !W(sys).updates.some((u) => u.security && (!u.installed || u.restart));
/** What is waiting for a restart: installed Windows updates and upgraded programs. */
export const restartPending = (sys) => [...W(sys).updates.filter((u) => u.installed && u.restart).map((u) => u.title || u.kb), ...W(sys).programs.filter((p) => p.restart).map((p) => p.name)];
/** Restart the PC: automatic services come back, stopped ones stay down, pending updates finish installing. */
export function reboot(sys) {
  for (const s of listServices(sys)) {
    for (const p of sys.processes.filter((x) => x.svc === `win:${s.name}`)) sys.killProc(p.pid);
    if (/^Automatic/.test(s.startType)) { s.status = 'Running'; spawnFor(sys, s); } else if (s.status === 'Running' && s.startType === 'Disabled') s.status = 'Stopped'; else if (s.status === 'Running') spawnFor(sys, s);
  }
  for (const u of W(sys).updates) delete u.restart;
  for (const p of W(sys).programs) delete p.restart;
  tick(sys);
  touch(sys);
}
export const pendingUpdates = (sys) => W(sys).updates.filter((u) => !u.installed);
export function installUpdates(sys, which = null) {
  for (const u of W(sys).updates) if (!u.installed && (!which || which.includes(u.kb))) { u.installed = true; u.installedOn = sys.now(); if (u.security) u.restart = true; }
  touch(sys);
}

// ================================================================= shares, tasks
export const listShares = (sys) => W(sys).shares;
export function addShare(sys, name, path, desc = '') { if (W(sys).shares.some((s) => lc(s.name) === lc(name))) throw new WinError('The share name entered may not be in use already.', 2118); W(sys).shares.push({ name, path, desc }); touch(sys); }
export function removeShare(sys, name) {
  const s = W(sys).shares.find((x) => lc(x.name) === lc(name)); if (!s) throw new WinError('This shared resource does not exist.', 2310);
  W(sys).shares = W(sys).shares.filter((x) => x !== s); touch(sys);
}
export const listTasks = (sys) => W(sys).tasks;
export const getTask = (sys, name) => W(sys).tasks.find((t) => lc(t.name) === lc(String(name).replace(/^\\+/, '').split('\\').pop()) || lc(t.path + t.name) === lc(name)) || null;
export function removeTask(sys, name) { const t = getTask(sys, name); if (!t) throw new WinError('ERROR: The system cannot find the file specified.', 2); W(sys).tasks = W(sys).tasks.filter((x) => x !== t); touch(sys); }
export function setTaskEnabled(sys, name, en) { const t = getTask(sys, name); if (!t) throw new WinError('ERROR: The system cannot find the file specified.', 2); t.enabled = en; touch(sys); }

/** Background behaviour: backdoors come back while whatever starts them (a scheduled task or a Run key) still exists. */
export function tick(sys) {
  let changed = false;
  for (const r of W(sys).respawn || []) {
    const alive = sys.processes.some((p) => p.respawnId === r.id);
    if (alive) continue;
    const t = r.task && getTask(sys, r.task);
    const runVal = r.runKey && !(W(sys).startupDisabled || []).includes(r.runKey) ? regGet(sys, KEYS.run, r.runKey) : undefined;
    const exeThere = !r.exe || sys.vfs.exists(resolve(sys, r.exe));
    if (((t && t.enabled) || runVal != null) && exeThere) { sys.spawn({ ...r.proc, respawnId: r.id }); changed = true; }
  }
  return changed;
}
export const portListening = (sys, port) => sys.sockets().some((s) => s.port === port);

// ================================================================= Group Policy: Administrative Templates
// Each policy is a registry value under HKLM\SOFTWARE\Policies (or a system key). "Not Configured" = value absent.
const GP = (path, name, key, value, en, dis, help) => ({ id: `${path.join('/')}/${name}`, path, name, key, value, en, dis, help });
export const GPOS = [
  GP(['Windows Components', 'Remote Desktop Services', 'Remote Desktop Session Host', 'Connections'], 'Allow users to connect remotely by using Remote Desktop Services', KEYS.tsPolicy, 'fDenyTSConnections', 0, 1, 'This policy setting allows you to configure remote access to computers by using Remote Desktop Services. If you disable this policy setting, users cannot connect remotely to the target computers by using Remote Desktop Services.'),
  GP(['Windows Components', 'Remote Desktop Services', 'Remote Desktop Session Host', 'Security'], 'Require user authentication for remote connections by using Network Level Authentication', KEYS.tsPolicy, 'UserAuthentication', 1, 0, 'This policy setting allows you to specify whether to require user authentication for remote connections to the RD Session Host server by using Network Level Authentication.'),
  GP(['Windows Components', 'Remote Desktop Services', 'Remote Desktop Session Host', 'Security'], 'Always prompt for password upon connection', KEYS.tsPolicy, 'fPromptForPassword', 1, 0, 'This policy setting specifies whether Remote Desktop Services always prompts the client for a password upon connection.'),
  GP(['Windows Components', 'Windows Remote Management (WinRM)', 'WinRM Service'], 'Allow unencrypted traffic', KEYS.winrmService, 'AllowUnencryptedTraffic', 1, 0, 'This policy setting allows you to manage whether the Windows Remote Management (WinRM) service sends and receives unencrypted messages over the network. If you disable this policy setting, the WinRM service does not send or receive unencrypted messages.'),
  GP(['Windows Components', 'Windows Remote Management (WinRM)', 'WinRM Service'], 'Allow Basic authentication', KEYS.winrmService, 'AllowBasic', 1, 0, 'This policy setting allows you to manage whether the WinRM service accepts Basic authentication from a remote client.'),
  GP(['Windows Components', 'Windows Remote Management (WinRM)', 'WinRM Client'], 'Allow unencrypted traffic', KEYS.winrmClient, 'AllowUnencryptedTraffic', 1, 0, 'This policy setting allows you to manage whether the WinRM client sends and receives unencrypted messages over the network.'),
  GP(['Windows Components', 'Windows Update', 'Manage end user experience'], 'Configure Automatic Updates', KEYS.wuAU, 'NoAutoUpdate', 0, 1, 'Specifies whether this computer will receive security updates and other important downloads through the Windows automatic updating service.'),
  GP(['Windows Components', 'Microsoft Defender Antivirus', 'Real-time Protection'], 'Turn off real-time protection', KEYS.defenderRtp, 'DisableRealtimeMonitoring', 1, 0, 'This policy setting turns off real-time protection prompts for known malware detection. If you enable this policy setting, Microsoft Defender Antivirus will not prompt users to take actions on malware detections.'),
  GP(['Windows Components', 'AutoPlay Policies'], 'Turn off Autoplay', KEYS.explorerPol, 'NoDriveTypeAutoRun', 255, 145, 'This policy setting allows you to turn off the Autoplay feature. If you enable this policy setting, Autoplay is disabled on all drives.'),
  GP(['Windows Components', 'Windows Installer'], 'Always install with elevated privileges', KEYS.installer, 'AlwaysInstallElevated', 1, 0, 'This policy setting directs Windows Installer to use elevated permissions when it installs any program on the system. Enabling it is a serious security risk.'),
  GP(['Windows Components', 'Windows PowerShell'], 'Turn on PowerShell Script Block Logging', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging', 'EnableScriptBlockLogging', 1, 0, 'This policy setting enables logging of all PowerShell script input to the Microsoft-Windows-PowerShell/Operational event log.'),
  GP(['Windows Components', 'File Explorer'], 'Configure Windows Defender SmartScreen', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableSmartScreen', 1, 0, 'This policy allows you to turn Windows Defender SmartScreen on or off.'),
  GP(['Network', 'Lanman Workstation'], 'Enable insecure guest logons', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\LanmanWorkstation', 'AllowInsecureGuestAuth', 1, 0, 'This policy setting determines if the SMB client will allow insecure guest logons to an SMB server.'),
  GP(['System', 'Logon'], 'Do not display network selection UI', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'DontDisplayNetworkSelectionUI', 1, 0, 'This policy setting allows you to control whether anyone can interact with available networks UI on the logon screen.'),
];
export function gpoState(sys, g) {
  const v = regGet(sys, g.key, g.value);
  if (v == null) return 'Not configured';
  return Number(v) === g.en ? 'Enabled' : Number(v) === g.dis ? 'Disabled' : 'Enabled';
}
export function setGpo(sys, g, state) {
  if (state === 'Not configured') { try { regDeleteValue(sys, g.key, g.value); } catch { /* already absent */ } return; }
  regSet(sys, g.key, g.value, state === 'Enabled' ? g.en : g.dis);
}
