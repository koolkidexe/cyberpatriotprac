# CyberPatriot Simulator (Linux Mint 21, Ubuntu 22.04, Debian 12, Windows 11, Windows Server 2022)

A **static website** that simulates CyberPatriot practice images (Linux Mint, Ubuntu and Windows 11). For Linux: a fake Linux Mint 21 "Cinnamon" desktop in your browser, with a deliberately misconfigured virtual computer you have to secure, a simulated terminal, GUI admin apps, a scenario README, forensics questions, and a live Scoring Report with "You gained / lost points" popups. No VM, no backend, no build step.

> Status: **work in progress.** The simulation engine, the shell and the scoring are finished and tested. The desktop UIs for Mint and Ubuntu are built; polish items are listed in "What's done / what's left" below.

## Running it

```bash
npm test            # headless tests (Node 20+), no install needed
node scripts/serve.mjs   # http://localhost:8080  (needs the UI, see below)
```

Hosting on GitHub Pages: push to `main`, then Settings → Pages → Source = **GitHub Actions**. The workflow in `.github/workflows/pages.yml` runs the tests and publishes `index.html`, `css/` and `src/`. (It fails until `index.html` exists — that is part of the UI work.)

There is nothing to install: the project is native ES modules, so there is no Vite/webpack step.

## How it works

Everything the player can change lives in one virtual machine object (`System`): a virtual filesystem (`/etc/passwd`, `/etc/shadow`, `sudoers`, `sshd_config`, PAM files, ufw config, lightdm config, cron, …), a process table, package state, service state and a firewall. The terminal and every GUI app edit that *same* state, and the scoring engine re-reads it. That means a fix scores the same whether you make it with `sudo usermod`, the Users and Groups app, or by editing a file in a text editor. Un-doing a fix takes the points away again, like the real scoring service.

```
src/core/      virtual machine: vfs, users/PAM/sudoers, packages (apt/dpkg), services (systemd), ufw, sysctl, cron, scoring
src/images/    OS images (mint21.js builds a fresh Mint 21.3 install; catalog.js = package & service catalog; configs.js = stock config files)
src/scenarios/ scenarios (a scenario = image + misconfigurations + vulnerabilities worth points + penalties + forensics + README)
src/shell/     simulated bash: parser, pipes/redirects/loops/subshell, ~200 commands
tests/         node:test suites incl. a full scripted solve that must reach exactly 100/100
```

### The bundled scenario: "Mint Practice Round 1"
100 points, penalties of −5. 3 forensics questions, user auditing (unauthorized users, hidden UID 0 account, wrongly-privileged users, weak passwords), account policy (guest login, password age/length, lockout, empty passwords, sudo without password), updates, firewall, SSH hardening (note the `sshd_config.d` trap), sysctl, prohibited software/files, a respawning backdoor (cron + listener), a malicious autostart entry and `/etc/shadow` permissions. Since Oct 29 it also scores past-season task types: create a missing user, force a password change at next login, install security updates, remove Apache2 / AisleRiot / Ophcrack, and Chromium pop-up blocking and Safe Browsing. A full scripted solve in `tests/solve.test.mjs` proves all 100 points are reachable and that nothing scores by accident.

## Updates need a restart

On every image, an update task (application updates, OpenSSL/OpenSSH/systemd/sudo updates, Windows updates) only scores once the machine has been restarted after the update was installed. Restart from the power menu, or run `sudo reboot` (Linux) / `Restart-Computer` or `shutdown /r /t 0` (Windows). The simulated screen goes through a restart, open windows close, and services come back according to their startup settings. Tasks about *enabling* automatic updates are settings and do not need a restart.

## Reshuffle: random rounds

Press the **↻** button in the panel (or simulator menu → New round) to deal a new random round. A round is built from a deck of about 45 task cards modelled on real round reports (unauthorized and hidden-root users, admin rights, weak/missing passwords, new hires, forced password changes, groups, password and lockout policy, guest/auto login, firewall and its default policy, automatic updates, security/OpenSSH/systemd/sudo/browser updates, SSH, sysctl, browser pop-ups and Safe Browsing, unwanted services, prohibited software and files, file permissions, cron/autostart/SUID backdoors) plus 2-3 forensics questions. People, file names, ports, answers and points are random; the README is written to match, and points always total exactly 100 (usually 20-30 checks, 3-6 points each). Code: `src/scenarios/deck/`. `tests/deck.test.mjs` deals many rounds per OS and checks each starts at 0 and can be solved to exactly 100 through the terminal (`DECK_SEEDS=100 npm test` for a bigger sweep). When you reach 100/100 with no penalties, the simulator offers a reshuffle.

