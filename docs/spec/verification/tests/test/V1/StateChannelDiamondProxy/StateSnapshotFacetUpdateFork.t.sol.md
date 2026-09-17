# test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                                  | Covers                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_updateStateSnapshotFork_snapshotNotGenesis_revertsCarryingBothForkIdsAndHeight`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol#L27) (line 27)                   | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P8`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p8)   |
| [`test_updateStateSnapshotFork_noDisputeWindowOnOriginFork_revertsCarryingBothForkIds`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol#L44) (line 44)                   | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P9`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p9)   |
| [`test_updateStateSnapshotFork_genesisTimestampMismatch_revertsCarryingBothTimestamps`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol#L60) (line 60)                   | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P10`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p10) |
| [`test_updateStateSnapshotFork_targetForkUnreachableByReductions_revertsCarryingCurrentAndTargetForkIds`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetUpdateFork.t.sol#L76) (line 76) | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P11`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p11) |
