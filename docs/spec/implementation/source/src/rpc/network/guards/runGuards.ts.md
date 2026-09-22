# runGuards.ts

> **Source:** [src/rpc/network/guards/runGuards.ts](../../../../../../../../src/rpc/network/guards/runGuards.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-RUN-GUARDS-1-TS1WHT

Ordering and short-circuit

- Setup: Three probe guards with each failing position
- Oracle: Later guards unevaluated after a failure; exactly one onFailure; empty list passes

- [x] `UNIT-TEST-RUN-GUARDS-1-TS1WHT.P1` — first guard fails
- [x] `UNIT-TEST-RUN-GUARDS-1-TS1WHT.P2` — all pass
- [x] `UNIT-TEST-RUN-GUARDS-1-TS1WHT.P3` — empty list
- [x] `UNIT-TEST-RUN-GUARDS-1-TS1WHT.P4` — middle guard fails
- [x] `UNIT-TEST-RUN-GUARDS-1-TS1WHT.P5` — last guard fails
