# test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case4_blockInjection.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                                                                                                                                     | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > signedBlocks > stateProof.signedBlocks[-1].header.channelId = random → DisputeStateProofHeaderMismatch` (line 10)                                                                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > signedBlocks > stateProof.signedBlocks[-1].header.forkId = random → DisputeStateProofHeaderMismatch` (line 43)                                                                                             | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > signedBlocks > stateProof.signedBlocks[0].header.forkId = random → DisputeStateProofHeaderMismatch` (line 76)                                                                                              | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > milestone blockConfirmations > stateProof.milestones[-1].blockConfirmations[-1].header.channelId = random → DisputeStateProofHeaderMismatch` (line 115)                                                    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > milestone blockConfirmations > stateProof.milestones[-1].blockConfirmations[-1].header.forkId = random → DisputeStateProofHeaderMismatch` (line 152)                                                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > dispute.input.channelId = random → upload fails → ErrorCantParticipateInDispute` (line 191)                                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > dispute.input.forkId = random (stateProof still on real fork) → junk fork ignored` (line 196)                                                                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > uniform junk forkId (dispute.input + entire stateProof) > signedBlocks: uniform junk forkId → committed, no kill, honest peers stay on current fork` (line 202) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / block injection with incorrect channelId/forkId > dispute.input fields (channelId, forkId) > uniform junk forkId (dispute.input + entire stateProof) > milestones: uniform junk forkId → committed, no kill, honest peers stay on current fork` (line 247)   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
