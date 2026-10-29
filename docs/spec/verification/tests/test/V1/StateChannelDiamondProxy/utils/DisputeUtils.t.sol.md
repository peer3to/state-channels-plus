# DisputeUtils.t.sol

Test file: [test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol](../../../../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol)
Exercises: [DisputeUtils.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md)

## Overview

The Foundry suite calls the free functions in `DisputeUtils.sol` directly, without a diamond
or storage. The reason cases cover the existing-window flag, timeout, self-removal, forced
inbound progress and slash membership. The latest-block cases call `_getLatestSignedBlock`:
an empty proof has no block, and a fuzzed last milestone returns its last confirmation's
signed block when nonempty. The oracle checks the returned encoded bytes, not only array length.
These utility tests do not establish signature validity or execute state transitions.

## Tests

- `test_reason_falseWithoutEvidenceIsNotAReason`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P1, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P1
- `test_reason_trueIsSufficientWithoutSelfRemoval`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P2, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P2
- `test_reason_timeoutStillCountsWhenFlagFalse`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P3, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P3
- `test_reason_selfRemovalStillCountsWhenFlagFalse`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P4, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P4
- `test_reason_forcedInboundStillCountsWhenFlagFalse`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P5, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P5
- `test_reason_slashOfNonParticipantInvalidatesEveryReason`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P6, UNIT-TEST-DISPUTE-UTILS-1-30FXAM.P6
- `test_latestSignedBlock_emptyProof_hasNoBlock`: none
- `testFuzz_latestSignedBlock_neverReverts`: none
