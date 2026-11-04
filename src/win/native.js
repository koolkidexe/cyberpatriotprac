// Windows command-line programs (net, sc, reg, netsh, auditpol, secedit, schtasks, wmic, winget, certutil, netstat,
// tasklist, taskkill, ipconfig, whoami, systeminfo, ...). Used from both cmd.exe and PowerShell. Each takes
// (ctx, argv) and returns an exit code; output goes through ctx.out / ctx.err. Text formats follow the real tools.
import * as S from './state.js';
import { WIN_VERSION } from './image.js';
import { sha256hex, md5ish } from '../core/util.js';

const lc = (s) => String(s ?? '').toLowerCase();
const pad = (s, n) => String(s ?? '').padEnd(n);
const fmtDate = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };
const ACCESS = 'System error 5 has occurred.\n\nAccess is denied.\n';
function admin(ctx) { if (!ctx.elevated) { ctx.err(ACCESS); return false; } return true; }
function wrap(ctx, fn) {
  try { return fn(); } catch (e) {
    if (e instanceof S.WinError) { ctx.err(/^ERROR|^The|^No |^This|^Cannot|^There/.test(e.message) ? e.message + '\n' : `System error ${e.code} has occurred.\n\n${e.message}\n`); return 2; }
    throw e;
  }
}
const sw = (argv, name) => argv.some((a) => lc(a) === lc(name));
const opt = (argv, name) => { const a = argv.find((x) => lc(x).startsWith(lc(name) + ':') || lc(x).startsWith(lc(name) + '=')); return a ? a.slice(name.length + 1).replace(/^"|"$/g, '') : undefined; };

