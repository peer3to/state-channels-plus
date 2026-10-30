# SpectateRpcMethods.ts

> **Source:** [src/rpc/network/services/spectate/SpectateRpcMethods.ts](../../../../../../../../../src/rpc/network/services/spectate/SpectateRpcMethods.ts)

## Requirements

- [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../../../../../../../specification/peer-communication/synchronization.md#req-sync-1-t2589h)
- [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)
- [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../../../../../../../specification/peer-communication/synchronization.md#req-spc-3-azbkr1)

## UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH

Endpoint contract

- Setup: Provable and unprovable requests; a responder whose own initial sync is in flight and then succeeds, or that is opened with no participant handshake
- Oracle: Payload returned encoded; unprovable applies the documented consequence; an opened responder answers `isResponderSyncing` at once, with no wait, close, strike or blacklist on either side, and serves the payload when asked again after its own sync succeeds

- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1` — provable path
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2` — unprovable consequence
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3` — missing sender identity
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P9` — own initial sync in flight: answers `isResponderSyncing` at once, well within one window; the requester's connection stays with no strike, neither side blacklists the other, and the requester's state is unchanged
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P10` — opened responder with no participant handshake: answers `isResponderSyncing` at once with no close or strike, before its own initial-sync deadline aborts it
- [x] `UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P11` — own initial sync in flight, then succeeds: earlier requests get `isResponderSyncing`, and the request after the success gets the payload
