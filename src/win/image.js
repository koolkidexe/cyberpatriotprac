// Builds a clean Windows 11 Pro (23H2) machine. A scenario then breaks it on purpose (src/scenarios/win-*).
import { System } from '../core/system.js';
import { BUILTIN_GROUPS, POLICY_DEFAULTS, AUDIT_CATEGORIES, KEYS, regSet, addUser, spawnFor } from './state.js';

export const WIN_VERSIONS = {
  11: { ver: 11, product: 'Windows 11 Pro', display: '23H2', build: '22631', ubr: '2715', edition: 'Professional', image: 'Windows 11' },
  10: { ver: 10, product: 'Windows 10 Pro', display: '22H2', build: '19045', ubr: '3693', edition: 'Professional', image: 'Windows 10' },
};
export const WIN_VERSION = WIN_VERSIONS[11];
/** Version info of this machine (Windows 10 or 11 image). */
export const winVer = (sys) => WIN_VERSIONS[sys?.win?.ver === 10 ? 10 : 11];

function mkdirs(sys, list) { for (const d of list) if (!sys.vfs.exists(d)) sys.vfs.mkdir(d, { parents: true, mode: 0o777 }); }
export function putFile(sys, path, data = '', { size, days = 30 } = {}) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  if (!sys.vfs.exists(dir)) sys.vfs.mkdir(dir, { parents: true, mode: 0o777 });
  const n = sys.vfs.writeFile(path, data, { mode: 0o666, uid: 0, gid: 0, mtime: sys.now() - days * 86400000 });
  if (size != null) n.size = size;
  return n;
}
const BIN = (name) => `MZ\u0090\u0000(simulated ${name})`;