Saves are tied to the exact set of checks they were made with; a save from an older version is discarded (with a notice) instead of being loaded, so nothing is ever scored on load.

## Images

| Image | Desktop | Scenario | Pick it with |
|---|---|---|---|
| Linux Mint 21.3 | Cinnamon (bottom panel) | Mint Practice Round 1, 100 pts | start page, or `?os=mint` |
| Ubuntu 22.04 | GNOME/Yaru (top bar + dock) | Ubuntu Practice Round 1, 100 pts | start page, or `?os=ubuntu` |
| Windows 11 Pro 23H2 | Windows 11 (centred taskbar, Start, Search) | Windows Practice Round 1, 100 pts | start page, or `?os=windows` |

The choice is remembered; switch with the chart icon → "Switch OS…". Saves are per image. Ubuntu logins: `student` / `Student#Ubuntu22` (Mint: `Student#Mint21`, Windows: `Student#Win11`).
Both images share the same engine, shell, apps and scoring; the distro differences live in `src/images/catalog.js` (`only` / `over` tags, `applyDistro`), `src/images/mint21.js` (`DISTROS` table, `buildUbuntu22`), the scenario folders and `src/ui/gnome-shell.js` + `css/ubuntu.css`.


## Windows 11 image

Everything Windows lives on `sys.win` (users, groups, account/audit policy, user rights, a registry, services, firewall profiles and rules, Defender, optional features, programs, updates, shares, scheduled tasks) and is saved with the rest of the machine. The C: drive is the virtual filesystem's `/` (`C:\Users\student` = `/Users/student`), paths are case-insensitive.

```
src/win/state.js    the model + every operation (addUser, setPolicy, setSecopt, stopService, setFirewall, regSet, ...)
src/win/image.js    a clean Windows 11 Pro 23H2 install (services, registry defaults, programs, updates, built-in accounts)
src/win/native.js   net, sc, reg, netsh advfirewall, auditpol, secedit, schtasks, wmic, winget, certutil, netstat, tasklist, ...
src/win/shell.js    PowerShell 5.1 (object pipeline, Where/ForEach/Select/Sort/Format-*, variables, $env:, sub-expressions,
                    ~90 cmdlets: *-LocalUser/Group/GroupMember, *-Service, *-Process, *-NetFirewallProfile/Rule, *-SmbShare,
                    *-WindowsOptionalFeature, *-MpPreference, Get/Install-WindowsUpdate, *-ScheduledTask, registry provider
                    (HKLM:\), file cmdlets, Get-FileHash, Select-String, [Convert]::FromBase64String, Start-Process -Verb RunAs)
                    and cmd.exe (dir, cd, type, del, set, findstr, &&, |). Real error text and formatting.
src/scenarios/win-deck/  Windows task cards + makeWinRound(seed); "Windows Practice Round 1" is the round from a fixed seed
src/ui/win-shell.js      taskbar, Start + search, flyouts, desktop icons, lock/sign-in, User Account Control
src/apps/win-*.js        Explorer, Notepad, Computer Management (users, groups, services, shares, Task Scheduler),
                         Local Security Policy, Settings, Windows Security, Control Panel (Firewall, Programs and Features,
                         System Properties > Remote, Windows Features), Task Manager, Registry Editor
```

Administrator rights work like Windows: the terminal opens unelevated; right-click Terminal > **Run as administrator** (or Win+X style menu on the Start button) shows a UAC prompt. MMC consoles always ask. Turning UAC off in the registry (one of the tasks) makes elevation silent.

