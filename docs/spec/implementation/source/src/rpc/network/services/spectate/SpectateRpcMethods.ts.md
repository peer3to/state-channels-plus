# SpectateRpcMethods.ts

> **Source:** [src/rpc/network/services/spectate/SpectateRpcMethods.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateRpcMethods.ts)

## Requirements

- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
  Partial: [`DEF-10-199C7F`](../../../../../../../audit/open-findings.md#def-10-199c7f) refusal penalty.
- [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)
- [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../../../../../../../specification/peer-communication/synchronization.md#req-spc-3-azbkr1)

## UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH

Endpoint contract

- Setup: Provable and unprovable requests; a responder whose own initial sync is in flight
- Oracle: Payload returned encoded; unprovable applies the documented consequence; an in-flight own initial sync delays the answer until it settles

- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1` — provable path
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2` — unprovable consequence
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3` — missing sender identity
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P4` — own initial sync in flight, then succeeds: answered after it settles
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P5` — own initial sync in flight, then fails: the request fails
