# ProofTypes.sol — Source Report

> **Source:** [contracts/V1/types/ProofTypes.sol](../../../../../../../contracts/V1/types/ProofTypes.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md)

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

Proof carrier structs (FraudProof, DisputeFraudProof, state-proof elements), the state-proof walk input and
result, and the fraud-proof type enums.

## Key design decisions

1. **A state proof is milestones only.** `StateProof` ([#L17](../../../../../../../contracts/V1/types/ProofTypes.sol#L17)) holds only `MilestoneProof[] milestones`;
   the latest state is the last block of the last milestone and an empty proof is the fork genesis. The former
   trailing signed-block list is deleted, so there is one proof shape for the walk, the fraud proofs and the SDK
   codec. The `MilestoneProof` comment ([#L10](../../../../../../../contracts/V1/types/ProofTypes.sol#L10)) states the milestone rule: a linked run whose proven
   point is a normal snapshot anchor or its threshold-proven first block, where only a single last genesis-linked
   run may stay unfinal; linkage alone finalizes neither block 0 nor the whole run (engineer decision, 2026-10-04).
2. **The walk has a typed input and result.** `ProofWalkInput` ([#L23](../../../../../../../contracts/V1/types/ProofTypes.sol#L23)) carries the channel, fork, proof,
   the genesis data (read by a genesis start and by an empty proof, unless the on-chain snapshot is that genesis) and one milestone snapshot per milestone
   (read only when finality is checked). `ProofWalkResult` ([#L34](../../../../../../../contracts/V1/types/ProofTypes.sol#L34)) reports `valid`,
   the `finalizedSnapshot` and `replayBlockIndex`, where the last milestone's unfinal tail starts; its
   length means no tail, and an empty proof reports 0 ([#L39](../../../../../../../contracts/V1/types/ProofTypes.sol#L39)). When `valid` is false no other
   field is usable. The walk that
   fills it is in [StateChannelCommon](../StateChannelDiamondProxy/StateChannelCommon.sol.md).
3. **`DisputeFraudProofType` grows only at the end.** `DisputeStateProofBelowOnChainAnchor` is appended last
   ([#L85](../../../../../../../contracts/V1/types/ProofTypes.sol#L85)), so the encoded values of the existing types do not change; the SDK enum mirrors this order.

## Inputs, outputs, state, and side effects

| Aspect       | Contents              |
| ------------ | --------------------- |
| Inputs       | Per role above.       |
| Outputs      | Types/helpers/events. |
| Owned state  | None.                 |
| Side effects | None.                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [ProofTypes.sol](../../../../../../../contracts/V1/types/ProofTypes.sol) | [`REQ-DATA-1-1KNRQS`](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

## Assumptions, dependencies, trust boundaries, and limits

- Declarative/support code; behavior owned by consumers.

## Specification adherence

- Consistent with the owning documents' type/behavior contracts.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the manager and state-machine-base views.
