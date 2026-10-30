# runCleanup.ts

> **Source:** [src/utils/runCleanup.ts](../../../../../../src/utils/runCleanup.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-CLEANUP-1-14NFGW

Ordered cleanup and failure preservation

- Setup: Call `runCleanup` and `runCleanupSync` with no steps, ordered steps, async steps, and steps that throw or reject (including `undefined`) before later steps.
- Oracle: Every step runs in order, each async step settles before the next starts, and the call throws or rejects with exactly the first failure, `undefined` included, after the last step has run.

- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P1` — Empty sync and async sequences complete without error
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P2` — Synchronous steps execute in order before return
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P3` — Synchronous failures do not skip later steps; the original first error is thrown
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P4` — An async step settles before the next step begins
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P5` — A synchronous throw followed by a rejection still runs final cleanup and rejects with the original error
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P6` — An async rejection remains the first failure when a later step throws synchronously
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P7` — A synchronous throw of undefined remains a failure, not a success sentinel
- [x] `UNIT-TEST-CLEANUP-1-14NFGW.P8` — An async rejection with undefined remains a failure, not a success sentinel