// ============================================================================ net
function netUser(ctx, argv) {
  const sys = ctx.sys;
  const pos = argv.filter((a) => !a.startsWith('/'));
  if (!pos.length) {
    const names = S.listUsers(sys).map((u) => u.name);
    let t = `\nUser accounts for \\\\${sys.hostname}\n\n-------------------------------------------------------------------------------\n`;
    for (let i = 0; i < names.length; i += 3) t += names.slice(i, i + 3).map((n) => pad(n, 25)).join('').trimEnd() + '\n';
    ctx.out(t + 'The command completed successfully.\n\n');
    return 0;
  }
  const [name, pw] = pos;
  const flags = argv.filter((a) => a.startsWith('/'));
  if (!flags.length && pw === undefined) {
    const u = S.getUser(sys, name);
    if (!u) { ctx.err('The user name could not be found.\n\nMore help is available by typing NET HELPMSG 2221.\n\n'); return 2; }
    const p = sys.win.policy;
    const gs = S.userGroups(sys, u.name).map((g) => `*${g.name}`);
    const exp = u.neverExpires || p.maxAge === 0 ? 'Never' : fmtDate(u.pwSet + p.maxAge * 86400000);
    ctx.out(`User name                    ${u.name}\nFull Name                    ${u.full}\nComment                      ${u.desc}\nUser's comment\nCountry/region code          000 (System Default)\nAccount active               ${u.enabled ? 'Yes' : 'No'}\nAccount expires              Never\n\nPassword last set            ${u.mustChange ? 'Never' : fmtDate(u.pwSet)}\nPassword expires             ${u.mustChange ? 'Never' : exp}\nPassword changeable          ${fmtDate(u.pwSet + p.minAge * 86400000)}\nPassword required            ${u.hash ? 'Yes' : 'No'}\nUser may change password     ${u.cannotChange ? 'No' : 'Yes'}\n\nWorkstations allowed         All\nLogon script\nUser profile\nHome directory\nLast logon                   ${u.lastLogon ? fmtDate(u.lastLogon) : 'Never'}\n\nLogon hours allowed          All\n\nLocal Group Memberships      ${gs.slice(0, 2).map((g) => pad(g, 21)).join('').trimEnd()}\n${gs.slice(2).map((g) => '                             ' + g).join('\n')}${gs.length > 2 ? '\n' : ''}Global Group memberships     *None\nThe command completed successfully.\n\n`);
    return 0;
  }
  if (!admin(ctx)) return 2;
  return wrap(ctx, () => {
    if (sw(flags, '/delete')) { S.removeUser(sys, name); }
    else {
      let u = S.getUser(sys, name);
      if (sw(flags, '/add')) { S.addUser(sys, { name, password: '', full: opt(flags, '/fullname') || '', desc: opt(flags, '/comment') || '' }); u = S.getUser(sys, name); if (pw !== undefined && pw !== '*') S.setPassword(sys, name, pw); }
      else if (!u) throw new S.WinError('The user name could not be found.', 2221);
      else if (pw !== undefined && pw !== '*') S.setPassword(sys, name, pw);
      const act = opt(flags, '/active'); if (act) S.setUserFlags(sys, name, { enabled: lc(act) === 'yes' });
      const lpc = opt(flags, '/logonpasswordchg'); if (lpc) S.setUserFlags(sys, name, { mustChange: lc(lpc) === 'yes' });
      const pch = opt(flags, '/passwordchg'); if (pch) S.setUserFlags(sys, name, { cannotChange: lc(pch) === 'no' });
      const preq = opt(flags, '/passwordreq'); void preq;
      const exp = opt(flags, '/expires'); void exp;
      const fn = opt(flags, '/fullname'); if (fn != null && !sw(flags, '/add')) S.setUserFlags(sys, name, { full: fn });
      const cm = opt(flags, '/comment'); if (cm != null && !sw(flags, '/add')) S.setUserFlags(sys, name, { desc: cm });
    }
    ctx.out('The command completed successfully.\n\n');
    return 0;
  });
}
function netLocalgroup(ctx, argv) {
  const sys = ctx.sys;
  const pos = argv.filter((a) => !a.startsWith('/'));
  const flags = argv.filter((a) => a.startsWith('/'));
  if (!pos.length) {
    ctx.out(`\nAliases for \\\\${sys.hostname}\n\n-------------------------------------------------------------------------------\n${S.listGroups(sys).map((g) => `*${g.name}`).join('\n')}\nThe command completed successfully.\n\n`);
    return 0;
  }
  const [group, ...members] = pos;
  if (!flags.length) {
    const g = S.getGroup(sys, group);
    if (!g) { ctx.err('The specified local group does not exist.\n\nMore help is available by typing NET HELPMSG 3780.\n\n'); return 2; }
    ctx.out(`Alias name     ${g.name}\nComment        ${g.desc}\n\nMembers\n\n-------------------------------------------------------------------------------\n${g.members.join('\n')}${g.members.length ? '\n' : ''}The command completed successfully.\n\n`);
    return 0;
  }
  if (!admin(ctx)) return 2;
  return wrap(ctx, () => {
    if (sw(flags, '/add') && !members.length) S.addGroup(sys, group, opt(flags, '/comment') || '');
    else if (sw(flags, '/delete') && !members.length) S.removeGroup(sys, group);
    else for (const m of members) { const mm = m.replace(/^.*\\/, ''); if (sw(flags, '/add')) S.addMember(sys, group, mm); else S.removeMember(sys, group, mm); }
    ctx.out('The command completed successfully.\n\n');
    return 0;
  });
}
function netAccounts(ctx, argv) {
  const sys = ctx.sys; const p = sys.win.policy;
  if (!argv.length) {
    ctx.out(`Force user logoff how long after time expires?:       ${p.forceLogoff}\nMinimum password age (days):                          ${p.minAge}\nMaximum password age (days):                          ${p.maxAge === 0 ? 'Unlimited' : p.maxAge}\nMinimum password length:                              ${p.minLen}\nLength of password history maintained:                ${p.history || 'None'}\nLockout threshold:                                    ${p.lockoutThreshold || 'Never'}\nLockout duration (minutes):                           ${p.lockoutDuration}\nLockout observation window (minutes):                 ${p.lockoutWindow}\nComputer role:                                        WORKSTATION\nThe command completed successfully.\n\n`);
    return 0;
  }
  if (!admin(ctx)) return 2;
  const patch = {};
  const num = (k, field, max) => { const v = opt(argv, k); if (v === undefined) return true; const n = lc(v) === 'unlimited' || lc(v) === 'never' ? 0 : Number(v); if (!Number.isInteger(n) || n < 0 || n > max) { ctx.err(`The syntax of this command is:\n\nNET ACCOUNTS\n[/FORCELOGOFF:{minutes | NO}] [/MINPWLEN:length]\n              [/MAXPWAGE:{days | UNLIMITED}] [/MINPWAGE:days]\n              [/UNIQUEPW:number] [/DOMAIN]\n\n`); return false; } patch[field] = n; return true; };
  if (![num('/minpwlen', 'minLen', 14), num('/maxpwage', 'maxAge', 999), num('/minpwage', 'minAge', 998), num('/uniquepw', 'history', 24), num('/lockoutthreshold', 'lockoutThreshold', 999), num('/lockoutduration', 'lockoutDuration', 99999), num('/lockoutwindow', 'lockoutWindow', 99999)].every(Boolean)) return 1;
  if (patch.minAge && patch.maxAge != null && patch.maxAge && patch.minAge > patch.maxAge) { ctx.err('The minimum password age must be less than the maximum password age.\n'); return 2; }
  S.setPolicy(sys, patch);
  ctx.out('The command completed successfully.\n\n');
  return 0;
}
function netShare(ctx, argv) {
  const sys = ctx.sys;
  if (!argv.length) {
    let t = '\nShare name   Resource                        Remark\n\n-------------------------------------------------------------------------------\n';
    for (const s of S.listShares(sys)) t += `${pad(s.name, 13)}${pad(s.path, 32)}${s.desc}\n`;
    ctx.out(t + 'The command completed successfully.\n\n');
    return 0;
  }
  const first = argv[0];
  if (sw(argv, '/delete')) { if (!admin(ctx)) return 2; return wrap(ctx, () => { S.removeShare(sys, first); ctx.out(`${first} was deleted successfully.\n\n`); return 0; }); }
  const m = /^([^=]+)=(.+)$/.exec(first);
  if (m) { if (!admin(ctx)) return 2; return wrap(ctx, () => { S.addShare(sys, m[1], m[2].replace(/^"|"$/g, ''), opt(argv, '/remark') || ''); ctx.out(`${m[1]} was shared successfully.\n\n`); return 0; }); }
  const s = S.listShares(sys).find((x) => lc(x.name) === lc(first));
  if (!s) { ctx.err('This shared resource does not exist.\n\nMore help is available by typing NET HELPMSG 2310.\n\n'); return 2; }
  ctx.out(`Share name        ${s.name}\nPath              ${s.path}\nRemark            ${s.desc}\nMaximum users     No limit\nUsers\nCaching           Manual caching of documents\nPermission        Everyone, FULL\n\nThe command completed successfully.\n\n`);
  return 0;
}
function netStartStop(ctx, argv, start) {
  const sys = ctx.sys;
  if (!argv.length) {
    if (!start) { ctx.err('The syntax of this command is:\n\nNET STOP\nservice\n\n'); return 1; }
    ctx.out(`These Windows services are started:\n\n${S.listServices(sys).filter((s) => s.status === 'Running').map((s) => '   ' + s.display).join('\n')}\n\nThe command completed successfully.\n\n`);
    return 0;
  }
  if (!admin(ctx)) return 2;
  const name = argv.join(' ').replace(/^"|"$/g, '');
  const s = S.getService(sys, name);
  if (!s) { ctx.err('The service name is invalid.\n\nMore help is available by typing NET HELPMSG 2185.\n\n'); return 2; }
  return wrap(ctx, () => {
    if (start) { if (s.status === 'Running') { ctx.err('The requested service has already been started.\n\nMore help is available by typing NET HELPMSG 2182.\n\n'); return 2; } S.startService(sys, s.name); ctx.out(`The ${s.display} service is starting.\nThe ${s.display} service was started successfully.\n\n`); }
    else { if (s.status !== 'Running') { ctx.err(`The ${s.display} service is not started.\n\nMore help is available by typing NET HELPMSG 3521.\n\n`); return 2; } S.stopService(sys, s.name); ctx.out(`The ${s.display} service is stopping.\nThe ${s.display} service was stopped successfully.\n\n`); }
    return 0;
  });
}
export function net(ctx, argv) {
  const [sub, ...rest] = argv;
  switch (lc(sub)) {
    case 'user': case 'users': return netUser(ctx, rest);
    case 'localgroup': return netLocalgroup(ctx, rest);
    case 'accounts': return netAccounts(ctx, rest);
    case 'share': return netShare(ctx, rest);
    case 'start': return netStartStop(ctx, rest, true);
    case 'stop': return netStartStop(ctx, rest, false);
    case 'session': ctx.out('There are no entries in the list.\n\n'); return 0;
    case 'use': ctx.out('New connections will be remembered.\n\nThere are no entries in the list.\n\n'); return 0;
    case 'view': ctx.err('System error 6118 has occurred.\n\nThe list of servers for this workgroup is not currently available\n\n'); return 2;
    case 'config': ctx.out('The following running services can be controlled:\n\n   Server\n   Workstation\n\nThe command completed successfully.\n\n'); return 0;
    default: ctx.out('The syntax of this command is:\n\nNET\n    [ ACCOUNTS | COMPUTER | CONFIG | CONTINUE | FILE | GROUP | HELP |\n      HELPMSG | LOCALGROUP | PAUSE | SESSION | SHARE | START |\n      STATISTICS | STOP | TIME | USE | USER | VIEW ]\n\n'); return 1;
  }
}

