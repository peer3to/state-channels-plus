# RuntimeEventsService.ts — Source Report

> **Source:** [RuntimeEventsService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The host's one-way traffic to the client as a service: bus emissions and autonomous host errors. Nothing here is answered.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                       |
| ------------ | ---------------------------------------------- |
| Inputs       | The router and the sink the client implements. |
| Outputs      | The endpoints of its methods class.            |
| Owned state  | A reference to the sink the client implements. |
| Side effects | None of its own.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                        | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RuntimeEventsService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsService.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Events reach the client the same way inline and threaded ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- A host error before readiness settles readiness ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                 | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** the family's owner. **Other files:** [RuntimeEventsRpcMethods.ts.md](./RuntimeEventsRpcMethods.ts.md).                         | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** delivers the error. **Other files:** [../../P2pRuntimeClient.ts.md](../../P2pRuntimeClient.ts.md) rejects `ready` or notifies. | None here.       |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [RuntimeEventsRpcMethods.ts.md](./RuntimeEventsRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeClientRoot.ts.md](../P2pRuntimeClientRoot.ts.md) — the root that composes it.
