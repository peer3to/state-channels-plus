# test/e2e/disputeValidation/settledPathInboundGap.test.ts — Test Report

> **Test file:** [settledPathInboundGap.test.ts](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [DisputeValidationService.ts.md](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Real peers stage lost delivery separately from held event handling. Dispute audit recovers available inbound data or abstains without false fraud proofs, remains participating, and converges after release. The final-dispute case also checks the exact resulting fork. Posted empty inbound data cannot replace the local rebuild.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                        | Covers                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / inbound run gap > recoverable inbound log → the auditor recovers it, audits for real and converges`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L34) (line 34)                           | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P1`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p1) |
| [`E2E: dispute validation / inbound run gap > unrecoverable inbound log → the auditor abstains, stays participating, converges once the event lands`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L103) (line 103)    | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P2`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p2) |
| [`E2E: dispute validation / inbound run gap > final dispute over an unrecoverable gap → reduction deferred, then settles on the final dispute's fork`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L171) (line 171)   | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P3`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p3) |
| [`E2E: dispute validation / inbound run gap > posted auditing data with an emptied inbound run → the auditor still rebuilds locally, nobody is slashed`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L248) (line 248) | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P4`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p4) |
