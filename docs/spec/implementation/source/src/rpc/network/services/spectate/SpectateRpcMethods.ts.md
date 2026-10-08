# SpectateRpcMethods.ts

> **Source:** [src/rpc/network/services/spectate/SpectateRpcMethods.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/spectate.md](../../../../../../views/architecture/sdk/rpc/spectate.md)

## Requirements

- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
  Partial: [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f) refusal penalty.
- [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)

## UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH

Endpoint contract

- Setup: Provable and unprovable requests
- Oracle: Payload returned encoded; unprovable applies the documented consequence

- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1` — provable path
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2` — unprovable consequence
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3` — missing sender identity