// [name, display, startType, status, description, exe/group, listen, extra]
const SERVICES = [
  ['AudioSrv', 'Windows Audio', 'Automatic', 'Running', 'Manages audio for Windows-based programs.', 'LocalServiceNetworkRestricted'],
  ['BFE', 'Base Filtering Engine', 'Automatic', 'Running', 'The Base Filtering Engine (BFE) is a service that manages firewall and Internet Protocol security (IPsec) policies.', 'LocalServiceNoNetworkFirewall', [], { critical: true }],
  ['BITS', 'Background Intelligent Transfer Service', 'Manual', 'Stopped', 'Transfers files in the background using idle network bandwidth.', 'netsvcs'],
  ['CryptSvc', 'Cryptographic Services', 'Automatic', 'Running', 'Provides three management services: Catalog Database Service, Protected Root Service and Automatic Root Certificate Update Service.', 'NetworkService'],
  ['DcomLaunch', 'DCOM Server Process Launcher', 'Automatic', 'Running', 'The DCOMLAUNCH service launches COM and DCOM servers in response to object activation requests.', 'DcomLaunch', [], { critical: true }],
  ['Dhcp', 'DHCP Client', 'Automatic', 'Running', 'Registers and updates IP addresses and DNS records for this computer.', 'LocalServiceNetworkRestricted'],
  ['Dnscache', 'DNS Client', 'Automatic', 'Running', 'The DNS Client service (dnscache) caches Domain Name System (DNS) names.', 'NetworkService', [], { critical: true }],
  ['EventLog', 'Windows Event Log', 'Automatic', 'Running', 'This service manages events and event logs.', 'LocalServiceNetworkRestricted', [], { critical: true }],
  ['Fax', 'Fax', 'Manual', 'Stopped', 'Enables you to send and receive faxes.', 'fxssvc.exe'],
  ['LanmanServer', 'Server', 'Automatic', 'Running', 'Supports file, print, and named-pipe sharing over the network for this computer.', 'netsvcs', [{ proto: 'tcp', addr: '0.0.0.0', port: 445 }, { proto: 'tcp', addr: '0.0.0.0', port: 139 }]],
  ['LanmanWorkstation', 'Workstation', 'Automatic', 'Running', 'Creates and maintains client network connections to remote servers using the SMB protocol.', 'NetworkService'],
  ['lmhosts', 'TCP/IP NetBIOS Helper', 'Manual', 'Running', 'Provides support for the NetBIOS over TCP/IP (NetBT) service and NetBIOS name resolution.', 'LocalServiceNetworkRestricted'],
  ['mpssvc', 'Windows Defender Firewall', 'Automatic', 'Running', 'Windows Defender Firewall helps protect your computer by preventing unauthorized users from gaining access to your computer.', 'LocalServiceNoNetworkFirewall', [], { critical: true }],
  ['NetTcpPortSharing', 'Net.Tcp Port Sharing Service', 'Disabled', 'Stopped', 'Provides ability to share TCP ports over the net.tcp protocol.', 'SMSvcHost.exe'],
  ['Netlogon', 'Netlogon', 'Manual', 'Stopped', 'Maintains a secure channel between this computer and the domain controller.', 'lsass.exe'],
  ['ProfSvc', 'User Profile Service', 'Automatic', 'Running', 'This service is responsible for loading and unloading user profiles.', 'netsvcs', [], { critical: true }],
  ['RemoteRegistry', 'Remote Registry', 'Disabled', 'Stopped', 'Enables remote users to modify registry settings on this computer.', 'localService'],
  ['RpcSs', 'Remote Procedure Call (RPC)', 'Automatic', 'Running', 'The RPCSS service is the Service Control Manager for COM and DCOM servers.', 'rpcss', [{ proto: 'tcp', addr: '0.0.0.0', port: 135 }], { critical: true }],
  ['SamSs', 'Security Accounts Manager', 'Automatic', 'Running', 'The startup of this service signals other services that the Security Accounts Manager (SAM) is ready to accept requests.', 'lsass.exe', [], { critical: true }],
  ['Schedule', 'Task Scheduler', 'Automatic', 'Running', 'Enables a user to configure and schedule automated tasks on this computer.', 'netsvcs', [], { critical: true }],
  ['SecurityHealthService', 'Windows Security Service', 'Manual', 'Running', 'Windows Security Service handles unified device protection and health information.', 'SecurityHealthService.exe'],
  ['seclogon', 'Secondary Logon', 'Manual', 'Stopped', 'Enables starting processes under alternate credentials.', 'netsvcs'],
  ['SessionEnv', 'Remote Desktop Configuration', 'Manual', 'Stopped', 'Remote Desktop Configuration service (RDCS) is responsible for all Remote Desktop Services and Remote Desktop related configuration and session maintenance activities.', 'netsvcs'],
  ['SNMPTRAP', 'SNMP Trap', 'Manual', 'Stopped', 'Receives trap messages generated by local or remote Simple Network Management Protocol (SNMP) agents.', 'snmptrap.exe'],
  ['Spooler', 'Print Spooler', 'Automatic', 'Running', 'This service spools print jobs and handles interaction with the printer.', 'spoolsv.exe'],
  ['SSDPSRV', 'SSDP Discovery', 'Manual', 'Running', 'Discovers networked devices and services that use the SSDP discovery protocol, such as UPnP devices.', 'LocalServiceAndNoImpersonation'],
  ['TermService', 'Remote Desktop Services', 'Manual', 'Stopped', 'Allows users to connect interactively to a remote computer.', 'termsvcs', [{ proto: 'tcp', addr: '0.0.0.0', port: 3389 }]],
  ['Themes', 'Themes', 'Automatic', 'Running', 'Provides user experience theme management.', 'netsvcs'],
  ['UmRdpService', 'Remote Desktop Services UserMode Port Redirector', 'Manual', 'Stopped', 'Allows the redirection of Printers/Drives/Ports for RDP connections.', 'LocalSystemNetworkRestricted'],
  ['upnphost', 'UPnP Device Host', 'Manual', 'Stopped', 'Allows UPnP devices to be hosted on this computer.', 'LocalServiceAndNoImpersonation'],
  ['UserManager', 'User Manager', 'Automatic', 'Running', 'User Manager provides the runtime components required for multi-user interaction.', 'netsvcs', [], { critical: true }],
  ['W32Time', 'Windows Time', 'Manual', 'Stopped', 'Maintains date and time synchronization on all clients and servers in the network.', 'LocalService'],
  ['WinDefend', 'Microsoft Defender Antivirus Service', 'Automatic', 'Running', 'Helps protect users from malware and other potentially unwanted software.', 'MsMpEng.exe', [], { critical: true }],
  ['Winmgmt', 'Windows Management Instrumentation', 'Automatic', 'Running', 'Provides a common interface and object model to access management information about operating system, devices, applications and services.', 'netsvcs', [], { critical: true }],
  ['WinRM', 'Windows Remote Management (WS-Management)', 'Manual', 'Stopped', 'Windows Remote Management (WinRM) service implements the WS-Management protocol for remote management.', 'NetworkService', [{ proto: 'tcp', addr: '0.0.0.0', port: 5985 }]],
  ['WSearch', 'Windows Search', 'Automatic (Delayed Start)', 'Running', 'Provides content indexing, property caching, and search results for files, e-mail, and other content.', 'SearchIndexer.exe'],
  ['wuauserv', 'Windows Update', 'Manual', 'Running', 'Enables the detection, download, and installation of updates for Windows and other programs.', 'netsvcs'],
  ['XblGameSave', 'Xbox Live Game Save', 'Manual', 'Stopped', 'This service syncs save data for Xbox Live save enabled games.', 'netsvcs'],
  ['wscsvc', 'Security Center', 'Automatic (Delayed Start)', 'Running', 'The WSCSVC (Windows Security Center) service monitors and reports security health settings on the computer.', 'LocalServiceNetworkRestricted'],
  ['Audiosrv', null],
];

