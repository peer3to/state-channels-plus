# RootWorkerDrain tests

Test file: [RootWorkerDrain.test.ts](../../../../../../test/rpc/RootWorkerDrain.test.ts)
Exercises: [RootWorkerRuntime.ts](../../../../implementation/source/src/rpc/internal/node/RootWorkerRuntime.ts.md)

## Overview

The cases use [RootWorkerDrainFixture](../../../../../../test/fixtures/node/RootWorkerDrainFixture.ts) to create
a real parentless contract-executor worker through `createRoot` with a real caller logger from the log-uploader
fixture. `RootWorkerControl` substitutes the worker entry and hands the test the real `Worker`, whose `exit`
code is recorded. The leaking entry ([LeakedTimerRootEntry](../../../../../../test/fixtures/node/LeakedTimerRootEntry.ts))
arms a referenced `setInterval` when its root is disposed; `closeRootWorker` cannot close JS timers, so the
worker loop cannot drain. The clean case runs the production executor entry. Each case disposes the handle,
times the disposal, and reads the caller's log store for the drain warning and for the hidden parent's
failure log. Oracles: the first case asserts the drain-timeout exit code, a disposal no shorter than
`ROOT_WORKER_DRAIN_TIMEOUT_MS`, one warning and no failure; the second asserts the warning's level, worker
name and bound, and that its diagnostics list a `timer` libuv handle and a `Timeout` resource; the third
asserts exit code 0, a disposal shorter than the bound, and no warning or failure.

## Tests

- `completes disposal after the drain bound when the disposed worker leaks a referenced timer`: REQ-RUNTIME-7-A2VAR0.T1.P1, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P1
- `warns with diagnostics naming the leaked timer when the worker exits after the drain bound`: REQ-RUNTIME-7-A2VAR0.T1.P2, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P2
- `drains a worker with no leaked handle before the bound without a warning`: REQ-RUNTIME-7-A2VAR0.T1.P3, UNIT-TEST-ROOT-WORKER-DRAIN-1-JWKQ0P.P3
