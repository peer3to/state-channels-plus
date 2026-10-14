# RootWorkerRuntime.ts

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-RUNTIME-7-A2VAR0` (Bounded isolated-context teardown)](../../../../../../specification/runtime/execution.md#req-runtime-7-a2var0)
- [`REQ-CONFIG-4-WW7BRX` (Isolated contexts start with their creator's configuration)](../../../../../../specification/runtime/configuration.md#req-config-4-ww7brx)

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR

Fatal worker boundary

- Setup: Spawn a scripted entry through `createRootWorker` and observe `onError`
- Oracle: Every load-time error and every unrequested exit is reported, in order; the first error is the executor's cause

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1` — a load-time throw is reported as `error` and the exit that follows it as `exited with 1`, in that order
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2` — a ready SDK worker exits unexpectedly, pending requests reject and the client receives one notification carrying the exit cause
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3` — Closing the real SDK parent port while client disposal is held marks shutdown synchronously; the worker exits with no fatal adapter callback before the held parent cleanup resumes

## UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P

Bounded worker drain after disposal

- Setup: Create a parentless executor worker through `createRoot` with a real caller logger, substitute either an entry whose root arms a referenced `setInterval` during disposal (a timer `closeRootWorker` cannot see) or the production executor entry, observe the real `Worker` exit code, and dispose the handle
- Oracle: Disposal resolves; the exit code, the disposal time against `ROOT_WORKER_DRAIN_TIMEOUT_MS`, and the `warn` entry and hidden-parent failure entries in the caller's store

- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P1` — a leaked referenced timer: `closeRootWorker`'s unreferenced deadline ends the worker with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE` no earlier than `ROOT_WORKER_DRAIN_TIMEOUT_MS`; `createRootWorker` treats that exit as an expected shutdown, logs one warning and reports no failure
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P2` — the diagnostics posted over the bootstrap port arrive before `exit`; the warning names the worker's thread, the bound, a `timer` libuv handle and a `Timeout` resource
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P3` — the production executor entry drains before the bound and exits with code 0, with no warning and no failure
