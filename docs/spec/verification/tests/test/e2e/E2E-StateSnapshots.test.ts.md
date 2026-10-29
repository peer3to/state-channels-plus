# E2E-StateSnapshots.test.ts

Test file: [test/e2e/E2E-StateSnapshots.test.ts](../../../../../../test/e2e/E2E-StateSnapshots.test.ts)

## Overview

The suite drives on-chain snapshot posting (`StateManager.postStateSnapshot` through the prepared
same-fork/fork multicall paths of `StateSnapshotFacet`) end to end: peers advance real transitions
(including `leaveChannel` exits so the outbound stream carries a withdrawal), post the snapshot,
and the oracles compare chain against local state — `withdrawalDeltaMatchesExpected`,
`verifyOnChainChannelBalanceInvariant` before and after, `snapshotMatchesLocal`, and
`onStateSnapshotUpdated` event counts per peer. The dispute-path tests resolve a real fork and
verify both shapes of the follow-up: two independent updates (fork genesis first, then a same-fork
advance) and a single multicall that performs the fork update plus the same-fork advance in one
transaction landing on the reduced fork; a further test checks the post-dispute on-chain snapshot
is the new fork's genesis (`forkId == keccak256(snapshotData)`). Reduction re-entry tests use
host-side stubs to hold or pause old-fork reduction timers and prove `onSetState` fires exactly
once whether the held timer replays after the snapshot-event reduction or the snapshot event joins
an already-entered reduction. Edge cases cover the first snapshot at block height 0 and a
same-fork post on a fork with an active dispute, which the chain refuses with
`RaceConditionSnapshotUpdateDisputedFork` while the on-chain snapshot hash stays unchanged, the invalid dispute
is still killed and resolved, and a post on the reduced fork lands again. Reduction single-completion obligations belong to
`test/stateManager/ReductionManager.test.ts` and stay unassigned here, as do batch-split
convergence permutations that would need one test to compare split against unsplit advances.

The fork scenarios use the shared evidence window. A full-pool run recorded a valid upload taking 4.8 seconds; the former 3-second override expired during that upload. Snapshot assertions and the global test timeout remain unchanged.

## Tests

- `unpublished newcomer survives timeout rejection and applies resumed verified history`: REQ-SM-11-VVP01C.T1.P15
- `chain-eligible participants still open a real timeout dispute`: REQ-SM-11-VVP01C.T1.P18
- `a reduce onto a fork disputed while it was pending lands alone; the latest undisputed fork is adopted once that fork reduces`: REQ-ENFSNAP-4-ESP98F.T1.P20
- `off-chain promotion gains dispute standing only after snapshot publication`: REQ-SM-11-VVP01C.T1.P14
- `should post updated state snapshot on-chain after 3 transitions`: REQ-ENFSNAP-1-FYN3BW.T1.P1, REQ-LIF-1-A5BN02.T1.P1, INV-MSG-4-6E5G7V.T1.P1, INV-MSG-6-1C22RD.T1.P1
- `should remove malicious participant after fork and then post updated state snapshot on the reduced fork - 2 independent snapshot updates`: REQ-LIF-2-Z3Z9Y3.T1.P1
- `should remove malicious participant after fork and then post updated state snapshot on the reduced fork - multicall`: INV-ENFSNAP-1-9VZ2HE.T1.P1, UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P1
- `should not re-emit setState when a held old-fork reduction timeout runs after snapshot-event reduction`: none
- `should not re-emit setState when a snapshot event joins an already-entered old-fork reduction`: none
- `should handle snapshot update at blockHeight = 0 (first snapshot) - edge case since genesis is also height 0`: REQ-LIF-1-A5BN02.T1.P7
- `should update on-chain snapshot to a new fork genesis after dispute resolution`: REQ-DIS-6-Y92H1M.T1.P8
- `same-fork post on a disputed fork reverts with RaceConditionSnapshotUpdateDisputedFork; the window survives and the kill still resolves`: none
