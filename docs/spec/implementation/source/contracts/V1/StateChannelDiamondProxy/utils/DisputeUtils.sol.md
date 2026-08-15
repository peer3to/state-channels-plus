# DisputeUtils.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../../views/architecture/contracts/manager-and-facets.md)

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

Free functions for dispute/window accessors, period predicates, `_hasDisputeReason`, header
mismatch, and the positional committed-set matching `areDisputesCommitted`.

## Key design decisions

1. **Positional set matching** is where the post-kill order sensitivity ([`OQ-4-JGDCNX`](../../../../../../verification/open-questions.md#oq-4-jgdcnx) input) is anchored.

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

| Source file                                                                                              | Specification IDs                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [DisputeUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol) | [`REQ-ENFDIS-1-8CSA6B`](../../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b) |

## Assumptions, dependencies, trust boundaries, and limits

- Declarative/support code; behavior owned by consumers.

## Specification adherence

- Consistent with the owning documents' type/behavior contracts.

## Specification contradictions

None demonstrated.

## Missing behavior

Order-sensitivity of the positional match feeds [`OQ-4-JGDCNX`](../../../../../../verification/open-questions.md#oq-4-jgdcnx) — documented, engineer decision pending.

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
