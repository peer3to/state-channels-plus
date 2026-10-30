# RootWorkerRuntime.ts

> **Source:** [RootWorkerRuntime.ts](../../../../../../../../src/rpc/internal/node/RootWorkerRuntime.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-RUNTIME-7-A2VAR0` (Bounded isolated-context teardown)](../../../../../../specification/runtime/execution.md#req-runtime-7-a2var0)
- [`REQ-CONFIG-4-WW7BRX` (Isolated contexts start with their creator's configuration)](../../../../../../specification/runtime/configuration.md#req-config-4-ww7brx)
- [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../../../../../../specification/runtime/execution.md#req-runtime-9-p5vpt5)

## UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR

Fatal worker boundary

- Setup: Spawn a scripted entry through `createRootWorker` and observe `onError`
- Oracle: Every load-time error and every unrequested exit is reported, in order; the first error is the executor's cause

- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P1` — a load-time throw is reported as `error` and the exit that follows it as `exited with 1`, in that order
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P2` — a ready SDK worker exits unexpectedly, pending requests reject and the client receives one notification carrying the exit cause
- [x] `UNIT-TEST-CONTRACT-EXECUTOR-WORKER-RUNTIME-1-2ZBBHR.P3` — Closing the real SDK parent port while client disposal is held marks shutdown synchronously; the worker exits with no fatal adapter callback before the held parent cleanup resumes

## UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P

Bounded worker drain after disposal

- Setup: Create a parentless executor worker through `createRoot` with a real caller logger, substitute a scripted entry (a root that arms a referenced `setInterval` during disposal; a root whose `process.report.getReport` throws; a root that exits with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE` while serving a call; a root that keeps a bound native udx socket open, run with the parent in a child process) or the production executor entry, observe the real `Worker` exit code, and dispose the handle; for the SDK host, set up a worker SDK from a scripted host entry (a UDP socket closed just before the worker closes its handles, ahead of an open one; a leaked referenced timer) and dispose the `P2pInstance`
- Oracle: The disposal time against `ROOT_WORKER_DRAIN_TIMEOUT_MS`, the exit code, the parent process's exit signal, the `warn` entry with its bound and diagnostics, and the failure entries in the caller's or client root's store

- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P1` — a leaked referenced timer: the drain deadline that `closeRootWorker` arms before it closes any handle ends the worker with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE` no earlier than `ROOT_WORKER_DRAIN_TIMEOUT_MS`; `createRootWorker` treats that exit as an expected shutdown, logs one warning and reports no failure
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P2` — the diagnostics posted over the bootstrap port arrive before `exit`; the warning names the worker's thread, the bound, a `timer` libuv handle and a `Timeout` resource
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P3` — the production executor entry drains before the bound and exits with code 0, with no warning and no failure
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P4` — an exit with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE` the owner did not request: the pending call rejects with `Root worker exited with 86`, the hidden parent logs that failure and no drain warning is recorded
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P7` — `process.report.getReport` throws: `exitAfterDrainTimeout` posts no diagnostics message and still exits with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE`; the warning is still logged with `diagnostics` undefined
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P8` — a bound native udx socket `_getActiveHandles` does not list: the child-process parent exits with code 0 and no signal, the worker exits with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE` and the warning names a `udp` handle
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P9` — a worker SDK whose UDP socket is already closing when `closeRootWorker` runs (a second close throws `ERR_SOCKET_DGRAM_NOT_RUNNING`): `closeHandle` absorbs the refusal, the open socket listed after it still closes, the worker exits with code 0, `P2pInstance` disposal completes, no warning and no host error
- [x] `UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P10` — a worker SDK whose host leaks a referenced timer: `P2pInstance` disposal completes no earlier than `ROOT_WORKER_DRAIN_TIMEOUT_MS`, the client root logs one warning naming `P2pRuntimeHostRoot` and the bound, and no host error is raised
