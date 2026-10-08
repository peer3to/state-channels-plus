# LocalOnlyGuard.test.ts

Test file: [test/rpc/guards/LocalOnlyGuard.test.ts](../../../../../../../test/rpc/guards/LocalOnlyGuard.test.ts)
Exercises: [LocalOnlyGuard.ts](../../../../../implementation/source/src/rpc/network/guards/LocalOnlyGuard.ts.md)

## Overview

The suite runs the production host-only guard on two real harness peers
([LocalOnlyGuardFixture](../../../../../../../test/fixtures/LocalOnlyGuardFixture.ts), built on the E2E
staging in [LocalOnlyGuardE2EFixture](../../../../../../../test/fixtures/LocalOnlyGuardE2EFixture.ts)).
Peer 0 receives and peer 1 calls over the real network session. The negotiating cases hold the
receiver's own handshake initiation, so the caller's transport stays negotiating with its real registered
pre-handshake profile, and the caller sends over the transport it captured while initiating its
handshake. The "neither profile nor proven address" and "proven address without profile" states come from
the harness stub pairs `stubUnregisterHeldHandshakeProfiles` / `stubUnregisterPeerProfile` and
`restoreUnregisteredProfiles`, which unregister the real profile for one call and restore it. The
retired-transport case captures the caller's real inbound request frames with
`stubCaptureInboundRequestFrames` and re-injects one on its closed connection through the network router
entry point with `injectCapturedRequestFrame`, then restores capture with `restoreInboundRequestFrames`.

A record-only observation on the receiver forwards every call unchanged and reads back, per delivery,
the transport's identity state at arrival (proven, negotiating, profile) and afterwards (profile
blacklisted, transport closed and open-connection membership, suppression), the dispatcher's response
attempts, and the response frames sent for that request id on that exact transport. The observation
patches own properties only on the receiver's own transports (those open when it starts, those added
through `p2pManager.addConnection`, and each transport a guarded call arrives on) and deletes them on
restore; it never patches the shared transport prototype. It also reads endpoint invocations, dispatch
and `Failed to send RPC response` error logs, handshake-waiter calls, the stored verdict count, and every
call to the canonical disconnect owner with its tier, reason, and origin: direct, the dispatcher's
response-failure path, or the closed transport's own close bookkeeping. The shared no-response oracle
`expectRejectedWithoutResponse` requires zero response attempts and frames, closed transports, no
invocation, no response-send or dispatch error, no response-failure disconnect, and exactly one direct
`BLACKLIST` decision with the local-only reason per rejected delivery. Callers'
requests are read as settled by the transport closure (`Peer disconnected before RPC response arrived`),
never by a response. The loopback case calls the target through the local RPC proxy.

## Tests

A row lists only permutation IDs this test covers **in full** — partial credit is never recorded. Each
permutation ID is assigned to at most one test across the whole tree.

- `lets a trusted loopback call run its endpoint once without punishment`: REQ-RPC-7-9CBSHK.T2.P1, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P1
- `blacklists and disconnects an authenticated remote request without a failure response`: UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P2
- `blacklists and disconnects an authenticated remote notification without executing it`: UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P3
- `rejects a negotiating transport with a registered profile at once and never replays it`: REQ-RPC-7-9CBSHK.T2.P5, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P4
- `closes a transport with neither a profile nor a proven address without recording a verdict`: REQ-RPC-7-9CBSHK.T2.P6, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P5
- `records an address verdict for a proven address that has no profile`: REQ-RPC-7-9CBSHK.T2.P7, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P6
- `suppresses the response when an earlier guard passes and the local-only guard rejects`: REQ-RPC-7-9CBSHK.T2.P8, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P7
- `keeps an earlier failing guard's rejection response unchanged`: REQ-RPC-7-9CBSHK.T2.P9, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P8
- `marks only the request it rejected as suppressed`: UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P9
- `rejects overlapping calls and a call on the retired transport without executing or deferring`: REQ-RPC-7-9CBSHK.T2.P12, UNIT-TEST-LOCAL-ONLY-GUARD-1-GK4GR8.P10
