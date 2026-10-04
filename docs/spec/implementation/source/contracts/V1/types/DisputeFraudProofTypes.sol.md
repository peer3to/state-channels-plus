# DisputeFraudProofTypes.sol — Source Report

> **Source:** [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol) > **Status:** Authored — engineer verification pending.
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

The 19 dispute fraud-proof families' payload structs (the enum is in [ProofTypes.sol](./ProofTypes.sol.md)).

## Key design decisions

1. **Block-pointing payloads address the last milestone.** `DisputeInvalidBlockInStateProofApplyFraudProof`
   ([#L92](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L92)), `DisputeInvalidBlockStructure` ([#L119](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L119)) and `DisputeBlockAuthorNotParticipant`
   ([#L123](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L123)) name `blockIndex` of the last milestone of the submitted proof; they carry no milestone
   index and no walk evidence ([#L90](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L90)). Why: only the last milestone can hold the submitter's unfinal
   tail, and the chain bounds the index with `isBlockChallengeEligible`, which reads no walk
   ([StateProofFacet](../StateChannelDiamondProxy/StateProofFacet.sol.md),
   [DisputeFraudProofFacet](../StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md)).
2. **The balance payload names the latest state.** `DisputeInvalidBalanceInvariant` ([#L49](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L49)) carries
   only `latestStateSnapshot` and its machine state; the snapshot must be the dispute's latest state
   ([#L48](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L48)), so no walk evidence is needed.
3. **The below-anchor payload is empty.** `DisputeStateProofBelowOnChainAnchor` ([#L131](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L131)) is `{ bool __; }`:
   the chain reads the on-chain snapshot itself, and a Solidity struct cannot be empty.

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

| Source file                                                                                      | Specification IDs                                                                                  |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [DisputeFraudProofTypes.sol](../../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol) | [`REQ-DATA-1-1KNRQS`](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

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
