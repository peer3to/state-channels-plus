# E2E-KillAndDispute.test.ts — Test report

> **Test file:** [test/e2e/E2E-KillAndDispute.test.ts](../../../../../../test/e2e/E2E-KillAndDispute.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Submits invalid disputes and follows real audit transactions. Checks atomic kill-before-replacement, kill-only handling and fatal, atomic failure after the kill deadline.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                                                      | Covers                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: kill then dispute, and challenge timing > E49: an invalid opener is killed and the auditor's own dispute lands in the same multicall, kill first, with the killed submitter's slash as its reason; reduction completes from it`](../../../../../../test/e2e/E2E-KillAndDispute.test.ts#L23) (line 23)                          | [`REQ-DISPUTE-PIPE-6-6FZB9M.T4.P1`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t4.p1) |
| [`E2E: kill then dispute, and challenge timing > E49 ext: when the kill in the kill-then-dispute multicall cannot land (kill period over), the whole multicall reverts: no replacement claiming the unestablished slash is committed, and the failure is fatal`](../../../../../../test/e2e/E2E-KillAndDispute.test.ts#L91) (line 91) | [`REQ-DISPUTE-PIPE-5-RZZB48.T3.P1`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t3.p1) |
| [`E2E: kill then dispute, and challenge timing > E22: an audit that completes inside the kill window kills the invalid dispute in time: the challenge lands before the period ends and slashes the submitter`](../../../../../../test/e2e/E2E-KillAndDispute.test.ts#L131) (line 131)                                                 | [`REQ-FP-7-4DD0D7.T7.P1`](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t7.p1)                           |
| [`E2E: kill then dispute, and challenge timing > E22: a challenge sent after the kill period ends reverts with RaceConditionDisputeKillPeriodExpired and is fatal: no kill, no slash, the invalid dispute stays committed`](../../../../../../test/e2e/E2E-KillAndDispute.test.ts#L175) (line 175)                                    | [`REQ-DISPUTE-PIPE-5-RZZB48.T3.P2`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t3.p2) |
