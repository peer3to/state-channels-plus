# RootWorkerRuntime.ts

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR

Fatal worker boundary

- Setup: Spawn a scripted entry through `createRootWorker` and observe `onError`
- Oracle: Every load-time error and every unrequested exit is reported, in order; the first error is the executor's cause

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1` — a load-time throw is reported as `error` and the exit that follows it as `exited with 1`, in that order
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2` — a ready SDK worker exits unexpectedly, pending requests reject and the client receives one notification carrying the exit cause
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3` — Closing the real SDK parent port while client disposal is held marks shutdown synchronously; the worker exits with no fatal adapter callback before the held parent cleanup resumes
