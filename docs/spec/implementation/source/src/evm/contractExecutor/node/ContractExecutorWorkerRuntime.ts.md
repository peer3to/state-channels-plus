# ContractExecutorWorkerRuntime.ts — Source Report

> **Source:** [src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

Node worker runtime bootstrap (limits, shutdown wiring).

## Key design decisions

1. **Any exit the executor did not request is fatal, code 0 included.** A worker that ends on its own cannot serve pending requests, so `exit` reports an error unless `shutdown` was called; an `error` event before the exit is reported first and the executor keeps that first cause.
2. **Entry path is a parameter.** `createContractExecutorWorkerFromPath(workerPath, onMessage, onError, workerData?)` spawns any entry; the platform `createContractExecutorWorker` resolves the production entry and delegates to it. Tests load a scripted entry this way.

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

| Source file                                                                                                                | Specification IDs                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                          | Obligation            | Public entry and setup                                                                      | Oracle and forbidden effects                                                                                    | Required permutations                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR` | Fatal worker boundary | Spawn a scripted entry through `createContractExecutorWorkerFromPath` and observe `onError` | Every load-time error and every unrequested exit is reported, in order; the first error is the executor's cause | <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1` — a load-time throw is reported as `error` and the exit that follows it as `exited with 1`, in that order |

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
