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

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                          | Obligation                | Public entry and setup                                                    | Oracle and forbidden effects                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-worker-contract-executor-1-gqgaw7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7` | Worker executor lifecycle | Create through the public factory with real precompiles; call and dispose | Results, logs, and errors cross intact; readiness completes before return; work is serialized; disposal settles once | <a id="unit-test-worker-contract-executor-1-gqgaw7.p1"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P1` — precompile runs in worker; <a id="unit-test-worker-contract-executor-1-gqgaw7.p2"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P2` — delayed precompile readiness gates worker return; <a id="unit-test-worker-contract-executor-1-gqgaw7.p3"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P3` — logs serialize; <a id="unit-test-worker-contract-executor-1-gqgaw7.p4"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P4` — idempotent disposal; <a id="unit-test-worker-contract-executor-1-gqgaw7.p5"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P5` — post-disposal rejection; <a id="unit-test-worker-contract-executor-1-gqgaw7.p6"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P6` — inline and worker serialization; <a id="unit-test-worker-contract-executor-1-gqgaw7.p7"></a>`UNIT-TEST-WORKER-CONTRACT-EXECUTOR-1-GQGAW7.P7` — concurrent success/error response correlation |

## Related source reports

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
