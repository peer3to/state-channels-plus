# E2E-OlderDisputeNewerState.test.ts — Test report

> **Test file:** [test/e2e/E2E-OlderDisputeNewerState.test.ts](../../../../../../test/e2e/E2E-OlderDisputeNewerState.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Audits old disputes with newer evidence and missing old application state. Checks newer-signed-state kills or honest newer-state responses and final reduction results.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                                                    | Covers                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: older dispute after sync to a newer finalized state > E35: a fresh pending peer synced past the lagging chain anchor kills an older omitted-data dispute with the disputer's newer signed block from its retained evidence`](../../../../../../test/e2e/E2E-OlderDisputeNewerState.test.ts#L20) (line 20)                    | [`REQ-FP-7-4DD0D7.T7.P2`](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t7.p2)                           |
| [`E2E: older dispute after sync to a newer finalized state > E41: a second pending peer synced past a first pending peer's state answers that peer's older dispute with its own newer state and posted auditing data, and the reduction selects it`](../../../../../../test/e2e/E2E-OlderDisputeNewerState.test.ts#L131) (line 131) | [`REQ-DISPUTE-PIPE-6-6FZB9M.T4.P2`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t4.p2) |
| [`E2E: older dispute after sync to a newer finalized state > E43: a fresh pending auditor answers a departed but chain-eligible participant's older dispute with its own newer state and posted auditing data, and the reduction selects it`](../../../../../../test/e2e/E2E-OlderDisputeNewerState.test.ts#L162) (line 162)        | [`REQ-DISPUTE-PIPE-6-6FZB9M.T4.P3`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m.t4.p3) |
