# test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two tests cover `dispute.input.selfRemoval` from both sides. The valid case arms `forceExit` on
peer 1 so its dispute pipeline produces a genuine self-removal dispute, posted untampered: the
oracles assert exactly one commitment, no `onDisputeKilled` from anyone during a 4-second quiet
window, fork resolution among the remaining peers, a participant count of 2, and that every
remaining peer's participant list no longer contains the leaver's address. The invalid case posts
a dispute through `DisputeTampering.flipSelfRemovalWithoutOutputRecompute`, which flips the flag
and zeroes timeout/onChainSlashes without recomputing `outputSnapshotDataHash`; the on-chain
validator sees the output hash disagree with the flipped flag, so all peers fire
`onDisputeKilled`, honest peers store a `DisputeInvalidOutputState` proof, and the fork still
resolves. After the permutation atomization, the valid-case permutation of the dispute-input
requirement is a single scenario the accept-side test covers in full; the flipped variant is a
second instance of the output-correctness proof type, whose IDs live on `outputState.test.ts`.

The two honest-leaver permutations use the production fifteen-second writer window because the scenario deliberately authors nothing during the exit-post delay and the forced join. The other time values and signing assertions remain unchanged.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > dispute.input.selfRemoval = true; honest disputer voluntarily exits → dispute commits and disputer removed from participant set`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L11) (line 11) | [`REQ-DIS-1-XAJ1VA.T1.P9`](../../../../../../specification/disputes/disputes.md#req-dis-1-xaj1va.t1.p9)                                                                                                                                                                    |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > an honest leaver re-joined before its exit post → its self-removal dispute is its last signed state; no stale proof, no slash`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L92) (line 92)   | [`REQ-DISPUTE-PIPE-8-BVR8XV.T1.P4`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv.t1.p4), [`REQ-DISPUTE-PIPE-9-TDWQPV.T1.P21`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv.t1.p21) |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > an honest leaver's fallback waits for an admitted incoming signature before capturing its dispute`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L99) (line 99)                               | [`REQ-DISPUTE-PIPE-8-BVR8XV.T1.P10`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv.t1.p10)                                                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > dispute.input.selfRemoval flipped without recomputing outputSnapshotDataHash → DisputeInvalidOutputState`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L103) (line 103)                      | —                                                                                                                                                                                                                                                                          |
