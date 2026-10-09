# E2E-PingService.test.ts

Test file: [test/e2e/E2E-PingService.test.ts](../../../../../../test/e2e/E2E-PingService.test.ts)

## Overview

The empty-request-ID case also sends a subsequent peer request and verifies its result and requester identity, proving the observer returns control to the real router.

The suite proves the custom-RPC extension point and endpoint authorization end to end over real
peer transports. The first case starts two peers with the PingPong manifest loaded by module path,
opens the channel, connects them through the real handshake, and exercises both delivery modes of
the custom services between authenticated peers, targeted by EVM address: fire-and-forget pings in
both directions, where the oracle is the recorded state on the far side (the responder's received
ping nonce, the sender's received pong nonce from the reply, and the relay service's record —
proving the one-way payload arrived intact and triggered the service logic), and a
request/response `sum` call whose typed response (sum, nonce, requester identity) is asserted
exactly alongside the responder's recorded nonce. The second case connects three authenticated
peers, sends an Object-prototype method name in a raw frame, and proves the receiver blacklists
and disconnects only that authenticated sender without invoking service state while the bystander
session remains usable. Two raw-frame cases prove empty-string request correlation and UTF-8
oversized-frame isolation, including exclusion of the oversized authenticated sender.

## Tests

- `should let two peers call custom Ping/Pong RPC services`: INV-RPC-1-SJS2T6.T1.P1, REQ-RPC-1-FF89Z0.T1.P2, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P5, INTEGRATION-TEST-RPC-2-PBZ4QY.P1
- `blacklists a peer that sends an inherited method name without affecting another session`: REQ-RPC-6-E60S4J.T1.P6, INTEGRATION-TEST-RPC-2-PBZ4QY.P3
- `returns one response for an empty request id over the peer transport`: REQ-RPC-1-FF89Z0.T1.P8
- `blacklists a multibyte oversized sender without affecting another session`: REQ-RPC-5-CV1R1Y.T1.P2, INTEGRATION-TEST-RPC-2-PBZ4QY.P4
