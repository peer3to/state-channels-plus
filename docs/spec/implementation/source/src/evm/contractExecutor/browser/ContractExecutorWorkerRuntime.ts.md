# ContractExecutorWorkerRuntime.ts — Source Report

> **Source:** [src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.
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

Browser worker runtime bootstrap.

## Key design decisions

1. **Entry URL is a parameter.** `createContractExecutorWorkerFromUrl(workerUrl, onMessage, onError, name?)` spawns any module worker; the platform `createContractExecutorWorker` delegates with the production entry URL. The browser gate loads a scripted entry whose selection rides in the worker `name` (read back as `self.name`).
2. **`worker.onerror` stays the fatal boundary.** The worker's own funnel marks its `error` and `unhandledrejection` events handled, so a reported detached error never reaches this handler; only a real unhandled worker failure does.

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

| Source file                                                                                                                   | Specification IDs                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

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

| Unit test ID                                                                                                            | Obligation                       | Public entry and setup                                                                                            | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX` | Browser detached-error reporting | Create the browser worker executor with a scripted entry through the gate page; arm each failure and keep calling | One detached report per arm with the worker still serving; no worker `error` event and no console error | <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1` — a watchdog trip is one report with `runtime: "browser"` delay data; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2` — an autonomous throw is one report; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3` — an unhandled rejection is one report |

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
