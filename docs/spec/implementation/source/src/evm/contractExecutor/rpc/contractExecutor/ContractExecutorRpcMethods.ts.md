# ContractExecutorRpcMethods.ts — Source Report

> **Source:** [ContractExecutorRpcMethods.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The executor's operations as endpoints, and nothing else — every body is one call into
[ContractExecutorService](./ContractExecutorService.ts.md), which owns the worker's state. `init`'s
reply is the worker's readiness; `dispose` ends the executor and the link closes once its reply is
out; `deploy`, `executeCall` and `simulateCall` run on the executor the service built.

## Key design decisions

- **Endpoints only.** The dispatcher routes by name on this object, so nothing but a wire endpoint
  may live here; the bootstrap and the teardown are the service's
  ([`init`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts#L32),
  [`dispose`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts#L53)).
- **Configuration crosses explicitly** — the worker rebuilds its local logger and timing
  configuration from the `init` parameters instead of reading main-thread process state.
- **Readiness is the `init` reply**; there is no `ready` frame.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| Inputs       | Precompile manifests and config; hex calldata and addresses.                          |
| Outputs      | Nothing for `init`/`dispose`; execution results otherwise.                            |
| Owned state  | None; the service holds it.                                                           |
| Side effects | None of its own; every body delegates to the service.                                 |

## Linked requirements

| Source file                                                                                                                             | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutorRpcMethods.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r) |

## Assumptions, dependencies, trust boundaries, and limits

- A call before `init` throws `Contract executor worker has not been initialized`.

## Specification adherence

- Requests and results cross as transfer-safe values ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).
- The executor is owned here and reached only through these calls ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).
- Initialization completes before the reply; disposal releases the executor and ends the port ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).
- The worker joins the log tree before it can crash ({{REQ:[`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                           | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** hex strings in, `ContractExecutionResult` out.                                                                                                           | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** every call goes through the one executor. **Other files:** [ContractExecutorService.ts.md](./ContractExecutorService.ts.md) holds it.                    | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** `init` awaits precompile readiness before replying; `dispose` stops monitoring, disposes the logger, closes the port after the reply.                    | None.            |
| [`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)    | Covered               | **Here:** `addLogLink` at the top of `init`. **Other files:** [../../WorkerContractExecutor.ts.md](../../WorkerContractExecutor.ts.md) registers the owner's side. | None.            |

## Component test obligations

| Unit test ID                                                                                                    | Obligation                                                                                                                                                                                                                                                  | Public entry and setup                                                                                | Oracle and forbidden effects                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-host-1-2trsyv"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV` | Worker-host lifecycle for {{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}} and {{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}} | Create the public worker executor with real synchronous and delayed precompiles; call and dispose it. | Readiness never precedes precompile initialization; requests settle once; errors stay correlated; disposal releases ownership. | <a id="unit-test-contract-executor-worker-host-1-2trsyv.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1` — delayed precompile readiness gates the init reply; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2` — successful request correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3` — error serialization and correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4` — idempotent disposal and post-disposal rejection; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p8"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P8` — starts the configured monitor without injected options and stops it on dispose; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p9"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P9` — does not start a disabled monitor without injected options; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p10"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P10` — stops the injected sample source on dispose |

## Related source reports

- [ContractExecutorService.ts.md](./ContractExecutorService.ts.md)
- [../../WorkerContractExecutor.ts.md](../../WorkerContractExecutor.ts.md) — the caller.
