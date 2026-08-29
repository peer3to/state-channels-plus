# RuntimeEventsRpcMethods.ts — Source Report

> **Source:** [RuntimeEventsRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsRpcMethods.ts) > **Status:** Authored — engineer verification pending.
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

Two casts from the host: `busEvent(kind, eventName, args)`, one payload for every forwarded event
kind, and `hostError(error)`, an autonomous host-side failure not tied to a request.

## Key design decisions

- **Casts, by signature.** Both return `void`, so the host can only fire-and-forget them, which is
  what an event stream needs: back-pressure would stall the peer.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | A bus kind, event name and args; a serialized error.  |
| Outputs      | Nothing.                                              |
| Owned state  | None.                                                 |
| Side effects | The client's bus emits; the client's error path runs. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                              | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RuntimeEventsRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsRpcMethods.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- Args are whatever structured clone carried; a non-cloneable arg failed on the host before it was sent.

## Specification adherence

- One payload shape for every event kind, both deployments ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- The host error crosses as a serialized error ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                      | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** `busEvent` re-emits into the client bus. **Other files:** [../../P2pRuntimeClient.ts.md](../../P2pRuntimeClient.ts.md).             | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `hostError` takes `SerializedError`. **Other files:** [../../../../rpc/serializeError.ts.md](../../../../rpc/serializeError.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [RuntimeEventsService.ts.md](./RuntimeEventsService.ts.md)
