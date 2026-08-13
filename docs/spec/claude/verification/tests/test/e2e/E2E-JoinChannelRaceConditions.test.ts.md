# test/e2e/E2E-JoinChannelRaceConditions.test.ts — Test Report

> **Test file:** [test/e2e/E2E-JoinChannelRaceConditions.test.ts](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite races the on-chain join/top-up admission gates of `JoinChannelFacet` against snapshot
advances and disputes, driven end to end through the `MathTestSession` harness: a spectator syncs
and collects a real unanimous join confirmation (`syncSpectatorAndPrepareJoin`), then the chain
state is moved underneath it before submission. The snapshot-race tests assert the exact custom
revert (`RaceConditionJoinChannelSnapshotMismatch`, `RaceConditionPendingInboundNotConsumed`)
decoded from the transaction failure, plus the SDK-side stand-down of `postStateSnapshot` when a
join's inbound message is still unconsumed. The dispute-race tests open a real dispute and assert
the disputed-fork join gate (`RaceConditionForceInboundJoinForkDisputed`) for both `joinChannel`
and `forceInboundJoin`, that a pending joiner survives dispute reduction into the reduced fork's
participant set, that existing and pending participants can top up mid-dispute and converge, and
that a stale top-up pin rethrows without disposing the participant. Oracles combine decoded revert
names, host-side status/storage reads over the control port, and on-chain
participant/pending/deposit queries. Countersignature collection itself is owned by
`test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts`; the remaining unassigned rows exercise
guards (the forceInboundJoin disputed-fork direction, pending-joiner survival across reduction)
whose atomized permutations are either already claimed by the joinChannel direction or have no
one-scenario ID of their own.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: Join channel race conditions > Snapshot vs join race > new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L16) (line 16)                 | [`REQ-ENFADM-1.T1.P2`](../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-t1-p2), [`UNIT-TEST-JOIN-CHANNEL-FACET-1.P12`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1.p12)                                                                                                              |
| [`E2E: Join channel race conditions > Snapshot vs join race > pending inbound unconsumed → postStateSnapshot stands down; on-chain snapshot unchanged`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L95) (line 95)                                | —                                                                                                                                                                                                                                                                                                                                                                                                |
| [`E2E: Join channel race conditions > Snapshot vs join race > pending inbound lands after preparation → raw same-fork calldata reverts with RaceConditionPendingInboundNotConsumed`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L140) (line 140) | [`REQ-ENFSNAP-3.T1.P2`](../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-t1-p2), [`REQ-ENFSNAP-3.T1.P3`](../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-t1-p3), [`UNIT-TEST-STATE-SNAPSHOT-FACET-1.P7`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1.p7) |
| [`E2E: Join channel race conditions > Dispute vs join race > join on disputed fork reverts`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L190) (line 190)                                                                                         | [`REQ-ENFADM-2.T1.P3`](../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-t1-p3), [`UNIT-TEST-JOIN-CHANNEL-FACET-1.P5`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1.p5)                                                                                                                |
| [`E2E: Join channel race conditions > Dispute vs join race > forceInboundJoin on disputed fork reverts`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L240) (line 240)                                                                             | —                                                                                                                                                                                                                                                                                                                                                                                                |
| [`E2E: Join channel race conditions > Dispute vs join race > pending joiner participates after dispute reduction`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L269) (line 269)                                                                   | —                                                                                                                                                                                                                                                                                                                                                                                                |
| [`E2E: Join channel race conditions > Dispute vs join race > allows existing and pending participants to top up during a dispute and converge after reduction`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L361) (line 361)                      | [`REQ-ENFADM-2.T1.P5`](../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-t1-p5)                                                                                                                                                                                                                                                                                          |
| [`E2E: Join channel race conditions > Dispute vs join race > rethrows a stale top-up guard without aborting participation`](../../../../../../../test/e2e/E2E-JoinChannelRaceConditions.test.ts#L477) (line 477)                                                          | —                                                                                                                                                                                                                                                                                                                                                                                                |
