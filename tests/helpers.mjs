// Shared helpers for headless tests: build the Mint scenario machine and drive a Shell with scripted input.
import { createShell } from '../src/shell/index.js';
import mint from '../src/scenarios/mint-round1/index.js';
import ubuntu from '../src/scenarios/ubuntu-round1/index.js';
import { ScoringEngine } from '../src/core/scoring.js';

export function makeEnv({ user = 'student', seed = 1, os = 'mint', scenario: sc } = {}) {
  const scenario = sc || (os === 'ubuntu' ? ubuntu : mint);
  let t = Date.UTC(2026, 9, 24, 20, 48, 0); // fixed clock: Sat 2026-10-24 16:48 EDT
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const sys = scenario.createMachine({ now: () => t, rng });
  let buf = '';
  const inputs = [];
  const editors = [];
  const launches = [];
  const io = {
    write: (x) => { buf += x; },
    async readLine(prompt, o) { buf += prompt + (o && o.echo === false ? '' : ''); const v = inputs.shift(); return v === undefined ? null : v; },
    async editor(opts) { editors.push(opts); const e = editors.script?.shift(); if (!e) return null; if (opts.save) { const r = opts.save(e); if (!r.ok) { buf += `[ Error writing ${opts.path}: ${r.err} ]\n`; return null; } } return e; },
    launch(app, o) { launches.push({ app, ...o }); },
    clear() {}, exit() { buf += '[exit]'; }, cols: 80, rows: 24,
  };
  const sh = createShell(sys, { user, io });
  const engine = new ScoringEngine(sys, scenario);
  async function run(line, ...inp) {
    inputs.length = 0;
    inputs.push(...inp);
    buf = '';
    await sh.run(line);
    return buf.replace(/\u001b\[[0-9;]*m/g, '');
  }
  return { sys, sh, io, run, engine, editors, launches, advance: (ms) => { t += ms; }, scenario, get out() { return buf; } };
}