Task types (from real Windows round reports): unauthorized users, users who should not be admins, admins who should be, weak or blank passwords, password never expires, new hires, Guest and built-in Administrator enabled, Remote Desktop Users group, a new group with members; password length/history/age, complexity, reversible encryption, lockout threshold and duration; security options (blank passwords console only, anonymous SAM enumeration, CTRL+ALT+DEL, LM hash, last user name, shutdown without logon, UAC), audit policy subcategories, user rights (Act as part of the OS, Debug programs); firewall profiles and an inbound allow rule; Defender real-time protection (sometimes via policy); SmartScreen; Remote Desktop off (or NLA on when RDP is required); SMB v1; PowerShell 2.0; a hidden share; auto logon; AutoPlay; FTP/IIS/Telnet/SNMP/Remote Registry/UPnP services; Windows updates, automatic updates and the Windows Update service; Notepad++/Chrome/7-Zip updates; Wireshark, Cursor, Nmap, uTorrent, Angry IP Scanner, CCleaner, Steam, portable hacking tools; media and password files; a netcat backdoor that respawns from a scheduled task, a Run-key keylogger, a hijacked hosts file; Chrome pop-ups and Safe Browsing (via Chrome policy in the registry). Forensics: Base64 message, SID of a user, SHA256 of a file, backdoor port, hidden share path, scheduled task name, a password hidden in a text file.

`tests/windows.test.mjs` deals many Windows rounds and solves each one to exactly 100 through an elevated PowerShell session (every card carries its real PowerShell fix).

**Debian 12 and Windows Server 2022 images (Nov 13 2026):**
- `?os=debian` — Debian 12 "bookworm" with GNOME. It shares the GNOME desktop and apps of the Ubuntu image, with Debian identity (os-release, lsb_release, apt sources, package versions, kernel), an Adwaita-style light theme and its own wallpaper. *Debian Practice Round 1* is a fixed 27-check round (2 unauthorized users, 2 users who should not be administrators, password complexity and length, lockout, UFW, OpenSSH update, SSH hardening, a service, prohibited software and media, a cron backdoor, 2 forensics). A new "Password complexity requirements are enforced" task also appears in random Mint and Ubuntu rounds.
- `?os=server` — Windows Server 2022 Standard with the Windows 10-style shell, **Server Manager** (Dashboard, Local Server, File and Storage Services > Shares, Manage and Tools menus; opens at sign-in), `Get-/Install-/Uninstall-WindowsFeature`, and Wireshark's Help > Check for Updates. *Server 2022 Practice Round 1* (`src/scenarios/win-deck/server1.js`) is a file server with 26 checks whose names and points follow a real Server scoring report and the CP18 Server 2019 training answer key: 3 forensics (hidden share path, SHA256, Base64), unauthorized users, the `Exec SMB Users` group, the `Executive` SMB share, hidden share `Private$`, Audit File Share, SMB 1.x, firewall, automatic updates, FTP and SMTP services, Notepad++ and Wireshark updates, TightVNC. Remote Desktop, the Server service and the Projects/Templates shares are critical.

**One Windows image, Northstar Tabletop round (Nov 6 2026):** there is a single Windows image again (`?os=windows`; old `?os=windows10` links open it). *Windows Practice Round 1* is now the Northstar Tabletop scenario adapted from Krishna Ajay's Windows practice simulation (`src/scenarios/win-deck/round1.js`): 2 forensics (Event Log Readers members; the path of the file containing "blue meeple protocol") and 32 checks — unauthorized users raven, vecna, brenner and svc-update, Guest, jbyers not an admin, weak and blank passwords, mwheeler's password expiry, new user kmeeple and the Game Designers group, password and security-option policy, firewall, Defender, Remote Desktop and NLA, Firefox and Notepad++ updates, Nmap and Jellyfin Server, Remote Registry, a music file and the tini.exe backdoor on port 4444. OpenSSH SSH Server is a critical service. Reshuffle still deals random rounds from the deck.