export const PROGRAMS = [
  { id: 'Mozilla.Firefox', name: 'Mozilla Firefox (x64 en-US)', publisher: 'Mozilla', version: '115.0.2', latest: '133.0.3', size: 236, dir: '/Program Files/Mozilla Firefox', exe: 'firefox.exe' },
  { id: 'Mozilla.Thunderbird', name: 'Mozilla Thunderbird (x64 en-US)', publisher: 'Mozilla', version: '102.13.0', latest: '128.5.2', size: 228, dir: '/Program Files/Mozilla Thunderbird', exe: 'thunderbird.exe' },
  { id: 'Notepad++.Notepad++', name: 'Notepad++ (64-bit x64)', publisher: 'Notepad++ Team', version: '8.5.8', latest: '8.6.2', size: 14, dir: '/Program Files/Notepad++', exe: 'notepad++.exe' },
  { id: '7zip.7zip', name: '7-Zip 23.01 (x64)', publisher: 'Igor Pavlov', version: '23.01', latest: '23.01', size: 5, dir: '/Program Files/7-Zip', exe: '7zFM.exe' },
  { id: 'Microsoft.Edge', name: 'Microsoft Edge', publisher: 'Microsoft Corporation', version: '120.0.2210.91', latest: '120.0.2210.91', size: 650, dir: '/Program Files (x86)/Microsoft/Edge/Application', exe: 'msedge.exe', system: true },
  { id: 'Microsoft.EdgeWebView2Runtime', name: 'Microsoft Edge WebView2 Runtime', publisher: 'Microsoft Corporation', version: '120.0.2210.91', latest: '120.0.2210.91', size: 590, system: true },
  { id: 'Microsoft.VCRedist.2015+.x64', name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33130', publisher: 'Microsoft Corporation', version: '14.38.33130.0', latest: '14.38.33130.0', size: 20 },
  { id: 'Microsoft.OneDrive', name: 'Microsoft OneDrive', publisher: 'Microsoft Corporation', version: '23.246.1127.0002', latest: '23.246.1127.0002', size: 290, exe: 'OneDrive.exe' },
  { id: 'Microsoft.WindowsPCHealthCheck', name: 'Windows PC Health Check', publisher: 'Microsoft Corporation', version: '3.6.2204.08001', latest: '3.6.2204.08001', size: 11 },
];

const UPDATES_10 = [
  { kb: 'KB5034122', title: '2024-01 Cumulative Update for Windows 10 Version 22H2 for x64-based Systems (KB5034122)', size: 651, security: true },
  { kb: 'KB5034275', title: '2024-01 Cumulative Update for .NET Framework 3.5, 4.8 and 4.8.1 for Windows 10 Version 22H2 for x64 (KB5034275)', size: 68, security: true },
  { kb: 'KB890830', title: 'Windows Malicious Software Removal Tool x64 - v5.120 (KB890830)', size: 62, security: true },
  { kb: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.403.1205.0)', size: 89, security: true },
  { kb: 'KB5005463', title: 'Windows Update for Windows 10 Version 22H2 for x64-based Systems (KB5005463)', size: 4, security: false },
];
const UPDATES = [
  { kb: 'KB5033375', title: '2023-12 Cumulative Update for Windows 11 Version 23H2 for x64-based Systems (KB5033375)', size: 638, security: true },
  { kb: 'KB5033920', title: '2023-12 Cumulative Update for .NET Framework 3.5 and 4.8.1 for Windows 11, version 23H2 for x64 (KB5033920)', size: 72, security: true },
  { kb: 'KB890830', title: 'Windows Malicious Software Removal Tool x64 - v5.120 (KB890830)', size: 62, security: true },
  { kb: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.403.1205.0)', size: 89, security: true },
  { kb: 'KB5032007', title: '2023-11 Update for Windows 11 Version 23H2 for x64-based Systems (KB5032007)', size: 18, security: false },
  { kb: 'KB5034123', title: '2024-01 Cumulative Update Preview for Windows 11 Version 23H2 for x64-based Systems (KB5034123)', size: 655, security: false, optional: true },
];
const INSTALLED_UPDATES = ['KB5027397', 'KB5031354', 'KB5032190'];

export function buildWindows11({ now = () => Date.now(), rng = Math.random, hostname, ver = 11 } = {}) {
  const V = WIN_VERSIONS[ver === 10 ? 10 : 11];
  hostname = hostname || (V.ver === 10 ? 'DESKTOP-CP10' : 'DESKTOP-CP11');
  const sys = new System({ now, rng, hostname });
  sys.os = 'windows';
  sys.win = {
    ver: V.ver,
    users: [], groups: [], nextRid: 1001, policy: { ...POLICY_DEFAULTS },
    audit: Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c, { success: false, failure: false }])),
    rights: {}, reg: {}, services: [], firewall: { Domain: { enabled: true }, Private: { enabled: true }, Public: { enabled: true } },
    fwRules: [], defender: { realtime: true, cloud: true, sampleSubmission: true, tamper: true, pua: true, smartscreenApps: 'Warn', smartscreenEdge: true },
    programs: PROGRAMS.map((p) => ({ ...p, installed: '11/14/2023' })), updates: (V.ver === 10 ? UPDATES_10 : UPDATES).map((u) => ({ ...u, installed: false })), installedUpdates: [...INSTALLED_UPDATES],
    features: {
      SMB1Protocol: { state: 'Disabled', display: 'SMB 1.0/CIFS File Sharing Support' }, TelnetClient: { state: 'Disabled', display: 'Telnet Client' }, TFTP: { state: 'Disabled', display: 'TFTP Client' },
      'IIS-WebServerRole': { state: 'Disabled', display: 'Internet Information Services' }, 'IIS-FTPServer': { state: 'Disabled', display: 'FTP Server' },
      MicrosoftWindowsPowerShellV2Root: { state: 'Enabled', display: 'Windows PowerShell 2.0' }, 'Printing-PrintToPDFServices-Features': { state: 'Enabled', display: 'Microsoft Print to PDF' },
      'NetFx4-AdvSrvs': { state: 'Enabled', display: '.NET Framework 4.8 Advanced Services' }, 'Microsoft-Hyper-V-All': { state: 'Disabled', display: 'Hyper-V' },
    },
    shares: [{ name: 'ADMIN$', path: 'C:\\Windows', desc: 'Remote Admin', special: true }, { name: 'C$', path: 'C:\\', desc: 'Default share', special: true }, { name: 'IPC$', path: '', desc: 'Remote IPC', special: true }],
    tasks: [
      { path: '\\', name: 'MicrosoftEdgeUpdateTaskMachineCore', author: 'Microsoft Corporation', action: 'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe /c', trigger: 'At log on of any user', enabled: true, desc: 'Keeps your Microsoft software up to date.' },
      { path: '\\', name: 'GoogleUpdateTaskMachineUA', author: 'Google LLC', action: 'C:\\Program Files (x86)\\Google\\Update\\GoogleUpdate.exe /ua /installsource scheduler', trigger: 'At 9:14 AM every day - After triggered, repeat every 1 hour', enabled: true, desc: 'Keeps your Google software up to date.' },
      { path: '\\', name: 'OneDrive Standalone Update Task-S-1-5-21-3290174852', author: 'Microsoft Corporation', action: '%localappdata%\\Microsoft\\OneDrive\\OneDriveStandaloneUpdater.exe', trigger: 'At 11:00 PM on 5/1/1992 - After triggered, repeat every 1.00:00:00', enabled: true, desc: '' },
      { path: '\\Microsoft\\Windows\\Defrag\\', name: 'ScheduledDefrag', author: 'Microsoft Corporation', action: '%windir%\\system32\\defrag.exe -c -h -o -$', trigger: 'Weekly', enabled: true, desc: 'This task optimizes local storage drives.' },
      { path: '\\Microsoft\\Windows\\WindowsUpdate\\', name: 'Scheduled Start', author: 'Microsoft Corporation', action: 'C:\\Windows\\system32\\sc.exe start wuauserv', trigger: 'At 9:21 AM every day', enabled: true, desc: 'This task is used to start the Windows Update service when needed.' },
    ],
    respawn: [],
  };
  const v = sys.vfs;
  // ---- folders and files
  mkdirs(sys, ['/Windows/System32/drivers/etc', '/Windows/System32/config', '/Windows/SysWOW64', '/Windows/Temp', '/Windows/Logs', '/Windows/Fonts', '/ProgramData/Microsoft/Windows/Start Menu/Programs/Startup',
    '/Program Files/Common Files', '/Program Files (x86)/Common Files', '/Program Files/Windows Defender', '/PerfLogs', '/Users/Public/Desktop', '/Users/Public/Documents', '/Users/Public/Downloads', '/Users/Default']);
  for (const f of ['cmd.exe', 'notepad.exe', 'regedit.exe', 'taskmgr.exe', 'mmc.exe', 'net.exe', 'sc.exe', 'reg.exe', 'netsh.exe', 'certutil.exe', 'schtasks.exe', 'auditpol.exe', 'secedit.exe', 'whoami.exe', 'svchost.exe', 'lsass.exe', 'winlogon.exe', 'explorer.exe', 'powershell.exe', 'control.exe', 'lusrmgr.msc', 'services.msc', 'secpol.msc', 'compmgmt.msc', 'taskschd.msc', 'gpedit.msc', 'eventvwr.msc']) putFile(sys, `/Windows/System32/${f}`, BIN(f), { size: 40000 + f.length * 3000, days: 200 });
  putFile(sys, '/Windows/System32/drivers/etc/hosts', '# Copyright (c) 1993-2009 Microsoft Corp.\r\n#\r\n# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.\r\n#\r\n# localhost name resolution is handled within DNS itself.\r\n#\t127.0.0.1       localhost\r\n#\t::1             localhost\r\n'.replace(/\r/g, ''), { days: 200 });
  for (const p of PROGRAMS) if (p.dir && p.exe) putFile(sys, `${p.dir}/${p.exe}`, BIN(p.exe), { size: 2500000 });
  putFile(sys, '/Program Files/Notepad++/readme.txt', 'Notepad++ is a free source code editor and Notepad replacement.\n');
  putFile(sys, '/Program Files/7-Zip/7z.exe', BIN('7z.exe'), { size: 560000 });

  // ---- accounts
  for (const [name, desc, rid] of BUILTIN_GROUPS) sys.win.groups.push({ name, desc, rid, members: [] });
  addUser(sys, { name: 'Administrator', desc: 'Built-in account for administering the computer/domain', rid: 500, enabled: false, groups: ['Administrators'], noTouch: true });
  addUser(sys, { name: 'Guest', desc: 'Built-in account for guest access to the computer/domain', rid: 501, enabled: false, groups: ['Guests'], noTouch: true });
  addUser(sys, { name: 'DefaultAccount', desc: 'A user account managed by the system.', rid: 503, enabled: false, groups: ['System Managed Accounts Group'], noTouch: true });
  addUser(sys, { name: 'WDAGUtilityAccount', desc: 'A user account managed and used by the system for Windows Defender Application Guard scenarios.', rid: 504, enabled: false, groups: [], noTouch: true });
  sys.win.groups.find((g) => g.name === 'Users').members.push('NT AUTHORITY\\Authenticated Users', 'NT AUTHORITY\\INTERACTIVE');
  sys.win.rights = {
    SeNetworkLogonRight: ['Everyone', 'Administrators', 'Users', 'Backup Operators'], SeTcbPrivilege: [], SeInteractiveLogonRight: ['Guest', 'Administrators', 'Users', 'Backup Operators'],
    SeRemoteInteractiveLogonRight: ['Administrators', 'Remote Desktop Users'], SeBackupPrivilege: ['Administrators', 'Backup Operators'], SeChangeNotifyPrivilege: ['Everyone', 'LOCAL SERVICE', 'NETWORK SERVICE', 'Administrators', 'Users', 'Backup Operators'],
    SeSystemtimePrivilege: ['LOCAL SERVICE', 'Administrators'], SeCreatePagefilePrivilege: ['Administrators'], SeCreateTokenPrivilege: [], SeDebugPrivilege: ['Administrators'],
    SeDenyNetworkLogonRight: ['Guest'], SeDenyInteractiveLogonRight: ['Guest'], SeDenyRemoteInteractiveLogonRight: [], SeRemoteShutdownPrivilege: ['Administrators'],
    SeLoadDriverPrivilege: ['Administrators'], SeSecurityPrivilege: ['Administrators'], SeRestorePrivilege: ['Administrators', 'Backup Operators'], SeShutdownPrivilege: ['Administrators', 'Users', 'Backup Operators'], SeTakeOwnershipPrivilege: ['Administrators'],
  };

  // ---- registry (values that the security settings and apps read)
  const r = (k, n, d, t = 'REG_DWORD') => regSet(sys, k, n, d, t, { noTouch: true });
  r(KEYS.lsa, 'LimitBlankPasswordUse', 1); r(KEYS.lsa, 'RestrictAnonymousSAM', 1); r(KEYS.lsa, 'RestrictAnonymous', 0); r(KEYS.lsa, 'NoLMHash', 1); r(KEYS.lsa, 'EveryoneIncludesAnonymous', 0); r(KEYS.lsa, 'SCENoApplyLegacyAuditPolicy', 0); r(KEYS.lsa, 'LmCompatibilityLevel', 5);
  r(KEYS.sysPol, 'DisableCAD', 1); r(KEYS.sysPol, 'DontDisplayLastUserName', 0); r(KEYS.sysPol, 'EnableLUA', 1); r(KEYS.sysPol, 'ConsentPromptBehaviorAdmin', 5); r(KEYS.sysPol, 'ConsentPromptBehaviorUser', 3); r(KEYS.sysPol, 'PromptOnSecureDesktop', 1); r(KEYS.sysPol, 'FilterAdministratorToken', 0); r(KEYS.sysPol, 'ShutdownWithoutLogon', 1);
  r(KEYS.ts, 'fDenyTSConnections', 1); r(KEYS.rdpTcp, 'UserAuthentication', 1); r(KEYS.rdpTcp, 'PortNumber', 3389); r(KEYS.rdpTcp, 'SecurityLayer', 2);
  r(KEYS.lanman, 'SMB1', 0); r(KEYS.lanman, 'AutoShareWks', 1);
  r(KEYS.run, 'SecurityHealth', '%windir%\\system32\\SecurityHealthSystray.exe', 'REG_EXPAND_SZ');
  r(KEYS.runUser, 'OneDrive', '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background', 'REG_SZ');
  r(KEYS.winlogon, 'Shell', 'explorer.exe', 'REG_SZ'); r(KEYS.winlogon, 'Userinit', 'C:\\Windows\\system32\\userinit.exe,', 'REG_SZ'); r(KEYS.winlogon, 'AutoAdminLogon', '0', 'REG_SZ');
  const cv = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
  r(cv, 'ProductName', 'Windows 10 Pro', 'REG_SZ'); r(cv, 'DisplayVersion', V.display, 'REG_SZ'); r(cv, 'CurrentBuild', V.build, 'REG_SZ'); r(cv, 'UBR', Number(V.ubr)); r(cv, 'EditionID', V.edition, 'REG_SZ'); r(cv, 'RegisteredOwner', 'student', 'REG_SZ');
  r('HKLM\\SYSTEM\\CurrentControlSet\\Control\\ComputerName\\ComputerName', 'ComputerName', hostname, 'REG_SZ');
  r('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer', 'SmartScreenEnabled', 'Warn', 'REG_SZ');
  r('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update', 'AUOptions', 4);
  r('HKCU\\Control Panel\\Desktop', 'Wallpaper', 'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg', 'REG_SZ'); r('HKCU\\Control Panel\\Desktop', 'ScreenSaveActive', '1', 'REG_SZ');
  r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'HideFileExt', 1); r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Hidden', 2);
  r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAl', 0); r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'SearchboxTaskbarMode', 2);
  r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'AppsUseLightTheme', 1); r('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'SystemUsesLightTheme', 0);
  for (const p of PROGRAMS) { const k = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${p.name}`; r(k, 'DisplayName', p.name, 'REG_SZ'); r(k, 'DisplayVersion', p.version, 'REG_SZ'); r(k, 'Publisher', p.publisher, 'REG_SZ'); }
  r('HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer', 'Start', 2);

  // ---- services and processes
  sys.nextPid = 4;
  const procs = [['System', 'SYSTEM'], ['Registry', 'SYSTEM'], ['smss.exe', 'SYSTEM'], ['csrss.exe', 'SYSTEM'], ['wininit.exe', 'SYSTEM'], ['services.exe', 'SYSTEM'], ['lsass.exe', 'SYSTEM'], ['winlogon.exe', 'SYSTEM'], ['fontdrvhost.exe', 'UMFD-0'], ['dwm.exe', 'DWM-1'], ['MsMpEng.exe', 'SYSTEM'], ['spoolsv.exe', 'SYSTEM'], ['SearchIndexer.exe', 'SYSTEM']];
  for (const [n, u] of procs) sys.spawn({ user: u, cmd: n === 'System' ? 'System' : `C:\\Windows\\System32\\${n}`, comm: n, stat: 'Running' });
  sys.nextPid = 612;
  for (const [name, display, startType, status, desc, group, listen = [], extra = {}] of SERVICES) {
    if (!display) continue;
    const exe = /\.exe$/.test(group) ? group : 'svchost.exe';
    const s = { name, display, startType, status, desc, exe, group: /\.exe$/.test(group) ? '' : group, listen, account: /Local|Network/.test(group) ? group.replace(/(Service).*/, ' Service').replace('LocalService', 'Local Service').replace('NetworkService', 'Network Service') : 'Local System', ...extra };
    sys.win.services.push(s);
    if (status === 'Running') spawnFor(sys, s);
  }
  sys.nextPid = 4100;
  for (const n of ['sihost.exe', 'explorer.exe', 'StartMenuExperienceHost.exe', 'SearchHost.exe', 'RuntimeBroker.exe', 'ShellExperienceHost.exe', 'SecurityHealthSystray.exe', 'OneDrive.exe', 'ctfmon.exe', 'TextInputHost.exe']) sys.spawn({ user: 'student', cmd: n === 'OneDrive.exe' ? '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background' : `C:\\Windows\\${/explorer/.test(n) ? '' : 'System32\\'}${n}`, comm: n, stat: 'Running' });
  sys.nextPid = 6200;
  void v;
  sys.dirty = false;
  return sys;
}

/** Create the logged-in user's profile folders (the scenario calls this after creating the account). */
export function makeProfile(sys, name) {
  const base = `/Users/${name}`;
  mkdirs(sys, ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Favorites', 'Contacts', 'Links', 'Saved Games', 'Searches', 'OneDrive', 'AppData/Local/Temp', 'AppData/Local/Microsoft/Windows', 'AppData/LocalLow', 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup'].map((d) => `${base}/${d}`));
  putFile(sys, `${base}/NTUSER.DAT`, '(registry hive)', { size: 2621440, days: 60 });
}
