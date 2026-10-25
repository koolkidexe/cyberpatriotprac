# Adding another image (Ubuntu, Windows…)

An image is `src/images/<id>.js` (builds the base machine: users, packages, services, config files) plus `src/images/catalog.js` data.
A scenario (`src/scenarios/<id>/index.js`) calls the image builder, then misconfigures it and defines `vulns` and `penalties`
(`{id, category, points, title, check(sys)}`) and forensics questions.

Steps for Ubuntu 22.04: copy `mint21.js` → `ubuntu22.js`, swap the desktop/launcher list and branding (`src/ui/desktop.js` reads `.desktop` files,
so the menu follows automatically), add a scenario, and register it in `src/main.js`.
Windows needs a new shell (cmd/PowerShell) and a registry/ACL model in `src/core`; the scoring engine and UI window manager are OS-agnostic.
