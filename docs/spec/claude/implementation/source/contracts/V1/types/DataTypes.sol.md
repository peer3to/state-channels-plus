# DataTypes.sol — Source Report

> **Source:** [contracts/V1/types/DataTypes.sol](../../../../../../../../contracts/V1/types/DataTypes.sol) > **Status:** Authored — engineer verification pending.
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

The core struct vocabulary (blocks, transactions, snapshots, message blocks, balances, joins/
exits, channel state) — the Solidity side of the canonical encodings.

## Key design decisions

1. **Struct shape = signature domain** under the current no-domain-tag scheme, which is exactly why [`OQ-29-EFY4NF`](../../../../../specification/open-questions.md#oq-29-efy4nf)] couples versioning to these definitions.

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

| Source file                                                               | Specification IDs                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [DataTypes.sol](../../../../../../../../contracts/V1/types/DataTypes.sol) | [`REQ-DATA-1-1KNRQS`](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

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
