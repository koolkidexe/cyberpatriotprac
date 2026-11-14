// The simulated web (DOM-free). Every host here is a made-up ".example" / ".test" training site; nothing is fetched
// from the internet. A site entry describes what the browser should do: show a page, try to open pop-ups on load,
// be flagged by Safe Browsing, or offer a download.

const page = (title, body, { bg = '#fff', fg = '#202124', extra = '' } = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;font:15px/1.5 "Segoe UI",Ubuntu,"Noto Sans",Arial,sans-serif;background:${bg};color:${fg}}
a{color:#1a5fd0}.wrap{max-width:780px;margin:0 auto;padding:28px 30px 60px}h1{font-weight:500}
.btn{display:inline-block;padding:9px 18px;border-radius:6px;background:#1a73e8;color:#fff;text-decoration:none;border:0;font:inherit;cursor:pointer}
.note{font-size:12px;color:#777;margin-top:30px;border-top:1px solid #ddd;padding-top:10px}
${extra}</style></head><body>${body}</body></html>`;

const SIM_NOTE = '<div class="note">Training site inside the CyberPatriot simulator. It is not a real website.</div>';

export const SITES = {
  // one-time pad / XOR practice tool (the browser draws it; see otpTool in browser.js)
  'otp-tools.example': { title: 'One-time pad encryption and decryption', tool: 'otp' },
  // hex <-> text converter (drawn by hexTool in browser.js)
  'hex-tools.example': { title: 'Hex to ASCII text converter', tool: 'hex' },
  // practice copy of a vulnerability guide (paraphrased summaries only)
  'msrc.example': {
    title: 'Security Update Guide (practice copy)',
    html: (path = '/') => {
      const id = (String(path).match(/CVE-\d{4}-\d+/i) || [''])[0].toUpperCase();
      const V = {
        'CVE-2021-36934': ['Windows Elevation of Privilege Vulnerability', 'Important', 'Elevation of Privilege', 'Overly permissive access control lists on several system files, including the Security Account Manager (SAM) database, let a local user read them. An attacker who exploits this can run arbitrary code with SYSTEM privileges, then install programs, view, change or delete data, or create new accounts with full user rights.', 'Restrict access to the contents of %windir%\\system32\\config and delete Volume Shadow Copy Service shadow copies made before the restriction.'],
        'CVE-2021-34527': ['Windows Print Spooler Remote Code Execution Vulnerability', 'Critical', 'Remote Code Execution', 'The Windows Print Spooler service improperly performs privileged file operations. An attacker who exploits this can run arbitrary code with SYSTEM privileges, then install programs, view, change or delete data, or create new accounts with full user rights.', 'Install the security update. If you cannot, stop and disable the Print Spooler service, or disable inbound remote printing through Group Policy.'],
      };
      const v = V[id];
      const list = Object.keys(V).map((k) => `<li><a href="https://msrc.example/update-guide/vulnerability/${k}">${k}</a> – ${V[k][0]}</li>`).join('');
      return page(v ? `${id} - Security Update Guide` : 'Security Update Guide', `<div style="background:#2f2f2f;color:#fff;padding:10px 30px;font-weight:600">Security Update Guide <span style="font-weight:400;color:#bbb">(practice copy)</span></div><div class="wrap">${v ? `<div style="color:#666">${id}</div><h1>${v[0]}</h1>
<table style="border-collapse:collapse;margin:10px 0 20px">${[['Max severity', v[1]], ['Impact', v[2]], ['Released', 'July 2021']].map(([a, b]) => `<tr><td style="padding:4px 18px 4px 0;color:#666">${a}</td><td><b>${b}</b></td></tr>`).join('')}</table>
<h2 style="font-weight:500;font-size:19px">Description</h2><p>${v[3]}</p><h2 style="font-weight:500;font-size:19px">Mitigations and workarounds</h2><p>${v[4]}</p>` : `<h1>Vulnerabilities</h1><p>Search by CVE number:</p><ul>${list}</ul>`}${SIM_NOTE}</div>`);
    },
  },
  'start.cyberpatriot-sim.test': {
    title: 'Simulator start page',
    html: () => page('Simulator start page', `<div class="wrap"><h1>Browser practice sites</h1>
<p>This simulated browser has no internet access. These made-up sites let you see what your browser security settings do.</p>
<ul>
<li><a href="http://www.prize-winner.example/">www.prize-winner.example</a> tries to open pop-up windows as soon as it loads. With the pop-up blocker on, the browser stops them.</li>
<li><a href="http://popuptest.example/">popuptest.example</a> is a pop-up blocker test page.</li>
<li><a href="http://account-verify.example/login">account-verify.example</a> is a fake phishing page. With Safe Browsing on, the browser shows a red warning first.</li>
<li><a href="http://free-games.example/">free-games.example</a> offers a dangerous download. With Safe Browsing on, the download is blocked.</li>
<li><a href="http://intranet.apex.example/">intranet.apex.example</a> is a harmless company intranet page.</li>
<li><a href="https://hex-tools.example/">hex-tools.example</a> converts hexadecimal to readable text and back.</li>
<li><a href="https://msrc.example/update-guide/vulnerability/CVE-2021-36934">msrc.example</a> is a practice copy of a security update guide (CVE pages).</li>
<li><a href="https://otp-tools.example/">otp-tools.example</a> is a one-time pad (XOR) encryption and decryption tool for forensics questions.</li>
</ul>${SIM_NOTE}</div>`),
  },
  'www.prize-winner.example': {
    title: 'CONGRATULATIONS!!! You are our 1,000,000th visitor',
    popups: ['http://ads.prize-winner.example/claim', 'http://ads.prize-winner.example/survey'],
    html: () => page('CONGRATULATIONS!!!', `<div class="wrap" style="text-align:center"><h1 style="color:#d00;font-size:38px">CONGRATULATIONS!!!</h1>
<p style="font-size:20px">You are our <b>1,000,000th</b> visitor! Claim your FREE tablet now!</p>
<p><a class="btn" style="background:#e8a400" href="http://ads.prize-winner.example/claim">CLAIM NOW</a></p>
<p style="color:#777">This page tries to open two pop-up windows when it loads.</p>${SIM_NOTE}</div>`, { bg: '#fff8d6' }),
  },
  'ads.prize-winner.example': {
    title: 'Claim your prize',
    html: () => page('Claim your prize', `<div class="wrap" style="text-align:center"><h1 style="color:#c00">Only 2 prizes left!</h1><p>Enter your card number to pay shipping.</p><p style="color:#777">This is the pop-up window. A pop-up blocker would have stopped it.</p>${SIM_NOTE}</div>`, { bg: '#ffecec' }),
  },
  'popuptest.example': {
    title: 'Pop-up blocker test',
    popups: ['http://popuptest.example/popup1'],
    html: (path) => (path.startsWith('/popup')
      ? page('Pop-up window', '<div class="wrap"><h1>Pop-up window opened</h1><p>Your browser allowed this site to open a pop-up window.</p></div>')
      : page('Pop-up blocker test', `<div class="wrap"><h1>Pop-up blocker test</h1><p>When this page loaded it tried to open <b>one</b> pop-up window.</p>
<ul><li>If you see a "pop-up blocked" notice in the address bar (Chromium) or a yellow bar (Firefox), your pop-up blocker works.</li>
<li>If a new window opened, pop-ups are allowed for this site.</li></ul>${SIM_NOTE}</div>`)),
  },
  'account-verify.example': {
    title: 'Sign in - Harborview Credit Union',
    threat: 'phishing',
    html: () => page('Sign in', `<div class="wrap" style="max-width:420px"><h2>Harborview Credit Union</h2><p>Your account has been <b>suspended</b>. Verify your identity to restore access.</p>
<form><p><input placeholder="Username" style="width:100%;padding:8px"></p><p><input type="password" placeholder="Password" style="width:100%;padding:8px"></p><p><button class="btn" type="submit">Verify</button></p></form>
<p style="color:#777">Harborview Credit Union is made up. This page imitates a bank sign-in to steal passwords, which is what Safe Browsing protects you from.</p>${SIM_NOTE}</div>`),
  },
  'free-games.example': {
    title: 'FREE GAMES - download full version',
    threat: 'malware',
    html: () => page('FREE GAMES', `<div class="wrap"><h1>Download full games for FREE</h1>
<p><a class="btn" data-download="FreeGame_Setup.exe" href="http://free-games.example/dl/FreeGame_Setup.exe">Download FreeGame_Setup.exe (48 MB)</a></p>
<p><a data-download="game-cheats.deb" href="http://free-games.example/dl/game-cheats.deb">game-cheats.deb</a></p>
<p style="color:#777">Both downloads are flagged as dangerous. Safe Browsing blocks them.</p>${SIM_NOTE}</div>`, { bg: '#111', fg: '#eee', extra: 'a{color:#7fb6ff}' }),
  },
  'intranet.apex.example': {
    title: 'Apex intranet',
    html: () => page('Apex intranet', `<div class="wrap"><h1>Apex Robotics intranet</h1><p>Welcome back. The cafeteria menu has been updated.</p>${SIM_NOTE}</div>`),
  },
};

/** Downloads offered by sites: name -> { size, dangerous }. */
export const DOWNLOADS = {
  'FreeGame_Setup.exe': { size: 48213504, dangerous: true, data: 'MZ\u0090\u0000(simulated Windows executable, flagged as malware)\n' },
  'game-cheats.deb': { size: 2213904, dangerous: true, data: '!<arch>\ndebian-binary   (simulated package, flagged as malware)\n' },
};

export const START_PAGE = 'http://start.cyberpatriot-sim.test/';

/** Parse a URL into { host, path, origin } (null if not http(s)). */
export function parseUrl(u) {
  const m = /^(https?):\/\/([^/?#:]+)(?::(\d+))?([^?#]*)/i.exec(u);
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] || '', path: m[4] || '/', origin: `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ? ':' + m[3] : ''}` };
}
export function siteFor(u) {
  const p = parseUrl(u);
  if (!p) return null;
  const s = SITES[p.host];
  return s ? { ...s, ...p } : { missing: true, ...p };
}
