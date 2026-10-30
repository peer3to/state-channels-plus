# StateSnapshotFacetUpdateFork.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol)
Exercises: [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Overview

Four Foundry component tests drive `updateStateSnapshotFork` through the deployed diamond
(`DiamondHarness`) on a freshly opened two-participant channel, isolating the three gates that
stand between a submitted fork snapshot and the reduced-result walk, plus the walk's own verdict.
Each builds a target snapshot whose origin fork is the channel's current fork, so the early
"already on the correct fork" return never fires and the gate under test is the one that rejects.

The first raises the target's block height, which breaks the genesis shape, and points its
`forkId` at a fork its snapshot data does not hash to, so the two reported forks are distinct
values; the revert must name the fork the target's snapshot data actually hashes to, the fork the
target claimed, and the offending height. The second leaves the target genesis-shaped but opens no dispute window on the
origin fork, so the chain has no dated genesis for it; the revert must name channel, origin fork
and target fork. The third opens a dispute window on the current fork and warps past its kill
period so the chain dates the genesis at the window's kill-period end, then submits a target
claiming one second later; the revert must name the dated timestamp and the claimed one. The
fourth clears all three gates — genesis-shaped target, dated origin window, matching timestamp —
but leaves that window unreduced, so the reduced-result walk never advances and the target stays
unreachable; the revert must name the current fork and the target fork, which the test asserts
are different values before submitting. Every case is a revert oracle on the exact decoded
payload, so a gate that fired for the wrong reason fails the test rather than passing on the name
alone.

## Tests

- `test_updateStateSnapshotFork_snapshotNotGenesis_revertsCarryingBothForkIdsAndHeight`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P8
- `test_updateStateSnapshotFork_noDisputeWindowOnOriginFork_revertsCarryingBothForkIds`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P9
- `test_updateStateSnapshotFork_genesisTimestampMismatch_revertsCarryingBothTimestamps`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P10
- `test_updateStateSnapshotFork_targetForkUnreachableByReductions_revertsCarryingCurrentAndTargetForkIds`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P11
