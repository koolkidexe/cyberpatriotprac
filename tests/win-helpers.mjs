// Headless Windows environment: build a scenario machine and drive a PowerShell / cmd session.
import { createWinShell } from '../src/win/shell.js';
import { ScoringEngine } from '../src/core/scoring.js';

export function makeWinEnv(scenario, { elevated = true, mode = 'ps' } = {}) {
  let t = Date.UTC(2026, 9, 24, 20, 48, 0);
  let s = 7;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const sys = scenario.createMachine({ now: () => t, rng });
  let buf = '';
  const inputs = [];
  const launches = [];
  const io = { write: (x) => { buf += x; }, async readLine(p) { buf += p; const v = inputs.shift(); return v === undefined ? null : v; }, launch: (app, o) => launches.push({ app, ...o }), clear() {}, exit() {}, power() {}, cols: 120 };
  const sh = createWinShell(sys, { user: 'student', io, elevated, mode });
  const engine = new ScoringEngine(sys, scenario);
  async function run(line, ...inp) { inputs.length = 0; inputs.push(...inp); buf = ''; await sh.run(line); return buf.replace(/\u001b\[[0-9;]*m/g, ''); }
  return { sys, sh, run, engine, launches, advance: (ms) => { t += ms; } };
}

