# Mint Practice Image — a CyberPatriot-style practice simulator

A browser-based practice environment for CyberPatriot-style Linux hardening, set on a simulated **Linux Mint 21.3 "Virginia"** (Ubuntu 22.04 base) desktop. Everything — files, users, packages, services, firewall, cron, kernel settings — is simulated in JavaScript and runs locally in your browser. No server, no build step, no `npm install`.

> Unofficial. Not affiliated with or endorsed by the Air & Space Forces Association, the CyberPatriot program, Linux Mint or Mozilla. No real competition images or materials are used.

## Run it

```bash
node scripts/serve.mjs          # then open http://localhost:8080   (Node 18+)
npm test                        # 15+ headless tests, includes a full scripted solve
```

**GitHub Pages:** push to `main`, then *Settings → Pages → Source: GitHub Actions*. The workflow in `.github/workflows/pages.yml` runs the tests and publishes `index.html`, `css/` and `src/`. The site appears at `https://<you>.github.io/<repo>/`.

## How to play

1. Double-click **README** on the desktop. It lists authorized users, critical services and policy.
2. Open the **Terminal**. Your password is `cyberpatriot` (the user is `student`).
3. Find and fix the 32 vulnerabilities (100 points). Answer the three Forensics Questions by typing after the `ANSWER:` line.
4. Watch the **Score** pill in the panel or open the **Scoring Report**. Avoid penalties (removing authorized users, breaking SSH or Firefox, removing your own sudo).
5. Progress is saved in your browser (localStorage). *Menu → Reset image…* starts over. The ⚙ menu can add a realistic scoring delay.

## What is implemented

| Area | Status |
|---|---|
| Virtual filesystem with real permission checks, symlinks, `/proc`, `/dev` | done |
| Accounts: passwd/shadow/group/gshadow, PAM stack, pwquality, faillock, sudoers | done |
| Packages (apt/dpkg, ~150 packages, deps, upgrades, purge/config state) | done |
| Services (systemd units), listening sockets, processes, respawn via cron | done |
| UFW firewall, sysctl (+ `sysctl.d`), cron, login.defs, sshd (Include + first-value-wins), LightDM | done |
| Mint 21.3 image builder (`src/images/mint21.js`) | done |
| Scenario "Mint Practice Round 1": 32 vulns = exactly 100 pts, 12 penalties, README, forensics | done |
| Scoring engine (gain/loss/penalty events, optional delay, report HTML, persistence) | done |
| Bash-subset shell: quoting, `$()`, pipes, redirects, `&& \|\| ;`, `if/for/while`, scripts, aliases, history, tab completion | done |
| ~160 commands (ls, find, grep, sed, awk, sudo, su, passwd, adduser, userdel, usermod, ps, ss, kill, systemctl, ufw, apt, dpkg, sysctl, crontab, nano, …) | done |
| Desktop: panel, menu, window manager, terminal, nano-style editor, Files, Text Editor, Firefox-style viewer, score toasts | done |
| GUI admin tools: Users and Groups, Firewall (GUFW-style), Update Manager, Software Manager, Login Window, Startup Applications, System Monitor, System Settings. Each asks for your password (polkit-style) and uses the same core functions as the terminal | done |

## Still to do

See `HANDOFF.md` for the detailed list. In short: more scenarios (a harder Round 2, a Ubuntu/other flavor), `vi` modal editing (currently opens the nano-style editor), `less` paging, more `man` pages, and a visual polish pass.

## Layout

```
index.html, css/                 the site
src/core/                        VFS, users/PAM/sudo, packages, services, firewall, sysctl, cron, scoring, checks
src/images/                      package + service catalog, config templates, mint21.js image builder
src/scenarios/mint-round1/       misconfigurations, README, 100-point table
src/shell/                       parser, interpreter, commands/*
src/ui/, src/main.js             desktop, window manager, terminal, apps, admin-apps.js (GUI admin tools)
tests/                           node:test suites + helpers; browser-smoke.py and browser-gui.py (optional, need Playwright + a running server on :8099)
```
