# createContractExecutor.ts — Source Report

> **Source:** [src/evm/contractExecutor/createContractExecutor.ts](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts) > **Status:** Authored — engineer verification pending.
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

Internal two-argument constructor behind the package's one-argument factory: builds the inline executor or the worker executor, and carries the internal seams (a scripted worker runtime, the host's detached-error route) that the package root does not expose.

## Key design decisions

1. **The seams stay off the package root.** `createContractExecutor(options, dependencies)` is imported by the runtime host adapter and by tests through its module path; `createContractExecutorFactory(options)` delegates here with no dependencies, so the exported options type keeps its pre-plan shape.
2. **The runtime Clock is attached when one exists.** The inline executor reads
   `Clock.getTimeInSeconds()` at call time and the dedicated executor receives the Clock's adjustment
   at initialization ([#L30](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts#L30));
   a runtime host syncs the Clock before it builds its executor, and an executor built with no Clock
   (a bare unit test) keeps time zero. The exported factory options are unchanged.
3. **The detached-error route is a dependency, never an option.** The runtime host passes `onDetachedError` to forward a worker's detached error as one `hostError`; a caller that passes none gets the re-throw-on-owning-thread behavior of the package entry ([`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)).

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

| Source file                                                                                          | Specification IDs                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [createContractExecutor.ts](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules; a worker's detached error is reported through the dependency route or surfaces on the owning thread, never dropped.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** the internal dependency route `onDetachedError` forwards a worker's detached error to the runtime host as one `hostError`; with no route the package entry re-throws on the owning thread, so a detached worker failure is never dropped. **Other files:** [WorkerContractExecutor](WorkerContractExecutor.ts.md) owns first-error-wins and request settlement; [ContractExecutorWorkerHostCore](worker/ContractExecutorWorkerHostCore.ts.md) reports the error from the worker.                                                                                          | None.            |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** one constructor selects the inline executor or the worker executor from the same options on every platform, and the scripted worker runtime dependency lets tests drive either platform's entry. **Other files:** [node/ContractExecutorWorkerRuntime](node/ContractExecutorWorkerRuntime.ts.md) and [browser/ContractExecutorWorkerRuntime](browser/ContractExecutorWorkerRuntime.ts.md) are the platform variants; [ContractExecutorFactory](ContractExecutorFactory.ts.md) is the public one-argument entry.                                                           | None.            |
| [`REQ-TIME-5-S9NQXK`](../../../../../specification/protocol-model/time.md#req-time-5-s9nqxk)     | Covered               | **Here:** [source](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts#L17) supplies the initialized Clock to inline execution and its adjustment to dedicated execution; no Clock keeps time zero. **Other files:** [Clock.ts](../../Clock.ts.md) (current clock and adjustment), [ContractExecutor.ts](ContractExecutor.ts.md) (timestamped execution and simulation), [ContractExecutorWorkerHostCore.ts](worker/ContractExecutorWorkerHostCore.ts.md) (worker-local clock derivation).                                                                      | —                |
| [`REQ-RUNTIME-6-6F4SSM`](../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm) | Covered               | **Here:** [source](../../../../../../../src/evm/contractExecutor/createContractExecutor.ts#L17) supplies the initialized Clock to inline execution and its adjustment to dedicated execution; no Clock keeps time zero. **Other files:** [Clock.ts](../../Clock.ts.md) (current clock and adjustment), [WorkerContractExecutor.ts](WorkerContractExecutor.ts.md) (initialization transport), [ContractExecutorWorkerHostCore.ts](worker/ContractExecutorWorkerHostCore.ts.md) (worker-local clock derivation), [protocol.ts](worker/protocol.ts.md) (initialization message shape). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation                     | Public entry and setup                                                                                                                                  | Oracle and forbidden effects                                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-create-contract-executor-1-m5h56n"></a>`UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N` | Detached-error route selection | Build a dedicated-worker executor through `createContractExecutor` with and without the `onDetachedError` dependency, loading the scripted worker entry | With the dependency the report reaches it once and the executor still serves; without it the error surfaces on the owning thread as an uncaught error and the executor still serves; nothing is dropped | <a id="unit-test-create-contract-executor-1-m5h56n.p1"></a>`UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P1` — the dependency route receives one report; <a id="unit-test-create-contract-executor-1-m5h56n.p2"></a>`UNIT-TEST-CREATE-CONTRACT-EXECUTOR-1-M5H56N.P2` — no route re-throws on the owning thread |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
