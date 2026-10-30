# E2E-OlderDisputeNewerState.test.ts

Test file: [test/e2e/E2E-OlderDisputeNewerState.test.ts](../../../../../../test/e2e/E2E-OlderDisputeNewerState.test.ts)

## Overview

Audits old disputes with newer evidence and missing old application state. Checks newer-signed-state kills or honest newer-state responses and final reduction results. E41 and E43 bind the expected reduction height to the snapshot in the auditor’s recorded submitted auditing data, verify its hash against the dispute commitment, and require that height to be at least the initially observed auditor height and strictly above the older dispute. A final block arriving after the initial read therefore cannot turn a correct newer-state reduction into a stale-height assertion failure. E43 awaits the leaver’s actual held exit send before submitting the auditor’s join; otherwise that inbound message can make exit preflight refuse and trigger an unrelated self-removal dispute before the test’s audit observations are installed.

## Tests

- `E35: a fresh pending peer synced past the lagging chain anchor kills an older omitted-data dispute with the disputer's newer signed block from its retained evidence`: REQ-FP-7-4DD0D7.T7.P2
- `E41: a second pending peer synced past a first pending peer's state answers that peer's older dispute with its own newer state and posted auditing data, and the reduction selects it`: REQ-DISPUTE-PIPE-6-6FZB9M.T4.P2
- `E43: a fresh pending auditor answers a departed but chain-eligible participant's older dispute with its own newer state and posted auditing data, and the reduction selects it`: REQ-DISPUTE-PIPE-6-6FZB9M.T4.P3
