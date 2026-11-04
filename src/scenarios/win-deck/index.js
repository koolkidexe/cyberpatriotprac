// Windows 11 rounds. makeWinRound(seed) deals a random round from the Windows deck (cards.js); the fixed
// "Windows Practice Round 1" is simply the round dealt from a fixed seed. Same shape as the Linux scenarios.
import { buildWindows11, makeProfile, putFile } from '../../win/image.js';
import * as S from '../../win/state.js';
import * as BP from '../../core/browserprefs.js';
import { CARDS } from './cards.js';
import { FIRST, LAST, ORGS, STRONG } from '../deck/names.js';

export const WIN_DECK_VERSION = 1;
export const FIXED_SEED = 20261029;
const STUDENT_PW = 'Student#Win11';
const lc = (s) => String(s).toLowerCase();

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DEAL = {
  'User Auditing': [4, 6], 'Account Policy': [2, 4], 'Local Policy': [3, 5], 'Defensive Countermeasures': [1, 3], 'Uncategorized Operating System Settings': [2, 3],
  'Service Auditing': [1, 2], 'Operating System Updates': [1, 2], 'Application Updates': [1, 2], 'Unwanted Software': [1, 2], 'Prohibited Files': [1, 1], Malware: [1, 2], 'Application Security': [1, 2],
};
const CAT_ORDER = ['Forensics', ...Object.keys(DEAL)];
// "Windows Practice Round 1" follows the structure of the CyberPatriot Windows 11 Training 2 image (25 scored checks)
const FIXED = { cards: ['unauth', 'newhire', 'guest', 'notadmin', 'pwexpire', 'minlen', 'reversible', 'complexity', 'so-smbclient', 'so-cad', 'gpo-winrm', 'firewall', 'rdpoff', 'nppupd', 'chromeupd', 'exploit', 'software', 'apache-sig'], forensics: ['fq-pcap', 'fq-otp'],
  want: { unauth: 2, notadmin: 2, rdpGpo: true, exploit: 0, software: ['Jellyfin Media Player', 'Burp Suite Community Edition', 'Python3', 'Nmap'] } };

