# RuntimeLifecycleService.ts — Source Report

> **Source:** [RuntimeLifecycleService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host's life as a service: build it once the deploys are in, drain it, end it.

## Linked requirements

| Source file                                                                                                          | Specification IDs                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [RuntimeLifecycleService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleService.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Startup, readiness, failure and disposal converge through one service ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                               | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** the family's owner. **Other files:** [RuntimeLifecycleRpcMethods.ts.md](./RuntimeLifecycleRpcMethods.ts.md). | None.            |

## Related source reports

- [RuntimeLifecycleRpcMethods.ts.md](./RuntimeLifecycleRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
