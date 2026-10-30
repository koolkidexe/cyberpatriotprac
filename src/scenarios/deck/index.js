// Randomly dealt practice rounds ("reshuffle"). makeRound(os, seed) returns a scenario object with the same shape as
// the fixed rounds in src/scenarios/*-round1. Everything is derived from the seed: the same seed always gives the same
// people, tasks, files, answers and points, so a saved game is restored by rebuilding the round from its seed.
import { buildMint21, buildUbuntu22 } from '../../images/mint21.js';
import * as users from '../../core/users.js';
import * as pk from '../../core/packages.js';
import * as sv from '../../core/services.js';
import { CARDS } from './cards.js';
import { FIRST, LAST, ORGS, STRONG } from './names.js';

export const DECK_VERSION = 1;
const STUDENT_PW = { mint: 'Student#Mint21', ubuntu: 'Student#Ubuntu22' };

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const newSeed = () => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;

// how many cards of each category a round deals: [min, max]
const DEAL = { 'User Auditing': [3, 5], 'Account Policy': [2, 4], 'Defensive Countermeasures': [2, 4], 'Application Security': [2, 4], 'Service Auditing': [1, 1], 'Prohibited Software': [1, 1], 'Prohibited Files': [1, 2], Malware: [1, 3] };

function planRound(os, seed) {
  const rng = mulberry32(seed);
  const used = new Set(['student', 'root']);
  const ctx = {
    os, seed, rng, browser: os === 'ubuntu' ? 'firefox' : 'chromium',
    int: (a, b) => a + Math.floor(rng() * (b - a + 1)),
    chance: (p) => rng() < p,
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    person() {
      for (;;) {
        const f = ctx.pick(FIRST); const l = ctx.pick(LAST);
        const name = (f[0] + l).toLowerCase();
        if (!used.has(name)) { used.add(name); return { name, full: `${f} ${l}` }; }
      }
    },
    strongPw() { return `${ctx.pick(STRONG)}${ctx.int(10, 99)}`; },
    ops: [], vulns: [], solves: [], forensics: [], unauthorized: [], lateAdmins: [], critical: ['ssh'], usedPkgs: new Set(),
    readme: { notes: [], policy: [], programs: [], notServices: [] },
    apply(fn) { ctx.ops.push(fn); },
    vuln(v) { ctx.vulns.push({ ...v, category: v.category || ctx.cat, base: v.pts || ctx.basePts }); },
    solve(phase, cmd, ...input) { ctx.solves.push({ phase, order: ctx.solves.length, cmd, input }); },
    forensic(text, answer) { ctx.forensics.push({ text, answer }); },
    takeUser() { const u = ctx.users.find((x) => !x.taken); if (!u) return null; u.taken = true; return u.name; },
  };
  // ---- the organisation and its people
  const org = ctx.pick(ORGS);
  ctx.org = org;
  ctx.admins = [{ name: 'student', full: 'Student', pw: STUDENT_PW[os], note: 'you' }];
  for (let i = 0, n = ctx.int(1, 2); i < n; i++) { const p = ctx.person(); ctx.admins.push({ ...p, pw: ctx.strongPw(), note: ctx.pick(['Manager', 'IT Lead', 'Director', 'Supervisor', 'Office Manager']) }); }
  ctx.users = [];
  for (let i = 0, n = ctx.int(5, 8); i < n; i++) ctx.users.push({ ...ctx.person(), pw: ctx.strongPw() });
  ctx.users = ctx.shuffle(ctx.users);

  // ---- deal the cards
  const byCat = {};
  for (const c of CARDS) if (!c.forensic && (!c.os || c.os === os)) (byCat[c.cat] ||= []).push(c);
  const dealt = [];
  for (const [cat, [lo, hi]] of Object.entries(DEAL)) {
    const pool = (byCat[cat] || []).flatMap((c) => Array(c.weight || 1).fill(c));
    const n = ctx.int(lo, hi);
    const chosen = [];
    for (const c of ctx.shuffle(pool)) { if (chosen.length >= n) break; if (!chosen.includes(c)) chosen.push(c); }
    dealt.push(...chosen);
  }
  // user tasks that create accounts run before tasks that may target the new account
  const order = ['unauth', 'uid0', 'newhire'];
  dealt.sort((a, b) => (order.includes(b.id) - order.includes(a.id)) || 0);
  for (const c of dealt) { ctx.cat = c.cat; ctx.basePts = c.pts; c.plan(ctx); }
  const dealtIds = new Set(dealt.map((c) => c.id));
  const fqPool = ctx.shuffle(CARDS.filter((c) => c.forensic && (!c.requires || dealtIds.has(c.requires))));
  for (const c of fqPool.slice(0, ctx.int(2, 3))) { ctx.cat = 'Forensics'; c.plan(ctx); }

  // ---- forensic questions become scored checks; answers are the solver's first step
  ctx.forensics.forEach((q, i) => {
    q.n = i + 1;
    const path = `/home/student/Desktop/Forensics Question ${q.n}.txt`;
    ctx.vulns.unshift({ id: `fq${q.n}`, category: 'Forensics', base: 0, fq: true, title: `Forensics Question ${q.n} correct`, check: (s) => answerOf(s, path).toLowerCase() === q.answer.toLowerCase() });
    ctx.solves.push({ phase: 0, order: i, cmd: `sed -i 's|^ANSWER:.*|ANSWER: ${q.answer}|' ~/Desktop/Forensics\\ Question\\ ${q.n}.txt`, input: [] });
  });
  ctx.vulns.sort((a, b) => (b.fq ? 1 : 0) - (a.fq ? 1 : 0) || (a.fq && b.fq ? a.id.localeCompare(b.id) : 0));

  // ---- points: forensics 5-8 each, everything else scaled from the card weights so the total is exactly 100
  const fqPts = ctx.forensics.length === 3 ? 6 : ctx.pick([6, 7, 8]);
  const fqTotal = fqPts * ctx.forensics.length;
  const rest = ctx.vulns.filter((v) => !v.fq);
  const B = rest.reduce((a, v) => a + v.base, 0);
  const raw = rest.map((v) => (v.base * (100 - fqTotal)) / B);
  const pts = raw.map((r) => Math.max(2, Math.floor(r)));
  let diff = 100 - fqTotal - pts.reduce((a, b) => a + b, 0);
  const byRem = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; diff !== 0 && k < 1000; k++) {
    const i = byRem[k % byRem.length][1];
    if (diff > 0) { pts[i]++; diff--; } else if (pts[i] > 2) { pts[i]--; diff++; }
  }
  rest.forEach((v, i) => { v.points = pts[i]; });
  ctx.vulns.filter((v) => v.fq).forEach((v) => { v.points = fqPts; });
  return ctx;
}

