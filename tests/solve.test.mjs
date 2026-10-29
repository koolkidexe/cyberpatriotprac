// Drives the real shell through a complete solve of the Mint Practice Round 1 scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.mjs';

const PW = 'Student#Mint21';
const SOLVE = [
  ['sudo usermod -aG sudo dana'],
  ['sudo gpasswd -d casey sudo'],
  ['sudo gpasswd -d casey adm'],
  ['sudo userdel -r kali'], ['sudo pkill -u zerocool'], ['sudo userdel -r zerocool'], ['sudo userdel -r toor'],
  ['sudo passwd riley', 'Tr1cky#Pass-9917', 'Tr1cky#Pass-9917'],
  ['sudo passwd morgan', 'Un1que#Pass-5528', 'Un1que#Pass-5528'],
  ["sudo sed -i 's/allow-guest=true/allow-guest=false/' /etc/lightdm/lightdm.conf.d/70-linuxmint.conf"],
  ["sudo sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS\\t90/' /etc/login.defs"],
  ["sudo sed -i 's/minlen=4/minlen=12/' /etc/pam.d/common-password"],
  ["echo 'auth required pam_faillock.so deny=5 unlock_time=900' | sudo tee -a /etc/pam.d/common-auth"],
  ["sudo sed -i 's/ nullok//' /etc/pam.d/common-auth /etc/pam.d/common-password"],
  ['sudo rm /etc/sudoers.d/99-wheel-nopasswd'], ['sudo -v', PW],
  ['sudo ufw enable', 'y'],
  ["sudo sed -i 's/\"0\"/\"1\"/' /etc/apt/apt.conf.d/10periodic"],
  ['sudo apt install --only-upgrade -y chromium'],
  ["sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config"],
  ["sudo sed -i 's/PermitEmptyPasswords yes/PermitEmptyPasswords no/' /etc/ssh/sshd_config.d/99-local.conf"],
  ['sudo systemctl restart ssh'],
  ["sudo sed -i 's/tcp_syncookies=0/tcp_syncookies=1/' /etc/sysctl.conf"], ['sudo sysctl -p'],
  ['sudo systemctl disable --now vsftpd'],
  ['sudo systemctl disable --now smbd nmbd'],
  ['sudo apt purge -y john'], ['sudo apt purge -y wireshark'],
  ['sudo apt purge -y apache2 aisleriot ophcrack'],
  ['sudo useradd -m -s /bin/bash -c "Taylor Kim" taylor'], ['sudo passwd taylor', 'N3wH1re#Apex-2026', 'N3wH1re#Apex-2026'],
  ['sudo passwd -e jordan'],
  ['sudo apt install --only-upgrade -y openssl libssl3'],
  [`sed -i 's/"popups":1/"popups":2/; s/"safebrowsing":{"enabled":false/"safebrowsing":{"enabled":true/' ~/.config/chromium/Default/Preferences`],
  ['sudo rm /home/riley/Music/summer_mix.mp3 /home/alex/Videos/movie_night.mp4 /home/morgan/Documents/passwords.txt'],
  ['sudo chmod 640 /etc/shadow'],
  ['sudo rm /etc/cron.d/sys-update-check'],
  ['sudo pkill -f nc.traditional'],
  ['rm ~/.config/autostart/update-helper.desktop'],
  ["sed -i 's/^ANSWER:.*/ANSWER: Bluebird-2291/' ~/Desktop/Forensics\\ Question\\ 1.txt"],
  ["sed -i \"s/^ANSWER:.*/ANSWER: $(sudo base64 -d /home/alex/Documents/message.b64 | sed 's/.*: //')/\" ~/Desktop/Forensics\\ Question\\ 2.txt"],
];

test('scenario starts at 0 points with no penalties', () => {
  const e = makeEnv();
  e.engine.evaluate();
  assert.equal(e.engine.score(), 0);
  assert.equal(e.engine.maxScore(), 100);
  assert.deepEqual(e.engine.report().penalties, []);
});

test('full solve through the terminal scores exactly 100 with no penalties', async () => {
  const e = makeEnv();
  const log = [];
  for (const [cmd, ...inp] of SOLVE) {
    const out = await e.run(cmd, ...inp);
    log.push(`$ ${cmd}\n${out}`);
  }
  // let the cron job tick: backdoor must stay dead because the cron file is gone
  const { cronEntries } = await import('../src/core/cron.js');
  e.sys.runCronTick(cronEntries(e.sys));
  const d = e.engine.evaluate();
  const r = e.engine.report();
  const missing = e.scenario.vulns.filter((v) => !e.engine.state.found[v.id]).map((v) => v.id);
  assert.deepEqual(missing, [], 'unsolved: ' + missing.join(',') + '\n' + log.slice(-8).join('\n'));
  assert.equal(r.score, 100);
  assert.deepEqual(r.penalties.map((p) => p.id), []);
  void d;
});

test('backdoor respawns while its cron job exists', async () => {
  const e = makeEnv();
  const { cronEntries } = await import('../src/core/cron.js');
  await e.run('sudo pkill -f nc.traditional');
  e.engine.evaluate();
  assert.ok(e.engine.state.found['bd-listener']);
  e.sys.runCronTick(cronEntries(e.sys));
  e.engine.evaluate();
  assert.ok(!e.engine.state.found['bd-listener'], 'cron should have restarted the listener');
});

test('reverting a fix removes the points again', async () => {
  const e = makeEnv();
  await e.run('sudo chmod 640 /etc/shadow');
  e.engine.evaluate();
  assert.ok(e.engine.state.found['shadow-perms']);
  await e.run('sudo chmod 666 /etc/shadow');
  e.engine.evaluate();
  assert.ok(!e.engine.state.found['shadow-perms']);
});

test('penalties: deleting an authorized user or breaking ssh costs points', async () => {
  const e = makeEnv();
  await e.run('sudo userdel -r alex');
  await e.run('sudo systemctl stop ssh');
  e.engine.evaluate();
  const ids = e.engine.report().penalties.map((p) => p.id).sort();
  assert.deepEqual(ids, ['auth-alex', 'ssh-crit']);
  assert.equal(e.engine.score(), -10);
});

test('state survives a snapshot/restore round trip', async () => {
  const e = makeEnv();
  await e.run('sudo ufw enable', 'y');
  e.engine.evaluate();
  assert.ok(e.engine.state.found['ufw']);
  const { System } = await import('../src/core/system.js');
  const { mountVirtual } = await import('../src/images/mint21.js');
  const snap = JSON.parse(JSON.stringify(e.sys.snapshot()));
  const sys2 = System.restore(snap);
  mountVirtual(sys2);
  const { ScoringEngine } = await import('../src/core/scoring.js');
  const eng2 = new ScoringEngine(sys2, e.scenario, e.engine.serialize());
  eng2.evaluate();
  assert.equal(eng2.score(), e.engine.score());
  assert.ok(sys2.vfs.exists('/proc/cpuinfo'));
});
