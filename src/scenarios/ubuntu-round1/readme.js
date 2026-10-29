// The Scenario README shown on the desktop, written in the style of a competition README.
export const AUTHORIZED_ADMINS = [
  { name: 'student', password: 'Student#Ubuntu22', note: 'you' },
  { name: 'sam', password: 'Sunfl0wer!Day', note: 'Branch Manager' },
];
export const AUTHORIZED_USERS = ['lena', 'omar', 'priya', 'tyrone', 'hana'];

/** New employee whose account still has to be created (not in AUTHORIZED_USERS: they do not exist at the start). */
export const NEW_HIRE = 'nadia';

export function readmeHtml() {
  const admins = AUTHORIZED_ADMINS.map((a) => `<li><code>${a.name}</code>${a.note === 'you' ? ' (you)' : ''}<br>password: <code>${a.password}</code></li>`).join('');
  const users = AUTHORIZED_USERS.map((u) => `<li><code>${u}</code></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ubuntu Practice Image README</title>
<style>
body{font:15px/1.5 "Noto Sans","DejaVu Sans",Arial,sans-serif;color:#222;max-width:820px;margin:0 auto;padding:22px 30px 60px;background:#fff}
h1{font-size:26px;margin:.2em 0 .1em}h2{font-size:18px;margin:1.6em 0 .3em;border-bottom:2px solid #e95420;padding-bottom:3px}
.sub{color:#666;margin:0 0 1em}code{background:#f0f0ec;padding:1px 5px;border-radius:3px;font-family:"DejaVu Sans Mono",monospace;font-size:13px}
.box{background:#fdf3ef;border-left:4px solid #e95420;padding:8px 14px;margin:12px 0}li{margin:3px 0}
</style></head><body>
<h1>Ubuntu 22.04 Practice Image</h1>
<p class="sub">Unique identifier: <code>UBUNTU22-PRACTICE-1</code> &middot; Unofficial practice simulator</p>

<h2>Competition Scenario</h2>
<p>Harbor Lane Library is a small branch library. The staff workstation is an Ubuntu 22.04 desktop shared by the front-desk team. After an IT contractor left, the library director is worried that the machine has been tampered with. You have been hired as the system administrator. Your job is to find and fix security problems, and to keep the computer running the way the staff need it.</p>
<p>Some changes may have been made by the former contractor, and some problems are plain misconfigurations. The company does <b>not</b> consider every software package or service a problem: check this README before you remove something.</p>

<div class="box"><b>Forensics questions</b> are on the desktop. Answer them <i>before</i> you delete accounts or files, because the evidence might be in there. Type your answer after <code>ANSWER:</code> and save the file.</div>

<h2>Authorized Administrators and Users</h2>
<p><b>Authorized Administrators</b> (these users, and only these users, may have administrator / sudo rights):</p>
<ul>${admins}</ul>
<p><b>Authorized Users</b> (standard users, no administrator rights):</p>
<ul>${users}</ul>
<p>All other accounts on the system are <b>not</b> authorized. Authorized users must keep their accounts; do not delete them. All users must have secure passwords, and automatic login must not be enabled.</p>
<p><b>New hire:</b> Nadia Brennan joins the front desk this week. Create a standard (non-administrator) account named <code>${NEW_HIRE}</code> for her.</p>
<p>Omar's password was written on a sticky note at the desk. Make sure user <code>omar</code> has to choose a new password the next time he logs in.</p>

<h2>Critical Services</h2>
<ul><li><b>OpenSSH server</b> (<code>ssh</code>) must be running and enabled at boot. Remote administration depends on it, so lock it down rather than turn it off.</li></ul>

<h2>Critical Programs</h2>
<ul><li><b>Mozilla Firefox</b> is the library's required web browser and must stay installed and up to date. It must block pop-up windows and dangerous or deceptive content and downloads.</li></ul>

<h2>Company Policy</h2>
<ul>
<li>Peer-to-peer, hacking, network-scanning and password-cracking software is prohibited, and so are games on staff computers.</li>
<li>No web server (Apache) and no Windows file sharing (Samba) is used at this library.</li>
<li>Security updates must be installed promptly.</li>
<li>Personal media files (music, video) are not allowed on company computers.</li>
<li>Plaintext files that contain user passwords are prohibited.</li>
<li>The firewall must be enabled, the system must check for updates automatically, and a sensible password and account-lockout policy must be in place.</li>
<li><code>sudo</code> must always require the user's password.</li>
<li>Remote login as <code>root</code> over SSH is not allowed, and neither are empty passwords.</li>
</ul>

<h2>Tips</h2>
<ul>
<li>Open the <b>Scoring Report</b> on the desktop to see how many issues you have fixed. It does not tell you what is left.</li>
<li>Everything here works like a real Ubuntu machine: the Terminal, Settings, Software Updater, Ubuntu Software and Firewall Configuration all change the same system.</li>
<li>If you remove or break something the company needs, you will lose points.</li>
</ul>
</body></html>`;
}
