// The CyberPatriot (CCS) style scoring report page (HTML string), regenerated from engine.report().
import { esc } from './dom.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`; }; // the CCS report always prints UTC
const fmtRun = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
// The real report's card is covered in faint, diagonal groups of binary ("0110 0100 0111 1110 ...").
const WM = (() => {
  let t = ''; let x = 1337;
  for (let i = 0; i < 12; i++) {
    let row = '';
    for (let j = 0; j < 14; j++) { let g = ''; for (let k = 0; k < 4; k++) { x = (x * 1103515245 + 12345) & 0x7fffffff; g += (x >> 16) & 1; } row += g + ' '; }
    t += `<text x="${-160 + (i % 2) * 22}" y="${20 + i * 30}">${row}</text>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='520' height='360'><g transform='rotate(-28 260 180)' font-family='Arial,sans-serif' font-size='15' letter-spacing='1' fill='#8f979e' fill-opacity='.16'>${t}</g></svg>`)}")`;
})();

// Competition reports since 2025 hide which program was updated or removed; training images still name them.
const GENERIC = { 'Application Updates': 'Application update check passed', 'Unwanted Software': 'Unwanted software check passed', 'Prohibited Software': 'Unwanted software check passed' };

export function reportHtml(r, { mode = 'instant', title = 'CyberPatriot Practice Round', imageName = '', names = 'detailed', uid, stopped = false } = {}) {
  const line = (x, sign = '') => `<div class="l${sign ? ' pen' : ''}">${esc(names === 'generic' && GENERIC[x.category] ? GENERIC[x.category] : x.title)} - ${sign}${x.points} pts</div>`;
  const pen = r.penalties.map((p) => line(p, '-')).join('');
  const found = r.found.map((f) => line(f)).join('');
  const start = r.generatedAt - r.elapsedMs;
  const ok = '<span class="ok">OK</span>';
  const shown = String(title || '').replace(/^CyberPatriot\s+(Windows|Linux Mint|Ubuntu)\s+/i, 'CyberPatriot ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>CCS Scoring Report</title><style>
  html,body{margin:0;min-height:100%}
  body{background:#0f2a5c linear-gradient(90deg,#0b1f49 0,#1a3f86 3%,#0f2a5c 6%,#102c63 94%,#1a3f86 97%,#0b1f49 100%);font-family:Arial,Helvetica,sans-serif;color:#1b1b1b;padding:12px 4.5% 28px;box-sizing:border-box}
  .card{max-width:1000px;margin:0 auto;background:#f7f7f7 ${WM};border-radius:18px;padding:18px 34px 26px;box-shadow:0 2px 14px rgba(0,0,0,.35)}
  .logo{display:block;margin:0 auto 6px;width:122px;height:122px;object-fit:contain}
  h1{text-align:center;font-size:27px;margin:2px 0 0;font-weight:700}
  h2{text-align:center;font-size:20px;margin:0;font-weight:700}
  .net{text-align:center;font-size:16px;font-weight:700;margin:0 0 16px}
  .meta{font-size:16px;line-height:1.25;margin:0}
  .run{color:#e8962c}.ok{color:#4a9a3c}.cs{color:#3f8a33;font-weight:700}
  .warn{color:#e8962c;font-weight:700;font-size:19px;margin:16px 0}
  .sb{display:block;margin:20px 0 22px;font-size:15px;color:#2b2b8f}
  .conn{font-size:15px;line-height:1.2;margin:0 0 26px}
  .id{text-align:center;font-size:18px;font-weight:700;margin:0 0 18px}.id span{color:#3f8a33}
  .pts{text-align:center;font-size:21px;font-weight:700;margin:0 0 24px}
  h3{font-size:17px;margin:0 0 24px;font-weight:700}
  .list{margin:-10px 0 26px}
  .l{font-size:15px;line-height:1.22}
  .l.pen{color:#c62828}
  .foot{text-align:center;color:#222;font-size:14.5px;line-height:1.3;margin-top:8px}
  .foot p{margin:0 0 16px}
  </style></head><body><div class="card">
  <img class="logo" src="assets/cyberpatriot-logo.png" alt="">
  <h1>${esc(shown)}${imageName ? ` ${esc(imageName)}` : ''}</h1>
  <h2>Report Generated At: ${fmtTime(r.generatedAt)}</h2>
  <div class="net">(Network Time: ${fmtTime(r.generatedAt)})</div>
  <p class="meta">Image Start Time: ${fmtTime(start)}, Running Time: <span class="run">${fmtRun(r.elapsedMs)}</span><br>Team Start Time: ${fmtTime(start)}, Running Time: <span class="run">${fmtRun(r.elapsedMs)}</span></p>
${stopped ? '  <p class="warn">WARNING: Scoring has been stopped on this image. Set the Unique Identifier again to resume scoring.</p>\n' : ''}  <a class="sb" href="https://scoreboard.uscyberpatriot.org/" title="Opens the public scoreboard website">Click here to view the public scoreboard</a>
  <p class="conn"><b>Connection Status:</b> <span class="cs">Scoring Data Uploaded Successfully: No Errors Detected</span><br>Internet Connectivity Check: ${ok}<br>CCS Server Connection Status: ${ok}<br>CCS Server Score Upload Status: ${ok}</p>
  <div class="id">Current Team Unique ID: ${uid === null ? '<span style="color:#c62828">Not Set</span>' : `<span>${esc(uid || r.teamId)}</span>`}</div>
  <div class="pts">${r.score} out of ${r.maxScore} points received</div>
  <h3>${r.penalties.length} penalties assessed, for a loss of ${r.penaltyPoints} points:</h3>${pen ? `<div class="list">${pen}</div>` : ''}
  <h3>${r.foundCount} out of ${r.totalCount} scored checks passed, for a gain of ${r.gainPoints} points:</h3>${found ? `<div class="list">${found}</div>` : ''}
  <div class="foot"><p>This practice report copies the layout of the CCS scoring report. It is not produced by the CCS Competition System.</p><p>Unofficial CyberPatriot practice simulator${mode === 'instant' ? ' · scoring updates instantly' : ' · scoring updates about every minute'} · the page refreshes on its own.</p></div>
  </div></body></html>`;
}
