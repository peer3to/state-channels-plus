# E2E-WorkerShutdown.test.ts

Test file: [test/e2e/E2E-WorkerShutdown.test.ts](../../../../../../test/e2e/E2E-WorkerShutdown.test.ts)

## Overview

A smoke test starts three peers with `RUN_SDK_IN_THREAD: true` through the
`MathTestSession` harness (each SDK in its own worker), runs one warm-up transition, then calls
concurrent and repeated `harness.cleanup()` calls and asserts the whole teardown — draining and disposing every threaded peer —
completes in under five seconds and leaves `harness.peers` empty. Concurrent calls return the same cleanup promise, and a later call remains harmless. The oracle is teardown latency
plus the emptied peer list; it guards against workers hanging the process or teardown stalling on
undrained handles. It does not observe the settlement of individual in-flight requests, resource
reclamation, or post-disposal mutation, so the disposal permutations of the runtime and SDK
obligations (which require those observations) are not covered in full here and none are
assigned; `test/evm/workerShutdown.test.ts` covers executor-level shutdown separately.

A second test asserts its premise: through the harness stub it starts one real
`TimeoutManager` task on a threaded peer that stays running until that manager's own `dispose`
begins, and checks before cleanup that the task has entered and the manager reports a running
task. The stub releases the task right after the synchronous part of `dispose`, so `dispose`
provably starts its bounded wait with the task in flight and the task settles inside that wait.
The teardown then has the same five-second bound: a wait bound timer left pending after the
tasks settle keeps the worker thread alive until it fires, so the teardown takes at least five
seconds and the test fails.

## Tests

- `drains and tears down multiple threaded peers promptly`: none
- `tears down threaded peers promptly when disposal starts with a scheduled task still running`: none

This is partial system evidence for `REQ-RUNTIME-3-VQXW59`, without crediting a full lifecycle permutation.