**Earlier Windows 10 work (the Windows 10 look is no longer offered as a separate image) (from a CP XIV Windows 10 walkthrough and desktop screenshot, Nov 2026):**
- `?os=windows10` is a Windows 10 Pro 22H2 image (DESKTOP-CP10) with its own saved round. Both images use **Firefox** (the user-supplied logo) and **Mozilla Thunderbird** instead of Chrome; the Start button uses the supplied Windows logo.
- First boot shows the **Competitor Agreement**, then **Set Unique Identifier** (UAC, 12 letters/digits). The report shows the ID or "Not Set". Desktop shortcuts **CyberPatriot Set Unique Identifier**, **README**, **Scoring Report** and **Stop Scoring** (UAC shields, shortcut arrows) work; Stop Scoring pauses scoring until the ID is set again. The time-limit warning was removed from the report.
- Windows 10 shell: black 40 px taskbar with a white "Type here to search" box, Task View, Explorer and Firefox pins, a two-line clock and the Action Center; Start menu with the left rail, A–Z list and folders (Windows Accessories, Administrative Tools, PowerShell, System) and live-tile-style tiles; search flyout with All / Apps / Documents / Settings tabs and Open / Run as administrator / Open file location; an original grey low-poly wallpaper; square window corners; classic Notepad (Format menu) and the blue PowerShell console; Settings home grid, Apps & features (select a row → Modify / Uninstall, NSIS-style uninstaller for third-party apps) and Update & Security > Activation. Both versions show the "Activate Windows" watermark.
- Firefox: the "A new Firefox update is available" doorhanger and ≡ > Help > About Firefox ("Update to 133.0.3" → "Restart to update Firefox"). Thunderbird: Home tab, account setup cards, telemetry bar, ≡ > Help > About Thunderbird with the same update flow. Firefox pop-up blocking / Safe Browsing tasks edit the Firefox profile's `prefs.js`.
- User Account Control Settings (the four-notch slider, `UserAccountControlSettings` from Run or search) writes ConsentPromptBehaviorAdmin / PromptOnSecureDesktop; a new "UAC is set to always notify" task and a "Windows Security Center service is running" task.
- Forensics files use the competition layout (an example block, a line of `=`, the question, `ANSWER: <Type Answer Here>`). New practice sites: `hex-tools.example` (hex ↔ text) and `msrc.example` (paraphrased CVE pages for CVE-2021-36934 and CVE-2021-34527).

**Matched to the CyberPatriot Windows 11 Training 2 answer key and real round photos (Nov 2026):**
- *Windows Practice Round 1* has the Training 2 structure: 25 checks (pcap and one-time-pad forensics, Guest, 2 unauthorized users, a new user, 2 unauthorized admins, password expires, length, reversible encryption, complexity, SMB client signing, CTRL+ALT+DEL, WinRM unencrypted traffic and Remote Desktop through gpedit, firewall, Notepad++ and Chrome updates, an exploit script, Jellyfin / Burp Suite / Python / Nmap, Apache ServerSignature), with its own people, files and answers.
- Penalties from the key: "Account lockout threshold less than 5 is deprecated" and "Chrome / Notepad++ / 7-Zip / Wireshark is not installed at the default location".
- The answer key's own methods all work: Computer Management, Settings > Accounts > Other users > Change account type, secpol.msc and **gpedit.msc** (Local Group Policy Editor: Administrative Templates mapped to the real HKLM\SOFTWARE\Policies values) from the **Run** dialog (Win+R, Ctrl+Alt+R or right-click Start), Windows Security, **Notepad++ > ? > Update Notepad++** (updater + installer wizard), Chrome's **Update** pill / About Chrome > Relaunch, deleting program folders or desktop shortcuts, editing `C:\Apache24\conf\httpd.conf` with Notepad++.
- **Wireshark** opens `attack.pcap` (packet list with the default colouring, display filters such as `ip.addr == x`, `tcp.flags.syn == 1`, `http`, details and bytes panes, Statistics). A practice one-time-pad tool lives at `https://otp-tools.example/`.
- More task types from the 2025 report photo: "User X is no longer a Backup Operator", "Audit Security Group Management [Failure]", Windows Installer AlwaysInstallElevated, Apache ServerTokens / directory listing.
- Taskbar like the competition VM: left-aligned with Start, a "Type here to search" box, Task View and pinned Chrome, Wireshark, File Explorer, Notepad++, Windows PowerShell, Settings. It follows the real `TaskbarAl` / `SearchboxTaskbarMode` registry values; Settings > Personalization > Taskbar switches to the centred Windows 11 layout.
- Scoring report: checks listed in the image's order, the four-hour time warning, the public scoreboard link, "Scoring Data Uploaded Successfully", and an optional competition style (simulator menu > Report check names > Generic) that says "Application update check passed" / "Unwanted software check passed" like 2025 reports.

