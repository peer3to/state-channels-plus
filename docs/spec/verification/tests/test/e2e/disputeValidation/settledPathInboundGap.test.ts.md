# test/e2e/disputeValidation/settledPathInboundGap.test.ts — Test Report

> **Test file:** [settledPathInboundGap.test.ts](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [DisputeValidationService.ts.md](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Real peers stage a lost chain-event delivery on one lagging auditor (`dropInboundMessageLogs`, or
`preDisputeSetupCalldataPath` with `laggingInbound: "dropped"`): the delivery is lost, but an
explicit query of the same log still returns it, so the audit's event recovery can heal the gap.
The settled-path case commits a dispute without posted auditing data over the gap; the lagging
auditor recovers the inbound head, the fork resolves for it, it stays participating, the honest
peers store no dispute fraud proof, and no detached error appears. The final-dispute case submits
a threshold-final dispute over the gap; the lagging auditor recovers the run and settles on the
final dispute's own fork. The posted case empties the posted inbound run of a dispute that must
post its auditing data; the lagging auditor rebuilds the run from chain logs (it holds the inbound
head afterwards), everyone but the attacker converges on the reduced fork, nobody is slashed, and
no detached error appears.

No-fraud-proof checks inspect the honest auditors through the shared storage assertion. The
offender may already have been slashed and disposed; the test does not query its closed root. A gap
that event recovery cannot heal is out of scope here: it is an internal audit failure, covered by
the unit suite.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                  | Covers                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / inbound run gap > recoverable inbound log → the auditor recovers it, audits for real and converges`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L17) (line 17)                                     | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P1`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p1) |
| [`E2E: dispute validation / inbound run gap > final dispute over a recoverable gap → the lagging auditor recovers the run and settles on the final dispute's fork`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L86) (line 86)  | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P5`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p5) |
| [`E2E: dispute validation / inbound run gap > posted auditing data with an emptied inbound run → the auditor rebuilds the run from chain logs, nobody is slashed`](../../../../../../../test/e2e/disputeValidation/settledPathInboundGap.test.ts#L164) (line 164) | [`UNIT-TEST-DISPUTE-INBOUND-RECOVERY-32-6PBRKZ.P4`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-inbound-recovery-32-6pbrkz.p4) |
