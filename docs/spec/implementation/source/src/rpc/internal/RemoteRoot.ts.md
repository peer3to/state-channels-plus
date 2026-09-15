# RemoteRoot.ts — Source Report

> **Source:** [src/rpc/internal/RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts) > **Status:** Authored — engineer verification pending.

Both disposal directions await final acknowledgement. Parent-requested cleanup first posts its domain response; if the parent closes after that response, closure also confirms shutdown. A child disposal acknowledgement confirms domain cleanup. For an inline child, shared finalization awaits both cached domain disposal and final reply closure before notifying parent close observers, so the acknowledgement can arrive and local connections finish closing.

## Responsibility and observable boundary

Owns the typed remote RPC surface and connection lifetime for one created root.

The handle retains the fatal child failure before transport close observers run. The SDK client uses that cause to suppress a duplicate generic close notification; RootErrorService delivers the original failure. Request diagnostics project the actual sent envelope, including its requestId.

## Key design decisions

fail reports child failure through the owner; close also closes the inline counterpart; closeWithReason preserves the supplied rejection cause; linkLocalEndpoint pairs inline handles; postContext sends context through that pairing or RPC. childDisposedError supplies the common completed-child cleanup error.

Creation installs platform cleanup through setAfterDispose; the callback is private. Both local disposal and a child-confirmed disposal invoke completeDisposal. Remote handle variables use the remoteRoot suffix to distinguish them from transports and local roots.

The transport and inline peer link stay private. This handle owns the RPC proxy, parent/child relation, placement and platform cleanup callback directly; there is no separate registration record or duplicate proxy field. Shared creation uses handle methods for failure, closure and inline endpoint linking. Context forwarding uses the inline counterpart directly when linked, otherwise the bound RPC proxy. Disposal caches its result; quiescence drains on every call, and disposal waits for a ready child acknowledgement before platform cleanup. An unattached child closes without requesting an absent endpoint. Shared settlement and failure observers are installed once and removed on connection closure. Diagnostics use shared RPC metadata.

## Inputs, outputs, state, and side effects

Parents own child handles. Root diagnostics use common RPC metadata only; there is no per-root request-description hook. Readiness and errors use existing common services.

## Linked requirements

| Source file                                                          | Specification IDs                                                                                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

Parents own child handles. Root diagnostics use common RPC metadata only; there is no per-root request-description hook. Readiness and errors use existing common services.

## Specification adherence

This file contributes its boundary to the linked requirements; the related owners provide the remaining lifecycle and dispatch behavior.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                              | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** [RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts#L15) owns the typed remote RPC surface and connection lifetime for one created root. **Other files:** [AInternalRpcRoot.ts](AInternalRpcRoot.ts.md); [createRoot.ts](createRoot.ts.md). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts#L15) owns the typed remote RPC surface and connection lifetime for one created root. **Other files:** [AInternalRpcRoot.ts](AInternalRpcRoot.ts.md); [createRoot.ts](createRoot.ts.md). | None demonstrated for this contribution. |

## Component test obligations

| Unit test ID                                                                | Obligation                                    | Public entry and setup                             | Oracle and forbidden effects                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-remote-root-1-7d9jve"></a>`UNIT-TEST-REMOTE-ROOT-1-7D9JVE` | Complete remote handle and shared diagnostics | Real production roots and their public operations. | Complete remote handle and shared diagnostics; no duplicate completion or leaked ownership. | <a id="unit-test-remote-root-1-7d9jve.p1"></a>`UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P1` — Two concurrent held requests crossing the slow threshold each log once with the exact request ID sent on the port, with no calldata assumptions.; <a id="unit-test-remote-root-1-7d9jve.p2"></a>`UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P2` — A child failure logs both concurrent pending operations with their distinct wire request IDs and rejects them; repeated failure after closure produces no duplicate observation.; <a id="unit-test-remote-root-1-7d9jve.p3"></a>`UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P3` — Inline executor creation returns a typed handle, keeps transport and connection private at compile time, and repeated disposal preserves its owner.; <a id="unit-test-remote-root-1-7d9jve.p4"></a>`UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P4` — Worker executor creation returns the same handle surface and repeated disposal preserves its owner. |

## Related source reports

[AInternalRpcRoot.ts](AInternalRpcRoot.ts.md); [createRoot.ts](createRoot.ts.md).
