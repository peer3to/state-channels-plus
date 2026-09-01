# ContractExecutorRoot.ts — Source Report

> **Source:** [ContractExecutorRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

What the vm worker serves to the thread above it: the executor and log control. The manifest of its
names is what the owner types its endpoint from.

## Key design decisions

- **The protocol is the root.** The former request union and its switch are one service with five
  methods ([`ContractExecutorRoot`](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts#L6)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                             |
| ------------ | ------------------------------------ |
| Inputs       | The router.                          |
| Outputs      | The composed services; the manifest. |
| Owned state  | The service instances.               |
| Side effects | None of its own.                     |

## Linked requirements

| Source file                                                                                             | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorRoot.ts](../../../../../../../../src/evm/contractExecutor/rpc/ContractExecutorRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- Built before the worker has a logger; the services take it on `init`.

## Specification adherence

- Same root for the Node and the browser worker ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** one root, two entries. **Other files:** [../node/ContractExecutorWorkerEntry.ts.md](../node/ContractExecutorWorkerEntry.ts.md), [../browser/ContractExecutorWorkerEntry.ts.md](../browser/ContractExecutorWorkerEntry.ts.md). | None.            |

## Related source reports

- [contractExecutor/ContractExecutorService.ts.md](./contractExecutor/ContractExecutorService.ts.md)
- [ContractExecutorClientRoot.ts.md](./ContractExecutorClientRoot.ts.md) — the other end.
