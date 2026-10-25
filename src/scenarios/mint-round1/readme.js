// The Scenario README shown on the desktop, written in the style of a competition README.
export const AUTHORIZED_ADMINS = [
  { name: 'student', password: 'Student#Mint21', note: 'you' },
  { name: 'dana', password: 'Sunfl0wer!Day', note: 'Operations Manager' },
];
export const AUTHORIZED_USERS = ['alex', 'jordan', 'riley', 'morgan', 'casey'];

export function readmeHtml() {
  const admins = AUTHORIZED_ADMINS.map((a) => `<li><code>${a.name}</code>${a.note === 'you' ? ' (you)' : ''}<br>password: <code>${a.password}</code></li>`).join('');
  const users = AUTHORIZED_USERS.map((u) => `<li><code>${u}</code></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Linux Mint Practice Image README</title>
<style>
body{font:15px/1.5 "Noto Sans","DejaVu Sans",Arial,sans-serif;color:#222;max-width:820px;margin:0 auto;padding:22px 30px 60px;background:#fff}
h1{font-size:26px;margin:.2em 0 .1em}h2{font-size:18px;margin:1.6em 0 .3em;border-bottom:2px solid #8fa876;padding-bottom:3px}
.sub{color:#666;margin:0 0 1em}code{background:#f0f0ec;padding:1px 5px;border-radius:3px;font-family:"DejaVu Sans Mono",monospace;font-size:13px}
.box{background:#f5f8f1;border-left:4px solid #8fa876;padding:8px 14px;margin:12px 0}li{margin:3px 0}
</style></head><body>
<h1>Linux Mint 21 Practice Image</h1>
<p class="sub">Unique identifier: <code>MINT21-PRACTICE-1</code> &middot; Unofficial practice simulator</p>

<h2>Competition Scenario</h2>
<p>Apex Robotics is a small engineering firm. The company's workstation is a Linux Mint 21 desktop used by the operations team. After a contractor left, management is worried that the machine has been tampered with. You have been hired as the system administrator. Your job is to find and fix security problems on this computer while keeping it working for the company's real users.</p>
<p>Some changes may have been made by the former contractor, and some problems are plain misconfigurations. The company does <b>not</b> consider every software package or service a problem: check this README before you remove something.</p>

<div class="box"><b>Forensics questions</b> are on the desktop. Answer them <i>before</i> you delete accounts or files, because the evidence might be in there. Type your answer after <code>ANSWER:</code> and save the file.</div>

<h2>Authorized Administrators and Users</h2>
<p><b>Authorized Administrators</b> (these users, and only these users, may have administrator / sudo rights):</p>
<ul>${admins}</ul>
<p><b>Authorized Users</b> (standard users, no administrator rights):</p>
<ul>${users}</ul>
<p>All other accounts on the system are <b>not</b> authorized. Authorized users must keep their accounts; do not delete them. All users must have secure passwords, and nobody may log in as a guest.</p>

<h2>Critical Services</h2>
<ul><li><b>OpenSSH server</b> (<code>ssh</code>) must be running and enabled at boot. Remote administration depends on it, so lock it down rather than turn it off.</li></ul>

<h2>Critical Programs</h2>
<ul><li><b>Mozilla Firefox</b> is the company's required web browser and must stay installed and up to date.</li></ul>

<h2>Company Policy</h2>
<ul>
<li>Peer-to-peer, hacking, password-cracking and network-sniffing software is prohibited.</li>
<li>No FTP or Windows file sharing (Samba) is used by this company.</li>
<li>Personal media files (music, video) are not allowed on company computers.</li>
<li>Plaintext files that contain user passwords are prohibited.</li>
<li>The firewall must be enabled, the system must check for updates automatically, and a sensible password and account-lockout policy must be in place.</li>
<li><code>sudo</code> must always require the user's password.</li>
<li>Remote login as <code>root</code> over SSH is not allowed, and neither are empty passwords.</li>
</ul>

<h2>Tips</h2>
<ul>
<li>Open the <b>Scoring Report</b> on the desktop to see how many issues you have fixed. It does not tell you what is left.</li>
<li>Everything here works like a real Linux Mint machine: the Terminal, the Users and Groups app, Update Manager, Software Manager and Firewall Configuration all change the same system.</li>
<li>If you remove or break something the company needs, you will lose points.</li>
</ul>
</body></html>`;
}
