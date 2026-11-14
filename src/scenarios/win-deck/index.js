// Windows 11 rounds. makeWinRound(seed) deals a random round from the Windows deck (cards.js); the fixed
// "Windows Practice Round 1" is simply the round dealt from a fixed seed. Same shape as the Linux scenarios.
import { buildWindows11, makeProfile, putFile } from '../../win/image.js';
import * as S from '../../win/state.js';
import * as BP from '../../core/browserprefs.js';
import { CARDS } from './cards.js';
import * as R1 from './round1.js';
import * as SRV1 from './server1.js';
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
// "Windows Practice Round 1" is the hand-written Northstar Tabletop scenario in round1.js (32 checks, 100 points);
// every other round is dealt at random from the deck.

function planRound(seed, fixed = false, V = 11) {
  const rng = mulberry32(seed);
  const used = new Set(['student', 'administrator', 'guest']);
  let nextRid = 1001;
  const ctx = {
    os: 'windows', seed, rng, studentPw: STUDENT_PW, server: V === 2022,
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
    forensic(text, answer, check) { ctx.forensics.push({ text, answer, check }); },
    takeUser() { const u = ctx.users.find((x) => !x.taken); if (!u) return null; u.taken = true; return u.name; },
    makeProfile,
  };
  if (fixed) return planFixed(ctx, V === 2022 ? SRV1 : R1);
  ctx.org = ctx.pick(ORGS);
  ctx.rdpRequired = ctx.chance(0.35);
  ctx.wireshark = ctx.chance(0.5); // Wireshark is a required tool when a packet-capture question is in play
  ctx.admins = [{ name: 'student', full: 'Student', pw: STUDENT_PW, note: 'you', rid: nextRid++ }];
  for (let i = 0, n = ctx.int(1, 2); i < n; i++) { const p = ctx.person(); ctx.admins.push({ ...p, pw: ctx.strongPw(), note: ctx.pick(['Manager', 'IT Lead', 'Director', 'Supervisor', 'Office Manager']), rid: nextRid++ }); }
  ctx.users = [];
  for (let i = 0, n = ctx.int(5, 8); i < n; i++) ctx.users.push({ ...ctx.person(), pw: ctx.strongPw(), rid: nextRid++ });
  ctx.users = ctx.shuffle(ctx.users);

  // ---- deal the cards
  const byCat = {};
  for (const c of CARDS) if (!c.forensic && (!c.when || c.when(ctx))) (byCat[c.cat] ||= []).push(c);
  let dealt = [];
  for (const [cat, [lo, hi]] of Object.entries(DEAL)) {
    const pool = byCat[cat] || [];
    const n = Math.min(pool.length, ctx.int(lo, hi));
    const groups = new Set(dealt.map((c) => c.group).filter(Boolean));
    let k = 0;
    for (const c of ctx.shuffle(pool)) { if (k >= n) break; if (c.group && groups.has(c.group)) continue; if (c.group) groups.add(c.group); dealt.push(c); k++; }
  }
  const first = ['unauth', 'newhire'];
  dealt.sort((a, b) => (first.includes(b.id) - first.includes(a.id)) || 0);
  for (const c of dealt) { ctx.cat = c.cat; ctx.basePts = c.pts; c.plan(ctx); }
  const dealtIds = new Set(dealt.map((c) => c.id));
  const ok = (c) => !c.requires || (c.requires === 'wireshark' ? ctx.wireshark : dealtIds.has(c.requires));
  const fqs = ctx.shuffle(CARDS.filter((c) => c.forensic && ok(c))).slice(0, ctx.int(2, 3));
  for (const c of fqs) { ctx.cat = 'Forensics'; c.plan(ctx); }

  finishForensics(ctx);

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

/** The fixed round: people and checks from round1.js, with the point values written there (they add up to 100). */
function planFixed(ctx, R) {
  R.people(ctx);
  const card = (id, pts) => { const c = CARDS.find((x) => x.id === id); ctx.cat = c.cat; ctx.basePts = pts; c.plan(ctx); };
  R.plan(ctx, card);
  finishForensics(ctx);
  for (const v of ctx.vulns) v.points = v.fq ? ctx.fqPoints : v.base;
  const total = ctx.vulns.reduce((a, v) => a + v.points, 0);
  if (total !== 100) throw new Error(`Practice Round 1 adds up to ${total}, not 100`);
  return ctx;
}

function finishForensics(ctx) {
  // ---- forensics become scored checks; answering them is the solver's first step
  ctx.forensics.forEach((fq, i) => {
    fq.n = i + 1;
    const path = `/Users/student/Desktop/Forensics Question ${fq.n}.txt`;
    ctx.vulns.unshift({ id: `fq${fq.n}`, category: 'Forensics', base: 0, fq: true, title: `Forensics Question ${fq.n} correct`, check: (s) => (fq.check ? fq.check(answersOf(s, path)) : lc(answerOf(s, path)) === lc(fq.answer)) });
    const win = S.toWin(path);
    ctx.solves.push({ phase: 0, order: i, cmd: `(Get-Content '${win}') -replace '^ANSWER: <Type Answer Here>', 'ANSWER: ${fq.answer.replace(/'/g, "''")}' | Set-Content '${win}'`, input: [] });
  });
  // report order: Forensics first, then the CyberPatriot category order
  ctx.vulns.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || (a.fq && b.fq ? a.id.localeCompare(b.id) : 0));
}

