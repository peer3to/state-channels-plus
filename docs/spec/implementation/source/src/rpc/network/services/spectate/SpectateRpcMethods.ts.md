# SpectateRpcMethods.ts

> **Source:** [src/rpc/network/services/spectate/SpectateRpcMethods.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateRpcMethods.ts)

## Requirements

- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
- [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)
- [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../../../../../../../specification/peer-communication/synchronization.md#req-spc-3-azbkr1)

## UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH

Endpoint contract

- Setup: Provable and unprovable requests; a responder whose own initial sync is in flight, already failed, or not started before its initial-sync deadline; a requester whose one-window probe times out while the responder waits
- Oracle: Payload returned encoded; unprovable applies the documented consequence; an in-flight own initial sync delays the answer until it settles; a failed own initial sync refuses the request; a timed-out requester records only a retry-tier close and no blacklist on either side

- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1` — provable path
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2` — unprovable consequence
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3` — missing sender identity
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P4` — own initial sync in flight, then succeeds: answered after it settles
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P5` — own initial sync in flight, then fails: the request fails
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P6` — own initial sync in flight past the requester's one-window timeout: the requester records only a retry-tier close, neither side blacklists the other, and the late answer has no effect on the requester
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P7` — own initial sync already failed when the request enters: refused at once with the own-sync failure
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P8` — opened responder with no participant handshake: the request waits and is refused when the initial-sync deadline fires
