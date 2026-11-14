# Scenario format

See `src/scenarios/mint-round1/index.js`. Exports `{ id, title, image, user, createMachine, vulns, penalties, forensics, readmeHtml }`.
Checks are pure functions of the `System`; a vuln counts while its check is true, so reverting a fix removes the points.
Round 1: 100 points over 39 items, penalties −5 each. Two forensics questions (6 pts each): FQ1 `Bluebird-2291`, FQ2 `PINEAPPLE-47`. The required browser is Chromium (report/README open in it).

Past-season task types (added Oct 29, both images): create the new hire's account (`taylor` on Mint, `nadia` on Ubuntu, standard user), force a password change at next login (`jordan` / `omar`: shadow last-change field = 0), install the OpenSSL security updates (`openssl` + `libssl3`), remove Apache2 / AisleRiot / Ophcrack (Ubuntu: Ophcrack and Nmap), and browser hardening read from the real profile files: Chromium pop-ups blocked + Safe Browsing on (Mint); Firefox pop-ups blocked, dangerous content blocked and dangerous downloads blocked (Ubuntu). The new-hire name is `NEW_HIRE` in each `readme.js` and is deliberately not in `AUTHORIZED_USERS` (that list drives the "authorized user removed" penalties).