/** The scored answer is the first ANSWER: line after the ===== separator (the lines above it are the worked examples). */
function answersOf(sys, path) {
  const t = sys.vfs.isFile(path) ? sys.vfs.readFile(path).replace(/\r/g, '') : '';
  const parts = t.split(/^={10,}\s*$/m);
  const body = parts.length > 1 ? parts[parts.length - 1] : t;
  return [...body.matchAll(/^ANSWER:[ \t]*(.*)$/gm)].map((m) => m[1].trim()).filter((v) => v && !/^<type answer here>$/i.test(v));
}
function answerOf(sys, path) {
  const t = sys.vfs.isFile(path) ? sys.vfs.readFile(path).replace(/\r/g, '') : '';
  const parts = t.split(/^={10,}\s*$/m);
  const body = parts.length > 1 ? parts[parts.length - 1] : t;
  for (const m of body.matchAll(/^ANSWER:[ \t]*(.*)$/gm)) { const v = m[1].trim(); if (v && !/^<type answer here>$/i.test(v)) return v; }
  return '';
}
export function forensicsFile(q) {
  return `This is a forensics question. Answer it below.

Here is an example question:

What color is a clear daytime sky?

ANSWER: <Type Answer Here>

After correctly answering the question, the example question would look like this:

What color is a clear daytime sky?

ANSWER: Blue

If the question has more than one answer, place each answer on a separate line, for example:

Name two primary colors.

ANSWER: Red
ANSWER: Blue

Remember to save the file after typing the answer.
The scored question appears below.

${'='.repeat(58)}

${q.text}

ANSWER: <Type Answer Here>
`.replace(/\n/g, '\r\n');
}
const teamId = (rng) => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 32)]).join('')).join('-');

