// The scenario README, shown in the browser window exactly like the CyberPatriot README.
export const ADMINS = ['student', 'dana'];
export const AUTHORIZED = ['alex', 'jordan', 'riley', 'morgan', 'casey'];

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function readmeHtml({ studentPassword = 'cyberpatriot' } = {}) {
  const li = (a) => a.map((u) => `<li>${esc(u)}</li>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mint Practice Round 1 - README</title>
<style>body{font-family:sans-serif;max-width:46em;margin:2em auto;line-height:1.45}h1{text-align:center}code{background:#eee;padding:0 .3em}</style></head>
<body>
<h1>Linux Mint 21 Practice Image &mdash; Round 1</h1>
<p><i>Unofficial practice material. This is a simulation and is not affiliated with or endorsed by the Air &amp; Space Forces Association or the CyberPatriot program.</i></p>
<h2>Scenario</h2>
<p>This computer belongs to the small, family-run print shop <b>Tri-County Print &amp; Copy</b>. It runs Linux Mint 21.3 and is used by the staff for office work and for the shop's file transfers.
The owner's nephew set it up over the summer, and the staff suspect that somebody else has been using it. You have been hired as the new IT administrator. Make the computer secure,
while keeping everything the shop needs working.</p>
<p>It is critical that you <b>do not</b> remove or disable the software and services listed below. You may be penalized for doing so.</p>
<h2>Forensics Questions</h2>
<p>If you have not already, answer the Forensics Questions on the Desktop. Each question has an <code>ANSWER:</code> line at the bottom of its file; type your answer after it and save the file.</p>
<h2>Authorized Users</h2>
<p>These are the users the company says should be on this computer. Any other user should be removed. Do not remove any user listed here, and do not change anyone's account type unless this README says to.</p>
<p><b>Authorized Administrators:</b> (your password is <code>${esc(studentPassword)}</code>)</p>
<ul>${li(ADMINS)}</ul>
<p><b>Authorized Users:</b></p>
<ul>${li(AUTHORIZED)}</ul>
<p>Only the authorized administrators should have administrative (sudo) privileges.</p>
<h2>Critical Services</h2>
<ul><li>OpenSSH &mdash; the shop's contractor connects remotely. Keep the service running and enabled, but secure it.</li></ul>
<h2>Critical Applications</h2>
<ul><li>Firefox (keep it installed and up to date)</li></ul>
<h2>Company Policy</h2>
<ul>
<li>No media files (music or video) are allowed on the computer, with the exception of the files under <code>/usr</code>.</li>
<li>Passwords must never be stored in plain-text files.</li>
<li>No hacking tools or network-sniffing tools may be installed.</li>
<li>Passwords should be strong, should expire, and the computer should lock out repeated failed logins.</li>
<li>The system must check for updates every day.</li>
</ul>
<h2>Competition Guidelines</h2>
<p>Any password you set must be at least 10 characters. Do not modify the Scoring Report or the README. Good luck!</p>
</body></html>`;
}
