# P2pRuntimeHostRoot.ts — Source Report

> **Source:** [P2pRuntimeHostRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

What the sdk realm serves to the main thread over the runtime port, composed in one place: the
runtime's lifecycle, the three signers, the mirror onto the host's peer RPC, and log control. Its
own type is what the main thread types its endpoint from. `RuntimeHost` is the set of live pieces
the endpoints reach — held here on the root, so an endpoint reads it off `localRpc` — behind
accessors that throw until each exists, except `deploySigner`, which is awaited because the client
deploys through it before the host has finished starting.

## Key design decisions

- **The protocol is the root.** Adding an operation is adding a method to a service here; nothing
  else changes ([`P2pRuntimeHostRoot`](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts#L45)).
- **A service with nothing of its own is not a class.** Every name here but `p2pSigner` and
  `logControl` is a plain `ARpcService` built with its methods class; the endpoints reach the host
  through `localRpc.host`. The two that carry state of their own keep their own service.
- **Not-ready is an accessor, not a case.** The former per-case `Runtime is not ready` guard is one
  `required()` on each late-built piece; the one piece the client legitimately reaches early —
  `deploySigner` — waits for it instead, so no line-wide inbound hold is needed.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                          |
| ------------ | --------------------------------- |
| Inputs       | The router; the live host pieces. |
| Outputs      | The composed services.            |
| Owned state  | The host handle and the services. |
| Side effects | None of its own.                  |

## Linked requirements

| Source file                                                                                   | Specification IDs                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pRuntimeHostRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeHostRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- The main thread cannot reach the host's peer services directly; they live on the peer manager's router, hence the mirror.

## Specification adherence

- One root for the inline and the threaded host ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- Readiness, failure and disposal go through `lifecycle` ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                     | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** composed identically for both deployments. **Other files:** [../P2pRuntimeHost.ts.md](../P2pRuntimeHost.ts.md) builds it.          | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** composes `lifecycle`. **Other files:** [lifecycle/RuntimeLifecycleRpcMethods.ts.md](./lifecycle/RuntimeLifecycleRpcMethods.ts.md). | None here.       |

## Related source reports

- [lifecycle/RuntimeLifecycleRpcMethods.ts.md](./lifecycle/RuntimeLifecycleRpcMethods.ts.md)
- [p2pSigner/P2pSignerService.ts.md](./p2pSigner/P2pSignerService.ts.md)
- [chainSigner/ChainSignerRpcMethods.ts.md](./chainSigner/ChainSignerRpcMethods.ts.md)
- [deploySigner/DeploySignerRpcMethods.ts.md](./deploySigner/DeploySignerRpcMethods.ts.md)
- [hostRpc/HostRpcMirrorRpcMethods.ts.md](./hostRpc/HostRpcMirrorRpcMethods.ts.md)
- [P2pRuntimeClientRoot.ts.md](./P2pRuntimeClientRoot.ts.md) — the other end.
