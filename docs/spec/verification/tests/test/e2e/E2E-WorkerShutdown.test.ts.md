# E2E-WorkerShutdown.test.ts

Test file: [test/e2e/E2E-WorkerShutdown.test.ts](../../../../../../test/e2e/E2E-WorkerShutdown.test.ts)

## Overview

A single smoke test starts three peers with `RUN_SDK_IN_THREAD: true` through the
`MathTestSession` harness (each SDK in its own worker), runs one warm-up transition, then calls
concurrent and repeated `harness.cleanup()` calls and asserts the whole teardown — draining and disposing every threaded peer —
completes in under five seconds and leaves `harness.peers` empty. Concurrent calls return the same cleanup promise, and a later call remains harmless. The oracle is teardown latency
plus the emptied peer list; it guards against workers hanging the process or teardown stalling on
undrained handles. It does not observe the settlement of individual in-flight requests, resource
reclamation, or post-disposal mutation, so the disposal permutations of the runtime and SDK
obligations (which require those observations) are not covered in full here and none are
assigned; `test/evm/workerShutdown.test.ts` covers executor-level shutdown separately.

## Tests

- `drains and tears down multiple threaded peers promptly`: none

This is partial system evidence for `REQ-RUNTIME-3-VQXW59`, without crediting a full lifecycle permutation.
