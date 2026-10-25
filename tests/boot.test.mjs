import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.mjs';
import { rebootSystem, autostartListeners } from '../src/core/boot.js';

test('autostart entry declares the 4444 backdoor listener', () => {
  const { sys } = makeEnv();
  const l = autostartListeners(sys, 'student');
  assert.ok(l.some((x) => x.port === 4444));
});

test('reboot clears sudo timestamps', async () => {
  const { sys, run } = makeEnv();
  await run('sudo -v', 'Student#Mint21');
  rebootSystem(sys);
  assert.deepEqual(sys.sudoTs, {});
});

test('shell basics: ps, ufw, apt', async () => {
  const { run } = makeEnv();
  assert.match(String(await run('ps aux')), /USER/);
  assert.match(String(await run('sudo ufw status', 'Student#Mint21')), /inactive/);
  assert.match(String(await run('apt list --upgradable')), /firefox|Listing/);
});
