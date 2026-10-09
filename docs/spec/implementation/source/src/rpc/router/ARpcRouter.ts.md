# ARpcRouter.ts

> **Source:** [src/rpc/router/ARpcRouter.ts](../../../../../../../src/rpc/router/ARpcRouter.ts)
>
> **Replaces:** `src/IOnMessage.ts`
>
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-ARPC-ROUTER-1-459EX2

Request correlation, deadlines, send failures and settlement-once races.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Assert the exact scalar result or original failure, one settlement, zero owned pending entries/timers after completion, and successful unrelated or subsequent traffic.

- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P1` — Resolves false without changing the result
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P2` — Resolves zero without changing the result
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P3` — Resolves null without changing the result
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P4` — Resolves undefined without changing the result
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P5` — Keeps concurrent out-of-order responses separate
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P6` — Returns sync endpoint failures and serves the next call
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P7` — Returns async endpoint failures and serves the next call
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P8` — Rejects a synchronous post failure and releases its entry
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P9` — Rejects an uncloneable argument without leaving pending work
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P10` — Uses the supplied timeout and cancels it after settlement
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P11` — Keeps a timeout-free call pending until its owner settles it
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P12` — Keeps reply settlement before remote error
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P13` — Keeps reply settlement before timeout
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P14` — Keeps reply settlement before owner rejection
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P15` — Keeps remote error settlement before reply
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P16` — Keeps remote error settlement before timeout
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P17` — Keeps remote error settlement before owner rejection
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P18` — Keeps timeout settlement before reply
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P19` — Keeps timeout settlement before remote error
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P20` — Keeps timeout settlement before owner rejection
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P21` — Keeps owner rejection settlement before reply
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P22` — Keeps owner rejection settlement before remote error
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P23` — Keeps owner rejection settlement before timeout
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P24` — Ignores unknown and duplicate responses
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P25` — Rejects all entries once and releases timers
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P26` — Request dispatch remains pending until a held endpoint completes; another RPC releases it and all pending entries settle
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P27` — One-way dispatch remains pending until its endpoint completes while another incoming RPC can release it; the send creates no pending request
- [x] `UNIT-TEST-ARPC-ROUTER-1-459EX2.P28` — registers before synchronous loopback delivery can reply
