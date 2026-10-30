// Random "reshuffle" rounds: every dealt round must start at 0, add up to exactly 100, and be fully solvable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.mjs';
import { makeRound } from '../src/scenarios/deck/index.js';
import { cronEntries } from '../src/core/cron.js';

const SEEDS = Number(process.env.DECK_SEEDS || 12);

for (const os of ['mint', 'ubuntu']) {
  test(`${os}: ${SEEDS} random rounds start at 0, total 100 and solve to 100 through the terminal`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sc = makeRound(os, seed * 7919);
      const total = sc.vulns.reduce((a, v) => a + v.points, 0);
      assert.equal(total, 100, `seed ${seed}: total ${total}`);
      assert.ok(sc.vulns.every((v) => v.points >= 2), `seed ${seed}: a check is worth less than 2`);
      assert.ok(sc.vulns.length >= 14 && sc.vulns.length <= 34, `seed ${seed}: ${sc.vulns.length} checks`);
      assert.equal(new Set(sc.vulns.map((v) => v.id)).size, sc.vulns.length, `seed ${seed}: duplicate check ids`);
      const e = makeEnv({ os, scenario: sc });
      e.engine.evaluate();
      const early = sc.vulns.filter((v) => e.engine.state.found[v.id]).map((v) => v.id);
      assert.deepEqual(early, [], `seed ${seed}: scored before anything was done`);
      assert.deepEqual(e.engine.report().penalties, [], `seed ${seed}: penalties at start`);
      const log = [];
      for (const [cmd, ...inp] of sc.solution) {
        await e.run('sudo -v', sc.password);
        log.push(`$ ${cmd}\n${await e.run(cmd, ...inp)}`);
      }
      e.sys.runCronTick(cronEntries(e.sys));
      e.engine.evaluate();
      const missing = sc.vulns.filter((v) => !e.engine.state.found[v.id]).map((v) => v.id);
      assert.deepEqual(missing, [], `seed ${seed}: unsolved ${missing.join(',')}\n${log.join('\n').slice(-3000)}`);
      assert.deepEqual(e.engine.report().penalties.map((p) => p.id), [], `seed ${seed}: penalties after solving`);
      assert.equal(e.engine.score(), 100);
    }
  });
}

test('the same seed always deals the same round; different seeds differ', () => {
  const a = makeRound('mint', 42); const b = makeRound('mint', 42); const c = makeRound('mint', 43);
  assert.deepEqual(a.vulns.map((v) => [v.id, v.points, v.title]), b.vulns.map((v) => [v.id, v.points, v.title]));
  assert.deepEqual(a.forensics, b.forensics);
  assert.notDeepEqual(a.vulns.map((v) => v.title), c.vulns.map((v) => v.title));
});