**Real websites in the browsers:** any address the simulated web doesn't know (and address-bar searches, via Google's embeddable results page) loads the real site live in an iframe, with an "Open in a real tab" link for sites that refuse to be framed.

## What's done

- Virtual filesystem with real permission semantics (`FsView` per user), symlinks, usr-merge layout, `/proc` and `/dev` virtual nodes
- Accounts: passwd/shadow/group/gshadow, `useradd/adduser/usermod/userdel/deluser/gpasswd/chage/chpasswd/passwd`, yescrypt-style hashes, PAM parsing (pwquality, faillock/tally, nullok), sudoers parsing with drop-ins, `sudo`/`su` with password prompts and a 15-minute cache, auth.log entries
- Packages: apt/apt-get/apt-cache/apt-mark/dpkg with dependencies, `rc` config-file state, upgrades, history logs, root-only locking errors like the real tools
- Services: systemctl/service with polkit-style password prompts, unit enable/disable/mask, processes spawned and killed in the process table, `ss`/`netstat`/`lsof` derived from them
- Firewall: ufw (enable/disable/default/allow/deny/delete/status verbose|numbered/reset/logging), sysctl, cron/crontab with respawning backdoor
- Shell: quoting, variables, `$(…)`, arithmetic, globs, pipes, redirects, `&&`/`||`/`;`, `for`/`while`/`if`, history expansion, aliases, tab completion API, `~/.bashrc`, command-not-found suggestions, ~200 commands (coreutils-like, grep/sed/awk subset, find with `-exec`, ps/top/kill, journalctl, man (short pages), nano/vi hooks, GUI launchers)
- Scoring engine (instant or realistic 60 s mode), report object, penalties, persistence round trip
- Desktop UI (`index.html`, `css/`, `src/main.js`, `src/ui/*`): Cinnamon-style panel, start menu from `.desktop` files, window manager, desktop icons, polkit-style auth dialog, "You gained / lost points" toasts + sounds (`assets/sound-gain.wav` on a gain, `assets/sound-lose.wav` alarm on a loss or penalty, once per scoring update; muting stops them), welcome dialog, lock screen/greeter, tray menu (scoring mode, sound, hint, report, reset), autosave to localStorage, reboot semantics
- GUI apps (`src/apps/*`): Terminal (history, Tab completion, nano/vi overlays), Files/Nemo (Open as Root, trash, Properties → Permissions), Text Editor (xed), Chromium/Firefox viewer (tabs, README, live CCS-style Scoring Report at `/opt/CyberPatriot/ScoringReport.html`), Users and Groups, Firewall (gufw), Update Manager (+ auto-refresh preference), Software Manager, Startup Applications, Login Window (guest sessions), System Monitor, System Settings. All of them read/write the same virtual system as the terminal, so a fix made either way scores identically
- Looks follow real reference screenshots. Mint: dark wallpaper, logo-only menu button, time-only clock, two-column start menu. Ubuntu (Yaru): top bar with the active app name, dock with Trash, Settings → Appearance (Light/Dark, 10 accent colours, dock Left/Bottom/Right; default Dark + Red + Bottom like the reference), Nautilus-style Files (icon view, breadcrumb path bar, Ctrl+L)
- Icons: the real CyberPatriot logo (`assets/cyberpatriot-logo.png`) is used for the README, Scoring Report and Forensics Question files
- Ubuntu 22.04 image: gdm3/GNOME packages, Software Updater, Software & Updates, Ubuntu Software, gedit, GNOME-style Settings, automatic-login handling via `/etc/gdm3/custom.conf`
- Browser (`src/apps/browser.js`, `browser-pages.js`, `browser-sites.js`, `src/core/browserprefs.js`): Chromium with its own dark frame and Firefox, real tabs, bookmarks bar, `chrome://settings` (Safe Browsing levels, Pop-ups and redirects with site exceptions, Appearance light/dark, Reset settings, managed-policy banner), `chrome://downloads`, `chrome://policy`, Firefox `about:preferences` (Block pop-up windows + Exceptions dialog, Block dangerous and deceptive content, HTTPS-Only, logins), `about:config` (warning page, search, toggle/edit/reset, user.js and policy locks), `about:policies`. A small simulated web of made-up `.example` training sites shows what the settings do: pop-ups blocked or opened, the red Safe Browsing pages, and dangerous downloads blocked or saved to `~/Downloads`. Every setting lives in the real profile files (`~/.config/chromium/Default/Preferences`, `~/.mozilla/firefox/*/prefs.js`, `user.js`, `permissions.json`, `/etc/chromium/policies/managed/*.json`, `/etc/firefox/policies/policies.json`), so terminal edits and GUI edits match and the scorer reads the same files
- Mint look: cube wallpaper with a silver emblem (`assets/wallpaper-mint.svg`), Mint-Y windows with a round green close button, themed Mint-Y / Yaru icon sets (`src/ui/icons-apps.js`), Nemo path buttons + status bar with free space, xed (menu bar, toolbar, tab, line numbers, find bar), GNOME Terminal with menu bar and dark variant, cinnamon-settings icon grid with search, Update Manager (security shields, description pane), Software Manager (categories, cards, details page, per-package icons), gufw shield, Startup Applications switches, Cinnamon lock screen and Slick Greeter login
- Ubuntu look: gedit header bar, Ubuntu Software (Explore / Installed / Updates), Software Updater dialog, Software & Updates dropdowns, Startup Applications Preferences, Activities overview (search with app and Settings results, window previews, workspaces, paged app grid), GNOME lock screen and GDM
- Hover tips on every control (`src/ui/tooltip.js`; controls built without a title get one automatically)
- Tests: 29 passing (VFS, full terminal solve to 100/100, penalties, respawn, snapshot/restore, boot). GUI paths were also verified in headless Chromium (Playwright): GUI fixes score, toasts fire, state survives a reload

