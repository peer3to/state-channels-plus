# RootWorkerDrain tests

Test file: [RootWorkerDrain.test.ts](../../../../../../test/rpc/RootWorkerDrain.test.ts)
Exercises: [RootWorkerRuntime.ts](../../../../implementation/source/src/rpc/internal/node/RootWorkerRuntime.ts.md)

## Overview

The cases use [RootWorkerDrainFixture](../../../../../../test/fixtures/node/RootWorkerDrainFixture.ts) to create
a real parentless contract-executor worker through `createRoot` with a real caller logger from the log-uploader
fixture. `RootWorkerControl` substitutes the worker entry and hands the test the real `Worker`, whose `exit`
code is recorded. The leaking entry ([LeakedTimerRootEntry](../../../../../../test/fixtures/node/LeakedTimerRootEntry.ts))
arms a referenced `setInterval` when its root is disposed; `closeRootWorker` cannot close JS timers, so the
worker loop cannot drain. The clean case runs the production executor entry. The fault entry
([TeardownExecutorEntry](../../../../../../test/fixtures/node/TeardownExecutorEntry.ts)) stages, by
`workerData`, a leaked timer with a `process.report.getReport` that throws, an exit with the drain-timeout
code from a served `quiesce` call, or a bound native udx socket. The native-socket case runs its parent in a
child process ([NativeHandleDrainHost](../../../../../../test/fixtures/node/NativeHandleDrainHost.ts)) so an
abort of the process shows as a signal. Each disposal case disposes the handle, times the disposal, and reads
the caller's log store for the drain warning and for the hidden parent's failure log. Oracles: the leak case
asserts the drain-timeout exit code, a disposal no shorter than `ROOT_WORKER_DRAIN_TIMEOUT_MS`, one warning and
no failure; the warning case asserts its level, worker name and `drainTimeoutMs` and that its diagnostics list
a `timer` libuv handle and a `Timeout` resource; the clean case asserts exit code 0 and no warning or failure;
the report-failure case asserts the exit after the bound, no failure, and one warning carrying the bound
with no diagnostics (none was posted); the unrequested case asserts the call rejected with the exit, one hidden-parent failure with that
message and no warning; the native-socket case asserts the child process exits with code 0 and no signal, the
worker with the drain-timeout code, and one warning naming a `udp` handle.

## Tests

- `completes disposal after the drain bound when the disposed worker leaks a referenced timer`: REQ-RUNTIME-7-A2VAR0.T1.P1, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P1
- `warns with diagnostics naming the leaked timer when the worker exits after the drain bound`: REQ-RUNTIME-7-A2VAR0.T1.P2, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P2
- `drains a worker with no leaked handle before the bound without a warning`: REQ-RUNTIME-7-A2VAR0.T1.P3, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P3
- `still exits after the drain bound when the worker cannot collect its diagnostics report`: REQ-RUNTIME-7-A2VAR0.T1.P7, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P7
- `reports a drain-timeout exit code the owner did not request as a worker failure`: REQ-RUNTIME-7-A2VAR0.T1.P4, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P4
- `exits after the drain bound without aborting the parent process when a native socket stays open`: REQ-RUNTIME-7-A2VAR0.T1.P8, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P8
