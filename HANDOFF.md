# HANDOFF — CyberPatriot practice simulator (Linux **Mint 21.3 "Virginia"**, Ubuntu 22.04 base)

Read this first if you are a new Claude session continuing the work.

## Goal (from the user)
A **static website** (no VM, no backend) that looks and behaves like a CyberPatriot Linux Mint image:
a fake Mint/Cinnamon desktop in the browser, a misconfigured "system" the user secures, a live
**Scoring Report**, a **Scenario README**, forensics questions, score popups ("You gained points!").
"As accurate as artificially possible." Start with **Mint 21** (user corrected from 22 → 21), later
Ubuntu and Windows. Deployed free on GitHub Pages. Unofficial fan project; the user supplied the CyberPatriot logo (`assets/cyberpatriot-logo.png`) for the file icons.
I cannot create the GitHub repo from the sandbox; user publishes with `git init` / `gh repo create`.

## Key decisions
- **Zero-build**: native ES modules, no bundler/npm deps (`npm test` = `node --test`, `npm start` =
  `node scripts/serve.mjs`). Pages workflow just copies `index.html css src` (see `.github/workflows/pages.yml`).
  (I had told the user "Vite"; zero-build superseded it — mention this when reporting.)
- **Single source of truth = files.** Users/groups/sudo/ssh/PAM/ufw/lightdm config all live as real
  text files in the virtual FS, so the terminal and every GUI app edit the same state and the
  scorer just re-reads files. Do not add parallel "settings" objects.
- Core + shell are **DOM-free** so they run under `node --test`.
- Functions-over-`sys` style (`users.userAdd(sys, ...)`), `CmdError` messages are printed verbatim
  (they already include the program prefix, e.g. `useradd: user 'x' already exists`).

## Status
DONE (in `src/core`, `src/images`, `tests`):
- `util.js` (posix paths, sha256, fake `$6$` crypt hash, dates, modeToString, version compare, glob)
- `vfs.js` (nodes, perms, symlinks, sticky bit, `FsView` bound to a cred, JSON persistence,
  `onChange` hook fired after every mutation — System wires it to `touch()`)
- `users.js` (passwd/shadow/group/gshadow parse+write, userAdd/Del/Mod, passwords, chage,
  pwquality+PAM model, pam_unix remember history, sudoers parsing → `sudoPolicy`, `isAdmin`)
- `system.js` (System: vfs, processes/spawn/kill, sockets from process listeners, cron respawn,
  syslog helper, `snapshot()/restore()` incl. `misc`), `cron.js`, `sysctl.js`
- `packages.js` (dpkg/apt model: plan install/remove, rc state, upgradable, writes binaries/conf and
  **.desktop launchers** for GUI packages; service registration), `services.js` (systemd model:
  start/stop/enable/disable/mask, `statusText`), `firewall.js` (ufw: ENABLED in ufw.conf, policies in
  /etc/default/ufw, rules + status text + user.rules mirror)
- `images/catalog.js` (~150 packages incl. scenario ones: vsftpd, john, aisleriot, nmap, wireshark,
  hydra, samba, apache2…; ~30 services) and `images/configs.js` (authentic Mint 21/jammy config
  templates: sshd_config, login.defs, PAM files, sysctl, sudoers, vsftpd, ufw, lightdm, bashrc, …)
- Tests: `tests/vfs.test.mjs` (8 passing). All new modules import cleanly.

NOT STARTED (empty dirs exist: `src/apps src/ui src/scenarios/mint-round1 src/shell/commands`, `css/`, `docs/`):
1. `src/images/mint21.js` — **image builder** `buildMint21({now,rng,hostname}) → System`:
   usrmerge symlinks (/bin→usr/bin, /sbin, /lib), dirs+modes, passwd/group/shadow for ~30 system
   accounts + `student` (uid 1000, groups adm,sudo,cdrom,dip,plugdev,lpadmin,sambashare),
   `installPackage(sys,name,{boot:true})` for every catalog entry with `installed:true`,
   `registerUnit`+`startUnit` for enabled services (ufw is oneshot, conf ENABLED=no), base process
   table (systemd, kthreads, journald, lightdm, Xorg, cinnamon-session, nemo-desktop, …; set
   `sys.nextPid` to look realistic), virtual files (`/dev/null|zero|urandom` via node.dev;
   `/proc/version|uptime|meminfo|loadavg`, `/proc/sys/<sysctl>` via node.gen/node.set — gen nodes are
   NOT serialized so re-mount after `System.restore`), /etc files from configs.js, /etc/skel, logs,
   `/run/utmp` + `/var/log/wtmp` text for `who`/`last`. `/etc/shadow` is 0640 root:shadow.
