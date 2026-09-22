# Finality — Implementation

> **Specification subject:** [specification/protocol-model/finality.md](../../../specification/protocol-model/finality.md)

## System design

Current: [`StateManager.playTransaction`](../../../../../src/stateManager/StateManager.ts#L478) gates
authoring only on the channel being open, it being the author's turn (`isMyTurn`), and linkage to
the latest stored block — there is no agreement check. Signature collection runs asynchronously
via the [`AgreementManager`](../../../../../src/agreementManager/AgreementManager.ts#L20); the author
schedules the calldata fallback (§8) `agreementTime` after producing the block and keeps going.

Current: peers detect conflicts at intake —
[`ValidationService.checkConflictingBlock`](../../../../../src/stateManager/ingest/ValidationService.ts#L87)
compares an incoming block against the stored block at the same coordinates and routes a same-author
conflict to the double-sign handler of the active validation strategy.

Current, off-chain:
[`AgreementManager.tryBuildMilestone`](../../../../../src/agreementManager/AgreementManager.ts#L106) walks
consecutive blocks and accumulates _all_ signer addresses (author + confirmation signatures) into
one set; when the accumulated set covers the threshold set, the walked blocks form a milestone
whose **first** block is thereby finalized.
Current, on-chain:
[`StateProofFacet._isMilestoneFinalWithExpectedParticipants`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1)
verifies the same rule — hash-linked confirmations, valid author signatures, signatures counted
across the whole sequence into a threshold set — and returns the first block's snapshot hash as
the finalized anchor. The precise conditions for a signature to count (same fork, hash linkage,
authentic author signature) are the linkage checks listed in
[state-proofs.md §7](./state-proofs.md).

current channel state defined by the integrator's state machine
([`AStateMachine.getNextToWrite`](../../../../../contracts/V1/AStateMachine.sol#L32)) — names the address
authorized to author the next **block** (block-level, not per-transaction, even though the current
implementation packs one transaction per block). Every peer validates incoming blocks against it
([`ValidationService`](../../../../../src/stateManager/ingest/ValidationService.ts#L26) leader check; this
protocol-layer check is the enforcement point — in-contract wrong-turn checks are optional
defense in depth, see [`OQ-26-XH59SP` (On-chain wrong-turn enforceability)](../../../specification/open-questions.md#oq-26-xh59sp) for the on-chain proof gap), and the dispute
path re-derives it on-chain to validate timeout targets
([`DisputeFraudProofFacet`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L15)).

## 9. Current vs. intended divergences

- **Proof shape limits virtual finality's reach in disputes.** Intended: a state proof may extend
  a proved milestone with a trailing non-final signed-block suffix. Current: milestones and
  trailing signed blocks are mutually exclusive in both the SDK proof builder and the on-chain
  verifier, so when any milestone exists the provable latest state stops at the last milestone.
  Recorded in full, with its consequences, in [state-proofs.md §8](./state-proofs.md).
- **Refusing to sign posted blocks when next-to-write.** Current:
  [`StateManager.shouldSignBlock`](../../../../../src/stateManager/StateManager.ts#L478) declines to sign
  a block that was posted on-chain when the local participant is the next author. This is not
  stated anywhere as intended protocol behavior. **Open question:** confirm the rule's intent
  (presumably avoiding attesting to a block that arrived via the fallback path while the local
  node is about to build on a competing view) and specify it, or remove it.
- Otherwise, the continuous-execution model of this document matches the implementation.
