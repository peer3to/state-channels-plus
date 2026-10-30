# E2E-MaliciousUpdateSnapshot.test.ts

Test file: [test/e2e/E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)

## Overview

The suite attacks `updateStateSnapshotSameFork` with colluded snapshots built through the
harness's `byzantine.postFraudulentSnapshot` mutator, which lets a test rewrite the snapshot data
and outbound message block before the (otherwise honest) posting flow submits them on-chain. Two
tests assert the contract-side guards via decoded custom errors: an outbound exit inflated beyond
total deposits reverts with `CantWithdrawMoreThanDeposits` carrying both the funded deposit total
and the forged withdrawal total, and an outbound block whose message
sum exceeds the snapshot's claimed `totalWithdrawals` reverts with
`ErrorOutboundMessageBlocksInvalid`. The third test covers the case the contract cannot see: all
peers collude on a state-machine state with one balance inflated by 1, the snapshot (committing
only the state hash) lands on-chain, every peer serves the inflated bytes, and a fresh spectator
syncing against it must hit the balance-invariant check and abort — verified through a host-side
abort-recording stub, a non-SYNCED status, and zero open connections. Oracles are decoded revert
names, the on-chain snapshot commitment, and the spectator's abort/status/connection state; the
dispute-side balance-invariant check is owned by `test/e2e/disputeValidation/balanceInvariant`.
The two revert tests exercise only the beyond-cap side of their bounds, so boundary-sweep
permutations (exact cap, zero, maximum) stay unassigned.
The balance-invariant case spawns its spectator spawn-only (`createSpectatorPeer`, abort-recording stub, `connectSpectator`): after the colluded snapshot the participants no longer agree with the chain, so no block may be authored during the spawn, and the stub is installed before the first sync request can run.

## Tests

- `colluded over-withdrawal → updateStateSnapshotSameFork reverts with CantWithdrawMoreThanDeposits`: INV-MSG-4-6E5G7V.T1.P3, INV-LIF-5-ENQB91.T1.P3
- `outbound block messages sum exceeds snapshot.totalWithdrawals → updateStateSnapshotSameFork reverts with ErrorOutboundMessageBlocksInvalid`: INV-MSG-3-PCR3KT.T1.P3
- `colluded inflated stateMachineState balance → updateStateSnapshotSameFork succeeds, spectator aborts on balance invariant`: REQ-SYNC-2-TNT4F4.T1.P2