// ============================================================================ sc
const SC_START = { Automatic: '2   AUTO_START', 'Automatic (Delayed Start)': '2   AUTO_START  (DELAYED)', Manual: '3   DEMAND_START', Disabled: '4   DISABLED' };
export function sc(ctx, argv) {
  const sys = ctx.sys;
  const [verb, name, ...rest] = argv;
  const s = name && S.getService(sys, name);
  const state = (x) => (x.status === 'Running' ? '4  RUNNING' : '1  STOPPED');
  const q = (x) => `\nSERVICE_NAME: ${x.name}\n        TYPE               : 20  WIN32_SHARE_PROCESS\n        STATE              : ${state(x)}\n                                (${x.status === 'Running' ? 'STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN' : 'NOT_STOPPABLE, NOT_PAUSABLE, IGNORES_SHUTDOWN'})\n        WIN32_EXIT_CODE    : 0  (0x0)\n        SERVICE_EXIT_CODE  : 0  (0x0)\n        CHECKPOINT         : 0x0\n        WAIT_HINT          : 0x0\n`;
  const missing = () => { ctx.err(`[SC] OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.\n\n`); return 1060; };
  switch (lc(verb)) {
    case 'query': case 'queryex':
      if (!name || /^(type|state)=/i.test(name)) { ctx.out(S.listServices(sys).filter((x) => x.status === 'Running').map(q).join('')); return 0; }
      if (!s) return missing();
      ctx.out(q(s)); return 0;
    case 'qc':
      if (!s) return missing();
      ctx.out(`[SC] QueryServiceConfig SUCCESS\n\nSERVICE_NAME: ${s.name}\n        TYPE               : 20  WIN32_SHARE_PROCESS\n        START_TYPE         : ${SC_START[s.startType]}\n        ERROR_CONTROL      : 1   NORMAL\n        BINARY_PATH_NAME   : ${s.cmdline || `C:\\Windows\\System32\\${s.exe}${s.exe === 'svchost.exe' ? ` -k ${s.group} -p` : ''}`}\n        LOAD_ORDER_GROUP   :\n        TAG                : 0\n        DISPLAY_NAME       : ${s.display}\n        DEPENDENCIES       :\n        SERVICE_START_NAME : ${s.account === 'Local System' ? 'LocalSystem' : `NT AUTHORITY\\${s.account.replace(/ /g, '')}`}\n`);
      return 0;
    case 'config': {
      if (!admin(ctx)) { ctx.err('[SC] OpenService FAILED 5:\n\nAccess is denied.\n\n'); return 5; }
      if (!s) return missing();
      const i = rest.findIndex((x) => lc(x) === 'start=' || lc(x).startsWith('start='));
      if (i < 0) { ctx.err('DESCRIPTION:\n        Modifies a service entry in the registry and Service Database.\nUSAGE:\n        sc <server> config [service name] <option1> <option2>...\n\nOPTIONS:\nNOTE: The option name includes the equal sign.\n      A space is required between the equal sign and the value.\n start= <boot|system|auto|demand|disabled|delayed-auto>\n'); return 1639; }
      const v = lc(rest[i]) === 'start=' ? rest[i + 1] : rest[i].slice(6);
      return wrap(ctx, () => { S.setStartType(sys, s.name, v); ctx.out('[SC] ChangeServiceConfig SUCCESS\n'); return 0; }) ?? 0;
    }
    case 'stop':
      if (!admin(ctx)) { ctx.err('[SC] OpenService FAILED 5:\n\nAccess is denied.\n\n'); return 5; }
      if (!s) return missing();
      if (s.status !== 'Running') { ctx.err('[SC] ControlService FAILED 1062:\n\nThe service has not been started.\n\n'); return 1062; }
      return wrap(ctx, () => { S.stopService(sys, s.name); ctx.out(q(s).replace('1  STOPPED', '3  STOP_PENDING')); return 0; });
    case 'start':
      if (!admin(ctx)) { ctx.err('[SC] OpenService FAILED 5:\n\nAccess is denied.\n\n'); return 5; }
      if (!s) return missing();
      if (s.startType === 'Disabled') { ctx.err('[SC] StartService FAILED 1058:\n\nThe service cannot be started, either because it is disabled or because it has no enabled devices associated with it.\n\n'); return 1058; }
      if (s.status === 'Running') { ctx.err('[SC] StartService FAILED 1056:\n\nAn instance of the service is already running.\n\n'); return 1056; }
      S.startService(sys, s.name); ctx.out(q(s).replace('4  RUNNING', '2  START_PENDING')); return 0;
    case 'delete':
      if (!admin(ctx)) { ctx.err('[SC] OpenService FAILED 5:\n\nAccess is denied.\n\n'); return 5; }
      if (!s) return missing();
      S.stopService(sys, s.name); sys.win.services = sys.win.services.filter((x) => x !== s); sys.touch('win'); ctx.out('[SC] DeleteService SUCCESS\n'); return 0;
    default: ctx.out('DESCRIPTION:\n        SC is a command line program used for communicating with the\n        Service Control Manager and services.\nUSAGE:\n        sc <server> [command] [service name] <option1> <option2>...\n\n        Commands: query, queryex, start, stop, config, qc, delete\n'); return 1;
  }
}

// ============================================================================ reg
const regData = (v) => (v.type === 'REG_DWORD' ? `0x${Number(v.data).toString(16)}` : String(v.data));
export function reg(ctx, argv) {
  const sys = ctx.sys;
  const [verb, key, ...rest] = argv;
  const k = key && S.regKey(key);
  const long = (p) => p.replace(/^HK\w+/, (h) => S.HIVE_LONG[h] || h);
  const vName = (() => { const i = rest.findIndex((x) => lc(x) === '/v'); return i >= 0 ? rest[i + 1] : undefined; })();
  const val = (flag) => { const i = rest.findIndex((x) => lc(x) === flag); return i >= 0 ? rest[i + 1] : undefined; };
  switch (lc(verb)) {
    case 'query': {
      const n = k && S.regFind(sys, k);
      if (!n) { ctx.err('ERROR: The system was unable to find the specified registry key or value.\n'); return 1; }
      let t = `\n${long(n.path)}\n`;
      const vals = Object.entries(n.values).filter(([nm]) => vName === undefined || lc(nm) === lc(vName));
      if (vName !== undefined && !vals.length) { ctx.err('ERROR: The system was unable to find the specified registry key or value.\n'); return 1; }
      for (const [nm, v] of vals) t += `    ${nm}    ${v.type}    ${regData(v)}\n`;
      if (vName === undefined) { t += '\n'; for (const sub of S.regSubkeys(sys, n.path)) t += `${long(n.path)}\\${sub}\n`; }
      ctx.out(t + '\n'); return 0;
    }
    case 'add': {
      if (!k) { ctx.err('ERROR: Invalid key name.\nType "REG ADD /?" for usage.\n'); return 1; }
      if (/^HKLM/i.test(k) && !ctx.elevated) { ctx.err('ERROR: Access is denied.\n'); return 1; }
      const type = (val('/t') || 'REG_SZ').toUpperCase();
      let data = val('/d') ?? '';
      if (type === 'REG_DWORD') { data = /^0x/i.test(data) ? parseInt(data, 16) : Number(data); if (Number.isNaN(data)) { ctx.err('ERROR: Invalid syntax.\nType "REG ADD /?" for usage.\n'); return 1; } }
      if (vName === undefined && !sw(rest, '/ve')) { S.regEnsure(sys, k); sys.touch('win'); ctx.out('The operation completed successfully.\n'); return 0; }
      const exists = S.regGet(sys, k, vName ?? '(Default)') !== undefined;
      if (exists && !sw(rest, '/f')) { ctx.err(`Value ${vName} exists, overwrite(Yes/No)? `); }
      S.regSet(sys, k, vName ?? '(Default)', data, type);
      ctx.out('The operation completed successfully.\n'); return 0;
    }
    case 'delete': {
      if (!k) { ctx.err('ERROR: Invalid key name.\n'); return 1; }
      if (/^HKLM/i.test(k) && !ctx.elevated) { ctx.err('ERROR: Access is denied.\n'); return 1; }
      return wrap(ctx, () => { if (vName !== undefined) S.regDeleteValue(sys, k, vName); else S.regDeleteKey(sys, k); ctx.out('The operation completed successfully.\n'); return 0; });
    }
    default: ctx.out('\nREG Operation [Parameter List]\n\n  Operation  [ QUERY   | ADD    | DELETE  | COPY    |\n               SAVE    | LOAD   | UNLOAD  | RESTORE |\n               COMPARE | EXPORT | IMPORT  | FLAGS ]\n\nReturn Code: (Except for REG COMPARE)\n\n  0 - Successful\n  1 - Failed\n'); return 1;
  }
}

