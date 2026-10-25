// The CyberPatriot-style scoring report page (HTML string), regenerated from engine.report().
import { esc } from './dom.js';

const fmtTime = (ms) => { const d = new Date(ms); return d.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };
const fmtRun = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)} hr(s), ${m % 60} minute(s)`; };

export function reportHtml(r, { mode = 'instant' } = {}) {
  const cats = Object.entries(r.categories).map(([name, c]) => `<tr><td>${esc(name)}</td><td class="n">${c.found} / ${c.total}</td><td class="n">${c.points} / ${c.max}</td></tr>`).join('');
  const found = r.found.map((f) => `<div class="item good"><span>${esc(f.title)}</span><b>${f.points} pts</b></div>`).join('') || '<div class="none">No vulnerabilities found yet.</div>';
  const pen = r.penalties.map((p) => `<div class="item bad"><span>${esc(p.title)}</span><b>-${p.points} pts</b></div>`).join('') || '<div class="none">No penalties.</div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scoring Report</title><style>
  body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#eef1f5;color:#1d2733}
  header{background:#12304f;color:#fff;padding:18px 28px;border-bottom:5px solid #c8102e}
  header h1{margin:0;font-size:24px;letter-spacing:.5px} header div{opacity:.85;margin-top:4px;font-size:13px}
  main{max-width:900px;margin:0 auto;padding:22px 28px 60px}
  .panel{background:#fff;border:1px solid #cfd6df;border-radius:6px;padding:16px 20px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:14px} .grid b{color:#12304f}
  .score{font-size:40px;font-weight:700;color:#12304f} .score small{font-size:16px;color:#6b7785;font-weight:400}
  h2{margin:0 0 10px;font-size:16px;color:#12304f;border-bottom:1px solid #e1e6ec;padding-bottom:6px}
  .item{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #f0f2f5;font-size:14px} .item b{white-space:nowrap;margin-left:14px}
  .good b{color:#1f7a3a} .bad b{color:#b3261e} .none{color:#8a94a0;padding:6px 8px;font-size:14px}
  table{border-collapse:collapse;width:100%;font-size:14px} td,th{padding:5px 8px;border-bottom:1px solid #f0f2f5;text-align:left} td.n,th.n{text-align:right}
  .ok{color:#1f7a3a;font-weight:700} .foot{color:#8a94a0;font-size:12px;text-align:center;margin-top:18px}
  </style></head><body>
  <header><h1>CyberPatriot Scoring Report</h1><div>${esc(r.title)} · ${esc(r.image)}</div></header>
  <main>
   <div class="panel"><div class="grid">
     <div><b>Report Generated At:</b> ${fmtTime(r.generatedAt)}</div><div><b>Team ID:</b> ${esc(r.teamId)}</div>
     <div><b>Approximate Image Running Time:</b> ${fmtRun(r.elapsedMs)}</div><div><b>Connection Status:</b> <span class="ok">OK</span></div>
     <div><b>Scoring updates:</b> ${mode === 'instant' ? 'instant (practice mode)' : 'about every minute'}</div><div><b>Vulnerabilities found:</b> ${r.foundCount} / ${r.totalCount}</div>
   </div></div>
   <div class="panel"><div class="score">${r.score} <small>/ ${r.maxScore} points</small></div>
     <div style="font-size:13px;color:#6b7785;margin-top:4px">${r.gainPoints} points gained${r.penaltyPoints ? `, ${r.penaltyPoints} points lost to penalties` : ''}</div></div>
   <div class="panel"><h2>Score by category</h2><table><tr><th>Category</th><th class="n">Found</th><th class="n">Points</th></tr>${cats}</table></div>
   <div class="panel"><h2>${r.foundCount} of ${r.totalCount} vulnerabilities found</h2>${found}</div>
   <div class="panel"><h2>${r.penalties.length} penalt${r.penalties.length === 1 ? 'y' : 'ies'} assessed</h2>${pen}</div>
   <div class="foot">Practice simulator — this page refreshes automatically.</div>
  </main></body></html>`;
}
