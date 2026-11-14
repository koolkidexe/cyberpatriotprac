# Adding another image (Ubuntu, Windows…)

An image is `src/images/<id>.js` (builds the base machine: users, packages, services, config files) plus `src/images/catalog.js` data.
A scenario (`src/scenarios/<id>/index.js`) calls the image builder, then misconfigures it and defines `vulns` and `penalties`
(`{id, category, points, title, check(sys)}`) and forensics questions.

Steps for Ubuntu 22.04: copy `mint21.js` → `ubuntu22.js`, swap the desktop/launcher list and branding (`src/ui/desktop.js` reads `.desktop` files,
so the menu follows automatically), add a scenario, and register it in `src/main.js`.
Windows needs a new shell (cmd/PowerShell) and a registry/ACL model in `src/core`; the scoring engine and UI window manager are OS-agnostic.


## How Ubuntu 22.04 was added (worked example)
1. Tag packages in `catalog.js` with `only: 'mint'|'ubuntu'` (and `over: {ubuntu: {...}}` for version differences); `applyDistro()` filters the visible catalog.
2. Add a `DISTROS` entry in `src/images/mint21.js` (os-release, sources, display manager, student groups) and a `buildUbuntu22` wrapper.
3. Add `src/scenarios/ubuntu-round1/` and a solve test (`tests/ubuntu.test.mjs`).
4. Add a desktop class (`src/ui/gnome-shell.js`) and skin (`css/ubuntu.css` under `body.os-ubuntu`), register the scenario in `src/main.js`.