// ============================================================================ netsh
export function netsh(ctx, argv) {
  const sys = ctx.sys; const a = argv.map(lc);
  if (a[0] === 'advfirewall') {
    if (a[1] === 'show') {
      const which = a[2] === 'allprofiles' ? ['Domain', 'Private', 'Public'] : a[2] === 'currentprofile' ? ['Private'] : [{ domainprofile: 'Domain', privateprofile: 'Private', publicprofile: 'Public' }[a[2]] || 'Private'];
      let t = '';
      for (const p of which) t += `\n${p} Profile Settings:\n----------------------------------------------------------------------\nState                                 ${sys.win.firewall[p].enabled ? 'ON' : 'OFF'}\nFirewall Policy                       BlockInbound,AllowOutbound\nLocalFirewallRules                    N/A (GPO-store only)\nLocalConSecRules                      N/A (GPO-store only)\nInboundUserNotification               Enable\nRemoteManagement                      Disable\nUnicastResponseToMulticast            Enable\n\nLogging:\nLogAllowedConnections                 Disable\nLogDroppedConnections                 Disable\nFileName                              %systemroot%\\system32\\LogFiles\\Firewall\\pfirewall.log\nMaxFileSize                           4096\n\n`;
      ctx.out(t + 'Ok.\n\n'); return 0;
    }
    if (a[1] === 'set' && a[3] === 'state') {
      if (!admin(ctx)) return 1;
      const which = a[2] === 'allprofiles' ? ['Domain', 'Private', 'Public'] : a[2] === 'currentprofile' ? ['Private'] : [{ domainprofile: 'Domain', privateprofile: 'Private', publicprofile: 'Public' }[a[2]]];
      if (!which[0] || !['on', 'off'].includes(a[4])) { ctx.err('The syntax supplied for this command is not valid. Check help for the correct syntax.\n'); return 1; }
      S.setFirewall(sys, which, a[4] === 'on'); ctx.out('Ok.\n\n'); return 0;
    }
    if (a[1] === 'firewall' && a[2] === 'show') { ctx.out(sys.win.fwRules.map((r) => `\nRule Name:                            ${r.name}\n----------------------------------------------------------------------\nEnabled:                              ${r.enabled ? 'Yes' : 'No'}\nDirection:                            ${r.dir}\nProfiles:                             Domain,Private,Public\nLocalPort:                            ${r.port}\nAction:                               ${r.action}\n`).join('') + '\nOk.\n\n'); return 0; }
    if (a[1] === 'firewall' && a[2] === 'delete' && a[3] === 'rule') {
      if (!admin(ctx)) return 1;
      const name = (argv.slice(4).join(' ').match(/name=("?)(.+?)\1(\s|$)/i) || [])[2];
      const before = sys.win.fwRules.length; sys.win.fwRules = sys.win.fwRules.filter((r) => lc(r.name) !== lc(name));
      if (before === sys.win.fwRules.length) { ctx.err('\nNo rules match the specified criteria.\n\n'); return 1; }
      sys.touch('win'); ctx.out(`\nDeleted ${before - sys.win.fwRules.length} rule(s).\nOk.\n\n`); return 0;
    }
    if (a[1] === 'reset') { if (!admin(ctx)) return 1; S.setFirewall(sys, ['Domain', 'Private', 'Public'], true); ctx.out('Ok.\n\n'); return 0; }
  }
  if (a[0] === 'interface' || a[0] === 'wlan') { ctx.out('\nThe Wireless AutoConfig Service (wlansvc) is not running.\n\n'); return 1; }
  ctx.out('\nUsage: netsh advfirewall [show | set | reset | firewall]\n  netsh advfirewall set allprofiles state on\n  netsh advfirewall show allprofiles\n\n'); return 1;
}

// ============================================================================ auditpol
const SUBCATS = {
  System: ['Security System Extension', 'System Integrity', 'IPsec Driver', 'Other System Events', 'Security State Change'],
  'Logon/Logoff': ['Logon', 'Logoff', 'Account Lockout', 'IPsec Main Mode', 'Special Logon', 'Other Logon/Logoff Events', 'Network Policy Server'],
  'Object Access': ['File System', 'Registry', 'Kernel Object', 'SAM', 'Certification Services', 'File Share', 'Removable Storage'],
  'Privilege Use': ['Non Sensitive Privilege Use', 'Other Privilege Use Events', 'Sensitive Privilege Use'],
  'Detailed Tracking': ['Process Creation', 'Process Termination', 'DPAPI Activity', 'RPC Events'],
  'Policy Change': ['Authentication Policy Change', 'Authorization Policy Change', 'Audit Policy Change', 'Other Policy Change Events'],
  'Account Management': ['Computer Account Management', 'Security Group Management', 'User Account Management', 'Other Account Management Events'],
  'DS Access': ['Directory Service Changes', 'Directory Service Replication', 'Directory Service Access'],
  'Account Logon': ['Kerberos Service Ticket Operations', 'Other Account Logon Events', 'Kerberos Authentication Service', 'Credential Validation'],
};
export function auditpol(ctx, argv) {
  const sys = ctx.sys;
  const cmd = lc(argv[0]);
  const catArg = (opt(argv, '/category') ?? opt(argv, '/subcategory') ?? '').replace(/^"|"$/g, '');
  const findCat = (c) => S.AUDIT_CATEGORIES.find((x) => lc(x) === lc(c)) || Object.keys(SUBCATS).find((x) => SUBCATS[x].some((s) => lc(s) === lc(c)));
  if (cmd === '/get') {
    if (!admin(ctx)) { ctx.err('Error 0x00000522 occurred:\nA required privilege is not held by the client.\n'); return 1; }
    const cats = catArg === '*' || !catArg ? S.AUDIT_CATEGORIES : catArg.split(',').map(findCat).filter(Boolean);
    let t = 'System audit policy\nCategory/Subcategory                      Setting\n';
    for (const c of cats) { t += `${c}\n`; for (const s of SUBCATS[c]) t += `  ${pad(s, 40)}${S.auditText(sys.win.audit[c])}\n`; }
    ctx.out(t); return 0;
  }
  if (cmd === '/set') {
    if (!admin(ctx)) { ctx.err('Error 0x00000522 occurred:\nA required privilege is not held by the client.\n'); return 1; }
    const cats = catArg === '*' ? S.AUDIT_CATEGORIES : catArg.split(',').map(findCat);
    if (!cats.length || cats.some((c) => !c)) { ctx.err('Error 0x00000057 occurred:\nThe parameter is incorrect.\n'); return 87; }
    const s = opt(argv, '/success'); const f = opt(argv, '/failure');
    if (s == null && f == null) { ctx.err('Error 0x00000057 occurred:\nThe parameter is incorrect.\n'); return 87; }
    for (const c of cats) S.setAudit(sys, c, { success: s == null ? undefined : lc(s) === 'enable', failure: f == null ? undefined : lc(f) === 'enable' });
    ctx.out('The command was successfully executed.\n'); return 0;
  }
  if (cmd === '/list') { ctx.out('Category/Subcategory\n' + S.AUDIT_CATEGORIES.join('\n') + '\n'); return 0; }
  ctx.out('Usage: AuditPol command [<sub-command><options>]\n\nCommands (only one command permitted per execution)\n  /?               Help (context-sensitive)\n  /get             Displays the current audit policy.\n  /set             Sets the audit policy.\n  /list            Displays selectable policy elements.\n'); return 1;
}

// ============================================================================ secedit (security template export / configure)
const SA = [['MinimumPasswordAge', 'minAge'], ['MaximumPasswordAge', 'maxAge'], ['MinimumPasswordLength', 'minLen'], ['PasswordComplexity', 'complexity'], ['PasswordHistorySize', 'history'], ['LockoutBadCount', 'lockoutThreshold'], ['ResetLockoutCount', 'lockoutWindow'], ['LockoutDuration', 'lockoutDuration'], ['ClearTextPassword', 'reversible']];
const AUDIT_INF = [['AuditSystemEvents', 'System'], ['AuditLogonEvents', 'Logon/Logoff'], ['AuditObjectAccess', 'Object Access'], ['AuditPrivilegeUse', 'Privilege Use'], ['AuditPolicyChange', 'Policy Change'], ['AuditAccountManage', 'Account Management'], ['AuditProcessTracking', 'Detailed Tracking'], ['AuditDSAccess', 'DS Access'], ['AuditAccountLogon', 'Account Logon']];
export function exportTemplate(sys) {
  const p = sys.win.policy; const w = sys.win;
  const admin = w.users.find((u) => u.rid === 500); const guest = w.users.find((u) => u.rid === 501);
  const priv = (m) => (S.getUser(sys, m) ? m : /^(Everyone)$/.test(m) ? '*S-1-1-0' : /Administrators/.test(m) ? '*S-1-5-32-544' : /^Users$/.test(m) ? '*S-1-5-32-545' : /Backup Operators/.test(m) ? '*S-1-5-32-551' : /Remote Desktop Users/.test(m) ? '*S-1-5-32-555' : m);
  return `[Unicode]\nUnicode=yes\n[System Access]\n${SA.map(([k, f]) => `${k} = ${typeof p[f] === 'boolean' ? (p[f] ? 1 : 0) : p[f]}`).join('\n')}\nRequireLogonToChangePassword = 0\nForceLogoffWhenHourExpire = 0\nNewAdministratorName = "${admin?.name}"\nNewGuestName = "${guest?.name}"\nEnableAdminAccount = ${admin?.enabled ? 1 : 0}\nEnableGuestAccount = ${guest?.enabled ? 1 : 0}\n[Event Audit]\n${AUDIT_INF.map(([k, c]) => `${k} = ${(w.audit[c].success ? 1 : 0) + (w.audit[c].failure ? 2 : 0)}`).join('\n')}\n[Registry Values]\n${S.SECOPTS.filter((o) => o.key).map((o) => `MACHINE\\${S.regKey(o.key).slice(5)}\\${o.value}=4,${S.regGet(sys, o.key, o.value) ?? o.dflt}`).join('\n')}\n[Privilege Rights]\n${Object.entries(w.rights).filter(([, v]) => v.length).map(([k, v]) => `${k} = ${v.map(priv).join(',')}`).join('\n')}\n[Version]\nsignature="$CHICAGO$"\nRevision=1\n`;
}
const SID_NAMES = { '*S-1-1-0': 'Everyone', '*S-1-5-32-544': 'Administrators', '*S-1-5-32-545': 'Users', '*S-1-5-32-551': 'Backup Operators', '*S-1-5-32-555': 'Remote Desktop Users', '*S-1-5-32-546': 'Guests', '*S-1-5-11': 'Authenticated Users' };
export function applyTemplate(sys, text) {
  let sec = '';
  const p = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith(';')) continue;
    const m = /^\[(.+)\]$/.exec(l); if (m) { sec = m[1]; continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(l); if (!kv) continue;
    const [, k, v] = kv;
    if (sec === 'System Access') {
      const f = SA.find((x) => lc(x[0]) === lc(k)); if (f) p[f[1]] = ['complexity', 'reversible'].includes(f[1]) ? Number(v) === 1 : Number(v);
      if (lc(k) === 'enableguestaccount') { const g = sys.win.users.find((u) => u.rid === 501); if (g) g.enabled = Number(v) === 1; }
      if (lc(k) === 'enableadminaccount') { const a = sys.win.users.find((u) => u.rid === 500); if (a) a.enabled = Number(v) === 1; }
    } else if (sec === 'Event Audit') {
      const c = AUDIT_INF.find((x) => lc(x[0]) === lc(k)); if (c) { const n = Number(v); sys.win.audit[c[1]] = { success: !!(n & 1), failure: !!(n & 2) }; }
    } else if (sec === 'Privilege Rights') {
      if (S.RIGHT_NAME[k.trim()]) sys.win.rights[k.trim()] = v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => SID_NAMES[x] || x.replace(/^\*/, ''));
    } else if (sec === 'Registry Values') {
      const m2 = /^MACHINE\\(.+)\\([^\\]+)$/i.exec(k.trim()); const d = /^\d+,(.*)$/.exec(v);
      if (m2 && d) S.regSet(sys, `HKLM\\${m2[1]}`, m2[2], Number(d[1].replace(/"/g, '')), 'REG_DWORD', { noTouch: true });
    }
  }
  Object.assign(sys.win.policy, p);
  sys.touch('win');
}
export function secedit(ctx, argv) {
  const sys = ctx.sys; const cmd = lc(argv[0]);
  const val = (f) => { const i = argv.findIndex((x) => lc(x) === f); return i >= 0 ? argv[i + 1] : undefined; };
  if (!ctx.elevated && (cmd === '/export' || cmd === '/configure')) { ctx.err('Failed to open the database.\nAccess is denied.\n'); return 5; }
  if (cmd === '/export') {
    const f = val('/cfg'); if (!f) { ctx.err('The parameter is incorrect.\n'); return 87; }
    ctx.writeFile(f, exportTemplate(sys)); ctx.out('\nThe task has completed successfully.\nSee log %windir%\\security\\logs\\scesrv.log for detail info.\n'); return 0;
  }
  if (cmd === '/configure') {
    const f = val('/cfg'); if (!f) { ctx.err('The parameter is incorrect.\n'); return 87; }
    const t = ctx.readFile(f); if (t == null) { ctx.err(`Failed to open the template file ${f}.\n`); return 2; }
    applyTemplate(sys, t); ctx.out('\nThe task has completed successfully.\nSee log %windir%\\security\\logs\\scesrv.log for detail info.\n'); return 0;
  }
  ctx.out('Secedit [/configure | /analyze | /import | /export | /validate | /generaterollback]\n  secedit /export /cfg C:\\secpol.cfg\n  secedit /configure /db C:\\Windows\\security\\local.sdb /cfg C:\\secpol.cfg /areas SECURITYPOLICY\n'); return 1;
}

// ============================================================================ schtasks
export function schtasks(ctx, argv) {
  const sys = ctx.sys; const cmd = lc(argv[0] || '/query');
  const val = (f) => { const i = argv.findIndex((x) => lc(x) === f); return i >= 0 ? argv[i + 1]?.replace(/^"|"$/g, '') : undefined; };
  if (cmd === '/query') {
    const tn = val('/tn'); const list = tn ? [S.getTask(sys, tn)].filter(Boolean) : S.listTasks(sys);
    if (tn && !list.length) { ctx.err('ERROR: The system cannot find the file specified.\n'); return 1; }
    if (sw(argv, '/v') || lc(val('/fo')) === 'list') {
      ctx.out(list.map((t) => `\nFolder: ${t.path}\nHostName:                             ${sys.hostname}\nTaskName:                             ${t.path}${t.name}\nNext Run Time:                        N/A\nStatus:                               ${t.enabled ? 'Ready' : 'Disabled'}\nLogon Mode:                           Interactive/Background\nAuthor:                               ${t.author}\nTask To Run:                          ${t.action}\nComment:                              ${t.desc || 'N/A'}\nScheduled Task State:                 ${t.enabled ? 'Enabled' : 'Disabled'}\nRun As User:                          ${t.runAs || 'SYSTEM'}\nSchedule Type:                        ${t.trigger}\n`).join('')); return 0;
    }
    const byFolder = {}; for (const t of list) (byFolder[t.path] ||= []).push(t);
    let o = '';
    for (const [f, ts] of Object.entries(byFolder)) { o += `\nFolder: ${f}\nTaskName                                 Next Run Time          Status\n======================================== ====================== ===============\n`; for (const t of ts) o += `${pad(t.name, 41)}${pad('N/A', 23)}${t.enabled ? 'Ready' : 'Disabled'}\n`; }
    ctx.out(o); return 0;
  }
  if (cmd === '/delete') {
    if (!admin(ctx)) return 1;
    const tn = val('/tn'); return wrap(ctx, () => { const t = S.getTask(sys, tn); if (!t) throw new S.WinError('ERROR: The system cannot find the file specified.', 1); S.removeTask(sys, tn); ctx.out(`SUCCESS: The scheduled task "${t.name}" was successfully deleted.\n`); return 0; });
  }
  if (cmd === '/change') {
    if (!admin(ctx)) return 1;
    const tn = val('/tn'); return wrap(ctx, () => { S.setTaskEnabled(sys, tn, !sw(argv, '/disable')); ctx.out(`SUCCESS: The parameters of scheduled task "${tn}" have been changed.\n`); return 0; });
  }
  if (cmd === '/run') { ctx.out(`SUCCESS: Attempted to run the scheduled task "${val('/tn')}".\n`); return 0; }
  ctx.out('SCHTASKS /parameter [arguments]\n\nParameter List:\n    /Create   Creates a new scheduled task.\n    /Delete   Deletes the scheduled task(s).\n    /Query    Displays all scheduled tasks.\n    /Change   Changes the properties of scheduled task.\n    /Run      Runs the scheduled task on demand.\n'); return 1;
}

// ============================================================================ wmic (deprecated but still used)
export function wmic(ctx, argv) {
  const sys = ctx.sys; const alias = lc(argv[0]);
  const getI = argv.findIndex((x) => lc(x) === 'get');
  const props = getI >= 0 ? argv.slice(getI + 1).join('').split(',').map((x) => x.trim()).filter(Boolean) : [];
  const table = (rows, cols) => { const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)) + 2); ctx.out([cols.map((c, i) => pad(c, w[i])).join(''), ...rows.map((r) => cols.map((c, i) => pad(r[c] ?? '', w[i])).join(''))].join('\n') + '\n\n'); };
  if (alias === 'useraccount') {
    const rows = S.listUsers(sys).map((u) => ({ Name: u.name, SID: S.sidOf(sys, u), Disabled: u.enabled ? 'FALSE' : 'TRUE', FullName: u.full, Description: u.desc, PasswordRequired: u.hash ? 'TRUE' : 'FALSE', PasswordExpires: u.neverExpires ? 'FALSE' : 'TRUE', Lockout: 'FALSE', LocalAccount: 'TRUE', Domain: sys.hostname, Status: u.enabled ? 'OK' : 'Degraded' }));
    const cols = props.length ? props.map((p) => Object.keys(rows[0]).find((k) => lc(k) === lc(p)) || p) : ['AccountType', 'Description', 'Disabled', 'Domain', 'FullName', 'LocalAccount', 'Lockout', 'Name', 'PasswordRequired', 'SID', 'Status'];
    table(rows.map((r) => ({ AccountType: 512, ...r })), cols); return 0;
  }
  if (alias === 'product') { const rows = S.listPrograms(sys).map((p) => ({ Name: p.name, Version: p.version, Vendor: p.publisher })); table(rows, props.length ? props : ['Name', 'Vendor', 'Version']); return 0; }
  if (alias === 'process') { const rows = sys.processes.map((p) => ({ Name: p.comm, ProcessId: p.pid, CommandLine: p.cmd, ExecutablePath: p.cmd.split(' ')[0].replace(/"/g, '') })); table(rows, props.length ? props.map((p) => ({ name: 'Name', processid: 'ProcessId', commandline: 'CommandLine', executablepath: 'ExecutablePath' }[lc(p)] || p)) : ['Name', 'ProcessId', 'CommandLine']); return 0; }
  if (alias === 'share') { table(S.listShares(sys).map((s) => ({ Name: s.name, Path: s.path, Description: s.desc })), ['Description', 'Name', 'Path']); return 0; }
  if (alias === 'qfe') { table(sys.win.installedUpdates.concat(sys.win.updates.filter((u) => u.installed).map((u) => u.kb)).map((kb) => ({ HotFixID: kb, Description: 'Update', InstalledOn: '11/14/2023' })), ['Description', 'HotFixID', 'InstalledOn']); return 0; }
  if (alias === 'os') { table([{ Caption: 'Microsoft Windows 11 Pro', Version: `10.0.${WIN_VERSION.build}`, BuildNumber: WIN_VERSION.build, OSArchitecture: '64-bit' }], props.length ? props : ['BuildNumber', 'Caption', 'OSArchitecture', 'Version']); return 0; }
  ctx.out('wmic:root\\cli>\nAvailable aliases: useraccount, product, process, share, qfe, os\n'); return 0;
}

// ============================================================================ winget
export function winget(ctx, argv) {
  const sys = ctx.sys; const cmd = lc(argv[0]);
  const idArg = (() => { const i = argv.findIndex((x) => ['--id', '-q', '--name'].includes(lc(x))); return i >= 0 ? argv[i + 1] : argv.slice(1).find((x) => !x.startsWith('-')); })();
  const row = (p, extra = '') => `${pad(p.name.slice(0, 38), 39)}${pad(p.id.slice(0, 30), 31)}${pad(p.version, 16)}${extra}`;
  if (cmd === 'list') {
    let list = S.listPrograms(sys); if (idArg) list = list.filter((p) => lc(p.name).includes(lc(idArg)) || lc(p.id).includes(lc(idArg)));
    ctx.out(`${pad('Name', 39)}${pad('Id', 31)}${pad('Version', 16)}Available Source\n${'-'.repeat(96)}\n${list.map((p) => row(p, p.latest && p.latest !== p.version ? `${pad(p.latest, 10)}winget` : 'winget')).join('\n')}\n`); return 0;
  }
  if (cmd === 'upgrade') {
    const ups = S.listPrograms(sys).filter((p) => p.latest && p.latest !== p.version);
    if (!idArg && !sw(argv, '--all')) { ctx.out(`${pad('Name', 39)}${pad('Id', 31)}${pad('Version', 16)}${pad('Available', 16)}Source\n${'-'.repeat(106)}\n${ups.map((p) => `${row(p)}${pad(p.latest, 16)}winget`).join('\n')}\n${ups.length} upgrades available.\n`); return 0; }
    if (!ctx.elevated) { ctx.err('Installer failed with exit code: 1603\nThe installation requires administrator privileges.\n'); return 1; }
    const targets = sw(argv, '--all') ? ups : [S.findProgram(sys, idArg)].filter(Boolean);
    if (!targets.length) { ctx.err('No installed package found matching input criteria.\n'); return 1; }
    for (const p of targets) { if (!p.latest || p.latest === p.version) { ctx.out(`No available upgrade found.\nNo newer package versions are available from the configured sources.\n`); continue; } ctx.out(`Found ${p.name} [${p.id}] Version ${p.latest}\nThis application is licensed to you by its owner.\nMicrosoft is not responsible for, nor does it grant any licenses to, third-party packages.\nDownloading ...\n  ██████████████████████████████  ${(p.size || 5) * 1.1 | 0}.0 MB / ${(p.size || 5) * 1.1 | 0}.0 MB\nSuccessfully verified installer hash\nStarting package install...\nSuccessfully installed\n`); S.upgradeProgram(sys, p); }
    return 0;
  }
  if (cmd === 'uninstall' || cmd === 'remove') {
    if (!ctx.elevated) { ctx.err('Uninstall failed with exit code: 1603\nThe uninstall requires administrator privileges.\n'); return 1; }
    return wrap(ctx, () => { const p = S.uninstallProgram(sys, idArg); ctx.out(`Found ${p.name} [${p.id}]\nStarting package uninstall...\nSuccessfully uninstalled\n`); return 0; });
  }
  if (cmd === 'search' || cmd === 'show') { ctx.err('Failed when searching source: winget\nAn unexpected error occurred while executing the command:\nInternetOpenUrl() failed.\n0x80072efd : unknown error\n'); return 1; }
  ctx.out('Windows Package Manager v1.6.3133\nCopyright (c) Microsoft Corporation. All rights reserved.\n\nThe winget command line utility enables installing applications and other packages from the command line.\n\nusage: winget  [<command>] [<options>]\n\nThe following commands are available:\n  install    Installs the given package\n  list       Display installed packages\n  upgrade    Shows and performs available upgrades\n  uninstall  Uninstalls the given package\n'); return 0;
}

// ============================================================================ certutil
export function certutil(ctx, argv) {
  const cmd = lc(argv[0]);
  if (cmd === '-decode' || cmd === '-encode') {
    const [, inp, outp] = argv; const t = ctx.readFile(inp);
    if (t == null) { ctx.err(`CertUtil: -${cmd.slice(1)} command FAILED: 0x80070002 (WIN32: 2 ERROR_FILE_NOT_FOUND)\nCertUtil: The system cannot find the file specified.\n`); return 2; }
    if (!outp) { ctx.err('CertUtil: -decode command FAILED: 0x80070057 (WIN32: 87 ERROR_INVALID_PARAMETER)\n'); return 87; }
    let data;
    try {
      const body = t.replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
      data = cmd === '-decode' ? (typeof atob === 'function' ? atob(body) : Buffer.from(body, 'base64').toString('binary')) : (typeof btoa === 'function' ? btoa(t) : Buffer.from(t).toString('base64'));
    } catch { ctx.err('CertUtil: -decode command FAILED: 0x80090005 (-2146893819 NTE_BAD_DATA)\nCertUtil: Bad Data.\n'); return 1; }
    if (ctx.exists(outp)) { ctx.err('CertUtil: -decode command FAILED: 0x80070050 (WIN32: 80 ERROR_FILE_EXISTS)\nCertUtil: The file exists.\n'); return 80; }
    ctx.writeFile(outp, cmd === '-encode' ? `-----BEGIN CERTIFICATE-----\n${data.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n` : data);
    ctx.out(`Input Length = ${t.length}\nOutput Length = ${data.length}\nCertUtil: -${cmd.slice(1)} command completed successfully.\n`); return 0;
  }
  if (cmd === '-hashfile') {
    const [, f, alg = 'SHA1'] = argv; const t = ctx.readFile(f);
    if (t == null) { ctx.err(`CertUtil: -hashfile command FAILED: 0x80070002 (WIN32: 2 ERROR_FILE_NOT_FOUND)\n`); return 2; }
    const hash = lc(alg) === 'sha256' ? sha256hex(t) : lc(alg) === 'md5' ? md5ish(t) : sha256hex('sha1:' + t).slice(0, 40);
    ctx.out(`${alg.toUpperCase()} hash of ${f}:\n${hash}\nCertUtil: -hashfile command completed successfully.\n`); return 0;
  }
  ctx.out('Verbs:\n  -decode          -- Decode Base64-encoded file\n  -encode          -- Encode file to Base64\n  -hashfile        -- Generate and display cryptographic hash over a file\n'); return 1;
}

// ============================================================================ processes / network / info
export function netstat(ctx, argv) {
  const sys = ctx.sys; const a = argv.join('').toLowerCase();
  const withPid = a.includes('o'); const withName = a.includes('b');
  if (withName && !ctx.elevated) { ctx.err('The requested operation requires elevation.\n'); return 1; }
  let t = '\nActive Connections\n\n  Proto  Local Address          Foreign Address        State' + (withPid ? '           PID' : '') + '\n';
  for (const s of sys.sockets().sort((x, y) => x.port - y.port)) {
    t += `  ${pad(s.proto.toUpperCase().replace('6', ''), 7)}${pad(`${s.addr === '*' ? '0.0.0.0' : s.addr}:${s.port}`, 23)}${pad(s.proto.startsWith('udp') ? '*:*' : '0.0.0.0:0', 23)}${pad(s.proto.startsWith('udp') ? '' : 'LISTENING', 16)}${withPid ? s.pid : ''}\n`;
    if (withName) t += ` [${s.comm}]\n`;
  }
  ctx.out(t + '\n'); return 0;
}
export function tasklist(ctx, argv) {
  const sys = ctx.sys; void argv;
  let t = `\nImage Name                     PID Session Name        Session#    Mem Usage\n========================= ======== ================ =========== ============\n`;
  for (const p of sys.processes) t += `${pad(p.comm.slice(0, 25), 26)}${String(p.pid).padStart(8)} ${pad(p.user === 'student' ? 'Console' : 'Services', 17)}${String(p.user === 'student' ? 1 : 0).padStart(11)} ${String(((p.rss || 5000) / 1).toLocaleString('en-US')).padStart(10)} K\n`;
  ctx.out(t); return 0;
}
export function taskkill(ctx, argv) {
  const sys = ctx.sys;
  const pidI = argv.findIndex((x) => lc(x) === '/pid'); const imI = argv.findIndex((x) => lc(x) === '/im');
  const targets = pidI >= 0 ? sys.processes.filter((p) => p.pid === Number(argv[pidI + 1])) : imI >= 0 ? sys.processes.filter((p) => lc(p.comm) === lc(argv[imI + 1])) : [];
  if (!targets.length) { ctx.err(`ERROR: The process ${pidI >= 0 ? `"${argv[pidI + 1]}"` : `"${argv[imI + 1]}"`} not found.\n`); return 128; }
  for (const p of targets) {
    if (p.user !== 'student' && !ctx.elevated) { ctx.err(`ERROR: The process with PID ${p.pid} could not be terminated.\nReason: Access is denied.\n`); continue; }
    if (['System', 'csrss.exe', 'wininit.exe', 'lsass.exe', 'services.exe', 'smss.exe'].includes(p.comm)) { ctx.err(`ERROR: The process with PID ${p.pid} could not be terminated.\nReason: This is critical system process. Taskkill cannot end this process.\n`); continue; }
    sys.killProc(p.pid); ctx.out(`SUCCESS: The process "${p.comm}" with PID ${p.pid} has been terminated.\n`);
  }
  return 0;
}
export function ipconfig(ctx, argv) {
  const all = sw(argv, '/all');
  ctx.out(`\nWindows IP Configuration\n\n${all ? `   Host Name . . . . . . . . . . . . : ${ctx.sys.hostname}\n   Primary Dns Suffix  . . . . . . . :\n   Node Type . . . . . . . . . . . . : Hybrid\n   IP Routing Enabled. . . . . . . . : No\n   WINS Proxy Enabled. . . . . . . . : No\n\n` : ''}Ethernet adapter Ethernet0:\n\n   Connection-specific DNS Suffix  . : localdomain\n${all ? '   Description . . . . . . . . . . . : Intel(R) 82574L Gigabit Network Connection\n   Physical Address. . . . . . . . . : 00-0C-29-4B-7E-21\n   DHCP Enabled. . . . . . . . . . . : Yes\n' : ''}   Link-local IPv6 Address . . . . . : fe80::4d1c:9b2e:6a3f:1d22%12\n   IPv4 Address. . . . . . . . . . . : 192.168.56.110\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.56.1\n${all ? '   DNS Servers . . . . . . . . . . . : 192.168.56.1\n' : ''}`); return 0;
}
export function whoami(ctx, argv) {
  const sys = ctx.sys; const u = S.getUser(sys, ctx.user);
  if (sw(argv, '/groups')) { ctx.out(`\nGROUP INFORMATION\n-----------------\n\nGroup Name                             Type             SID          Attributes\n====================================== ================ ============ ==================================================\nEveryone                               Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group\n${S.userGroups(sys, ctx.user).map((g) => `BUILTIN\\${pad(g.name, 31)}Alias            S-1-5-32-${g.rid} ${g.name === 'Administrators' && !ctx.elevated ? 'Group used for deny only' : 'Mandatory group, Enabled by default, Enabled group'}`).join('\n')}\nMandatory Label\\${ctx.elevated ? 'High' : 'Medium'} Mandatory Level   Label            S-1-16-${ctx.elevated ? '12288' : '8192'}\n`); return 0; }
  if (sw(argv, '/user')) { ctx.out(`\nUSER INFORMATION\n----------------\n\nUser Name             SID\n===================== ==============================================\n${lc(sys.hostname)}\\${ctx.user} ${u ? S.sidOf(sys, u) : ''}\n`); return 0; }
  if (sw(argv, '/priv')) { ctx.out(`\nPRIVILEGES INFORMATION\n----------------------\n\nPrivilege Name                Description                          State\n============================= ==================================== ========\nSeShutdownPrivilege           Shut down the system                 Disabled\nSeChangeNotifyPrivilege       Bypass traverse checking             Enabled\n${ctx.elevated ? 'SeDebugPrivilege              Debug programs                       Disabled\nSeTakeOwnershipPrivilege      Take ownership of files or other objects Disabled\n' : ''}`); return 0; }
  ctx.out(`${lc(sys.hostname)}\\${ctx.user}\n`); return 0;
}
export function systeminfo(ctx) {
  const sys = ctx.sys;
  ctx.out(`\nHost Name:                 ${sys.hostname}\nOS Name:                   Microsoft Windows 11 Pro\nOS Version:                10.0.${WIN_VERSION.build} N/A Build ${WIN_VERSION.build}\nOS Manufacturer:           Microsoft Corporation\nOS Configuration:          Standalone Workstation\nOS Build Type:             Multiprocessor Free\nRegistered Owner:          student\nProduct ID:                00330-80000-00000-AA123\nOriginal Install Date:     11/14/2023, 9:12:40 AM\nSystem Boot Time:          ${fmtDate(sys.bootTime)}\nSystem Manufacturer:       VMware, Inc.\nSystem Model:              VMware20,1\nSystem Type:               x64-based PC\nProcessor(s):              1 Processor(s) Installed.\n                           [01]: Intel64 Family 6 Model 142 Stepping 10 GenuineIntel ~1800 Mhz\nWindows Directory:         C:\\Windows\nSystem Directory:          C:\\Windows\\system32\nTotal Physical Memory:     4,095 MB\nAvailable Physical Memory: 1,812 MB\nDomain:                    WORKGROUP\nHotfix(s):                 ${sys.win.installedUpdates.length + sys.win.updates.filter((u) => u.installed).length} Hotfix(s) Installed.\n${[...sys.win.installedUpdates, ...sys.win.updates.filter((u) => u.installed).map((u) => u.kb)].map((k, i) => `                           [${String(i + 1).padStart(2, '0')}]: ${k}`).join('\n')}\nNetwork Card(s):           1 NIC(s) Installed.\n                           [01]: Intel(R) 82574L Gigabit Network Connection\n                                 Connection Name: Ethernet0\n                                 DHCP Enabled:    Yes\n                                 IP address(es)\n                                 [01]: 192.168.56.110\n`); return 0;
}
export function gpupdate(ctx) { ctx.out('Updating policy...\n\nComputer Policy update has completed successfully.\nUser Policy update has completed successfully.\n\n'); return 0; }
export function usoclient(ctx, argv) {
  if (!ctx.elevated) { ctx.err('Access is denied.\n'); return 5; }
  if (/startinstall|scaninstallwait|startinteractivescan/i.test(argv[0] || '')) { S.installUpdates(ctx.sys); return 0; }
  return 0;
}

export const NATIVE = {
  net, net1: net, sc, reg, netsh, auditpol, secedit, schtasks, wmic, winget, certutil, netstat, tasklist, taskkill, ipconfig, whoami, systeminfo, gpupdate, usoclient,
  hostname: (ctx) => { ctx.out(ctx.sys.hostname + '\n'); return 0; },
  ver: (ctx) => { ctx.out(`\nMicrosoft Windows [Version 10.0.${WIN_VERSION.build}.${WIN_VERSION.ubr}]\n`); return 0; },
};
