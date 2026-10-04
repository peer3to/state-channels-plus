# FraudProofService.ts — Source Report

> **Source:** [src/stateManager/utils/FraudProofService.ts](../../../../../../../src/stateManager/utils/FraudProofService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

Builds block-level fraud proofs (double-sign, invalid transition with message-block context,
wrong genesis, invalid timestamp, forged inbound block) from validation deviations and stores
them for escalation. The invalid-transition and invalid-timestamp proofs are built from the
block's predecessor: the one dispute replay passes, else the one storage holds. Only live
gossip can lack it; then the invalid-transition proof is not built (`undefined`).

## Key design decisions

1. **Proof structs mirror exactly what the enforcement handlers verify** — construction is packaging, never judgment (the mirrored predicate already judged).
2. **The invalid-transition proof is built from the block's predecessor.**
   `createInvalidStateTransitionProof(block, predecessor = getStoredPredecessor(block))`
   ([#L73-L76](../../../../../../../src/stateManager/utils/FraudProofService.ts#L73-L76)) takes a `BlockPredecessor` (block, its resulting snapshot, that snapshot's state;
   [QueueStorage](../../storage/QueueStorage.ts.md)) and packs it unchanged: an empty previous block
   for the fork genesis, the predecessor's snapshot and state ([#L91-L97](../../../../../../../src/stateManager/utils/FraudProofService.ts#L91-L97)). Dispute replay passes the
   predecessor on the dispute's own chain, also for a block that the stored history does not link.
   Live gossip passes none; `getStoredPredecessor` ([#L234-L245](../../../../../../../src/stateManager/utils/FraudProofService.ts#L234-L245)) reads the block the invalid block
   names by `previousBlockHash` (the fork genesis at height 0) and its snapshot and state by hash
   through `Storage.getPredecessor`, never the block stored one height below. Why: the chain replays
   the transition from the predecessor's snapshot, so a proof built from another snapshot would fail
   on chain and slash the sender ([`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)).
3. **Only live gossip abstains.** When no predecessor is passed and storage does not hold the named
   block, its snapshot or its state, the service logs a warning and returns `undefined`
   ([#L83-L89](../../../../../../../src/stateManager/utils/FraudProofService.ts#L83-L89)). The live block strategy ignores the result and still escalates to a dispute, so a
   missing proof there only means no stored transition evidence
   ([BlockValidationStrategy](../validationStrategy/BlockValidationStrategy.ts.md)); peer input must
   not crash a node. Dispute replay always passes a predecessor, and
   [DisputeValidationStrategy](../validationStrategy/DisputeValidationStrategy.ts.md) throws on
   `undefined`.
4. **The timestamp proof takes the same previous block and snapshot.**
   `buildInvalidTimestampProof(block, previous = storage.getPreviousBlockAndSnapshot(block.coordinates))`
   ([#L105-L141](../../../../../../../src/stateManager/utils/FraudProofService.ts#L105-L141)) and `createInvalidTimestampProof(block, previous?)` ([#L143-L162](../../../../../../../src/stateManager/utils/FraudProofService.ts#L143-L162)) use the passed
   predecessor when dispute replay supplies one, else the stored block below the block's height and
   its snapshot (the fork genesis at height 0). `ValidationService` builds the proof it evaluates
   from the same `previous` it judged with, so the check and the stored proof cannot disagree.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Inputs       | Deviation context from strategies; for the transition and timestamp proofs, an optional passed predecessor. |
| Outputs      | Stored `FraudProofStruct`s; `undefined` from the live transition proof when storage lacks the predecessor.  |
| Owned state  | None.                                                                                                       |
| Side effects | FraudProofStorage writes.                                                                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                              | Specification IDs                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FraudProofService.ts](../../../../../../../src/stateManager/utils/FraudProofService.ts) | [`REQ-BLOCK-PIPE-8-N529VH`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh), [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) |

Contribution note: [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) — this file builds the transition and timestamp fraud proofs from the predecessor the dispute replay passes; the stored-predecessor default and its `undefined` result serve live gossip only.

## Assumptions, dependencies, trust boundaries, and limits

- Evidence-before-escalation ordering is the caller's ([`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)).

## Specification adherence

- Each proof type packaged for its on-chain twin.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                                 | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-BLOCK-PIPE-8-N529VH`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh) | Covered               | **Here:** proof packaging per fault class. **Other files:** storage + escalation callers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | None.            |
| [`REQ-DISPUTE-PIPE-5-RZZB48`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)    | Covered               | **Here:** the transition proof packs the passed predecessor ([#L73-L76](../../../../../../../src/stateManager/utils/FraudProofService.ts#L73-L76), [#L91-L97](../../../../../../../src/stateManager/utils/FraudProofService.ts#L91-L97)); the timestamp proof uses the passed previous block and snapshot ([#L105-L111](../../../../../../../src/stateManager/utils/FraudProofService.ts#L105-L111), [#L143-L162](../../../../../../../src/stateManager/utils/FraudProofService.ts#L143-L162)); the live default reads the predecessor named by `previousBlockHash` by hash and returns `undefined` without it ([#L83-L89](../../../../../../../src/stateManager/utils/FraudProofService.ts#L83-L89), [#L234-L245](../../../../../../../src/stateManager/utils/FraudProofService.ts#L234-L245)). **Other files:** [DisputeValidationStrategy](../validationStrategy/DisputeValidationStrategy.ts.md) passes the replay predecessor and throws on `undefined`; [DisputeValidationService](../dispute/DisputeValidationService.ts.md) selects the predecessor of each replayed block; [Storage](../../storage/Storage.ts.md) owns the predecessor reads. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation      | Public entry and setup                        | Oracle and forbidden effects                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-fraud-proof-service-1-rf6j18"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18` | Proof packaging | Build each proof type from fixture deviations | Structs verify under the corresponding canonical handler; stored under content keys | <a id="unit-test-fraud-proof-service-1-rf6j18.p1"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P1` — double-sign proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1-rf6j18.p2"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P2` — invalid-transition proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1-rf6j18.p3"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P3` — wrong-genesis proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1-rf6j18.p4"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P4` — invalid-timestamp proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1-rf6j18.p5"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P5` — forged-inbound-block proof round-trips through the mirrored handler; <a id="unit-test-fraud-proof-service-1-rf6j18.p6"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P6` — live (no predecessor passed): a non-leader block linked to a stored block → the invalid-transition proof names the block's author and carries that stored block as the previous block; <a id="unit-test-fraud-proof-service-1-rf6j18.p7"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P7` — live (no predecessor passed): the block the proof names by `previousBlockHash` is not stored → no proof is built (`undefined`); <a id="unit-test-fraud-proof-service-1-rf6j18.p8"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P8` — live (no predecessor passed): the named block is stored but its snapshot or that snapshot's state-machine state is not → no proof is built (`undefined`); <a id="unit-test-fraud-proof-service-1-rf6j18.p9"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P9` — a passed predecessor is the proof's base (previous block, its snapshot and the stored state of that snapshot), also for a block whose `previousBlockHash` the stored history does not link; <a id="unit-test-fraud-proof-service-1-rf6j18.p10"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P10` — a passed fork-genesis predecessor → an empty previous block and the fork's genesis snapshot; <a id="unit-test-fraud-proof-service-1-rf6j18.p11"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P11` — `buildInvalidTimestampProof` with a passed predecessor uses its block and snapshot, not the stored block below the block's height; <a id="unit-test-fraud-proof-service-1-rf6j18.p12"></a>`UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P12` — `buildInvalidTimestampProof` without a passed predecessor uses the stored block below the block's height and that block's snapshot |

## Related source reports

- [FraudProofStorage](../../storage/FraudProofStorage.ts.md), [BlockValidationStrategy](../validationStrategy/BlockValidationStrategy.ts.md), [DisputeValidationStrategy](../validationStrategy/DisputeValidationStrategy.ts.md).
