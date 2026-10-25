# Handoff notes

Read `README.md` first. This file is for whoever continues the work (human or another Claude).

## State
Engine, Mint 21 image, scenario, scoring, shell/commands and a working desktop UI are **done and tested**:
`npm test` runs a scripted student who solves the whole scenario through the terminal and must land on exactly 100 points with zero penalties. The UI and every GUI admin tool were driven in headless Chromium (`tests/browser-*.py`) (typing, nano save, permission errors, score toasts, persistence across reload).

## Conventions that matter
- Plain ES modules, no bundler, no npm dependencies. Everything must keep working from `file`-less static hosting (GitHub Pages).
- Checks in a scenario must read **effective** configuration via `src/core/checks.js` (e.g. sshd first-value-wins with `Include` at the top), never grep for a string. Add a trap test whenever a check could be satisfied the wrong way.
- Scoring table must always sum to 100 (`tests/scenario.test.mjs` asserts it).
- New commands: `def('name', (ctx) => …, { bin })` in `src/shell/commands/*.js`. `ctx.fs` is permission-checked as the effective user; throw `CmdError(msg, code)` for failures; use `ctx.io.prompt` for interactive input. Remember sudo changes `shell.euser`.
- Generated nodes (`/proc`, `/dev`) are not serialized: `mountVirtual(sys)` must run after `System.restore`.

## Next steps (suggested order)
1. GUI admin tools are **done** (`src/ui/admin-apps.js`; `TOOLS` maps launcher names to windows). Remaining polish: Software Sources, Printers, Timeshift windows are still placeholders; the GUIs have no keyboard shortcuts; Users and Groups has no group editor.
2. **Round 2 scenario**: copy `src/scenarios/mint-round1/`, change the story, add harder items (PAM faillock vs tally2 variants, sudoers `Defaults`, SUID binaries, `/etc/hosts`, hidden users in `/etc/passwd` with UID 0, cron under `/var/spool/cron/crontabs`, `ssh` `AllowUsers`, unattended-upgrades config). Add a scenario picker to `main.js`.
3. Terminal polish: `Ctrl+R`, `less` paging, `vi` modal editing, background jobs (`&`), shell functions, `case`, here-docs.
4. Known approximations: `ss`/`ps` column widths, `apt` output is condensed, `journalctl` is a thin view of syslog, `top` prints one frame.
5. Visual polish of the desktop (themes, icons, window animations).

## Pitfalls already hit
- `pgrep -u user` must work without a pattern.
- `grep` inverted match logic and `ls` owner lookup for uid 0 (`toor`) were real bugs — keep tests for them.
- Base processes must be spawned with the clock set to boot time or `systemctl status` shows "45d ago".
