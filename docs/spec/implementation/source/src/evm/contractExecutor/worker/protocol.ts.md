# protocol.ts — Source Report

> **Source:** [src/evm/contractExecutor/worker/protocol.ts](../../../../../../../../src/evm/contractExecutor/worker/protocol.ts) > **Status:** Authored — engineer verification pending.
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

The executor port protocol: typed initialization, execution, disposal, success, and error messages
between the executor client and worker host. The initialization payload carries configuration for
worker logging and timing plus transfer-safe custom-precompile manifests.

## Key design decisions

1. **Configuration crosses explicitly** — the worker rebuilds its local logger and timing configuration instead of reading main-thread process state.
2. **Configuration keeps one timing policy** — the receiving worker rebuilds the same configured fatal-delay threshold used by the rest of the runtime.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Inputs       | Transfer-safe init, executor-request, and disposal payloads.                            |
| Outputs      | Correlated success or serialized-error responses.                                       |
| Owned state  | None; this file defines the boundary types only.                                        |
| Side effects | None at runtime. Invalid or incomplete message shapes fail TypeScript/build validation. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                        | Specification IDs                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [protocol.ts](../../../../../../../../src/evm/contractExecutor/worker/protocol.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Every payload must remain structured-clone safe.
- This type-only module carries the configuration used to apply the common runtime timing policy.

## Specification adherence

- The discriminated union keeps initialization, execution, disposal, and response correlation explicit.
- The init payload gives the worker the same logging and fatal-delay threshold configuration as the other runtime contexts.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                               | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** a closed discriminated union defines transfer-safe requests and correlated responses.                        | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** initialization carries the configuration and precompile manifests needed before the worker can report ready. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                            | Obligation                                                                                                                                                                                                                                                          | Public entry and setup                                                                      | Oracle and forbidden effects                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-protocol-1-0cq37k"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K` | Transfer-safe executor messages for [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) and readiness input for [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Drive the public worker executor with real precompile options, calls, errors, and disposal. | Boundary values survive exactly; invalid states reject; responses stay correlated. | <a id="unit-test-contract-executor-worker-protocol-1-0cq37k.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P1` — init configuration and precompile manifest; <a id="unit-test-contract-executor-worker-protocol-1-0cq37k.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P2` — successful request/response correlation; <a id="unit-test-contract-executor-worker-protocol-1-0cq37k.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P3` — serialized error correlation; <a id="unit-test-contract-executor-worker-protocol-1-0cq37k.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-PROTOCOL-1-0CQ37K.P4` — disposal message and terminal state |

Compile checks validate the type-level union; the public [`WorkerContractExecutor`](../WorkerContractExecutor.ts.md) exercises its runtime encoding through the real port.

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
