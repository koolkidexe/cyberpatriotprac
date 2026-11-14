// Windows 11: every dealt round starts at 0, adds up to 100, and solves to 100 through an elevated PowerShell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWinEnv } from './win-helpers.mjs';
import { makeWinRound, FIXED_SEED } from '../src/scenarios/win-deck/index.js';
import windowsRound1, { serverRound1 } from '../src/scenarios/win-deck/index.js';
import { ScoringEngine } from '../src/core/scoring.js';
import { System } from '../src/core/system.js';
import * as S from '../src/win/state.js';

const SEEDS = Number(process.env.DECK_SEEDS || 12);

test(`windows: ${SEEDS} random rounds start at 0, total 100 and solve to 100 in elevated PowerShell`, async () => {
  for (let seed = 0; seed <= SEEDS; seed++) {
    const sc = seed === 0 ? makeWinRound(FIXED_SEED, { fixed: true }) : makeWinRound(seed * 7919);
    const total = sc.vulns.reduce((a, v) => a + v.points, 0);
    assert.equal(total, 100, `seed ${seed}: total ${total}`);
    assert.ok(sc.vulns.length >= 18 && sc.vulns.length <= 48, `seed ${seed}: ${sc.vulns.length} checks`);
    assert.equal(new Set(sc.vulns.map((v) => v.id)).size, sc.vulns.length, `seed ${seed}: duplicate ids`);
    const e = makeWinEnv(sc);
    e.engine.evaluate();
    assert.deepEqual(sc.vulns.filter((v) => e.engine.state.found[v.id]).map((v) => v.id), [], `seed ${seed}: scored before anything was done`);
    assert.deepEqual(e.engine.report().penalties, [], `seed ${seed}: penalties at start`);
    const log = [];
    for (const [cmd, ...inp] of sc.solution) log.push(`PS> ${cmd}\n${await e.run(cmd, ...inp)}`);
    S.tick(e.sys);
    e.engine.evaluate();
    const missing = sc.vulns.filter((v) => !e.engine.state.found[v.id]).map((v) => v.id);
    assert.deepEqual(missing, [], `seed ${seed}: unsolved ${missing.join(',')}\n${log.join('\n').slice(-4000)}`);
    assert.deepEqual(e.engine.report().penalties.map((p) => p.id), [], `seed ${seed}: penalties after solving`);
    assert.equal(e.engine.score(), 100);
  }
});

test('windows: the fixed round is deterministic and survives a snapshot round trip', async () => {
  assert.equal(windowsRound1.id, 'windows-round1');
  assert.equal(windowsRound1.vulns.length, 34, 'Northstar Tabletop round: 2 forensics + 32 scored checks');
  const a = makeWinRound(FIXED_SEED, { fixed: true });
  assert.deepEqual(a.vulns.map((v) => [v.id, v.points]), windowsRound1.vulns.map((v) => [v.id, v.points]));
  const e = makeWinEnv(windowsRound1);
  const snap = JSON.parse(JSON.stringify(e.sys.snapshot()));
  const back = System.restore(snap);
  assert.equal(back.os, 'windows');
  assert.equal(back.win.users.length, e.sys.win.users.length);
  const eng = new ScoringEngine(back, windowsRound1); eng.evaluate();
  assert.equal(eng.score(), 0);
});

test('windows: non-elevated shells are refused admin changes; backdoors respawn until their task is removed', async () => {
  const sc = makeWinRound(FIXED_SEED, { fixed: true });
  const e = makeWinEnv(sc, { elevated: false });
  assert.match(await e.run('net user eve P@ssw0rd123 /add'), /Access is denied/);
  assert.match(await e.run('Set-NetFirewallProfile -All -Enabled True'), /Access is denied/);
  assert.match(await e.run('Get-LocalUser student'), /student\s+True/);
  // find any respawning malware and kill it without removing the starter
  const r = e.sys.win.respawn[0];
  if (r) {
    const p = e.sys.processes.find((x) => x.respawnId === r.id);
    e.sys.killProc(p.pid);
    S.tick(e.sys);
    assert.ok(e.sys.processes.some((x) => x.respawnId === r.id), 'backdoor came back');
  }
});

test('cmd.exe built-ins and native tools', async () => {
  const e = makeWinEnv(windowsRound1, { mode: 'cmd' });
  assert.match(await e.run('whoami'), /desktop-cp11\\student/i);
  assert.match(await e.run('net localgroup Administrators'), /student/);
  assert.match(await e.run('dir C:\\Users\\student\\Desktop /b'), /Forensics Question 1\.txt/);
  assert.match(await e.run('type "C:\\Users\\student\\Desktop\\Forensics Question 1.txt"'), /This is a forensics question/);
  assert.match(await e.run('net accounts | findstr /i length'), /Minimum password length/);
  assert.match(await e.run('nosuchthing'), /is not recognized as an internal or external command/);
});

test('server 2022: the fixed round and random rounds start at 0, total 100 and solve to 100', async () => {
  assert.equal(serverRound1.id, 'server-round1');
  assert.equal(serverRound1.vulns.length, 26);
  for (let seed = 0; seed <= Math.min(SEEDS, 8); seed++) {
    const sc = seed === 0 ? serverRound1 : makeWinRound(seed * 7919, { ver: 2022 });
    assert.equal(sc.vulns.reduce((a, v) => a + v.points, 0), 100, `seed ${seed}`);
    const e = makeWinEnv(sc);
    assert.equal(e.sys.win.ver, 2022);
    assert.match(await e.run('(Get-ComputerInfo).OsName'), /Windows Server 2022/);
    e.engine.evaluate();
    assert.deepEqual(sc.vulns.filter((v) => e.engine.state.found[v.id]).map((v) => v.id), [], `seed ${seed}: scored at start`);
    assert.deepEqual(e.engine.report().penalties.map((p) => p.id), [], `seed ${seed}: penalties at start`);
    const log = [];
    for (const [cmd, ...inp] of sc.solution) log.push(`PS> ${cmd}\n${await e.run(cmd, ...inp)}`);
    e.engine.evaluate();
    const missing = sc.vulns.filter((v) => !e.engine.state.found[v.id]).map((v) => v.id);
    assert.deepEqual(missing, [], `seed ${seed}: not solved\n${log.join('\n').slice(-3000)}`);
    assert.deepEqual(e.engine.report().penalties.map((p) => p.id), [], `seed ${seed}: penalties after solving`);
  }
});
