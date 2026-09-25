# RootErrorService.ts

> **Source:** [src/rpc/internal/services/errors/RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts#L1)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-ROOT-ERROR-1-0N4XM4

Root error routing

- Setup: Actual SDK-owned roots and their real service ports
- Oracle: Exactly one upward report, no duplicate request report, valid later traffic

- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P1` — An inline SDK forwards one child report to the application and both roots keep serving
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P2` — A worker SDK forwards one child report to the application and both roots keep serving
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P3` — An inline child request rejection reaches only its awaiting caller
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P4` — A worker child request rejection reaches only its awaiting caller
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P5` — A parent-origin error report is rejected and the connection remains usable
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P6` — A real worker exits during disposal; the request rejects, repeated disposal retains failure and the parent still serves
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P7` — A ready SDK worker exits unexpectedly with pending work; callers reject, the public error listener receives one original cause and client cleanup completes
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P8` — An error before readiness rejects the retained wait, closes the child and does not report a ready-host fatal error
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P9` — The startupFailed wire endpoint rejects readiness with the original error and closes the child
- [x] `UNIT-TEST-ROOT-ERROR-1-0N4XM4.P10` — A fire-and-forget endpoint rejection produces one public report and the root remains usable
