# test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeUtils.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A minimal Foundry unit suite calling the free function
`_getUnfinalizedBlockConfirmationsFromStateProof` directly (file-level import of
`DisputeUtils.sol`; no diamond, no storage). Inputs are synthetic `StateProof`s whose last
milestone carries `n` empty block confirmations; the oracle is the returned array length: an empty
last milestone yields an empty result, `n` confirmations yield `n − 1` (the first, finalized block
is skipped), and a fuzz over `uint8 n` pins the exact `max(0, n − 1)` formula while proving the
walk never reverts. Confirmation contents, signatures, and the callers that consume the
unfinalized suffix are out of scope. The DisputeUtils source report declares no component test
obligations, and no specification permutation is fully demonstrated by these length-only checks,
so all rows stay unassigned.

## Tests and covered test IDs

| Test declaration                                                                                                                                      | Covers                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_reason_falseWithoutEvidenceIsNotAReason`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L7) (line 7)       | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P1`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p1), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p1) |
| [`test_reason_trueIsSufficientWithoutSelfRemoval`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L13) (line 13)   | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P2`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p2), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p2) |
| [`test_reason_falsePreservesTimeout`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L21) (line 21)                | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P3`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p3), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p3) |
| [`test_reason_falsePreservesSelfRemoval`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L28) (line 28)            | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P4`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p4), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p4) |
| [`test_reason_falsePreservesForcedInbound`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L35) (line 35)          | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P5`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p5), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p5) |
| [`test_reason_falseRequiresEverySlashToBeEligible`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L42) (line 42)  | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P6`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p6), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p6) |
| [`test_unfinalized_emptyLastMilestone_returnsEmpty`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L61) (line 61) | —                                                                                                                                                                                                                                                                                                                         |
| [`test_unfinalized_skipsFirstFinalizedBlock`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L67) (line 67)        | —                                                                                                                                                                                                                                                                                                                         |
| [`testFuzz_unfinalized_neverReverts`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L73) (line 73)                | —                                                                                                                                                                                                                                                                                                                         |
