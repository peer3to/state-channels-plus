# RootWorkerRuntime.ts — Source Report

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Browser worker observation, transferred-port bootstrap and worker termination.

## Key design decisions

`expectShutdown()` is a no-op because browser workers expose no exit event to classify. It does not terminate the worker; `shutdown()` still owns termination after common cleanup.

The bootstrap handler consumes the same generic WorkerBootstrapMessage as Node. Its rootWorkerUrl stub exists for shared test fixture compilation; built-in browser workers use bundled asset URLs.

Worker globals are initialized by the common createRoot import. Worker detection only controls platform globals. Explicit worker entry modules call the common bootstrap; importing a root does not start it.

One generic `createRootWorker` accepts an entry URL for every root. No concrete root names, paths or per-root factory functions live in this platform owner.

Common worker observation is separate from literal per-root launch URLs to avoid circular worker bundles. Detached errors are marked handled and forwarded through the root; fatal startup failures reach the parent.

## Inputs, outputs, state, and side effects

The public entry signatures define the startup values and platform handles. Domain roots own services; the common router owns pending requests. Startup and cleanup may allocate or release ports and workers. No separate readiness registry is introduced here.

## Linked requirements

| Source file                                                                                   | Specification IDs                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Startup data must be cloneable. Local dependencies stay in the receiving realm. The caller supplies an emitted module-worker URL. URL construction and bundler syntax belong to the application; the browser adapter calls the standard Worker constructor.

## Specification adherence

Creation preserves the existing domain readiness points and explicit parent ownership. Platform bootstrap shares the transferred-port boundary.

## Specification contradictions

None identified for this construction change.

## Missing behavior

This file contributes only the behavior described above; domain execution and lifecycle policy remain with their owners.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                   | Gap / divergence                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |

## Component test obligations

| Unit test ID                                                                                                            | Obligation                       | Public entry and setup                                                                                            | Oracle and forbidden effects                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX` | Browser detached-error reporting | Create the browser worker executor with a scripted entry through the gate page; arm each failure and keep calling | One detached report per arm with the worker still serving; no worker `error` event and no console error | <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1` — a watchdog trip is one report with `runtime: "browser"` delay data; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2` — an autonomous throw is one report; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3` — an unhandled rejection is one report; <a id="unit-test-contract-executor-browser-runtime-1-6hx1gx.p4"></a>`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P4` — a real browser worker loads the custom precompile and returns its expected contract result |