export function makeWinRound(seed, { fixed = false, ver = 11 } = {}) {
  const V = ver === 2022 || ver === 'server' ? 2022 : ver === 10 ? 10 : 11;
  const SRV = V === 2022;
  const ctx = planRound(seed >>> 0, fixed, V);
  const authorized = [...ctx.admins.map((a) => a.name), ...ctx.users.map((u) => u.name)];
  const penalties = [
    ...authorized.filter((n) => n !== 'student').map((name) => ({ id: `auth-${name}`, points: 5, title: `Authorized user ${name} was removed`, check: (s) => !S.getUser(s, name) })),
    { id: 'student-admin', points: 5, title: 'Authorized administrator student lost administrator rights', check: (s) => !!S.getUser(s, 'student') && !S.isAdmin(s, 'student') },
    ...(ctx.rdpRequired ? [{ id: 'rdp-crit', points: 5, title: 'Critical service Remote Desktop is disabled or stopped', check: (s) => !S.rdpEnabled(s) || !S.serviceOn(s, 'TermService') }] : []),
    ...(ctx.apache ? [{ id: 'apache-crit', points: 5, title: 'Critical service Apache2.4 is stopped or removed', check: (s) => !S.serviceOn(s, 'Apache2.4') || !s.vfs.exists('/Apache24/bin/httpd.exe') }] : []),
    ...(ctx.critical || []).map((c) => ({ id: `crit-${c.name}`, points: 5, title: `Critical service ${c.display} is not running`, check: (s) => !S.serviceOn(s, c.name) })),
    ...(ctx.fileServer ? [{ id: 'crit-smb', points: 5, title: 'Critical service Server (SMB file sharing) is stopped or disabled', check: (s) => !S.serviceOn(s, 'LanmanServer') }, ...['Projects', 'Templates'].map((n) => ({ id: `share-${n}`, points: 5, title: `Critical file share ${n} was removed`, check: (s) => !s.win.shares.some((x) => x.name.toLowerCase() === n.toLowerCase()) }))] : []),
    { id: 'lockout-low', points: 5, title: 'Account lockout threshold less than 5 is deprecated', check: (s) => s.win.policy.lockoutThreshold > 0 && s.win.policy.lockoutThreshold < 5 },
    // the answer key's "not installed at the default location" penalties: removing or moving a required program
    ...[['Mozilla.Firefox', 'Firefox', '/Program Files/Mozilla Firefox/firefox.exe'], ...(SRV ? [] : [['Mozilla.Thunderbird', 'Thunderbird', '/Program Files/Mozilla Thunderbird/thunderbird.exe']]), ['Notepad++.Notepad++', 'Notepad++', '/Program Files/Notepad++/notepad++.exe'], ['7zip.7zip', '7-Zip', '/Program Files/7-Zip/7z.exe'], ...(ctx.wireshark ? [['WiresharkFoundation.Wireshark', 'Wireshark', '/Program Files/Wireshark/Wireshark.exe']] : [])]
      .map(([id, name, exe]) => ({ id: `default-${id}`, points: 5, title: `${name} is not installed at the default location`, check: (s) => !S.listPrograms(s).some((p) => p.id === id) || !s.vfs.exists(exe) })),
  ];
  const short = (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
  const scenario = {
    id: `${SRV ? 'server' : V === 10 ? 'windows10' : 'windows'}-${fixed ? 'round1' : `deck-${seed >>> 0}`}`,
    winVer: V,
    version: WIN_DECK_VERSION,
    random: !fixed,
    seed: seed >>> 0,
    os: 'windows',
    title: fixed ? (SRV ? 'Server 2022 Practice Round 1' : 'Windows Practice Round 1') : `Practice Round ${short}`,
    image: 'win11',
    imageName: SRV ? 'Windows Server 2022' : V === 10 ? 'Windows 10 Pro' : 'Windows 11 Pro',
    teamId: teamId(mulberry32(seed ^ 0x5eed)),
    user: 'student',
    password: STUDENT_PW,
    rdpRequired: ctx.rdpRequired,
    readmeHtml: () => readmeHtml(ctx, fixed, V),
    vulns: ctx.vulns.map(({ id, category, points, title, check }) => ({ id, category, points, title, check })),
    penalties,
    forensics: ctx.forensics.map(({ n, text, answer }) => ({ n, text, answer })),
    /** Elevated PowerShell fixes for every task, in a safe order. Used by tests/windows.test.mjs. */
    solution: ctx.solves.slice().sort((a, b) => a.phase - b.phase || a.order - b.order).map(({ cmd, input }) => [cmd, ...input]).concat([['Restart-Computer -Force']]),
    createMachine(opts = {}) {
      const sys = buildWindows11({ ...opts, ver: V });
      applyBase(sys, ctx);
      for (const fn of ctx.ops) fn(sys);
      writeDesktop(sys, ctx, fixed, V);
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
  // Firefox profile in %APPDATA% (secure defaults; Application Security cards make it insecure)
  BP.seedWindowsFirefox(sys, 'student');
  // hidden files the way Explorer sees them
  sys.win.hidden = ['/programdata', ...[...ctx.admins, ...ctx.users].map((u) => `/users/${lc(u.name)}/appdata`)];
}

function writeDesktop(sys, ctx, fixed, V) {
  putFile(sys, '/CyberPatriot/README.html', readmeHtml(ctx, fixed, V), { days: 1 });
  putFile(sys, '/CyberPatriot/ScoringReport.html', '<html><body>Scoring report (live; open it from the desktop shortcut)</body></html>', { days: 1 });
  for (const [f, n] of [['CCSClient.exe', 1843200], ['CCSClientUID.exe', 412160], ['CCSStopScoring.exe', 198144]]) putFile(sys, `/CyberPatriot/${f}`, 'MZ\u0090\u0000(simulated CyberPatriot scoring client)', { size: n, days: 1 });
  const desk = '/Users/student/Desktop';
  // the CyberPatriot shortcuts, named as on competition images
  putFile(sys, `${desk}/CyberPatriot Set Unique Identifier.lnk`, '[shortcut] C:\\CyberPatriot\\CCSClientUID.exe\n[runas]', { days: 1 });
  putFile(sys, `${desk}/CyberPatriot README.lnk`, '[shortcut] C:\\CyberPatriot\\README.html', { days: 1 });
  putFile(sys, `${desk}/CyberPatriot Scoring Report.lnk`, '[shortcut] C:\\CyberPatriot\\ScoringReport.html', { days: 1 });
  putFile(sys, `${desk}/CyberPatriot Stop Scoring.lnk`, '[shortcut] C:\\CyberPatriot\\CCSStopScoring.exe\n[runas]', { days: 1 });
  for (const q of ctx.forensics) putFile(sys, `${desk}/Forensics Question ${q.n}.txt`, forensicsFile(q), { days: 1 });
  putFile(sys, '/Users/Public/Desktop/Firefox.lnk', '[shortcut] C:\\Program Files\\Mozilla Firefox\\firefox.exe', { days: 30 });
  if (V !== 2022) putFile(sys, '/Users/Public/Desktop/Mozilla Thunderbird.lnk', '[shortcut] C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe', { days: 30 });
}

function readmeHtml(ctx, fixed, V = 11) {
  const [org, what, staff] = ctx.org;
  const SRV = V === 2022;
  const W = SRV ? 'Windows Server 2022' : V === 10 ? 'Windows 10' : 'Windows 11';
  const admins = ctx.admins.map((a) => `${a.name}${a.note === 'you' ? ' (you)' : ''}<div class="pw">password: ${a.pw}</div>`).join('');
  const usersL = ctx.users.map((u) => `<div>${u.name}</div>`).join('');
  const notServices = ctx.readme.notServices.length ? `<p>This computer is not used as a server for ${ctx.readme.notServices.join(', ')}. Those services should not be running.</p>` : '';
  const title = fixed ? `${W} Practice Round 1` : `${W} Practice Round ${(ctx.seed >>> 0).toString(36).toUpperCase()}`;
  const nav = ['Home', 'About the Simulator', 'Practice Rounds', 'Scoring Report Help', 'Windows Checklist', 'Forensics Tips', 'Linux Checklist', 'Glossary'].map((n) => `<a href="#top">${n}</a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} README</title>
<style>
html,body{margin:0}body{font:15px/1.55 "Segoe UI",Arial,sans-serif;color:#222;background:#041627 repeating-linear-gradient(115deg,rgba(0,190,220,.06) 0 2px,transparent 2px 46px),radial-gradient(1200px 700px at 70% 20%,#0d4a6b,#041627);min-height:100vh}
.page{display:flex;gap:22px;max-width:1080px;margin:0 auto;padding:22px}
.side{width:210px;flex:none;background:#fff;align-self:flex-start;padding:10px 0;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.side a{display:block;padding:5px 16px;color:#0a7fa5;font-size:12px;font-weight:700;text-transform:uppercase;text-decoration:none}.side a:hover{background:#eaf6fa}
.main{flex:1;background:#fff;padding:22px 34px 40px;box-shadow:0 2px 14px rgba(0,0,0,.35)}
h1{font-size:24px;margin:0 0 4px;color:#0b2f4a}.sub{color:#777;font-size:13px;margin-bottom:16px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.3px;margin:24px 0 8px;color:#111}
.box{background:#f5f5f5;border:1px solid #e3e3e3;padding:10px 12px;font-size:14px}.box .pw{padding-left:20px}.box b{display:block;margin:6px 0 2px}
ul{padding-left:22px}li{margin:4px 0}code{background:#eef3f6;padding:1px 5px;border-radius:3px;font-family:Consolas,monospace;font-size:13px}
.foot{margin-top:30px;text-align:center;color:#666;font-size:13px}
</style></head><body><div class="page" id="top"><nav class="side">${nav}</nav><div class="main">
<h1>${title}</h1><div class="sub">Unofficial CyberPatriot-style practice image &middot; ${org}</div>
<h2>Unique Identifier</h2>
<p>When the image starts you are asked to accept the competitor agreement and to enter your team's 12-character Unique Identifier. If you skipped it, double-click <b>CyberPatriot Set Unique Identifier</b> on the desktop. In this simulator any 12 letters and digits work (for example <code>ABCD-1234-EFGH</code>).</p>
<h2>Forensics Questions</h2>
<p>If there are "Forensics Questions" on your desktop, you will receive points for answering them correctly. Valid (scored) questions are worth points only if you get the answer exactly right. Answer them before changing the computer, because fixing problems may remove the evidence you need.</p>
<h2>Competition Scenario</h2>
<p>${org} is ${what}. This ${W} ${SRV ? 'file server is used by' : 'workstation is shared by'} ${staff}. Employees should use secure passwords, and the use of hacking tools, games and personal media is strictly prohibited. Management suspects the computer has been tampered with and has asked you, the system administrator, to secure it while keeping the authorized business software working.</p>
<p>Company policy says that Windows Security (the Security Center) must stay enabled and keep monitoring the security status of this computer at all times.</p>
<p>This is a critical computer in a production environment. Do <b>NOT</b> install Windows "Feature Updates" or "Insider Preview" builds, and do <b>NOT</b> use the recovery options "Reset this PC" or "Go back to an earlier build".</p>
<h2>${W}</h2>
<p>It is company policy to use only ${W} on this computer. Management has decided that the default web browser for all users is the latest stable version of <b>Firefox</b>.${SRV ? '' : ' <b>Thunderbird</b> is also required and should be updated to the latest stable version.'}</p>
${ctx.fileServer ? '<p>This server shares project files with the office over <b>SMB</b>. The <b>Server</b> service and the <code>Projects</code> and <code>Templates</code> shares are critical and must keep working; any other share that is not described in this README is not authorized. The IT lead manages the server with <b>Remote Desktop</b>, which must stay enabled.</p>' : ''}
<p>${ctx.fileServer ? '' : ctx.critical ? `This workstation must keep the following critical services running: ${ctx.critical.map((c) => `<b>${c.display}</b>`).join(', ')}. The studio's build server copies files to it over SSH.` : ctx.rdpRequired ? 'The office manager connects to this computer with <b>Remote Desktop</b>, which must stay enabled; only administrators may connect, and connections must use Network Level Authentication.' : 'This is a standalone workstation and does not have any business critical services. Remote Desktop is not used.'}</p>
${notServices}
${ctx.readme.notes.map((n) => `<p>${n}</p>`).join('\n')}
<h2>Authorized Administrators and Users</h2>
<div class="box"><b>Authorized Administrators:</b>${admins}<b style="margin-top:12px">Authorized Users:</b>${usersL}</div>
<h2>Critical Programs</h2>
<ul><li><b>Firefox</b>${SRV ? '' : ' and <b>Thunderbird</b>'} must stay installed in ${SRV ? 'its default location' : 'their default locations'} and be kept up to date.</li><li><b>Notepad++</b> and <b>7-Zip</b> are used by staff and must stay installed in their default locations.</li>${ctx.wireshark ? '<li><b>Wireshark</b> is used by the IT team for network troubleshooting and must stay installed.</li>' : ''}</ul>
<h2>Company Policy</h2>
<ul><li>Hacking tools, password crackers, network scanners and sniffers, peer-to-peer software, AI code editors and games are prohibited.</li>
<li>Personal media files and plaintext files containing passwords are not allowed.</li>
<li>Windows Defender Firewall and Microsoft Defender Antivirus must be on, and Windows must be kept up to date.</li>
<li>Use a sensible password and lockout policy: at least 10 characters, a password history, limited password age, and lockout after 5 to 10 failed logins for at least 30 minutes. A lockout threshold below 5 is deprecated.</li>
<li>${ctx.fileServer ? 'Only the file shares named in this README are allowed' : 'File and printer sharing is not used'}; SMB version 1 must not be available.</li>
${ctx.readme.policy.map((p) => `<li>${p}</li>`).join('\n')}</ul>
<h2>Competition Guidelines</h2>
<ul><li>You do <b>not</b> need to change the password of the main account that signs in automatically; doing so may lock you out.</li>
<li>Do not stop or disable the CyberPatriot scoring client service or its process.</li>
<li>Do not remove any authorized users or their home folders.</li>
<li>The time zone of this image is UTC. Do not change the time zone, date or time.</li>
<li>You can see your current score by double-clicking <b>CyberPatriot Scoring Report</b> on the desktop.</li>
<li>Some security settings may stop the Stop Scoring program from running; in a real round the safe way out is to suspend the virtual machine.</li>
<li>Finished? Use the <b>↻ reshuffle</b> icon in the notification area to deal a new random practice round.</li></ul>
<div class="foot">Unofficial practice simulator. Not affiliated with the CyberPatriot program.${fixed && !SRV ? '<br>Scenario adapted from the Windows practice simulation by Krishna Ajay.' : ''}</div>
</div></div></body></html>`;
}

const windowsRound1 = makeWinRound(FIXED_SEED, { fixed: true });
export const serverRound1 = makeWinRound(FIXED_SEED, { fixed: true, ver: 2022 });
export default windowsRound1;
