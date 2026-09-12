# ContractExecutorWorkerRuntime.ts — Source Report

> **Source:** [src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Browser worker runtime bootstrap: spawns the worker and returns its port and shutdown as a `WorkerLike`.

## Linked requirements

| Source file                                                                                                                   | Specification IDs                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                            | Obligation                       | Public entry and setup                                                                                            | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX` | Browser detached-error reporting | Create the browser worker executor with a scripted entry through the gate page; arm each failure and keep calling | One detached report per arm with the worker still serving; no worker `error` event and no console error | <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1` — a watchdog trip is one report with `runtime: "browser"` delay data; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2` — an autonomous throw is one report; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3` — an unhandled rejection is one report; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P4` — a real browser worker loads the custom precompile and returns its expected contract result |
