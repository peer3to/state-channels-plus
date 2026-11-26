# E2E-KillAndDispute.test.ts

Test file: [test/e2e/E2E-KillAndDispute.test.ts](../../../../../../test/e2e/E2E-KillAndDispute.test.ts)

## Overview

Submits invalid disputes and follows real audit transactions. Checks atomic kill-before-replacement, kill-only handling and fatal, atomic failure after the kill deadline. After the kill, E49 reads the window's commitments (the replacement without the killed spam) and completes the reduction from that post-kill set.

## Tests

- `E49: an invalid opener is killed and the auditor's own dispute lands in the same multicall, kill first; it lists none of the kill's slashes and needs the open window; reduction completes from it`: REQ-DISPUTE-PIPE-6-6FZB9M.T4.P1, INV-ENFDIS-1-1K65DT.T1.P3, REQ-FP-7-4DD0D7.T11.P15
- `E49 ext: when the kill in the kill-then-dispute multicall cannot land (kill period over), the whole multicall reverts: no replacement is committed, and the failure is fatal`: REQ-DISPUTE-PIPE-5-RZZB48.T3.P1, REQ-FP-7-4DD0D7.T11.P15
- `E22: an audit that completes inside the kill window kills the invalid dispute in time: the challenge lands before the period ends and slashes the submitter`: REQ-FP-7-4DD0D7.T7.P1
- `E22: a challenge sent after the kill period ends reverts with RaceConditionDisputeKillPeriodExpired and is fatal: no kill, no slash, the invalid dispute stays committed`: REQ-DISPUTE-PIPE-5-RZZB48.T3.P2
- `E49 ext: the kill and the auditor's own dispute do not fit one transaction, and another auditor's kill and replacement land while its lone kill waits -> the late kill changes nothing, its own dispute still lands without a slash, and only the spammer is slashed`: REQ-FP-7-4DD0D7.T11.P14
