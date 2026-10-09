# Peer-RPC Model

> **Specification subject:** [Peer Communication and RPC Services](../../../../../specification/peer-communication/rpc.md)

## INTEGRATION-TEST-RPC-2-PBZ4QY

Inbound frames reach an endpoint only over an authenticated session, and a rejected frame punishes only its sender's session.

- Setup: Harness peers send a custom `pingService.ping` over an authenticated session, a spectate request over a captured pre-handshake transport, a raw frame naming the inherited method `toString` (`rpcHandlerProbe.sendRawRpc`), and a multibyte oversized frame (`rpcHandlerProbe.sendMultibyteOversizedRpc`), with a third peer as bystander.
- Oracle: Authenticated pings and pongs reach both peers; the pre-handshake request is rejected by the guard and never reaches the spectate handler; the crafted and oversized senders are blacklisted and disconnected, the crafted frame records no ping or sum, and the receiver keeps exchanging pings with the bystander.
- Specification: [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)

- [x] `INTEGRATION-TEST-RPC-2-PBZ4QY.P1` — authenticated dispatch
- [x] `INTEGRATION-TEST-RPC-2-PBZ4QY.P2` — pre-auth rejection
- [x] `INTEGRATION-TEST-RPC-2-PBZ4QY.P3` — crafted endpoint isolation
- [x] `INTEGRATION-TEST-RPC-2-PBZ4QY.P4` — multibyte oversized offender isolation

## INTEGRATION-TEST-RPC-3-ZKFXGT

Every outbound request settles exactly once and leaves no pending entry or timer behind.

- Setup: `p2pManagerProbe` drives `P2PManager` requests through success, remote error, default error, synchronous send failure, disposal, a foreign responder, concurrent requests, and each pair of response, remote error, timeout and disconnect in both orders.
- Oracle: The first outcome wins (the response value, the remote error message, `timed out after <n>ms` or `Peer disconnected before RPC response arrived`) and pending and timer counts end at zero; concurrent requests get distinct IDs, and a response from an unrelated peer gets that peer blacklisted and disconnected without settling the intended request.
- Specification: [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)

- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P1` — response/error/send cleanup
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P5` — disposal cleanup
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P6` — response/timeout
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P7` — response/disconnect
- [ ] `INTEGRATION-TEST-RPC-3-ZKFXGT.P8` — replacement/unknown/duplicate response
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P9` — remote-error/timeout
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P10` — response/remote-error
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P11` — remote-error/disconnect
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P12` — timeout/disconnect
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P13` — foreign responder
- [x] `INTEGRATION-TEST-RPC-3-ZKFXGT.P14` — concurrent distinct/duplicate response

## INTEGRATION-TEST-RPC-4-EXZ35F

Guards run in declaration order on untrusted transports, the first failure alone decides the consequence, and trusted loopback skips them.

- Setup: `runGuards` over a passing, failing, passing guard list; an `ANetworkRpcService` call over the real loopback transport; `HandshakeCompletedGuard` facing an unverified peer that is not negotiating; and an E2E spectate request sent over a pre-handshake transport.
- Oracle: Checks stop at the first failure and only its failure handler runs; loopback runs the endpoint with zero guard checks; the non-negotiating peer is blacklisted and disconnected with no endpoint invoked; the blocked spectate request returns `RPC request rejected by guard` without reaching the handler, and the guarded peer later connects to a third peer and answers its spectate request.
- Specification: [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

- [x] `INTEGRATION-TEST-RPC-4-EXZ35F.P1` — order and short-circuit
- [x] `INTEGRATION-TEST-RPC-4-EXZ35F.P2` — loopback bypass
- [x] `INTEGRATION-TEST-RPC-4-EXZ35F.P3` — pre-handshake consequence
- [x] `INTEGRATION-TEST-RPC-4-EXZ35F.P4` — unrelated-session isolation

## INTEGRATION-TEST-RPC-5-ACP2QT

A custom RPC root with the public service shape is recognized structurally and serves requests in both inline and worker hosts.

- Setup: `hasRpcService` and `RemoteRpcProxy.createProxy` on a `CrossModuleRpcService` root; `p2pSetup` with a custom root in inline and worker mode calling `mutexProbe.isLockedAtHandlerEntry`; and an inline client calling `pingService.sum`, `ping` and `fail` on itself and on a peer through `hostRpc`.
- Oracle: The root is recognized and its service proxy is reused across reads; the custom handler enters with the state mutex unlocked in both modes; self and peer sums return the right sum, nonce and requester, a remote `fail` rejects with its message, and the next request on the same session succeeds.
- Specification: [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)

- [x] `INTEGRATION-TEST-RPC-5-ACP2QT.P1` — structural recognition
- [x] `INTEGRATION-TEST-RPC-5-ACP2QT.P2` — inline host
- [x] `INTEGRATION-TEST-RPC-5-ACP2QT.P3` — worker host
- [x] `INTEGRATION-TEST-RPC-5-ACP2QT.P4` — request/error delivery

## INTEGRATION-TEST-RPC-6-009EGG

Each service authorizes its senders and rejects replayed or concurrent duplicate requests in its own handler.

- Setup: Reuses the service-owned tests instead of one shared payload matrix: join signature requests validated by the responder, a duplicate handshake ack after a completed handshake, a second dispute-ack request for an already-acknowledged fork, a stored block re-ingested with an extra non-participant signature, and two concurrent `spectate.startSync` calls for one peer.
- Oracle: Exact joins are signed and invalid requests refused; the duplicate handshake ack gets its sender blacklisted and disconnected, the repeated dispute-ack request gets its sender disconnected; the extra signature is dropped and its sender blacklisted without dropping or replaying the block; the concurrent syncs produce one spectate request on the wire.
- Specification: [`REQ-RPC-3-ZM9WR5` (Service authorization)](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5), [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)

- [x] `INTEGRATION-TEST-RPC-6-009EGG.P3` — join authorization
- [x] `INTEGRATION-TEST-RPC-6-009EGG.P4` — handshake replay
- [x] `INTEGRATION-TEST-RPC-6-009EGG.P5` — dispute replay
- [x] `INTEGRATION-TEST-RPC-6-009EGG.P6` — block authorization
- [ ] `INTEGRATION-TEST-RPC-6-009EGG.P7` — sync authorization
- [x] `INTEGRATION-TEST-RPC-6-009EGG.P8` — block merge
- [x] `INTEGRATION-TEST-RPC-6-009EGG.P9` — sync concurrency

## Gaps

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)
  Partial: neither the `Rpc` envelope nor `InitHandshakeService` carries a protocol version, so an incompatible peer's messages fail through downstream decode or validation errors rather than one deterministic refusal ([`OQ-34-FY08V2` (RPC boundary decisions)](../../../../../specification/open-questions.md#oq-34-fy08v2)).
- [`REQ-RPC-5-CV1R1Y` (Resource bounds)](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y)
  Missing: `ANetworkRpcService` dispatches every authorized request with no central pending-count, aggregate, per-peer, proof-work or signaling-work bound ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5)).
