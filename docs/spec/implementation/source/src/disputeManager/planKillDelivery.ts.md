# planKillDelivery.ts

> **Source:** [src/disputeManager/planKillDelivery.ts](../../../../../../src/disputeManager/planKillDelivery.ts)

## Requirements

- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)

Pure decision for the kill-then-dispute sender: the kill rides first in the upload's multicall
when both fit one transaction's calldata limit, goes alone ahead of the upload when only the kill
fits, and is not sent when the kill alone does not fit
([`REQ-FP-7-4DD0D7.T11.P14`](../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t11.p14)).
