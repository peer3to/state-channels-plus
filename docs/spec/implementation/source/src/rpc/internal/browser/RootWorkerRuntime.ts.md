# RootWorkerRuntime.ts

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/browser/RootWorkerRuntime.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX

Browser detached-error reporting

- Setup: Create the browser worker executor with a scripted entry through the gate page; arm each failure and keep calling
- Oracle: One detached report per arm with the worker still serving; no worker `error` event and no console error

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1` — a watchdog trip is one report with `runtime: "browser"` delay data
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2` — an autonomous throw is one report
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3` — an unhandled rejection is one report
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P4` — a real browser worker loads the custom precompile and returns its expected contract result
