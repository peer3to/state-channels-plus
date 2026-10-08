# test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeUtils.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The Foundry suite calls the free functions in `DisputeUtils.sol` directly, without a diamond
or storage. The reason cases cover the existing-window flag, timeout, self-removal, forced
inbound progress and slash membership. The latest-block cases call `_getLatestSignedBlock`:
an empty proof has no block, and a fuzzed last milestone returns its last confirmation's
signed block when nonempty. The oracle checks the returned encoded bytes, not only array length.
These utility tests do not establish signature validity or execute state transitions.

## Tests and covered test IDs

| Test declaration                                                                                                                                             | Covers                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_reason_falseWithoutEvidenceIsNotAReason`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L7) (line 7)              | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P1`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p1), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p1) |
| [`test_reason_trueIsSufficientWithoutSelfRemoval`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L13) (line 13)          | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P2`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p2), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p2) |
| [`test_reason_timeoutStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L20) (line 20)             | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P3`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p3), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p3) |
| [`test_reason_selfRemovalStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L27) (line 27)         | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P4`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p4), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p4) |
| [`test_reason_forcedInboundStillCountsWhenFlagFalse`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L34) (line 34)       | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P5`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p5), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p5) |
| [`test_latestSignedBlock_emptyProof_hasNoBlock`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L70) (line 70)            | —                                                                                                                                                                                                                                                                                                                         |
| [`testFuzz_latestSignedBlock_neverReverts`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L76) (line 76)                 | —                                                                                                                                                                                                                                                                                                                         |
| [`test_reason_slashOfNonParticipantInvalidatesEveryReason`](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol#L43) (line 43) | [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P6`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p6), [`UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md#unit-test-dispute-utils-1-30fxam.p6) |