2. **Scenario** `src/scenarios/mint-round1/` (apply misconfigs on top of the base, README html,
   forensics, vuln table). Spec below.
3. **Scoring engine** (`src/core/scoring.js` + `checks.js`): each vuln `{id,category,points,title,check(sys)}`;
   engine re-evaluates on `sys` 'change' (debounced) + interval; emits gain/loss events; found item
   disappears if reverted (points lost); penalties are checks that are true when the bad state exists.
   Setting: instant (~2s) vs realistic (60s). Persist engine state + elapsed time.
4. **Shell** `src/shell/` — lexer/parser (quotes, `$VAR`, `$(..)`, globs, `~`, pipes, `> >> 2>&1`,
   `&& || ;`, `for/if/while`, `!!`), builtins (cd exit export alias history source type read),
   command registry; commands list below; `sudo` (sudoers via `users.sudoPolicy`, 15-min timestamp,
   NOPASSWD, `-i/-s/-u/-l/-k`), `su`, root-shell frames, nano overlay API (`io.editor`), `io.launch(app,args)`
   for GUI launchers (firefox, xed, nemo, gufw, mintupdate, mintinstall, cinnamon-settings, …).
   Tab completion + history. Command-not-found with apt suggestion for catalog packages.
5. **UI** (`index.html`, `css/`, `src/ui`, `src/apps`, `src/main.js`): Cinnamon/Mint-Y look (dark
   panel + menu with green selection, light windows, buttons top-right), original SVG icons (no
   Mint/Firefox logos), window manager, desktop icons generated from `~/Desktop/*.desktop` +
   files, polkit-style "Authentication Required" dialog (checks an admin's password), toast popups
   "You Gained Points!/You Lost Points", WebAudio ding, welcome overlay, simulator tray menu
   (reset image, scoring speed, sound, hints off by default), lock/login screen (shows Guest if allow-guest).
   Apps: Terminal (ANSI colours, nano overlay), Files (Nemo: Properties→Permissions, Open as Root),
   Text Editor (xed; read-only for root files unless sudo), Firefox-like browser window showing
   `file:///…/README.html` and the live Score Report, Users and Groups (Unlock button first),
   Login Window (guest/autologin → lightdm conf), Software Manager (Installed+Remove), Update
   Manager (+ Preferences → apt periodic), Firewall Configuration (gufw), Startup Applications
   (~/.config/autostart), System Monitor (processes, kill). Unsimulated apps open a stub window.
6. Docs (`README.md`, `docs/scenarios.md`, `docs/adding-an-os.md`), full-solve test, Playwright check
   (Chromium at `/opt/pw-browsers/chromium`), `git init` + commit, zip, publish commands.

## Scenario spec — "Mint Practice Round 1" (exactly 100 points)
Unauthorized users (README lists authorized ones): `kali`, `zerocool` (runs `python3 -m http.server 8000`
→ `userdel` fails "currently used by process N" until killed), `toor` (UID 0). Authorized admins:
`student` (you), `dana`. Authorized users: alex, jordan, riley, morgan, casey. Critical service: OpenSSH.
Required app: Firefox. Policy text: no media files, no plaintext password files, no hacking tools.

| id | pts | fix condition |
|---|---|---|
| fq1 | 5 | Desktop "Forensics Question 1.txt": FTP password in `/home/jordan/Documents/old/ftp_server_notes.txt` (`Bluebird-2291`) |
| fq2 | 5 | decode base64 `/home/alex/Documents/message.b64` → codeword `PINEAPPLE-47` |
| fq3 | 5 | TCP port of the backdoor listener → `4444` (answer lines are `ANSWER:`; regex-checked) |
| rm-kali / rm-zerocool / rm-toor | 3 each | user absent |
| casey-not-admin | 3 | casey not in sudo (casey is authorized, standard user) |
| dana-admin | 3 | dana in sudo |
| pw-riley (was `riley123`) / pw-morgan (was `morgan`) | 3 each | password changed to non-weak (hash ≠ original and not in weak list incl. username variants; store initial hashes in `sys.misc`) |
| guest-off | 3 | lightdm `allow-guest=false` (absent = true, lightdm default) |
| pass-max-days | 3 | login.defs `PASS_MAX_DAYS` 1–90 |
| pass-min-len | 3 | effective minlen ≥ 10 (pwquality conf/PAM line/pam_unix) — start state `minlen=4` |
| lockout | 3 | pam_faillock/pam_tally2 `deny` ≤ 10 (common-auth) or faillock.conf |
| nullok | 3 | no `nullok` in common-auth |
| sudo-auth | 3 | no NOPASSWD rule (`/etc/sudoers.d/99-wheel-nopasswd`) and no `Defaults !authenticate` |
| ufw | 4 | `ufwActive` |
| auto-updates | 3 | APT::Periodic::Update-Package-Lists ≥ 1 (start 0) |
| upd-firefox | 3 | firefox not upgradable (installed ≥ avail) |
| ssh-root | 4 | effective `PermitRootLogin` ≠ yes — sshd semantics: **first value wins**, `Include sshd_config.d/*.conf` is at the top |
| ssh-empty | 3 | effective `PermitEmptyPasswords no`; trap: set to yes in `sshd_config.d/99-local.conf` which overrides the main file |
| syncookies | 2 | `net.ipv4.tcp_syncookies=1` in sysctl conf files (start `0` in /etc/sysctl.conf) |
| vsftpd | 3 | service inactive+disabled, or package removed |
| smbd | 3 | smbd (and nmbd) inactive+disabled, or samba removed |
| john | 3 | package john removed |
| wireshark | 2 | package removed |
| media | 2 | `/home/riley/Music/summer_mix.mp3` and `/home/alex/Videos/movie_night.mp4` gone |
| passwords-txt | 3 | `/home/morgan/Documents/passwords.txt` gone |
| shadow-perms | 4 | `/etc/shadow` mode ≤ 0640 (start 0666) |
| cron-backdoor | 3 | `/etc/cron.d/sys-update-check` gone (runs `nc.traditional -lp 4444 -e /bin/bash`) |
| listener | 2 | no process listening on 4444 (cron respawns it every minute via `sys.respawn` while the cron entry exists) |
| autostart | 2 | `~student/.config/autostart/*update-helper*.desktop` removed |
Penalties (−5 each): removing any authorized user; `student` loses sudo; ssh stopped/disabled/removed; firefox removed.
Sum of positives = 15+18+... verify in a test that it equals exactly 100 (3 forensics=15, users 6×3 + 3 + 3 → recompute!).
Recount before finalising: 15 + (3·3 kali/zero/toor=9) + casey 3 + dana 3 + riley 3 + morgan 3 + guest 3 = 39 users+fq;
policy 3+3+3+3+3 = 15 → 54; ufw 4 + auto 3 + ff 3 = 10 → 64; ssh 4+3 + sync 2 = 9 → 73; svc 6 → 79;
sw 3+2 = 5 → 84; files 2+3 = 5 → 89; shadow 4 + cron 3 + listener 2 + autostart 2 = 11 → **100**. ✔

## Shell command list to implement (fidelity matters: ls -l/colours, ps aux, ss -tulpn, id, systemctl status, ufw status, apt output)
ls cd pwd cat head tail wc grep sort uniq cut tr tee sed(s///,d,p,-i,-n) awk(-F, print, simple conds) xargs find(-name -type -user -perm -mtime -size -exec -delete)
locate/updatedb stat file du df chmod chown chgrp mkdir rmdir rm cp mv touch ln echo printf base64 sha256sum
id whoami groups who w last getent passwd adduser(interactive) addgroup useradd userdel(-r) deluser delgroup groupadd groupdel usermod gpasswd chage chpasswd su sudo visudo crontab
apt/apt-get (update upgrade install remove purge autoremove list search show) dpkg(-l -L -s -r -P) systemctl service ps top(-bn1) kill pkill killall pgrep ss netstat lsof ip ping ufw sysctl
nmap(simulated from listeners) uname hostname uptime date free lsb_release env export alias history clear man nano(vi→minimal) journalctl bash/sh script execution,
stubs for john/hydra/clamscan/chkrootkit/rkhunter when installed.

## Testing plan
`node --test`: VFS perms, shell behaviours, each check type, **scripted full solve reaches exactly 100**,
each penalty triggers, persistence round-trip. Then serve (`node scripts/serve.mjs`) and drive with
Playwright/Chromium: open README, use terminal + GUI, watch score change, screenshots.


## Status (latest)
Engine, shell, Mint 21 image, scenario, desktop UI and all GUI apps are built and tested (see README "What's done"/"What's left"). Run `npm test` and `node scripts/serve.mjs` (http://localhost:8080).


## Latest status (Oct 26)
- Mint and Ubuntu look-alike desktops are both done and verified in headless Chromium; 20 tests pass.
- Ubuntu theme: `env.theme()` / `env.setTheme({style, accent, dock})` (stored in `env.settings.ubuntuTheme`, applied by `UbuntuDesktop.applyTheme`, CSS in `css/ubuntu.css`: `body.ub-dark`, `body.dock-left|bottom|right`). Window widgets use `--surface`, `--surface-2`, `--line`, `--text-dim` variables so dark mode works; do not hard-code light colours in app JS.
- Folder/home icons use `--folder` (accent on Ubuntu).
- Not done: tasks list from previous years (user has not re-sent it), Windows image, GNOME lock screen, Playwright e2e tests in `tests/`.

## Latest status (Oct 29)
The Oct 27-28 round is done. Note: the zip the user uploaded on Oct 29 predated the browser work described in an earlier plan, so the browser was rebuilt from that zip. The project is now a git repo (commit history from Oct 29).
- Icons: `icons.js` renders the themed set from `icons-apps.js` first (`setIconTheme('mint'|'yaru')`, set in `main.js`), falling back to the old `G` set. `ALIAS` maps .desktop Icon= names.
- Browser: `src/apps/browser.js` (frame, tabs, pop-ups, interstitials, downloads), `browser-pages.js` (chrome://settings, about:preferences, about:config, policy/downloads pages), `browser-sites.js` (DOM-free fake web). Decision rules live in `core/browserprefs.js` (`popupsAllowed`, `safeBrowsingBlocks`, `dangerousDownloadsBlocked`) and are tested in `tests/browser.test.mjs`. Profiles are seeded by `seedBrowserProfiles` from `buildImage`. Chromium theme preference: `env.settings.chromiumMode` (Device/Light/Dark, default Dark).
- WM: `wm.open({ frameless: true, cls })` + `win.controls()` / `win.makeDraggable(el)` for app-drawn title bars (browser, gedit, Ubuntu Software).
- Scenarios rebalanced (both still exactly 100, 39 items): forensics 6 pts; new checks in `core/checks.js` (`upToDate`, `mustChangePassword`, `standardUserExists`, browser checks). Security-pocket updates: `packages.SECURITY_UPDATES`.
- Lock/login screens moved to `src/ui/greeters.js` (Mint: Cinnamon screensaver + Slick Greeter; Ubuntu: GNOME lock + GDM).
- Ubuntu Activities: `gnome-shell.js` `toggleMenu('overview'|'apps')`.
- Tooltips: fallback `autoTip` in `tooltip.js`. Audit script idea: open every app, dispatch mouseover on every control, list ones without `title`/`data-tip` (0 on both images as of Oct 29).
- 29 tests pass.

## Next (agreed order)
1. Windows image — scope with the user first (local security policy, users, services, firewall, Windows 10 look; roughly as big as everything so far).
2. More past-year tasks if the user sends the written list.
3. Remaining polish listed in README "What's left".
