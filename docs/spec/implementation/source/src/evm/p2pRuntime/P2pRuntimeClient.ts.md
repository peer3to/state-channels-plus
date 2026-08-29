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

The main-thread client: a `PortRpcRouter` over the runtime port serving
[`P2pRuntimeClientRoot`](./rpc/P2pRuntimeClientRoot.ts.md) (the host's pushes and log control) and
holding `host`, the typed endpoint on the host's root that the signers, `hostRpc` and
`EvmDiamondStateMachine` call. `ready` is the `deployComplete` reply; a host error pushed before it
settles it rejected. In worker mode the client mints the WebRTC bridge channel, hands the worker end
over in the bootstrap, and keeps or closes its own end by what the reply says.

## Key design decisions

1. **The client is a proxy, never an owner** — node state lives host-side; the router correlates, the endpoint forwards.
2. **Manager addresses use `connectStateChannelManager`.** The client merges the SDK ABI first and
   the serialized consumer ABI second. SDK definitions win collisions, while consumer-only calls,
   events, and errors remain available.
3. **Readiness is a reply.** There is no `ready` message to match by hand; `deployComplete` resolving is the signal, and a `hostError` cast before it rejects the same promise.
4. **The bridge candidate is decided by the reply.** `deployComplete` returns whether the host registered the bridge; the client keeps its end as `webRTCBridgePort` or closes it.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The runtime port, the logger, the address; the host's `runtimeEvents` casts and replies.                                            |
| Outputs      | `host` (typed endpoint), `ready`, the client `EventBus`, `webRTCBridgePort`, `dispose`.                                             |
| Owned state  | The router and its transport; the pending readiness; the bridge candidate; host-error listeners; the link registered on the logger. |
| Side effects | Bus emissions; the link's close on dispose; the bridge candidate closed when unused.                                                |

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

- Port-protocol semantics identical across platforms; the same root and router whichever port it is handed.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                    | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** one client over either port. **Other files:** [rpc/P2pRuntimeClientRoot.ts.md](./rpc/P2pRuntimeClientRoot.ts.md). | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** holds no node state; every operation is a call on `host`.                                                         | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** `deployComplete` settles `ready`; `onHostError` rejects it first; `dispose` closes the link after the reply.      | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation                                                                  | Public entry and setup                                                                                                                                    | Oracle and forbidden effects                                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-p2p-runtime-client-1-w13t15"></a>`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15` | The client's own decisions: the bridge candidate and how readiness settles. | A real client over a `MessageChannel` against a fake host that speaks the real envelope (a `PortRpcRouter` serving `lifecycle`, pushing `runtimeEvents`). | `webRTCBridgePort` kept or closed by the reply; `ready` rejects with the host's error, its name and revert data; nothing leaks after dispose. | <a id="unit-test-p2p-runtime-client-1-w13t15.p1"></a>`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P1` — bridge kept when the host registered it; <a id="unit-test-p2p-runtime-client-1-w13t15.p2"></a>`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P2` — bridge closed when the host negotiates itself; <a id="unit-test-p2p-runtime-client-1-w13t15.p3"></a>`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P3` — host error before deployComplete rejects ready; <a id="unit-test-p2p-runtime-client-1-w13t15.p4"></a>`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P4` — failed deployComplete rejects with error and data |

## Related source reports

- [P2pRuntimeHost](./P2pRuntimeHost.ts.md).
- [rpc/P2pRuntimeClientRoot.ts.md](./rpc/P2pRuntimeClientRoot.ts.md) — what it serves; [rpc/P2pRuntimeHostRoot.ts.md](./rpc/P2pRuntimeHostRoot.ts.md) — what it calls.
