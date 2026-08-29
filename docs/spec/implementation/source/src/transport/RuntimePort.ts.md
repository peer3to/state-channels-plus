# RuntimePort.ts — Source Report

> **Source:** [RuntimePort.ts](../../../../../../src/transport/RuntimePort.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The port surface a worker link runs on: post a message, take the one inbound handler, start, learn
of the far end going away, close. Both Node's `worker_threads` port and the browser's satisfy it
through a thin adapter; a linked pair is a channel.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents            |
| ------------ | ------------------- |
| Inputs       | None; declarations. |
| Outputs      | Type declarations.  |
| Owned state  | None.               |
| Side effects | None.               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                      | Specification IDs                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [RuntimePort.ts](../../../../../../src/transport/RuntimePort.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- `onClose` is reliable on Node and best-effort in the browser; callers keep a timeout as backstop.

## Specification adherence

- One port shape for both hosts; the platform adapters differ, the contract does not ({{REQ:[`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** the platform-neutral shape. **Other files:** [../evm/p2pRuntime/node/P2pRuntimeChannel.ts.md](../evm/p2pRuntime/node/P2pRuntimeChannel.ts.md) and [../evm/p2pRuntime/browser/P2pRuntimeChannel.ts.md](../evm/p2pRuntime/browser/P2pRuntimeChannel.ts.md) adapt each host's port. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [MessagePortTransport.ts.md](./MessagePortTransport.ts.md) — the transport over this port.