function planRound(seed, fixed = false) {
  const rng = mulberry32(seed);
  const used = new Set(['student', 'administrator', 'guest']);
  let nextRid = 1001;
  const ctx = {
    os: 'windows', seed, rng, studentPw: STUDENT_PW,
    int: (a, b) => a + Math.floor(rng() * (b - a + 1)),
    chance: (p) => rng() < p,
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    person() { for (;;) { const f = ctx.pick(FIRST); const l = ctx.pick(LAST); const name = (f[0] + l).toLowerCase(); if (!used.has(name)) { used.add(name); return { name, full: `${f} ${l}` }; } } },
    strongPw() { return `${ctx.pick(STRONG)}${ctx.int(10, 99)}`; },
    ops: [], vulns: [], solves: [], forensics: [], unauthorized: [], newHires: [],
    readme: { notes: [], policy: [], programs: [], notServices: [] },
    apply(fn) { ctx.ops.push(fn); },
    vuln(v) { ctx.vulns.push({ ...v, category: v.category || ctx.cat, base: v.pts || ctx.basePts }); },
    solve(phase, cmd, ...input) { ctx.solves.push({ phase, order: ctx.solves.length, cmd, input }); },
    forensic(text, answer) { ctx.forensics.push({ text, answer }); },
    takeUser() { const u = ctx.users.find((x) => !x.taken); if (!u) return null; u.taken = true; return u.name; },
    makeProfile,
  };
  ctx.org = ctx.pick(ORGS);
  ctx.rdpRequired = fixed ? false : ctx.chance(0.35);
  ctx.wireshark = fixed ? true : ctx.chance(0.5); // Wireshark is a required tool when a packet-capture question is in play
  if (fixed) ctx.want = FIXED.want;
  ctx.admins = [{ name: 'student', full: 'Student', pw: STUDENT_PW, note: 'you', rid: nextRid++ }];
  for (let i = 0, n = ctx.int(1, 2); i < n; i++) { const p = ctx.person(); ctx.admins.push({ ...p, pw: ctx.strongPw(), note: ctx.pick(['Manager', 'IT Lead', 'Director', 'Supervisor', 'Office Manager']), rid: nextRid++ }); }
  ctx.users = [];
  for (let i = 0, n = ctx.int(5, 8); i < n; i++) ctx.users.push({ ...ctx.person(), pw: ctx.strongPw(), rid: nextRid++ });
  ctx.users = ctx.shuffle(ctx.users);

  // ---- deal the cards
  const byCat = {};
  for (const c of CARDS) if (!c.forensic && (!c.when || c.when(ctx))) (byCat[c.cat] ||= []).push(c);
  let dealt = [];
  if (fixed) dealt = FIXED.cards.map((id) => CARDS.find((c) => c.id === id));
  else for (const [cat, [lo, hi]] of Object.entries(DEAL)) {
    const pool = byCat[cat] || [];
    const n = Math.min(pool.length, ctx.int(lo, hi));
    dealt.push(...ctx.shuffle(pool).slice(0, n));
  }
  const first = ['unauth', 'newhire'];
  dealt.sort((a, b) => (first.includes(b.id) - first.includes(a.id)) || 0);
  for (const c of dealt) { ctx.cat = c.cat; ctx.basePts = c.pts; c.plan(ctx); }
  const dealtIds = new Set(dealt.map((c) => c.id));
  const ok = (c) => !c.requires || (c.requires === 'wireshark' ? ctx.wireshark : dealtIds.has(c.requires));
  const fqs = fixed ? FIXED.forensics.map((id) => CARDS.find((c) => c.id === id)) : ctx.shuffle(CARDS.filter((c) => c.forensic && ok(c))).slice(0, ctx.int(2, 3));
  for (const c of fqs) { ctx.cat = 'Forensics'; c.plan(ctx); }

  // ---- forensics become scored checks; answering them is the solver's first step
  ctx.forensics.forEach((fq, i) => {
    fq.n = i + 1;
    const path = `/Users/student/Desktop/Forensics Question ${fq.n}.txt`;
    ctx.vulns.unshift({ id: `fq${fq.n}`, category: 'Forensics', base: 0, fq: true, title: `Forensics Question ${fq.n} correct`, check: (s) => lc(answerOf(s, path)) === lc(fq.answer) });
    const win = S.toWin(path);
    ctx.solves.push({ phase: 0, order: i, cmd: `(Get-Content '${win}') -replace '^ANSWER:.*', 'ANSWER: ${fq.answer.replace(/'/g, "''")}' | Set-Content '${win}'`, input: [] });
  });
  // report order: Forensics first, then the CyberPatriot category order
  ctx.vulns.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || (a.fq && b.fq ? a.id.localeCompare(b.id) : 0));

  // ---- points: forensics 6-8 each, everything else scaled from the card weights to make exactly 100
  const fqPts = ctx.forensics.length === 3 ? 6 : ctx.pick([6, 7, 8]);
  const fqTotal = fqPts * ctx.forensics.length;
  const rest = ctx.vulns.filter((v) => !v.fq);
  const B = rest.reduce((a, v) => a + v.base, 0);
  const raw = rest.map((v) => (v.base * (100 - fqTotal)) / B);
  const pts = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = 100 - fqTotal - pts.reduce((a, b) => a + b, 0);
  const byRem = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; diff !== 0 && k < 2000; k++) { const i = byRem[k % byRem.length][1]; if (diff > 0) { pts[i]++; diff--; } else if (pts[i] > 1) { pts[i]--; diff++; } }
  rest.forEach((v, i) => { v.points = pts[i]; });
  ctx.vulns.filter((v) => v.fq).forEach((v) => { v.points = fqPts; });
  return ctx;
}

function answerOf(sys, path) { const t = sys.vfs.isFile(path) ? sys.vfs.readFile(path) : ''; const m = /^ANSWER:[ \t]*(.*)$/m.exec(t); return m ? m[1].trim() : ''; }
const teamId = (rng) => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 32)]).join('')).join('-');

