# DisputeFinalPointRegression.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFinalPointRegression.t.sol)

## Overview

Stages a channel whose anchor precedes a later joiner's JOIN, then posts two disputes in one window: the joiner's honest history, which consumes the JOIN and reaches a threshold-final point, and a side chain from the anchor whose inbound head stays below the JOIN. It applies the proposed `DisputeFinalPointRegression` kill, encoded with a proposed struct and proof-type slot because the kill does not exist yet, and expects the reduction to keep the joiner's final history. The test is skipped with `vm.skip(true)` until the kill lands; it tracks FIND-DISPUTE-6-E2YJ9X and covers no permutation. The requirements it bears on are REQ-FIN-7-RTZWQZ (the later joiner belongs to the relevant participant set) and REQ-FP-7-4DD0D7 (a dispute fraud proof kills the side chain's dispute).

## Tests

- `test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory`: none
