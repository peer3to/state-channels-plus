# ChainSignerService.ts — Source Report

> **Source:** [ChainSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host's managed real-chain signer, as the main thread's chain signer calls it.

## Linked requirements

| Source file                                                                                                  | Specification IDs                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [ChainSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerService.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Real-chain signing stays on the host, on the nonce-managed signer ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).

## Conformance traceability

| Requirement / invariant                                                                            | Implementation status | Evidence                                                                                                     | Gap / divergence |
| -------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3) | Covered               | **Here:** the family's owner. **Other files:** [ChainSignerRpcMethods.ts.md](./ChainSignerRpcMethods.ts.md). | None.            |

## Related source reports

- [ChainSignerRpcMethods.ts.md](./ChainSignerRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
