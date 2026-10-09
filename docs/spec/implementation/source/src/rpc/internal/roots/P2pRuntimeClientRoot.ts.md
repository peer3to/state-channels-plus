# P2pRuntimeClientRoot.ts

> **Source:** [src/rpc/internal/roots/P2pRuntimeClientRoot.ts](../../../../../../../../src/rpc/internal/roots/P2pRuntimeClientRoot.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96

SDK client endpoint callback, request and final ownership boundaries.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Use the actual SDK host/channel. Assert original errors, exact forwarded delivery arguments, preserved timeout choices, readiness and dispose response order, released pending state and continued calls after recoverable errors.

- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P1` — Rejects readiness with the original startup host error
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P2` — Forwards host RPC timeout options and sendOne addresses unchanged
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P3` — Cleans owned inline executor endpoints after domain disposal fails
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P4` — Leaves the disposal deadline with the host
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P5` — Rejects an unknown host RPC delivery and serves the next invocation
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P6` — Keeps a timeout-free operation pending until domain cancellation
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P7` — Uses the ordinary thirty second request default
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P8` — Uses an explicit short timeout and ignores the later reply
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P9` — Keeps concurrent request results correlated
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P10` — Cleans up a synchronous post failure and serves another call
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P11` — Reports a post-ready host error and keeps later calls alive
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P12` — Receives ready before the deployComplete response
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P13` — Receives the dispose response before closing its connection
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P14` — Makes repeated disposal harmless and rejects later requests
- [x] `UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P15` — With no public error listener, the client surfaces the original host error as an unhandled rejection in an isolated worker
