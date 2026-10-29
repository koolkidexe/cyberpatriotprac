// Drives the real shell through a complete solve of the Ubuntu Practice Round 1 scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.mjs';

const PW = 'Student#Ubuntu22';
const SOLVE = [
  ['sudo usermod -aG sudo sam'],
  ['sudo gpasswd -d hana sudo'], ['sudo gpasswd -d hana adm'],
  ['sudo pkill -u pentest'], ['sudo userdel -r pentest'], ['sudo pkill -u h4x0r'], ['sudo userdel -r h4x0r'], ['sudo userdel -r sysadm'],
  ['sudo passwd priya', 'Tr1cky#Pass-9917', 'Tr1cky#Pass-9917'],
  ['sudo passwd tyrone', 'Un1que#Pass-5528', 'Un1que#Pass-5528'],
  ["sudo sed -i 's/^AutomaticLoginEnable = true/AutomaticLoginEnable = false/' /etc/gdm3/custom.conf"],
  ["sudo sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS\\t90/' /etc/login.defs"],
  ["sudo sed -i 's/minlen=4/minlen=12/' /etc/pam.d/common-password"],
  ["echo 'auth required pam_faillock.so deny=5 unlock_time=900' | sudo tee -a /etc/pam.d/common-auth"],
  ["sudo sed -i 's/ nullok//' /etc/pam.d/common-auth /etc/pam.d/common-password"],
  ['sudo rm /etc/sudoers.d/99-wheel-nopasswd'], ['sudo -v', PW],
  ['sudo ufw enable', 'y'],
  ["sudo sed -i 's/\"0\"/\"1\"/' /etc/apt/apt.conf.d/10periodic"],
  ['sudo apt install --only-upgrade -y firefox'],
  ["sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config"],
  ["sudo sed -i 's/PermitEmptyPasswords yes/PermitEmptyPasswords no/' /etc/ssh/sshd_config.d/99-local.conf"],
  ['sudo systemctl restart ssh'],
  ["sudo sed -i 's/tcp_syncookies=0/tcp_syncookies=1/' /etc/sysctl.conf"], ['sudo sysctl -p'],
  ['sudo systemctl disable --now apache2'],
  ['sudo systemctl disable --now smbd nmbd'],
  ['sudo apt purge -y hydra'], ['sudo apt purge -y aisleriot'],
  ['sudo apt purge -y ophcrack nmap'],
  ['sudo adduser --gecos "Nadia Brennan" nadia', 'Fr0ntD3sk#Lib-26', 'Fr0ntD3sk#Lib-26'],
  ['sudo chage -d 0 omar'],
  ['sudo apt install --only-upgrade -y openssl libssl3'],
  ["sed -i '/safebrowsing\\|disable_open_during_load/s/false/true/' ~/.mozilla/firefox/*.default-release/prefs.js"],
  ['sudo rm /home/priya/Music/summer_mix.mp3 /home/lena/Videos/movie_night.mp4 /home/tyrone/Documents/passwords.txt'],
  ['sudo chmod 640 /etc/shadow'],
  ['sudo rm /etc/cron.d/popularity-sync'],
  ['sudo pkill -f nc.traditional'],
  ['rm ~/.config/autostart/gnome-update-helper.desktop'],
  ["sed -i 's/^ANSWER:.*/ANSWER: Lighthouse-8802/' ~/Desktop/Forensics\\ Question\\ 1.txt"],
  ["sed -i \"s/^ANSWER:.*/ANSWER: $(sudo base64 -d /home/lena/Documents/message.b64 | sed 's/.*: //')/\" ~/Desktop/Forensics\\ Question\\ 2.txt"],
];

test('ubuntu image identifies as Ubuntu 22.04 with GNOME bits and no Mint', () => {
  const { sys } = makeEnv({ os: 'ubuntu' });
  assert.match(sys.vfs.readFile('/etc/os-release'), /Ubuntu 22\.04/);
  assert.ok(sys.vfs.exists('/usr/bin/nautilus'));
  assert.ok(!sys.vfs.exists('/usr/bin/nemo'));
  assert.equal(sys.hostname, 'ubuntu');
});

test('ubuntu scenario starts at 0/100 and fully solves to 100 via the terminal', async () => {
  const e = makeEnv({ os: 'ubuntu' });
  e.engine.evaluate();
  assert.equal(e.engine.score(), 0);
  assert.equal(e.engine.maxScore(), 100);
  const log = [];
  for (const [cmd, ...inp] of SOLVE) log.push(`$ ${cmd}\n${await e.run(cmd, ...inp)}`);
  e.engine.evaluate();
  const missing = e.scenario.vulns.filter((v) => !e.engine.state.found[v.id]).map((v) => v.id);
  assert.deepEqual(missing, [], 'unsolved: ' + missing.join(',') + '\n' + log.slice(-10).join('\n'));
  assert.equal(e.engine.score(), 100);
  assert.deepEqual(e.engine.report().penalties, []);
});

test('mint image is unaffected by building ubuntu in the same process', async () => {
  makeEnv({ os: 'ubuntu' });
  const m = makeEnv({ os: 'mint' });
  assert.ok(m.sys.vfs.exists('/usr/bin/nemo'));
  assert.match(m.sys.vfs.readFile('/etc/os-release'), /Linux Mint/);
});
