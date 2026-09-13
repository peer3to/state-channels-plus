# RootWorkerRuntime.ts — Source Report

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Node worker launch, transferred-port bootstrap, resource profiles, error observation and graceful shutdown.

## Key design decisions

`expectShutdown()` synchronously sets the expected-exit state. `shutdown()` uses the same operation before waiting for natural exit. A port owner can mark closure before the child sees parent loss, without prematurely starting or skipping resource cleanup. Unrequested exits remain fatal; worker error events still retain their original cause.

The bootstrap handler consumes WorkerBootstrapMessage with the root argument type. Node worker data is not a runtime creation option.

Worker globals are initialized by the common createRoot import. Worker detection only controls platform globals. Explicit worker entry modules call the common bootstrap; importing a root does not start it.

One generic `createRootWorker` accepts an entry URL for every root. No concrete root names, paths or per-root factory functions live in this platform owner.

Compiled and ts-node entries use the same bootstrap. All roots use the shared memory limit and full worker cleanup. The bootstrap installs the supplied global threadName before domain initialization. Every unexpected root-worker exit, including zero, is fatal for all roots. The common launcher owns connection-close failure ordering. An earlier worker error is delivered first. Failed initial transfer closes a worker still waiting for bootstrap.

## Inputs, outputs, state, and side effects

The public entry signatures define the startup values and platform handles. Domain roots own services; the common router owns pending requests. Startup and cleanup may allocate or release ports and workers. No separate readiness registry is introduced here.

## Linked requirements

| Source file                                                                                | Specification IDs                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

Startup data must be cloneable. Local dependencies stay in the receiving realm. Browser launch URLs are literal and visible to the bundler; arbitrary runtime class names do not identify worker bundles.

## Specification adherence

Creation preserves the existing domain readiness points and explicit parent ownership. Platform bootstrap shares the transferred-port boundary.

## Specification contradictions

None identified for this construction change.

## Missing behavior

This file contributes only the behavior described above; domain execution and lifecycle policy remain with their owners.

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts) supplies the construction/platform boundary. **Other files:** [RuntimeLifecycleService](../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) owns readiness and quiescence; [createRoot](../../../../../../../../src/rpc/internal/createRoot.ts) connects the parent and child. | None identified; the cited owners compose this boundary. |

## Component test obligations

| Unit test ID                                                                                                          | Obligation            | Public entry and setup                                                  | Oracle and forbidden effects                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR` | Fatal worker boundary | Spawn a scripted entry through `createRootWorker` and observe `onError` | Every load-time error and every unrequested exit is reported, in order; the first error is the executor's cause | <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr.p1"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1` — a load-time throw is reported as `error` and the exit that follows it as `exited with 1`, in that order; <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr.p2"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2` — a ready SDK worker exits unexpectedly, pending requests reject and the client receives one notification carrying the exit cause.; <a id="unit-test-contract-executor-worker-runtime-1-2zbbhr.p3"></a>`UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3` — Closing the real SDK parent port while client disposal is held marks shutdown synchronously; the worker exits with no fatal adapter callback before the held parent cleanup resumes. |