## What's left (in priority order)

1. More polish on GUI apps: Nemo drag-and-drop, Software Sources / Print Settings (currently a stub window), richer vi, System Monitor graphs, Users and Groups 'Groups' tab.
2. Add Playwright end-to-end tests to `tests/` (currently ad hoc scripts) and unit tests for more shell commands (`ps`, `ufw`, `apt` output formats).
3. More task types from previous years if the written list arrives (the photo's task types are done). Fidelity: `ps`/`ss`/`netstat` column layouts are approximations; some catalog versions are Jammy/Ubuntu-mixed; more man pages; `tar`/`zip`.
4. More scenarios (Mint round 2, harder variants; scoring "realistic" mode tuning).
5. Windows polish: NTFS ACLs (icacls), Group Policy editor, Event Viewer content, more Edge/Firefox tasks. Ubuntu polish: GNOME lock screen, more Ubuntu-only tasks (snap, unattended-upgrades, AppArmor).

Known quirk: browsers may capture Ctrl+W / Ctrl+T in nano; use the clickable footer or F2/F3/F6.

## Terminal ↔ UI contract (implemented in `src/apps/terminal.js`)

`createShell(sys, { user, io })` from `src/shell/index.js`. `io` must provide:

| member | meaning |
|---|---|
| `write(text)` | print (ANSI colors, `\x1b[K` etc.) |
| `readLine(prompt, {echo, secret})` → string \| null | read a line (null = Ctrl+D); used for sudo/passwd prompts and apt confirmations |
| `editor({path, text, kind:'nano'|'vi', isNew, readErr, save(text)→{ok,err}, user, startLine})` → string \| null | full-screen editor; call `save` on write-out and show `err` in the status bar like nano ("Error writing …: Permission denied") |
| `launch(appId, {name, args, user, cwd})` | open a GUI app (`firefox chromium xed nemo gufw terminal settings update software sources monitor login startup users generic`) running as `user` |
| `clear()`, `exit()`, `cols`, `rows`, optional `power(kind)`, `notify(args)` | |

`shell.run(line)` executes a line; `shell.prompt()` gives the colored prompt; `shell.complete(...)` returns completion candidates.

## License
MIT
