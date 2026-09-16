# test/e2e/E2E-WorkerShutdown.test.ts — Test Report

> **Test file:** [test/e2e/E2E-WorkerShutdown.test.ts](../../../../../../test/e2e/E2E-WorkerShutdown.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                     | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: worker shutdown > drains and tears down multiple threaded peers promptly`](../../../../../../test/e2e/E2E-WorkerShutdown.test.ts#L5) (line 5) | —      |

This is partial system evidence for [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), without crediting a full lifecycle permutation.
