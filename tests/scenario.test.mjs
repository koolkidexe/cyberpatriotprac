import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

const PW = { answers: ['cyberpatriot'] };

test('scenario starts at 0 points with no penalties and the table sums to exactly 100', () => {
  const { scenario, engine } = setup();
  assert.equal(scenario.vulns.reduce((a, v) => a + v.points, 0), 100);
  assert.equal(new Set(scenario.vulns.map((v) => v.id)).size, scenario.vulns.length);
  assert.equal(engine.score, 0);
  assert.equal(engine.penalized.size, 0);
});

test('the intended solve (all through the terminal) reaches exactly 100', async () => {
  const t = setup();
  const { run, engine, tick } = t;
  const sudo = (c) => run(`sudo ${c}`, PW);
  // forensics
  assert.match((await run('grep -ri "ftp password" /home/*/Documents 2>/dev/null')).out, /Bluebird-2291/);
  await run('sed -i "s/^ANSWER:.*/ANSWER: Bluebird-2291/" ~/Desktop/Forensics\\ Question\\ 1.txt');
  assert.match((await run('base64 -d /home/alex/Documents/message.b64')).out, /PINEAPPLE-47/);
  await run('echo "ANSWER: pineapple-47" >> "$HOME/Desktop/Forensics Question 2.txt"');
  assert.match((await run('sudo ss -tulpn | grep 4444', PW)).out, /nc\.traditional/);
  await run('echo ANSWER: 4444 >> ~/Desktop/Forensics\\ Question\\ 3.txt');
  assert.equal(engine.score, 15);
  // users
  assert.match((await sudo('userdel zerocool')).out, /currently used by process/);
  await sudo('kill $(pgrep -u zerocool)'); await sudo('userdel -r zerocool');
  await sudo('userdel kali'); await sudo('deluser toor');
  await sudo('gpasswd -d casey sudo'); await sudo('usermod -aG sudo dana');
  await run('echo "riley:Tr1cky-Ledger#58" | sudo chpasswd', PW);
  await run('echo "morgan:Gr33n-Harbor!77" | sudo chpasswd');
  // account policy
  await sudo('sed -i "s/^PASS_MAX_DAYS.*/PASS_MAX_DAYS\\t90/" /etc/login.defs');
  await sudo('sed -i "s/^minlen = 4/minlen = 10/" /etc/security/pwquality.conf');
  await sudo('sed -i "1i auth required pam_faillock.so preauth deny=5 unlock_time=900" /etc/pam.d/common-auth');
  await sudo('sed -i "s/ nullok//" /etc/pam.d/common-auth');
  await sudo('rm /etc/sudoers.d/99-wheel-nopasswd');
  await run('printf "[Seat:*]\\nallow-guest=false\\n" | sudo tee /etc/lightdm/lightdm.conf.d/50-no-guest.conf');
  // defensive + updates
  await sudo('ufw enable');
  await run('echo \'APT::Periodic::Update-Package-Lists "1";\' | sudo tee /etc/apt/apt.conf.d/10periodic');
  await sudo('apt update'); await sudo('apt install firefox -y');
  // ssh / sysctl
  await sudo('sed -i "s/^PermitRootLogin yes/PermitRootLogin no/" /etc/ssh/sshd_config');
  assert.ok(!engine.found.has('ssh-empty'));
  await sudo('rm /etc/ssh/sshd_config.d/99-local.conf'); await sudo('systemctl restart ssh');
  await sudo('sed -i "s/^net.ipv4.tcp_syncookies=0/net.ipv4.tcp_syncookies=1/" /etc/sysctl.conf'); await sudo('sysctl -p');
  // services + software + files
  await sudo('systemctl disable --now vsftpd'); await sudo('apt purge samba -y');
  await sudo('apt remove --purge john wireshark -y');
  await sudo('find /home \\( -name "*.mp3" -o -name "*.mp4" \\) -delete');
  await sudo('rm /home/morgan/Documents/passwords.txt');
  await sudo('chmod 640 /etc/shadow');
  // malware: killing the listener first does not stick while the cron job exists
  await sudo('kill $(pgrep -f "nc.traditional -lp")'); tick();
  assert.ok(!engine.found.has('listener'), 'cron respawned the backdoor');
  await sudo('rm /etc/cron.d/sys-update-check'); await sudo('kill $(pgrep -f "nc.traditional -lp")'); tick();
  await run('rm ~/.config/autostart/update-helper.desktop');
  const missing = t.scenario.vulns.filter((v) => !engine.found.has(v.id)).map((v) => v.id);
  assert.deepEqual(missing, []);
  assert.equal(engine.score, 100);
  assert.equal(engine.penalized.size, 0);
});

test('penalties: removing an authorized user, stopping ssh, removing firefox, student losing sudo', async () => {
  const t = setup();
  const { run, engine } = t;
  await run('sudo userdel riley', PW); assert.equal(engine.score, -5);
  await run('sudo systemctl stop ssh'); assert.equal(engine.score, -10);
  await run('sudo systemctl start ssh'); assert.equal(engine.score, -5);
  await run('sudo apt remove firefox -y'); assert.equal(engine.score, -10);
  await run('sudo gpasswd -d student sudo');
  assert.ok(engine.penalized.has('pen-student-sudo'));
});

test('fixes that are undone lose their points again', async () => {
  const t = setup();
  await t.run('sudo chmod 640 /etc/shadow', PW); assert.equal(t.engine.score, 4);
  await t.run('sudo chmod 666 /etc/shadow'); assert.equal(t.engine.score, 0);
});

test('the sshd drop-in trap: appending to the main file does not fix PermitEmptyPasswords', async () => {
  const t = setup();
  await t.run('echo "PermitEmptyPasswords no" | sudo tee -a /etc/ssh/sshd_config', PW);
  assert.ok(!t.engine.found.has('ssh-empty'));
});

test('scoring delay holds credit back until the delay has passed', async () => {
  let now = 1_800_000_000_000;
  const t = setup({ delayMs: 0 });
  t.engine.delayMs = 60000; t.engine.now = () => now;
  await t.run('sudo chmod 640 /etc/shadow', PW);
  assert.equal(t.engine.score, 0); assert.equal(t.engine.waiting, 1);
  now += 61000; t.engine.evaluate(); assert.equal(t.engine.score, 4);
});

test('weak or unchanged passwords are not credited', async () => {
  const t = setup();
  await t.run('echo "riley:riley123" | sudo chpasswd', PW); assert.ok(!t.engine.found.has('pw-riley'));
  await t.run('echo "riley:Riley1" | sudo chpasswd'); assert.ok(!t.engine.found.has('pw-riley'));
  await t.run('echo "riley:Orchid-Lantern-42" | sudo chpasswd'); assert.ok(t.engine.found.has('pw-riley'));
});
