# ContractExecutorRpcMethods.ts — Source Report

> **Source:** [ContractExecutorRpcMethods.ts](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The executor's operations as endpoints. `init` rebuilds config and logger in the worker, registers
the link to the thread above before anything that can fail, files the worker under the owner's
identity carried in the call, builds the EVM, and its reply is the worker's readiness. `dispose` ends the executor and closes the link once its reply is out. `deploy`,
`executeCall` and `simulateCall` run on the executor.

## Key design decisions

- **Configuration crosses explicitly** — the worker rebuilds its local logger and timing
  configuration instead of reading main-thread process state, with the same configured fatal-delay
  threshold as the rest of the runtime ([`init`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts#L40)).
- **The link before the EVM.** A crash while the EVM is still being built already has a way up.
- **The owner's identity is a parameter, not a race.** The cast the owner's link makes on
  registration may cross before this link exists; `init` carries the same context, applied by tree
  side like any inbound one, so link and init may be posted in either order.
- **Readiness is the `init` reply**; there is no `ready` frame.
- **Close after the reply**: `dispose` schedules the port's close for after its own return, so the
  drained loop exits on its own ([`dispose`](../../../../../../../../../src/evm/contractExecutor/rpc/contractExecutor/ContractExecutorRpcMethods.ts#L85)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| Inputs       | Precompile manifests and config; hex calldata and addresses.                          |
| Outputs      | Nothing for `init`/`dispose`; execution results otherwise.                            |
| Owned state  | None; the service holds it.                                                           |
| Side effects | Config rebuilt; logger, link, EVM and monitor created and torn down; the port closed. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

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

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                           | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** hex strings in, `ContractExecutionResult` out.                                                                                                           | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** every call goes through the one executor. **Other files:** [ContractExecutorService.ts.md](./ContractExecutorService.ts.md) holds it.                    | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** `init` awaits precompile readiness before replying; `dispose` stops monitoring, disposes the logger, closes the port after the reply.                    | None.            |
| [`INV-LOG-1-P4WT6R`](../../../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)    | Covered               | **Here:** `addLogLink` at the top of `init`. **Other files:** [../../WorkerContractExecutor.ts.md](../../WorkerContractExecutor.ts.md) registers the owner's side. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                    | Obligation                                                                                                                                                                                                                                                  | Public entry and setup                                                                                | Oracle and forbidden effects                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-host-1-2trsyv"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV` | Worker-host lifecycle for {{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}} and {{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}} | Create the public worker executor with real synchronous and delayed precompiles; call and dispose it. | Readiness never precedes precompile initialization; requests settle once; errors stay correlated; disposal releases ownership. | <a id="unit-test-contract-executor-worker-host-1-2trsyv.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1` — delayed precompile readiness gates the init reply; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2` — successful request correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3` — error serialization and correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4` — idempotent disposal and post-disposal rejection |

## Related source reports

- [ContractExecutorService.ts.md](./ContractExecutorService.ts.md)
- [../../WorkerContractExecutor.ts.md](../../WorkerContractExecutor.ts.md) — the caller.
