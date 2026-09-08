# ContractExecutorService.ts — Source Report

> **Source:** [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The worker's executor and what it holds around it, from init to dispose: the EVM executor, the
worker's logger, and the remover of its link into the log tree.

## Linked requirements

| Source file                                                                                                                       | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [ContractExecutorService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorService.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- **Two internal seams for a scripted worker.** `monitorOptions` always starts the monitor on its
  own threshold rather than the runtime config, and `configOverrides` forces config values over the
  ones `init` carried, so a scripted worker can stay silent. Production leaves both unset.

- One executor per worker; a second `init` replaces it and leaks the first.

## Specification adherence

- One owner of the EVM state ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                          | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** the executor lives here and nowhere else in the worker. | None.            |

## Related source reports

- [ContractExecutorRpcMethods.ts.md](./ContractExecutorRpcMethods.ts.md) — the endpoints and the family.
- [../ContractExecutorRoot.ts.md](../ContractExecutorRoot.ts.md)
