# sol-enums.ts — Source Report

> **Source:** [src/types/sol-enums.ts](../../../../../../../src/types/sol-enums.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

TypeScript mirrors of Solidity enums (proof types, message types) — kept in lockstep with the contracts.

## Key design decisions

1. **Enum drift is a protocol bug**, so the mirrors live in one file with the contract names.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                 | Specification IDs                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [sol-enums.ts](../../../../../../../src/types/sol-enums.ts) | [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Declarative; consumers own behavior.

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

- [protocol-model/data-types](../../../../specification/protocol-model/data-types.md) (the neutral vocabulary).
