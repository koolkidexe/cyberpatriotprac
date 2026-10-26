// The CyberPatriot (CCS) style scoring report page (HTML string), regenerated from engine.report().
import { esc } from './dom.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).format(d).split(', ')[1] || ''}`.trim(); };
const fmtRun = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
// faint binary watermark like the real report background
const WM = (() => {
  let t = ''; let x = 1337;
  for (let i = 0; i < 9; i++) { let row = ''; for (let j = 0; j < 38; j++) { x = (x * 1103515245 + 12345) & 0x7fffffff; row += (x >> 16) & 1; } t += `<text x="0" y="${14 + i * 24}" transform="rotate(-8)">${row}</text>`; }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='220'><g font-family='monospace' font-size='11' fill='#9aa0a6' fill-opacity='.35'>${t}</g></svg>`)}")`;
})();

export function reportHtml(r, { mode = 'instant' } = {}) {
  const line = (x, sign = '') => `<div class="l">${esc(x.title)} - ${sign}${x.points} pts</div>`;
  const pen = r.penalties.map((p) => line(p, '-')).join('');
  const found = r.found.map((f) => line(f)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>CCS Scoring Report</title><style>
  html,body{margin:0;background:#eceeee ${WM};font-family:Arial,Helvetica,sans-serif;color:#111}
  .wrap{max-width:900px;margin:0 auto;padding:18px 28px 60px;font-size:15px}
  h1{text-align:center;font-size:22px;margin:6px 0 14px}
  .meta{text-align:center;font-size:13px;line-height:1.55}
  .id{text-align:center;font-size:18px;font-weight:700;margin:16px 0 14px}.id span{color:#2e7d32}
  .pts{text-align:center;font-size:24px;font-weight:700;margin:14px 0 22px}
  h3{font-size:17px;margin:20px 0 8px}
  .l{font-size:14.5px;line-height:1.28}
  .foot{margin-top:34px;text-align:center;color:#666;font-size:12px}
  </style></head><body><div class="wrap">
  <h1>CCS Scoring Report</h1>
  <div class="meta">Report Generated At: ${fmtTime(r.generatedAt)}<br>Approximate Image Running Time: ${fmtRun(r.elapsedMs)}<br>CCS Server Score Upload Status: OK</div>
  <div class="id">Current Team Unique ID: <span>${esc(r.teamId)}</span></div>
  <div class="pts">${r.score} out of ${r.maxScore} points received</div>
  <h3>${r.penalties.length} penalt${r.penalties.length === 1 ? 'y' : 'ies'} assessed, for a loss of ${r.penaltyPoints} points:</h3>${pen}
  <h3>${r.foundCount} out of ${r.totalCount} scored checks passed, for a gain of ${r.gainPoints} points:</h3>${found}
  <div class="foot">Practice simulator${mode === 'instant' ? ' — scoring updates instantly' : ' — scoring updates about every minute'}. This page refreshes automatically.</div>
  </div></body></html>`;
}
