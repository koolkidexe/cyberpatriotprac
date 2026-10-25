// Test helpers: a scripted terminal session against a scenario image.
import '../src/shell/index.js';
import { Shell, ExitSignal } from '../src/shell/shell.js';
import { buildScenario } from '../src/scenarios/mint-round1/index.js';
import { ScoringEngine } from '../src/core/scoring.js';
import { cronEntries } from '../src/core/cron.js';

export class ScriptedIO {
  constructor() { this.buf = ''; this.answers = []; this.edits = new Map(); this.launched = []; this.cleared = 0; }
  write(s) { this.buf += s; }
  async prompt(text) { this.buf += text; const a = this.answers.shift(); if (a === undefined) throw new Error(`unexpected prompt: ${text}`); this.buf += a === '' ? '\n' : '\n'; return a; }
  /** edit: (content) => newContent for the next editor session */
  async editor({ path, content, save }) { const fn = this.edits.get('next'); this.edits.delete('next'); if (!fn) throw new Error(`unexpected editor for ${path}`); await save(fn(content)); }
  launch(app, args) { this.launched.push([app, args]); }
  clear() { this.cleared++; }
}

export function setup({ delayMs = 0 } = {}) {
  const { sys, scenario } = buildScenario();
  const io = new ScriptedIO();
  const sh = new Shell(sys, io, { user: 'student' });
  const engine = new ScoringEngine(sys, scenario, { delayMs });
  engine.evaluate();
  /** Run a command line; returns what it printed. `answers` feeds prompts, `edit` rewrites the editor buffer. */
  const run = async (line, { answers = [], edit = null } = {}) => {
    io.buf = ''; io.answers = [...answers]; if (edit) io.edits.set('next', edit);
    let code;
    try { code = await sh.execLine(line); } catch (e) { if (e instanceof ExitSignal) code = e.code; else throw e; }
    engine.evaluate();
    return { out: io.buf.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), raw: io.buf, code };
  };
  const tick = () => { sys.runCronTick(cronEntries(sys)); engine.evaluate(); };
  return { sys, scenario, io, sh, engine, run, tick };
}
