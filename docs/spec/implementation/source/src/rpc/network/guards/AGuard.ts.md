# AGuard.ts

> **Source:** [src/rpc/network/guards/AGuard.ts](../../../../../../../../src/rpc/network/guards/AGuard.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-AGUARD-1-GTFEE2

Shape contract

- Setup: Implement a probe guard; drive pass/fail
- Oracle: check has no side effects; onFailure fires once on first failure only

- [ ] `UNIT-TEST-AGUARD-1-GTFEE2.P1` — pass path
- [ ] `UNIT-TEST-AGUARD-1-GTFEE2.P2` — fail path single onFailure
