# DeploySignerService.ts — Source Report

> **Source:** [DeploySignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host's local-VM deploy signer, as the setup-time bridge signer calls it.

## Linked requirements

| Source file                                                                                                     | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [DeploySignerService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerService.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- The local VM and its deploys are owned by the host and reached only through these calls ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                       | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** the family's owner. **Other files:** [DeploySignerRpcMethods.ts.md](./DeploySignerRpcMethods.ts.md). | None.            |

## Related source reports

- [DeploySignerRpcMethods.ts.md](./DeploySignerRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
