# test/e2e/E2E-ParticipantLifecycle.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ParticipantLifecycle.test.ts](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite walks both participant-set transitions end to end through the `MathTestSession` harness:
the exit path (`leaveChannel` → N/N snapshot → on-chain snapshot update demotes the exiter to
SYNCED while the rest stay PARTICIPATING) and the join path (a synced spectator broadcasts a real
join confirmation, flips to PENDING_PARTICIPANT before the transaction is mined, and is promoted
to PARTICIPATING once the first block whose resulting participant set includes it is processed).
It also proves two guards: a detached leaver whose process stays connected never signs a
post-leave block (checked against the actual confirmation-signature set of the next finalized
block, with no honest peer blacklisted), and retrying an already-landed join confirmation rejects
with `ErrorJoinChannelParticipantAlreadyExists` while the host keeps PENDING_PARTICIPANT and the
recorded join-submission height, so the pending join still completes. Oracles are host-side
status/storage reads over the control port and decoded block bundles. The `shouldSignBlock` and
admission permutations are now atomized per condition, so the join-promotion, signer-outside-union,
and pending-join-rejection scenarios each map to a single test here; the remaining conditions
(forfeit rule, blacklisted author, forced-join arming) belong to other suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                 | Covers                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: Participant Lifecycle > Exit path > should demote exiting participant to SYNCED when state snapshot is updated on-chain`](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L26) (line 26)                   | —                                                                                                                                    |
| [`E2E: Participant Lifecycle > Exit path > exiting participant does not sign blocks authored after its leave`](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L46) (line 46)                                     | [`UNIT-TEST-STATE-MANAGER-2.P7`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-2.p7) |
| [`E2E: Participant Lifecycle > Join path > should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block`](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L101) (line 101) | [`UNIT-TEST-STATE-MANAGER-2.P4`](../../../../implementation/source/src/stateManager/StateManager.ts.md#unit-test-state-manager-2.p4) |
| [`E2E: Participant Lifecycle > Join path > preserves a landed pending join when the same confirmation is retried`](../../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts#L161) (line 161)                               | [`REQ-ENFADM-2.T1.P4`](../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-t1-p4)                              |