export function makeWinRound(seed, { fixed = false } = {}) {
  const ctx = planRound(seed >>> 0, fixed);
  const authorized = [...ctx.admins.map((a) => a.name), ...ctx.users.map((u) => u.name)];
  const penalties = [
    ...authorized.filter((n) => n !== 'student').map((name) => ({ id: `auth-${name}`, points: 5, title: `Authorized user ${name} was removed`, check: (s) => !S.getUser(s, name) })),
    { id: 'student-admin', points: 5, title: 'Authorized administrator student lost administrator rights', check: (s) => !!S.getUser(s, 'student') && !S.isAdmin(s, 'student') },
    ...(ctx.rdpRequired ? [{ id: 'rdp-crit', points: 5, title: 'Critical service Remote Desktop is disabled or stopped', check: (s) => !S.rdpEnabled(s) || !S.serviceOn(s, 'TermService') }] : []),
    ...(ctx.apache ? [{ id: 'apache-crit', points: 5, title: 'Critical service Apache2.4 is stopped or removed', check: (s) => !S.serviceOn(s, 'Apache2.4') || !s.vfs.exists('/Apache24/bin/httpd.exe') }] : []),
    { id: 'lockout-low', points: 5, title: 'Account lockout threshold less than 5 is deprecated', check: (s) => s.win.policy.lockoutThreshold > 0 && s.win.policy.lockoutThreshold < 5 },
    // the answer key's "not installed at the default location" penalties: removing or moving a required program
    ...[['Google.Chrome', 'Google Chrome', '/Program Files/Google/Chrome/Application/chrome.exe'], ['Notepad++.Notepad++', 'Notepad++', '/Program Files/Notepad++/notepad++.exe'], ['7zip.7zip', '7-Zip', '/Program Files/7-Zip/7z.exe'], ...(ctx.wireshark ? [['WiresharkFoundation.Wireshark', 'Wireshark', '/Program Files/Wireshark/Wireshark.exe']] : [])]
      .map(([id, name, exe]) => ({ id: `default-${id}`, points: 5, title: `${name} is not installed at the default location`, check: (s) => !S.listPrograms(s).some((p) => p.id === id) || !s.vfs.exists(exe) })),
  ];
  const short = (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
  const scenario = {
    id: fixed ? 'windows-round1' : `windows-deck-${seed >>> 0}`,
    version: WIN_DECK_VERSION,
    random: !fixed,
    seed: seed >>> 0,
    os: 'windows',
    title: fixed ? 'Windows Practice Round 1' : `Practice Round ${short}`,
    image: 'win11',
    imageName: 'Windows 11 Pro',
    teamId: teamId(mulberry32(seed ^ 0x5eed)),
    user: 'student',
    password: STUDENT_PW,
    rdpRequired: ctx.rdpRequired,
    readmeHtml: () => readmeHtml(ctx, fixed),
    vulns: ctx.vulns.map(({ id, category, points, title, check }) => ({ id, category, points, title, check })),
    penalties,
    forensics: ctx.forensics.map(({ n, text, answer }) => ({ n, text, answer })),
    /** Elevated PowerShell fixes for every task, in a safe order. Used by tests/windows.test.mjs. */
    solution: ctx.solves.slice().sort((a, b) => a.phase - b.phase || a.order - b.order).map(({ cmd, input }) => [cmd, ...input]),
    createMachine(opts = {}) {
      const sys = buildWindows11(opts);
      applyBase(sys, ctx);
      for (const fn of ctx.ops) fn(sys);
      writeDesktop(sys, ctx, fixed);
      sys.dirty = false;
      return sys;
    },
  };
  return scenario;
}

function applyBase(sys, ctx) {
  sys.misc.initialWinHashes = {};
  for (const a of ctx.admins) { S.addUser(sys, { name: a.name, full: a.full === 'Student' ? '' : a.full, password: a.pw, groups: ['Administrators', 'Users'], rid: a.rid, noTouch: true }); makeProfile(sys, a.name); }
  for (const u of ctx.users) { S.addUser(sys, { name: u.name, full: u.full, password: u.pw, groups: ['Users'], rid: u.rid, noTouch: true }); makeProfile(sys, u.name); }
  sys.win.nextRid = Math.max(sys.win.nextRid, ...ctx.users.map((u) => u.rid + 1), ...ctx.admins.map((a) => a.rid + 1));
  for (const u of sys.win.users) u.lastLogon = u.rid >= 1000 ? sys.now() - Math.floor(ctx.rng() * 9 + 1) * 86400000 : 0;
  S.getUser(sys, 'student').lastLogon = sys.now();
  for (const u of ctx.users) putFile(sys, `/Users/${u.name}/Documents/notes.txt`, `To do:\r\n- ${ctx.pick(['call the vendor', 'order toner', 'update the schedule', 'file the report'])}\r\n- ${ctx.pick(['team meeting Tuesday', 'lunch order Friday', 'review budget'])}\r\n`.replace(/\r/g, ''), { days: 14 });
  if (ctx.rdpRequired) {
    S.regSet(sys, S.KEYS.ts, 'fDenyTSConnections', 0, 'REG_DWORD', { noTouch: true });
    const t = S.getService(sys, 'TermService'); t.startType = 'Automatic'; t.status = 'Running'; S.spawnFor(sys, t);
    for (const n of ['SessionEnv', 'UmRdpService']) { const s = S.getService(sys, n); s.status = 'Running'; S.spawnFor(sys, s); }
  }
  if (ctx.wireshark) {
    S.listPrograms(sys).push({ id: 'WiresharkFoundation.Wireshark', name: 'Wireshark 4.4.5 x64', publisher: 'The Wireshark developer community', version: '4.4.5', latest: '4.4.5', size: 220, dir: '/Program Files/Wireshark', exe: 'Wireshark.exe', installed: '9/18/2026' });
    putFile(sys, '/Program Files/Wireshark/Wireshark.exe', 'MZ\u0090\u0000(simulated Wireshark.exe)', { size: 9800000, days: 45 });
    putFile(sys, '/Program Files/Wireshark/tshark.exe', 'MZ\u0090\u0000(simulated tshark.exe)', { size: 700000, days: 45 });
    S.regSet(sys, 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Wireshark', 'DisplayName', 'Wireshark 4.4.5 x64', 'REG_SZ', { noTouch: true });
  }
  // Chrome profile (secure defaults; Application Security cards make it insecure)
  BP.setChromium(sys, 'student', { browser: { has_seen_welcome_page: true, show_home_button: true }, homepage: 'https://www.google.com/', homepage_is_newtabpage: true, 'profile.name': 'Person 1', 'safebrowsing.enabled': true, 'session.restore_on_startup': 5 });
  // hidden files the way Explorer sees them
  sys.win.hidden = ['/programdata', ...[...ctx.admins, ...ctx.users].map((u) => `/users/${lc(u.name)}/appdata`)];
}

function writeDesktop(sys, ctx, fixed) {
  putFile(sys, '/CyberPatriot/README.html', readmeHtml(ctx, fixed), { days: 1 });
  putFile(sys, '/CyberPatriot/ScoringReport.html', '<html><body>Scoring report (live; open it from the desktop shortcut)</body></html>', { days: 1 });
  putFile(sys, '/CyberPatriot/CCSClient.exe', 'MZ\u0090\u0000(simulated CyberPatriot scoring client)', { size: 1843200, days: 1 });
  const desk = '/Users/student/Desktop';
  putFile(sys, `${desk}/CyberPatriot README.url`, '[InternetShortcut]\nURL=file:///C:/CyberPatriot/README.html\nIconFile=C:\\CyberPatriot\\CCSClient.exe\n', { days: 1 });
  putFile(sys, `${desk}/CyberPatriot Scoring Report.url`, '[InternetShortcut]\nURL=file:///C:/CyberPatriot/ScoringReport.html\nIconFile=C:\\CyberPatriot\\CCSClient.exe\n', { days: 1 });
  for (const q of ctx.forensics) putFile(sys, `${desk}/Forensics Question ${q.n}.txt`, `FORENSICS QUESTION ${q.n}\n\n${q.text}\n\nType your answer after "ANSWER:" below and save this file.\n\nANSWER: \n`, { days: 1 });
  putFile(sys, '/Users/Public/Desktop/Google Chrome.lnk', '[shortcut] C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', { days: 30 });
  putFile(sys, '/Users/Public/Desktop/Microsoft Edge.lnk', '[shortcut] C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', { days: 30 });
}

function readmeHtml(ctx, fixed) {
  const [org, what, staff] = ctx.org;
  const admins = ctx.admins.map((a) => `<li><code>${a.name}</code>${a.note === 'you' ? ' (you)' : ''}<br>password: <code>${a.pw}</code></li>`).join('');
  const usersL = ctx.users.map((u) => `<li><code>${u.name}</code></li>`).join('');
  const notServices = ctx.readme.notServices.length ? `<li>This computer is not a server for ${ctx.readme.notServices.join(', ')}. Those services should not run here.</li>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Windows 11 Practice Image README</title>
<style>
body{font:15px/1.5 "Segoe UI",system-ui,Arial,sans-serif;color:#1b1b1b;max-width:840px;margin:0 auto;padding:22px 30px 60px;background:#fff}
h1{font-size:26px;font-weight:600;margin:.2em 0 .1em}h2{font-size:18px;font-weight:600;margin:1.6em 0 .3em;border-bottom:2px solid #0067c0;padding-bottom:3px}
.sub{color:#666;margin:0 0 1em}code{background:#f0f3f8;padding:1px 5px;border-radius:3px;font-family:Consolas,"Cascadia Mono",monospace;font-size:13px}
.box{background:#f3f7fc;border-left:4px solid #0067c0;padding:8px 14px;margin:12px 0}li{margin:3px 0}
</style></head><body>
<h1>Windows 11 Practice Image</h1>
<p class="sub">${fixed ? 'Windows Practice Round 1' : `Round ${(ctx.seed >>> 0).toString(36).toUpperCase()} &middot; randomly generated practice round`} &middot; Unofficial simulator</p>
<h2>Competition Scenario</h2>
<p>${org} is ${what}. This Windows 11 Pro workstation is shared by ${staff}. Management suspects that the computer has been tampered with and has hired you as the system administrator. Find and fix security problems while keeping the computer working for its authorized users.</p>
<p>Not every program or service is a problem: read this README before you remove something.</p>
<div class="box"><b>Forensics questions</b> are on the desktop. Answer them <i>before</i> you change accounts or files, because the evidence might be removed. Type your answer after <code>ANSWER:</code> and save the file.</div>
<div class="box">Most fixes need administrator rights. Right-click <b>Terminal</b> and choose <b>Run as administrator</b>, or open the management consoles (Computer Management, Local Security Policy, Services) from Start.</div>
<h2>Authorized Administrators and Users</h2>
<p><b>Authorized Administrators:</b></p><ul>${admins}</ul>
<p><b>Authorized Users:</b></p><ul>${usersL}</ul>
<p>All other accounts are <b>not</b> authorized. Authorized users must keep their accounts. All users must have secure passwords. The built-in Guest and Administrator accounts must stay disabled.</p>
${ctx.readme.notes.map((n) => `<p>${n}</p>`).join('\n')}
<h2>Critical Services</h2>
<ul>${ctx.rdpRequired ? '<li><b>Remote Desktop</b> must stay enabled so the office manager can connect remotely. Only administrators may connect, and connections must use Network Level Authentication.</li>' : '<li>None. Remote Desktop is <b>not</b> used on this computer.</li>'}</ul>
<h2>Critical Programs</h2>
<ul><li><b>Google Chrome</b> is the required web browser and must stay installed and up to date.</li><li><b>Notepad++</b> and <b>7-Zip</b> are used by staff and must stay installed in their default locations.</li>${ctx.wireshark ? '<li><b>Wireshark</b> is used by the IT team for network troubleshooting and must stay installed.</li>' : ''}${ctx.readme.programs.map((p) => `<li>${p}.</li>`).join('')}</ul>
<h2>Company Policy</h2>
<ul>
<li>Hacking tools, password crackers, network sniffers, peer-to-peer software, AI code editors and games are prohibited.</li>
<li>Personal media files and plaintext files containing passwords are not allowed.</li>
${notServices}
<li>Windows Defender Firewall and Microsoft Defender Antivirus must be on, and Windows must be kept up to date.</li>
<li>Use a sensible password and lockout policy (at least 10 characters, a password history, limited password age, lockout after 5 to 10 failed logins for at least 30 minutes). A lockout threshold below 5 is deprecated.</li>
<li>File and printer sharing is not used; SMB version 1 must not be available.</li>
${ctx.readme.policy.map((p) => `<li>${p}</li>`).join('\n')}
</ul>
<h2>Tips</h2>
<ul><li>The <b>Scoring Report</b> on the desktop shows how many problems you have fixed, but not what is left.</li>
<li>When you are done, use the <b>↻ reshuffle</b> button in the taskbar's notification area to deal a new random round.</li></ul>
</body></html>`;
}

const windowsRound1 = makeWinRound(FIXED_SEED, { fixed: true });
export default windowsRound1;
