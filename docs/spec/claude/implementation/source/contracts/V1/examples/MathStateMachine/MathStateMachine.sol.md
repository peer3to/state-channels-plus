# MathStateMachine.sol — Source Report

> **Source:** [contracts/V1/examples/MathStateMachine/MathStateMachine.sol](../../../../../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/state-machine-base.md](../../../../../views/architecture/contracts/state-machine-base.md)

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

The reference integrator machine: turn-taking arithmetic game demonstrating injected-context use,
join-or-top-up handling, and canonical single-struct serialization.

## Key design decisions

1. **The living example of the integration contract** — cited by the spec's state-machine doc as the pattern.

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

| Source file                                                                                                    | Specification IDs                                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [MathStateMachine.sol](../../../../../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol) | [`REQ-SM-1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-1) |

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