const rd = (sys, p) => (sys.vfs.isFile(p) ? sys.vfs.readFile(p) : null);
function answerOf(sys, path) { const t = rd(sys, path); const m = t && /^ANSWER:[ \t]*(.*)$/m.exec(t); return m ? m[1].trim() : ''; }

const teamId = (rng) => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 32)]).join('')).join('-');

export function makeRound(os, seed) {
  const ctx = planRound(os, seed >>> 0);
  const browserName = ctx.browser === 'chromium' ? 'Chromium' : 'Mozilla Firefox';
  const authorized = [...ctx.admins.map((a) => a.name), ...ctx.users.map((u) => u.name)];
  const penalties = [
    ...authorized.filter((n) => n !== 'student').map((name) => ({ id: `auth-${name}`, points: 5, title: `Authorized user ${name} was removed`, check: (s) => !users.getUser(s, name) })),
    { id: 'student-sudo', points: 5, title: 'Authorized administrator student lost administrator rights', check: (s) => !!users.getUser(s, 'student') && !users.isAdmin(s, 'student') },
    { id: 'ssh-crit', points: 5, title: 'Critical service OpenSSH is stopped, disabled or removed', check: (s) => !pk.isInstalled(s, 'openssh-server') || !sv.isActive(s, 'ssh') || !sv.isEnabled(s, 'ssh') },
    { id: `${ctx.browser}-crit`, points: 5, title: `Required program ${browserName} was removed`, check: (s) => !pk.isInstalled(s, ctx.browser) },
  ];
  const short = (seed >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
  const imageName = os === 'ubuntu' ? 'Ubuntu 22.04' : 'Linux Mint 21.3 Cinnamon';
  const scenario = {
    id: `${os}-deck-${seed >>> 0}`,
    version: DECK_VERSION,
    random: true,
    seed: seed >>> 0,
    title: `Practice Round ${short}`,
    image: os === 'ubuntu' ? 'ubuntu22' : 'mint21',
    imageName,
    teamId: teamId(mulberry32(seed ^ 0x5eed)),
    user: 'student',
    password: STUDENT_PW[os],
    readmeHtml: () => readmeHtml(ctx, os),
    vulns: ctx.vulns.map(({ id, category, points, title, check }) => ({ id, category, points, title, check })),
    penalties,
    forensics: ctx.forensics.map(({ n, text, answer }) => ({ n, text, answer })),
    /** The terminal fix for every task, in a safe order (forensics first). Used by tests/deck.test.mjs. */
    solution: ctx.solves.slice().sort((a, b) => a.phase - b.phase || a.order - b.order).map(({ cmd, input }) => [cmd, ...input]),
    createMachine(opts = {}) {
      const sys = (os === 'ubuntu' ? buildUbuntu22 : buildMint21)(opts);
      applyBase(sys, ctx, os);
      for (const fn of ctx.ops) fn(sys);
      writeDesktop(sys, ctx, os, scenario);
      sys.dirty = false;
      return sys;
    },
  };
  return scenario;
}

function applyBase(sys, ctx, os) {
  users.setPassword(sys, 'student', STUDENT_PW[os]);
  let uid = 1001;
  for (const a of ctx.admins.slice(1)) users.userAdd(sys, { name: a.name, uid: uid++, password: a.pw, groups: a.noSudo ? ['cdrom', 'plugdev'] : ['sudo', 'cdrom', 'plugdev'], gecos: `${a.full},,,` });
  for (const u of ctx.users) users.userAdd(sys, { name: u.name, uid: uid++, password: u.pw, groups: [], gecos: `${u.full},,,` });
  sys.misc.initialHashes = {};
  for (const n of [...ctx.admins.map((a) => a.name), ...ctx.users.map((u) => u.name)]) users.chage(sys, n, { max: 99999 });
  // ordinary files so every home folder looks lived in
  for (const u of ctx.users) {
    const p = `/home/${u.name}/Documents/notes.txt`;
    const o = users.getUser(sys, u.name);
    if (!sys.vfs.exists(`/home/${u.name}/Documents`)) sys.vfs.mkdir(`/home/${u.name}/Documents`, { parents: true, mode: 0o755, uid: o.uid, gid: o.gid });
    sys.vfs.writeFile(p, `To do:\n- ${ctx.pick(['call the vendor', 'order toner', 'update the schedule', 'file the report'])}\n- ${ctx.pick(['team meeting Tuesday', 'lunch order Friday', 'review budget'])}\n`, { mode: 0o644, uid: o.uid, gid: o.gid });
  }
}

function writeDesktop(sys, ctx, os, scenario) {
  const st = users.getUser(sys, 'student');
  const o = { uid: st.uid, gid: st.gid };
  const desk = '/home/student/Desktop';
  const browserCmd = ctx.browser;
  if (!sys.vfs.exists('/opt/CyberPatriot')) sys.vfs.mkdir('/opt/CyberPatriot', { parents: true, mode: 0o755 });
  sys.vfs.writeFile('/opt/CyberPatriot/README.html', readmeHtml(ctx, os), { mode: 0o644, uid: 0, gid: 0 });
  sys.vfs.writeFile('/opt/CyberPatriot/ScoringReport.html', '<html><body>Scoring report (live; open it from the Desktop shortcut)</body></html>', { mode: 0o644, uid: 0, gid: 0 });
  if (!sys.vfs.exists(desk)) sys.vfs.mkdir(desk, { parents: true, mode: 0o755, ...o });
  sys.vfs.writeFile(`${desk}/Scenario README.desktop`, `[Desktop Entry]\nType=Application\nName=Scenario README\nExec=${browserCmd} file:///opt/CyberPatriot/README.html\nIcon=cyberpatriot\nTerminal=false\n`, { mode: 0o755, ...o });
  sys.vfs.writeFile(`${desk}/Scoring Report.desktop`, `[Desktop Entry]\nType=Application\nName=Scoring Report\nExec=${browserCmd} file:///opt/CyberPatriot/ScoringReport.html\nIcon=cyberpatriot\nTerminal=false\n`, { mode: 0o755, ...o });
  for (const q of ctx.forensics) sys.vfs.writeFile(`${desk}/Forensics Question ${q.n}.txt`, `FORENSICS QUESTION ${q.n}\n\n${q.text}\n\nType your answer after "ANSWER:" below and save this file.\n\nANSWER: \n`, { mode: 0o644, ...o });
  if (!sys.vfs.exists('/home/student/.bash_history')) sys.vfs.writeFile('/home/student/.bash_history', '', { mode: 0o600, ...o });
  void scenario;
}

function readmeHtml(ctx, os) {
  const [org, what, staff] = ctx.org;
  const accent = os === 'ubuntu' ? '#e95420' : '#8fa876';
  const distro = os === 'ubuntu' ? 'Ubuntu 22.04' : 'Linux Mint 21';
  const admins = ctx.admins.map((a) => `<li><code>${a.name}</code>${a.note === 'you' ? ' (you)' : ''}<br>password: <code>${a.pw}</code></li>`).join('');
  const usersL = ctx.users.map((u) => `<li><code>${u.name}</code></li>`).join('');
  const browser = ctx.browser === 'chromium' ? 'Chromium' : 'Mozilla Firefox';
  const prog = ctx.readme.programs.length ? ` It must ${ctx.readme.programs.join(' and ')}.` : '';
  const notServices = ctx.readme.notServices.length ? `<li>This computer is not used as a server for ${ctx.readme.notServices.join(', ')}.</li>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${distro} Practice Image README</title>
<style>
body{font:15px/1.5 "Noto Sans","DejaVu Sans",Arial,sans-serif;color:#222;max-width:820px;margin:0 auto;padding:22px 30px 60px;background:#fff}
h1{font-size:26px;margin:.2em 0 .1em}h2{font-size:18px;margin:1.6em 0 .3em;border-bottom:2px solid ${accent};padding-bottom:3px}
.sub{color:#666;margin:0 0 1em}code{background:#f0f0ec;padding:1px 5px;border-radius:3px;font-family:"DejaVu Sans Mono",monospace;font-size:13px}
.box{background:#f6f6f2;border-left:4px solid ${accent};padding:8px 14px;margin:12px 0}li{margin:3px 0}
</style></head><body>
<h1>${distro} Practice Image</h1>
<p class="sub">Round ${(ctx.seed >>> 0).toString(36).toUpperCase()} &middot; randomly generated practice round &middot; Unofficial simulator</p>
<h2>Competition Scenario</h2>
<p>${org} is ${what}. This ${distro} workstation is shared by ${staff}. Management suspects that the computer has been tampered with and has hired you as the system administrator. Find and fix security problems while keeping the computer working for its authorized users.</p>
<p>Not every package or service is a problem: check this README before you remove something.</p>
<div class="box"><b>Forensics questions</b> are on the desktop. Answer them <i>before</i> you change accounts or files, because the evidence might be removed. Type your answer after <code>ANSWER:</code> and save the file.</div>
<h2>Authorized Administrators and Users</h2>
<p><b>Authorized Administrators:</b></p><ul>${admins}</ul>
<p><b>Authorized Users:</b></p><ul>${usersL}</ul>
<p>All other accounts are <b>not</b> authorized. Authorized users must keep their accounts. All users must have secure passwords.</p>
${ctx.readme.notes.map((n) => `<p>${n}</p>`).join('\n')}
<h2>Critical Services</h2>
<ul><li><b>OpenSSH server</b> (<code>ssh</code>) must stay installed, running and enabled at boot.</li></ul>
<h2>Critical Programs</h2>
<ul><li><b>${browser}</b> is the required web browser and must stay installed and up to date.${prog}</li></ul>
<h2>Company Policy</h2>
<ul>
<li>Hacking tools, password crackers, network sniffers, peer-to-peer software and games are prohibited.</li>
<li>Personal media files and plaintext files containing passwords are not allowed.</li>
${notServices}
<li>The firewall must be enabled and the system must be kept up to date.</li>
<li>Use a sensible password policy (passwords of at least 10 characters, limited password age, lockout after failed logins).</li>
<li><code>sudo</code> must always require a password, and remote login as <code>root</code> is not allowed.</li>
${ctx.readme.policy.map((p) => `<li>${p}</li>`).join('\n')}
</ul>
<h2>Tips</h2>
<ul><li>The <b>Scoring Report</b> on the desktop shows how many problems you have fixed, but not what is left.</li>
<li>When you are done, use the <b>↻ reshuffle</b> button in the panel to deal a new random round.</li></ul>
</body></html>`;
}
