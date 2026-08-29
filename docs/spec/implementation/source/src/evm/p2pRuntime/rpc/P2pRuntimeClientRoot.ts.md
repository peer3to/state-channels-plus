# P2pRuntimeClientRoot.ts — Source Report

> **Source:** [P2pRuntimeClientRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeClientRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

What the main thread serves to the sdk host over the runtime port: the host's one-way pushes (bus
events, host errors) and log control. `RuntimeEventSink` is what the client implements to receive
the pushes.

## Key design decisions

- **Pushes are services too.** What used to be two message types and a switch on the client is one
  service with two `void` methods, delivered as casts.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                |
| ------------ | --------------------------------------- |
| Inputs       | The router, the sink, the owner logger. |
| Outputs      | The composed services; the manifest.    |
| Owned state  | The service instances.                  |
| Side effects | None of its own.                        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                       | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [P2pRuntimeClientRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeClientRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- The host is trusted; a push is applied, never validated.

## Specification adherence

- The same root whether the host is inline or threaded ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** composed identically for both deployments. **Other files:** [../P2pRuntimeClient.ts.md](../P2pRuntimeClient.ts.md) builds it. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [runtimeEvents/RuntimeEventsService.ts.md](./runtimeEvents/RuntimeEventsService.ts.md)
- [P2pRuntimeHostRoot.ts.md](./P2pRuntimeHostRoot.ts.md) — the other end.
