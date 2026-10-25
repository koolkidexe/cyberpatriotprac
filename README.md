# CyberPatriot Simulator (Linux Mint 21)

A **static website** that simulates a CyberPatriot Linux practice image: a fake Linux Mint 21 "Cinnamon" desktop in your browser, with a deliberately misconfigured virtual computer you have to secure, a simulated terminal, GUI admin apps, a scenario README, forensics questions, and a live Scoring Report with "You gained / lost points" popups. No VM, no backend, no build step.

> Status: **work in progress.** The simulation engine, the shell and the scoring are finished and tested. The desktop UI is the part still being built. See "What's done / what's left" below.

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
100 points, penalties of −5. 3 forensics questions, user auditing (unauthorized users, hidden UID 0 account, wrongly-privileged users, weak passwords), account policy (guest login, password age/length, lockout, empty passwords, sudo without password), updates, firewall, SSH hardening (note the `sshd_config.d` trap), sysctl, prohibited software/files, a respawning backdoor (cron + listener), a malicious autostart entry and `/etc/shadow` permissions. A full scripted solve in `tests/solve.test.mjs` proves all 100 points are reachable and that nothing scores by accident.

## What's done

- Virtual filesystem with real permission semantics (`FsView` per user), symlinks, usr-merge layout, `/proc` and `/dev` virtual nodes
- Accounts: passwd/shadow/group/gshadow, `useradd/adduser/usermod/userdel/deluser/gpasswd/chage/chpasswd/passwd`, yescrypt-style hashes, PAM parsing (pwquality, faillock/tally, nullok), sudoers parsing with drop-ins, `sudo`/`su` with password prompts and a 15-minute cache, auth.log entries
- Packages: apt/apt-get/apt-cache/apt-mark/dpkg with dependencies, `rc` config-file state, upgrades, history logs, root-only locking errors like the real tools
- Services: systemctl/service with polkit-style password prompts, unit enable/disable/mask, processes spawned and killed in the process table, `ss`/`netstat`/`lsof` derived from them
- Firewall: ufw (enable/disable/default/allow/deny/delete/status verbose|numbered/reset/logging), sysctl, cron/crontab with respawning backdoor
- Shell: quoting, variables, `$(…)`, arithmetic, globs, pipes, redirects, `&&`/`||`/`;`, `for`/`while`/`if`, history expansion, aliases, tab completion API, `~/.bashrc`, command-not-found suggestions, ~200 commands (coreutils-like, grep/sed/awk subset, find with `-exec`, ps/top/kill, journalctl, man (short pages), nano/vi hooks, GUI launchers)
- Scoring engine (instant or realistic 60 s mode), report object, penalties, persistence round trip
- Desktop UI (`index.html`, `css/`, `src/main.js`, `src/ui/*`): Cinnamon-style panel, start menu from `.desktop` files, window manager, desktop icons, polkit-style auth dialog, "You gained / lost points" toasts + sounds, welcome dialog, lock screen/greeter, tray menu (scoring mode, sound, hint, report, reset), autosave to localStorage, reboot semantics
- GUI apps (`src/apps/*`): Terminal (history, Tab completion, nano/vi overlays), Files/Nemo (Open as Root, trash, Properties → Permissions), Text Editor (xed), Firefox (tabs, README, live Scoring Report), Users and Groups, Firewall (gufw), Update Manager (+ auto-refresh preference), Software Manager, Startup Applications, Login Window (guest sessions), System Monitor, System Settings. All of them read/write the same virtual system as the terminal, so a fix made either way scores identically
- Tests: 17 passing (VFS, full terminal solve to 100/100, penalties, respawn, snapshot/restore, boot). GUI paths were also verified in headless Chromium (Playwright): GUI fixes score, toasts fire, state survives a reload

## What's left (in priority order)

1. More polish on GUI apps: Nemo drag-and-drop and list/icon view toggle, Software Sources / Print Settings (currently a stub window), Firefox about:preferences, richer vi, System Monitor graphs.
2. Add Playwright end-to-end tests to `tests/` (currently ad hoc scripts) and unit tests for more shell commands (`ps`, `ufw`, `apt` output formats).
3. Fidelity: `ps`/`ss`/`netstat` column layouts are approximations; some catalog versions are Jammy/Ubuntu-mixed; more man pages; `tar`/`zip`.
4. More scenarios (Mint round 2, harder variants; scoring "realistic" mode tuning).
5. Ubuntu and Windows images (see `docs/adding-an-os.md`).

Known quirk: browsers may capture Ctrl+W / Ctrl+T in nano; use the clickable footer or F2/F3/F6.

## Terminal ↔ UI contract (implemented in `src/apps/terminal.js`)

`createShell(sys, { user, io })` from `src/shell/index.js`. `io` must provide:

| member | meaning |
|---|---|
| `write(text)` | print (ANSI colors, `\x1b[K` etc.) |
| `readLine(prompt, {echo, secret})` → string \| null | read a line (null = Ctrl+D); used for sudo/passwd prompts and apt confirmations |
| `editor({path, text, kind:'nano'|'vi', isNew, readErr, save(text)→{ok,err}, user, startLine})` → string \| null | full-screen editor; call `save` on write-out and show `err` in the status bar like nano ("Error writing …: Permission denied") |
| `launch(appId, {name, args, user, cwd})` | open a GUI app (`firefox xed nemo gufw terminal settings update software sources monitor login startup users generic`) running as `user` |
| `clear()`, `exit()`, `cols`, `rows`, optional `power(kind)`, `notify(args)` | |

`shell.run(line)` executes a line; `shell.prompt()` gives the colored prompt; `shell.complete(...)` returns completion candidates.

## License
MIT
