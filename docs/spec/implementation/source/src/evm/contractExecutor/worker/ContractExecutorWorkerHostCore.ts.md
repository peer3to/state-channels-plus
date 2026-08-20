# ContractExecutorWorkerHostCore.ts — Source Report

> **Source:** [src/evm/contractExecutor/worker/ContractExecutorWorkerHostCore.ts](../../../../../../../../src/evm/contractExecutor/worker/ContractExecutorWorkerHostCore.ts) > **Status:** Authored — engineer verification pending.
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

The worker-side owner of the local EVM. It restores configuration, constructs the logger and EVM,
awaits asynchronous custom-precompile initialization, exposes the executor request loop, and owns
worker shutdown. Its ready response is the boundary after which callers may use the executor.

## Key design decisions

1. **Worker readiness includes precompile readiness** — `init` does not return until `createEvm` has loaded every configured precompile and the executor exists.
2. **VM delay uses the common fatal guard** — monitoring begins after readiness and applies the configured delay threshold without a VM-specific override.
3. **The worker owns request execution and cleanup** — every call goes through the one executor instance, errors are serialized for the caller, and disposal stops monitoring before releasing the executor.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | `init`, `request`, and `dispose` port messages; configuration and custom-precompile manifests.                                                    |
| Outputs      | Correlated success/error responses and readiness only after the EVM is usable.                                                                    |
| Owned state  | One logger and one `ContractExecutor` for the worker lifetime.                                                                                    |
| Side effects | Creates and disposes the in-worker EVM; emits VM timing markers and enforces the configured fatal-delay threshold after initialization completes. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                                    | Specification IDs                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerHostCore.ts](../../../../../../../../src/evm/contractExecutor/worker/ContractExecutorWorkerHostCore.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings.
- The worker uses the same configured fatal-delay threshold as the other monitored runtime contexts.
- `createEvm` and custom-precompile factories must settle before the worker can report ready.

## Specification adherence

- Executor semantics remain identical across inline and worker contexts.
- Readiness includes EVM and custom-precompile initialization.
- Monitoring starts after readiness and applies the common fatal-delay threshold.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                    | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** the worker executes the same contract-executor operations and returns transfer-safe results and errors. **Other files:** [`WorkerContractExecutor.ts`](../WorkerContractExecutor.ts.md) owns the client boundary. | None.            |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** one executor owns all mutable EVM state and receives serialized requests.                                                                                                                                         | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** initialization awaits precompile readiness; monitoring starts afterward; disposal stops monitoring and releases the executor.                                                                                     | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                    | Obligation                                                                                                                                                                                                                            | Public entry and setup                                                                                | Oracle and forbidden effects                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-host-1-2trsyv"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV` | Worker-host lifecycle for [`REQ-RUNTIME-2-KBXKTG`](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) and [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Create the public worker executor with real synchronous and delayed precompiles; call and dispose it. | Ready never precedes precompile initialization; requests settle once; errors stay correlated; disposal releases ownership. | <a id="unit-test-contract-executor-worker-host-1-2trsyv.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P1` — delayed precompile readiness gates host return; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P2` — successful request correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P3` — error serialization and correlation; <a id="unit-test-contract-executor-worker-host-1-2trsyv.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-HOST-1-2TRSYV.P4` — idempotent disposal and post-disposal rejection |

The public [`WorkerContractExecutor`](../WorkerContractExecutor.ts.md) drives this private host through its real port.

## Related source reports

- [WorkerContractExecutor](../WorkerContractExecutor.ts.md), [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
