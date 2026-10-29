# MilestoneFinalityFreeze.t.sol

Test file: [test/V1/StateChannelDiamondProxy/MilestoneFinalityFreeze.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/MilestoneFinalityFreeze.t.sol)

## Overview

Two Foundry contracts. `MilestoneFinalityFreezeTest` drives the public `isAuditingDataOmissionAllowed`
predicate and `applyDisputeFraudProofs` on a harness that inherits the dispute-fraud-proof,
dispute-verification and snapshot facets; the predicate's `isMilestoneFinal` self-call is routed to a
deployed `StateProofFacet` through a fallback, and pruning uses the real `_clearOldInboundMessageBlocks`.
The seed is a two-member snapshot whose inbound head is the open block; each dispute anchors at a chosen
inbound block and lists its own slashes. Oracles are the predicate verdict before and after a later JOIN,
top-up, adoption or slash; the fuzz (64 runs) computes the expected verdict from the seeded joins, anchor index and
signer count over the full `uint8` range, once with the joins pending and once after adopting exactly the
joins at or below the anchor; the kill cases check who is slashed and whether the commitment stays. Both slash
cases use a milestone the slashed member did not sign. A slash one second after the window opened leaves the verdict
"not final", and a dispute that lists the slash reads final. The earlier-fork case slashes a member one second before
the construction read and the window: at construction and at proof, a dispute that does not list it reads "not
final" and a dispute that lists it reads final. The predicate reads the chain's snapshot participants, never the dispute's own latest state: a forged milestone only the disputer signed, with a latest-state hash that names a set of just the disputer or a preimage nobody holds, still reads "not final", and the honest prover's proof slashes the disputer. The fork-update cases
seed reduced links from fork E and call the real `updateStateSnapshotFork`: a disputed latest target is refused with
`RaceConditionSnapshotUpdateDisputedFork`, an intermediate target with `RaceConditionSnapshotUpdateNotLatestFork`
naming both forks while the latest one lands, and in both refusals the committed dispute's verdict stays "not final"
and the honest challenger's proof slashes the disputer; an unlinked target reverts `ErrorStateSnapshotNotValid`.

`SameForkSnapshotKillPeriodTest` deploys the real diamond, opens a two-member channel, opens a window with a real
routed `uploadDispute` anchored at the chain's inbound head whose last milestone both members signed, and sends same-fork snapshots built by
`DiamondHarness._makeSameForkSnapshot` through the routed `updateStateSnapshotSameFork`. The final close is refused
with `RaceConditionSnapshotUpdateDisputedFork(channelId, forkId)` one second before the kill period ends, with no
snapshot or registry change, and is still refused once `isKillPeriodExpired` reports the period over, leaving the
channel open. Every refusal asserts the exact arguments. It lands
with a window only on another fork (the no-window close is covered by the open-channel registry suite); an empty
proof on the disputed fork still reverts `ErrorInvalidStateProof`. The widening case leaves a routed `joinChannel`
pending above the snapshot's consumed inbound, then uploads a dispute anchored at the snapshot's inbound instead of
the chain head: it reverts `RaceConditionDisputeInboundNotLatest(head hash, snapshot inbound hash)`, no window opens,
and an adoption of the joiner signed by all three lands with three participants.

The leave case opens a three-member channel, lands one same-fork post with no window so the open block's joins are pruned, uploads a dispute without auditing data whose last milestone the leaver never signed, and sends the leaver's fully signed exit inside the kill period. The exit reverts `RaceConditionSnapshotUpdateDisputedFork`, and the not-final proof slashes the disputer and not the challenger; with the refusal removed the exit lands and the challenger is slashed.

## Tests

- `test_isFinal_topUpAboveAnchor_openBlockPruned_memberStaysExpected`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P29
- `testFuzz_isFinal_joinsAboveAnchor_oracle`: REQ-FIN-7-RTZWQZ.T1.P18
- `test_isFinal_joinAtAnchor_expectedBeforeAndAfterConsumption`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P30
- `test_isFinal_slashAfterCommit_cannotFlipFalseToTrue`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P31
- `test_isFinal_memberSlashedOnEarlierFork_expectedUnlessListed`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P28, REQ-FIN-7-RTZWQZ.T1.P13
- `test_forgedSelfSignedMilestone_selfServingLatestState_disputerSlashed`: REQ-FIN-7-RTZWQZ.T1.P19
- `test_forgedSelfSignedMilestone_withheldLatestState_disputerSlashed`: REQ-FIN-7-RTZWQZ.T1.P20
- `test_applyDisputeFraudProofs_participantSetUnchanged_submitterSlashedNotDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P33
- `test_applyDisputeFraudProofs_zeroTargetFromParticipant_submitterSlashedNotDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P205
- `test_disputeInvalidStateProof_noCalldata_frozenSet_slashesDisputer`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P32
- `test_forkUpdate_refusedOntoDisputedTarget_verdictUnchanged`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P24, REQ-ENFSNAP-4-ESP98F.T1.P17
- `test_forkUpdate_unlinkedTarget_revertsStateSnapshotNotValid`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P21
- `test_forkUpdate_ancestorAdoptionRefusedNotLatest_honestChallengerNotSlashed`: REQ-ENFSNAP-4-ESP98F.T1.P19
- `test_forkUpdate_intermediateTargetRefused_latestLands`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P23, REQ-ENFSNAP-4-ESP98F.T1.P18
- `test_forkUpdate_walkStopsAtUnexpiredLink_beyondIsUnreachable`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P25
- `test_forkUpdate_walkStopsAtUnexpiredLink_disputedLatestRefused`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P26
- `test_sameFork_refusedWhileKillPeriodOpen`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P15, REQ-ENFSNAP-4-ESP98F.T1.P1
- `test_sameFork_refusedAfterKillPeriodExpiry`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P16, REQ-ENFSNAP-4-ESP98F.T1.P2
- `test_sameFork_windowOnOtherForkDoesNotBlock`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P18, REQ-ENFSNAP-4-ESP98F.T1.P4
- `test_sameFork_invalidProofOnDisputedFork_revertsInvalidStateProof`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P19
- `test_joinPendingAtUpload_disputeBelowInboundHeadRefused`: REQ-DIS-2-PKVZ7E.T1.P31
- `test_leaverExitDuringKillPeriod_honestChallengerNotSlashed`: REQ-FIN-7-RTZWQZ.T1.P12
