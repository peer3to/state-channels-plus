# ContractExecutorClientRoot.ts — Source Report

> **Source:** [ContractExecutorClientRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorClientRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

What the owner of a vm worker serves to it: only the log tree, bound to the bus of the logger the
owner passed, so the worker's link lands where that logger lives.

## Linked requirements

| Source file                                                                                                         | Specification IDs                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [ContractExecutorClientRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorClientRoot.ts) | [`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) |

## Assumptions, dependencies, trust boundaries, and limits

- Without an owner logger the realm's bus is used and no link is registered.

## Specification adherence

- The worker's collection requests are served on the owner's bus ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}).

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                         | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-LOG-1-P4WT6R`](../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) | Covered               | **Here:** `LogControlService` on the owner logger's bus. **Other files:** [../WorkerContractExecutor.ts.md](../WorkerContractExecutor.ts.md) registers the link. | None.            |

## Related source reports

- [../WorkerContractExecutor.ts.md](../WorkerContractExecutor.ts.md)
