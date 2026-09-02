# P2pRuntimeClient.ts — Source Report

> **Source:** [src/evm/p2pRuntime/P2pRuntimeClient.ts](../../../../../../../src/evm/p2pRuntime/P2pRuntimeClient.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The main-thread client: the application-facing typed surface sending requests to the host and receiving responses/events/bridge ports.

## Key design decisions

1. **The client is a proxy, never an owner** — node state lives host-side; the client correlates and forwards.
2. **Manager addresses use `connectStateChannelManager`.** The client merges the SDK ABI first and
   the serialized consumer ABI second. SDK definitions win collisions, while consumer-only calls,
   events, and errors remain available.

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

| Source file                                                                        | Specification IDs                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pRuntimeClient.ts](../../../../../../../src/evm/p2pRuntime/P2pRuntimeClient.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- `scm.abiJson` must contain valid JSON ABI supplied by the application. The canonical connector
  supplies the SDK surface even when that payload contains only consumer extensions.

## Specification adherence

- Port-protocol semantics identical across platforms.

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

## Terminal leave contribution

The existing client request registry carries the timeout-free leave response and the existing disposal route
still owns port and worker teardown. This contributes to [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay).

- [P2pRuntimeHost](./P2pRuntimeHost.ts.md).
