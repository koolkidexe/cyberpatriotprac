# Scenario format

See `src/scenarios/mint-round1/index.js`. Exports `{ id, title, image, user, createMachine, vulns, penalties, forensics, readmeHtml }`.
Checks are pure functions of the `System`; a vuln counts while its check is true, so reverting a fix removes the points.
Round 1: 100 points, penalties −5 each. Forensics answers: FQ1 `Bluebird-2291`, FQ2 `PINEAPPLE-47`, FQ3 `4444`.
