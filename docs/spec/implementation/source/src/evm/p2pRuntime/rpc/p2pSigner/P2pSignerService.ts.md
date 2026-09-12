# P2pSignerService.ts — Source Report

> **Source:** [P2pSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host-owned p2p signer, as the main thread's signer facade calls it.

## Linked requirements

| Source file                                                                                            | Specification IDs                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pSignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerService.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Signing stays on the host; the client holds a facade ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).
- The p2p signer's state is owned here and reached only through these calls ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                 | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)     | Covered               | **Here:** the family's owner. **Other files:** [P2pSignerRpcMethods.ts.md](./P2pSignerRpcMethods.ts.md). | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** one owner of the p2p signer's mutable state.                                                   | None.            |

## Related source reports

- [P2pSignerRpcMethods.ts.md](./P2pSignerRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
