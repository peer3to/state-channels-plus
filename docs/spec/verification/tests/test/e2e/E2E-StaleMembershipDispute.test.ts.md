# test/e2e/E2E-StaleMembershipDispute.test.ts — Test Report

> **Test file:** [test/e2e/E2E-StaleMembershipDispute.test.ts](../../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One adversarial scenario on a four-peer channel with a real participant leave: peer 3's dispute
construction is stubbed to append a state-proof head block authored by the departed peer and bound
to the stale pre-leave snapshot at the head's coordinates, then peer 3 directly submits a self-removal dispute. Participant-timeout checks are suppressed
during staging, so an unrelated dispute does not open or consume the shared window. The oracles assert the honest peers classify exactly the coordinate-binding failure —
`DisputeBlockAuthorNotParticipant` stored on peers 0/1/3, with the structural, state-proof, and
apply fraud-proof types explicitly absent — and that the malicious disputer is slashed on-chain by
the kill transaction, independent of any later fork reduction. This pins the audit's author
check to the resulting snapshot's coordinates instead of a naive membership lookup in a stale era.
The removed-participant kill scenario is assigned below. Other predicate permutations belong to their owning test declarations.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                          | Covers                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`E2E: stale-membership dispute > departed author + stale resulting snapshot in a stateProof → DisputeBlockAuthorNotParticipant only, then killed on-chain`](../../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts#L11) (line 11) | [`REQ-DIS-3-C4KYSF.T1.P16`](../../../../specification/disputes/disputes.md#req-dis-3-c4kysf.t1.p16) |
