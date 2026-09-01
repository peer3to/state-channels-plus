# test/unit/BlockCommitService.test.ts — Test Report

> **Test file:** [test/unit/BlockCommitService.test.ts](../../../../../../test/unit/BlockCommitService.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [BlockCommitService.ts](../../../../implementation/source/src/stateManager/block/BlockCommitService.ts.md)

## Overview

The mapped pending-join case proves that a later ordinary committed block promotes a receipt-confirmed
`PENDING_PARTICIPANT` to `PARTICIPATING` and clears the recorded force-join height. This is later cooperative
progress, not a gate on the already completed targeted-connect result.

This evidence supports [`REQ-TJOIN-3-DCZKS6`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: BlockCommitService > success → status promotion > a PENDING joiner's first committed block includes it → PARTICIPATING and the recorded forceJoin height cleared`](../../../../../../test/unit/BlockCommitService.test.ts#L201) (line 201) | [`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1`](../../../../implementation/source/src/stateManager/block/BlockCommitService.ts.md#unit-test-block-commit-service-1-v6tp9s.p1), [`REQ-TJOIN-3-DCZKS6.T1.P3`](../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6.t1.p3) |
