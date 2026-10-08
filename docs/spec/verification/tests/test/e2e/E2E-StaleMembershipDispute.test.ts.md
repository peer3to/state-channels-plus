# E2E-StaleMembershipDispute.test.ts

Test file: [test/e2e/E2E-StaleMembershipDispute.test.ts](../../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts)

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

## Tests

- `departed author + stale resulting snapshot in a stateProof → DisputeBlockAuthorNotParticipant only, then killed on-chain`: REQ-DIS-3-C4KYSF.T1.P16
