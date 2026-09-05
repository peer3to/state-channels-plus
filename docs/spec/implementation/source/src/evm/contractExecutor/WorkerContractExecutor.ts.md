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
2. **The worker host owns its timing guard** — it starts monitoring only after EVM creation and custom-precompile readiness complete, using the same configured delay threshold as the other monitored contexts.
3. **Initialization carries the host's clock adjustment.** `create` sends the Clock's adjustment
   from wall time in the `init` request ([#L100](../../../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts#L100));
   the worker has no Clock singleton and derives the same perception from its own wall clock
   ([`REQ-RUNTIME-6-6F4SSM`](../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm)).
4. **One worker-error policy, report-and-continue** — a `detachedError` message from the worker (its funnel's uncaught exception or unhandled rejection, or the watchdog's throw) is rebuilt with the shared codec, logged, and handed to the internal `onDetachedError` route (the runtime host's port route); without a route, as through the package entry, it is re-thrown on the owning thread as an uncaught error, so a worker never hides what an inline executor would have surfaced. The executor and worker keep serving. A load-time error, an error event, or any exit the executor did not request is fatal: the first failure wins (a later exit never overwrites the original cause), pending requests reject with it, and later requests fail fast because a post to a dead worker would never settle. Construction dependencies (`createWorkerRuntime`, `onDetachedError`) are internal and not part of the package API ([`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)).

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

| Source file                                                                                          | Specification IDs                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WorkerContractExecutor.ts](../../../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-2-KBXKTG`](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

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

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| ------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-6-6F4SSM`](../../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm) | Covered               | **Here:** [source](../../../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts#L92) passes the host clock adjustment in initialization; calls continue to use local worker time. **Other files:** [Clock.ts](../../Clock.ts.md) (current clock and adjustment), [createContractExecutor.ts](createContractExecutor.ts.md) (clock/factory wiring), [ContractExecutorWorkerHostCore.ts](worker/ContractExecutorWorkerHostCore.ts.md) (worker-local clock derivation), [protocol.ts](worker/protocol.ts.md) (initialization message shape). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation                | Public entry and setup                                                    | Oracle and forbidden effects                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-worker-contract-executor-1-gqgaw7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7` | Worker executor lifecycle | Create through the public factory with real precompiles; call and dispose | Results, logs, and errors cross intact; readiness completes before return; work is serialized; disposal settles once | <a id="unit-test-worker-contract-executor-1-gqgaw7.p1"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1` — precompile runs in worker; <a id="unit-test-worker-contract-executor-1-gqgaw7.p2"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2` — delayed precompile readiness gates worker return; <a id="unit-test-worker-contract-executor-1-gqgaw7.p3"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3` — logs serialize; <a id="unit-test-worker-contract-executor-1-gqgaw7.p4"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4` — idempotent disposal; <a id="unit-test-worker-contract-executor-1-gqgaw7.p5"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5` — post-disposal rejection; <a id="unit-test-worker-contract-executor-1-gqgaw7.p6"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P6` — inline and worker serialization; <a id="unit-test-worker-contract-executor-1-gqgaw7.p7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7` — concurrent success/error response correlation; <a id="unit-test-worker-contract-executor-1-gqgaw7.p8"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P8` — a watchdog trip is one detached report carrying `eventLoopDelay`, and the executor still serves; <a id="unit-test-worker-contract-executor-1-gqgaw7.p9"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P9` — an autonomous throw in the worker is one detached report, and the executor still serves; <a id="unit-test-worker-contract-executor-1-gqgaw7.p10"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P10` — a worker exit after readiness rejects pending and later calls with the exit as the cause, never as a detached report; <a id="unit-test-worker-contract-executor-1-gqgaw7.p11"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P11` — a worker failure before its funnel exists rejects `create` with the original error; <a id="unit-test-worker-contract-executor-1-gqgaw7.p12"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P12` — a request in flight when the worker exits rejects with the exit as the cause, as does a later request; <a id="unit-test-worker-contract-executor-1-gqgaw7.p13"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P13` — an error thrown in the first microtask after the host starts is one detached report and the executor still serves; <a id="unit-test-worker-contract-executor-1-gqgaw7.p14"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P14` — a detached error with no application route is re-thrown on the owning thread and the executor still serves; <a id="unit-test-worker-contract-executor-1-gqgaw7.p15"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P15` — the public factory keeps one argument and its pre-plan option shape |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
