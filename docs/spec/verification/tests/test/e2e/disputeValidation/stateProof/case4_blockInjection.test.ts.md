# test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite checks the header binding between a dispute's claims and every block carried in its
state proof, plus the relevance gating for foreign-fork disputes. `stubConstructDispute`
rewrites peer 3's dispute: the header `channelId` or `forkId` is randomized on the last
signed block, the first signed block, and the last milestone confirmation (signedBlocks-only
and calldata/milestone setups respectively), with `submitDoubleSignBlock(1)` as the trigger.
Oracle for the mismatch cases: the dispute initiates, honest peers kill it and store a
`DisputeStateProofHeaderMismatch` dispute fraud proof, and the window resolves. The
uniform-junk-forkId cases instead rewrite `dispute.input` and the entire proof consistently
to a nonexistent fork and assert the opposite outcome: the dispute commits, no kill fires
within the observation window, and every honest peer stays on the original fork — a dispute
for a fork nobody runs is ignored, not fought. Two skipped declarations cross-reference
`uploadRevert/channelId.test.ts` and `disputeInputFields/forkId.test.ts`. After the
permutation atomization the first header-mismatch case carries the mirrored
`DisputeStateProofHeaderMismatch` predicate and header-match-check permutations, and the
foreign-forkId block tamper carries the [`REQ-SP-7-70EMAT`](../../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat) fork-identity split; the per-identity
[`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7) intake splits belong to the dedicated `uploadRevert/` and
`disputeInputFields/` suites, so the remaining rows stay unassigned.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                                                                                                                                     | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > genesis block-0 milestone (unfinalized) > stateProof.milestones[0].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L13) (line 13)                                                         | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > genesis block-0 milestone (unfinalized) > stateProof.milestones[0].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L50) (line 50)                                                            | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > genesis block-0 milestone (unfinalized) > stateProof.milestones[0].blockConfirmations[0].header.forkId = random → DisputeStateProofHeaderMismatch`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L87) (line 87)                                                             | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > milestone blockConfirmations > stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random (protected first block) → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L136) (line 136)                                                | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > milestone blockConfirmations > stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random (protected first block) → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L180) (line 180)                                                   | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > dispute.input.channelId = random → upload fails → ErrorCantParticipateInDispute`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L226) (line 226)                                                                                  | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > dispute.input.forkId = random (stateProof still on real fork) → junk fork ignored`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L231) (line 231)                                                                                | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > uniform junk forkId (dispute.input + entire stateProof) > genesis block-0 milestone: uniform junk forkId → committed, no kill, honest peers stay on current fork`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L237) (line 237) | —      |
| [`E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > uniform junk forkId (dispute.input + entire stateProof) > milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork`](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts#L283) (line 283)                | —      |
