# WorkerContractExecutor.ts — Source Report

> **Source:** [src/evm/contractExecutor/WorkerContractExecutor.ts](../../../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The worker-backed executor: serialized requests over the worker port with correlation, ordering, and lifecycle settlement.

## Key design decisions

1. **Same interface, different context** — the executor moves behind a worker without changing callers (the review's transport-neutrality decision).
2. **The worker host owns its timing guard** — it starts monitoring only after EVM creation and custom-precompile readiness complete, using the same configured fatal-delay threshold as the other monitored contexts.
3. **The log connection is attached before init is awaited, and a worker that fails init is ended** — the init request is posted first and the connection attached second, so the identity posted on attach lands on a handle the worker created at the top of init, and a crash while the EVM is still being built already has a way up ([`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)). A rejected init disposes the executor before the error propagates, so no worker outlives its owner (`create`).

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                          | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WorkerContractExecutor.ts](../../../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r), [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q), [`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.
- The worker's log connection exists for the whole of init, so a collection started by a crash in a
  worker that is still starting reaches this realm ([`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)).
- The host's session and participant identity is pushed down the connection on attach, before the
  worker writes its first line ([`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)).
- A worker that hit a fatal ends after its own upload; the pending calls here reject on its exit
  instead of hanging ([`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                         | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence |
| ----------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-LOG-1-P4WT6R`](../../../../../specification/runtime/log-collection.md#inv-log-1-p4wt6r)   | Covered               | **Here:** `create` posts init, attaches the log connection, then awaits init, and `handleResponse` hands every control message to that connection. **Other files:** [ContractExecutorWorkerHostCore.ts.md](./worker/ContractExecutorWorkerHostCore.ts.md) attaches the worker's end at the top of init; [LogFlushBus.ts.md](../../utils/logging/LogFlushBus.ts.md) runs the collection. | None.            |
| [`REQ-LOG-4-W5XR7Q`](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)   | Covered               | **Here:** the connection is owned by the host logger, so its identity is posted on attach and on every later change. **Other files:** [LogFlushBus.ts.md](../../utils/logging/LogFlushBus.ts.md) decides how much of it the worker applies.                                                                                                                                             | None.            |
| [`REQ-LOG-10-69CTN1`](../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) | Covered               | **Here:** a non-zero worker exit rejects every pending call and drops the connection; `dispose` on a failed worker skips the request and waits for the thread. **Other files:** [node/ContractExecutorWorkerEntry.ts.md](./node/ContractExecutorWorkerEntry.ts.md) asks the tree, waits on its own upload, and exits.                                                                   | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation                | Public entry and setup                                                    | Oracle and forbidden effects                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-worker-contract-executor-1-gqgaw7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7` | Worker executor lifecycle | Create through the public factory with real precompiles; call and dispose | Results, logs, and errors cross intact; readiness completes before return; work is serialized; disposal settles once | <a id="unit-test-worker-contract-executor-1-gqgaw7.p1"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1` — precompile runs in worker; <a id="unit-test-worker-contract-executor-1-gqgaw7.p2"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2` — delayed precompile readiness gates worker return; <a id="unit-test-worker-contract-executor-1-gqgaw7.p3"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3` — logs serialize; <a id="unit-test-worker-contract-executor-1-gqgaw7.p4"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4` — idempotent disposal; <a id="unit-test-worker-contract-executor-1-gqgaw7.p5"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5` — post-disposal rejection; <a id="unit-test-worker-contract-executor-1-gqgaw7.p6"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P6` — inline and worker serialization; <a id="unit-test-worker-contract-executor-1-gqgaw7.p7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7` — concurrent success/error response correlation; <a id="unit-test-worker-contract-executor-1-gqgaw7.p8"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P8` — a fatal in the worker ends it and later calls reject; <a id="unit-test-worker-contract-executor-1-gqgaw7.p9"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P9` — the worker's logs file under the vm thread with the host's identity; <a id="unit-test-worker-contract-executor-1-gqgaw7.p10"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P10` — a crash during init reaches the realms above under the host's identity; <a id="unit-test-worker-contract-executor-1-gqgaw7.p11"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P11` — a failed init ends the worker instead of leaking it; <a id="unit-test-worker-contract-executor-1-gqgaw7.p12"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P12` — a call still being answered when the thread ends rejects instead of hanging; <a id="unit-test-worker-contract-executor-1-gqgaw7.p13"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P13` — the caller's logger keeps logging and uploading after the worker crashed |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
