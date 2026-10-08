# case4_blockInjection.test.ts

Test file: [test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts)

## Overview

The suite checks the header binding between a dispute's claims and every block carried in its
state proof, plus the relevance gating for foreign-fork disputes. `stubConstructDispute`
rewrites peer 3's dispute: the header `channelId` or `forkId` is randomized on the last
confirmation, the first confirmation, and the last milestone confirmation (unfinalized
genesis block-zero and posted-calldata setups respectively), with `submitDoubleSignBlock(1)` as the trigger.
Oracle for the mismatch cases: the dispute initiates, honest peers kill it and store a
`DisputeStateProofHeaderMismatch` dispute fraud proof, and the window resolves. The
uniform-junk-forkId cases instead rewrite `dispute.input` and the entire proof consistently
to a nonexistent fork and assert the opposite outcome: the dispute commits, no kill fires
within the observation window, and every honest peer stays on the original fork — a dispute
for a fork nobody runs is ignored, not fought. Two skipped declarations cross-reference
`uploadRevert/channelId.test.ts` and `disputeInputFields/forkId.test.ts`. After the
permutation atomization the first header-mismatch case carries the mirrored
`DisputeStateProofHeaderMismatch` predicate and header-match-check permutations, and the
foreign-forkId block tamper carries the `REQ-SP-7-70EMAT` fork-identity split; the per-identity
`REQ-DISPUTE-PIPE-1-HRBFP7` intake splits belong to the dedicated `uploadRevert/` and
`disputeInputFields/` suites, so the remaining rows stay unassigned.

## Tests

- `stateProof.milestones[0].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch`: none
- `stateProof.milestones[0].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch`: none
- `stateProof.milestones[0].blockConfirmations[0].header.forkId = random → DisputeStateProofHeaderMismatch`: none
- `stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random (protected first block) → DisputeInvalidStateProof`: none
- `stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random (protected first block) → DisputeInvalidStateProof`: none
- `dispute.input.channelId = random → upload fails → ErrorCantParticipateInDispute`: none
- `dispute.input.forkId = random (stateProof still on real fork) → junk fork ignored`: none
- `genesis block-0 milestone: uniform junk forkId → committed, no kill, honest peers stay on current fork`: none
- `milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork`: none
