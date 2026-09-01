# test/e2e/E2E-ParticipantLifecycle.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite walks both participant-set transitions end to end through the `MathTestSession` harness.
It also opens several channels, closes one through the normal zero-participant snapshot path, and
compares the lifecycle-event live set with paged manager enumeration. The participant cases cover
the exit path (`leaveChannel` → N/N snapshot → on-chain snapshot update demotes the exiter to
SYNCED while the rest stay PARTICIPATING) and the join path (a synced spectator broadcasts a real
join confirmation, flips to PENDING_PARTICIPANT before the transaction is mined, and is promoted
to PARTICIPATING once the first block whose resulting participant set includes it is processed).
It also proves two guards: a detached leaver whose process stays connected never signs a
post-leave block (checked against the actual confirmation-signature set of the next finalized
block, with no honest peer blacklisted), and retrying an already-landed join confirmation rejects
with `ErrorJoinChannelParticipantAlreadyExists` while the host keeps PENDING_PARTICIPANT and the
recorded join-submission height, so the pending join still completes. Two fault interleavings hold
the join receipt after submission and inject an exact-sync failure while local status is pending.
Neither fault aborts: a failed transaction restores `SYNCED`, while a successful transaction leaves
on-chain pending membership and delivers the inbound join message. Oracles are host-side
status/storage reads over the control port and decoded block bundles. The `shouldSignBlock` and
admission permutations are now atomized per condition, so the join-promotion, signer-outside-union,
and pending-join-rejection scenarios each map to a single test here. The remaining conditions
(forfeit rule, blacklisted author, forced-join arming) belong to other suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Participant Lifecycle > Exit path > removes a normally closed channel from registry pages and the event-derived live set`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L27) (line 27)                  | [`INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP.P1`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#integration-test-open-channel-registry-1-a8m2kp.p1)                                                                                                                                                                                                                                                    |
| [`E2E: Participant Lifecycle > Exit path > should demote exiting participant to SYNCED when state snapshot is updated on-chain`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L97) (line 97)                   | [`UNIT-TEST-STATE-MANAGER-2-WSMPYS.P9`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-2-wsmpys.p9)                                                                                                                                                                                                                                                                                                              |
| [`E2E: Participant Lifecycle > Exit path > exiting participant does not sign blocks authored after its leave`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L117) (line 117)                                   | [`UNIT-TEST-STATE-MANAGER-2-WSMPYS.P7`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-2-wsmpys.p7), [`REQ-BLOCK-PIPE-10-PHAKE2.T1.P3`](../../../../specification/block-progression/block-processing.md#req-block-pipe-10-phake2.t1.p3)                                                                                                                                                                          |
| [`E2E: Participant Lifecycle > Join path > should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L172) (line 172) | [`UNIT-TEST-STATE-MANAGER-2-WSMPYS.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-2-wsmpys.p4)                                                                                                                                                                                                                                                                                                              |
| [`E2E: Participant Lifecycle > Join path > pending join fault survives until a failed receipt restores SYNCED`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L245) (line 245)                                  | [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P1`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p1), [`INV-TJOIN-2-H7JSQM.T1.P1`](../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm.t1.p1), [`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P8`](../../../../implementation/source/src/stateManager/membership/MembershipService.ts.md#unit-test-membership-service-1-edfkzf.p8) |
| [`E2E: Participant Lifecycle > Join path > pending join fault preserves the successful on-chain join and inbound message`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L309) (line 309)                       | [`INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P2`](../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75.t1.p2), [`INV-TJOIN-2-H7JSQM.T1.P2`](../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm.t1.p2), [`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P9`](../../../../implementation/source/src/stateManager/membership/MembershipService.ts.md#unit-test-membership-service-1-edfkzf.p9) |
| [`E2E: Participant Lifecycle > Join path > preserves a landed pending join when the same confirmation is retried`](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L370) (line 370)                               | [`REQ-ENFADM-2-K6K9SP.T1.P4`](../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp.t1.p4), [`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P17`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol.md#unit-test-join-channel-facet-1-vbjy1a.p17)                                                                                                                                                 |
