# test/e2e/E2E-LocalOnlyGuard.test.ts — Test Report

> **Test file:** [test/e2e/E2E-LocalOnlyGuard.test.ts](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [LocalOnlyGuard.ts](../../../../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md)

## Overview

Real SDK peers from the ping-pong E2E harness ([LocalOnlyGuardE2EFixture](../../../../../../test/fixtures/LocalOnlyGuardE2EFixture.ts))
load a custom RPC whose target service installs the production host-only guard, plus a guard-chain
service that runs a real earlier guard first. The suite runs in both harness placements (SDK in a worker
and inline). A peer calls the target on itself over loopback and on another peer over the real network
router, guard, disconnect owner, and transports. Punishment is read through the harness query service:
the receiver records the offender as blacklisted and neither side stays connected. The target's
invocation list proves which calls executed.

The remote-request case runs under the receiver's record-only observation (the same one the unit suite
uses): it patches only the receiver's own transports and matches response frames by request id and exact
transport. The caller's request must settle as `Peer disconnected before RPC response arrived`, that is, by
the closure. The shared no-response oracle `expectRejectedWithoutResponse` must hold for the single
delivery: zero dispatcher response attempts and response frames, a closed transport, no response-send or
dispatch error, no response-failure disconnect, and exactly one direct `BLACKLIST` decision from the guard. The
control case sends a request to the guard-chain endpoint whose earlier guard fails. It reads exactly one
response attempt and one `RPC request rejected by guard` frame, no response-send error, no disconnect
decision of any origin, and no invocation, and the requester stays connected and is not blacklisted.

The notification, overlap, and reconnect cases read outcomes only: the caller's request never resolves
and never carries the guard's rejection error. The negotiating case blocks the receiver's handshake
completion, sends over the transport the sender captured while initiating it, then releases the
handshake. Besides the no-guard-response oracle, it asserts that the outcome is not a timeout, that the
sender's captured pre-handshake transport is closed, that nothing executed, and that the receiver has not
blacklisted the address the sender claims. Before proof the receiver only closes that transport; it
records nothing against the claimed address and bars nothing. The reconnect case reconnects the pair and
waits one discovery period; an unrelated third peer keeps its session and a real ping call succeeds.
Identity-state variants staged by unregistering real profiles belong to the unit suite.

## Tests and covered test IDs

A row lists only permutation IDs this test covers **in full** — partial credit is never recorded. Each
permutation ID is assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                               | Covers                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`E2E: LocalOnlyGuard > runs a local call and blacklists and disconnects a remote requester with no response`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L19) (line 19)            | [`REQ-RPC-7-9CBSHK.T2.P2`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p2)   |
| [`E2E: LocalOnlyGuard > still sends an earlier guard's rejection response to a remote requester and keeps it connected`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L50) (line 50)  | [`REQ-RPC-7-9CBSHK.T2.P13`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p13) |
| [`E2E: LocalOnlyGuard > blacklists and disconnects a remote notification sender without executing it`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L89) (line 89)                    | [`REQ-RPC-7-9CBSHK.T2.P3`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p3)   |
| [`E2E: LocalOnlyGuard > rejects a call over a transport still negotiating its handshake and never replays it`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L102) (line 102)          | [`REQ-RPC-7-9CBSHK.T2.P4`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p4)   |
| [`E2E: LocalOnlyGuard > keeps a recorded blacklist through reconnect attempts while an unrelated peer stays connected`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L153) (line 153) | [`REQ-RPC-7-9CBSHK.T2.P10`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p10) |
| [`E2E: LocalOnlyGuard > completes an overlapping local call while the remote call is barred`](../../../../../../test/e2e/E2E-LocalOnlyGuard.test.ts#L191) (line 191)                           | [`REQ-RPC-7-9CBSHK.T2.P11`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk.t2.p11) |
