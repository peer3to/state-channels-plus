# ClientHostRpc.ts — Source Report

> **Source:** [src/evm/p2pRuntime/ClientHostRpc.ts](../../../../../../../src/evm/p2pRuntime/ClientHostRpc.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The `hostRpc` back-channel: no target → loopback into the local host's service root; peer target → relay the same typed call — local interaction without exposing service objects. The call crosses the port as one `hostRpc.call` on the host root's mirror service, which replays it on the host's `remoteRpc`.

## Key design decisions

1. **Loopback-or-relay duality** keeps one typed surface for both local and addressed calls (the review §43 intent).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

| Source file                                                                  | Specification IDs                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [ClientHostRpc.ts](../../../../../../../src/evm/p2pRuntime/ClientHostRpc.ts) | [`INV-RPC-1-SJS2T6`](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Port-protocol semantics identical across platforms.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2pRuntimeHost](./P2pRuntimeHost.ts.md).
