# test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeUtils.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A minimal Foundry unit suite that calls `DisputeUtils.sol` free functions directly (file-level
import; no diamond, no storage). The `_hasDisputeReason` cases build a `DisputeInput` and a
snapshot by hand and assert the boolean: no evidence is no reason; `requireExistingDisputeWindow`
alone is a reason; a timeout, a self-removal or a forced inbound height each count without the
flag; and on-chain slashes count only when every slashed address is in the snapshot's participant
set. The `_getLatestSignedBlock` cases check the dispute's latest claimed block: an empty proof has
no block (it denotes the fork genesis), and a fuzz over `uint8 n` builds an earlier one-block
milestone plus a last milestone of `n` blocks and asserts that the call never reverts, has a block
unless `n` is 0, and returns the last milestone's last block. Signatures and the callers that use
the latest block are out of scope.

## Tests and covered test IDs

| Test                                                                                                                                                   | Covers                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_reason_falseWithoutEvidenceIsNotAReason`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L7) (line 7)        | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P1`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p1), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p1) |
| [`test_reason_trueIsSufficientWithoutSelfRemoval`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L13) (line 13)    | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P2`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p2), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p2) |
| [`test_reason_timeoutStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L20) (line 20)       | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P3`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p3), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p3) |
| [`test_reason_selfRemovalStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L27) (line 27)   | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P4`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p4), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p4) |
| [`test_reason_forcedInboundStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L34) (line 34) | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P5`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p5), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p5) |
| [`test_reason_falseRequiresEverySlashToBeEligible`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L41) (line 41)   | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P6`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p6), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p6) |
| [`test_latestSignedBlock_emptyProof_hasNoBlock`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L65) (line 65)      | [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P7`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p7)                                                                                                                                      |
| [`testFuzz_latestSignedBlock_neverReverts`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L71) (line 71)           | [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P8`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p8)                                                                                                                                      |
