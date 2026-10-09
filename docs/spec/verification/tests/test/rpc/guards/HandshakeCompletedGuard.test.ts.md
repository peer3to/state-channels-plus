# HandshakeCompletedGuard.test.ts

Test file: [test/rpc/guards/HandshakeCompletedGuard.test.ts](../../../../../../../test/rpc/guards/HandshakeCompletedGuard.test.ts)
Exercises: [HandshakeCompletedGuard.ts](../../../../../implementation/source/src/rpc/network/guards/HandshakeCompletedGuard.ts.md)

## Overview

The suite drives the production authenticated-RPC guard inside a worker-hosted runtime with concrete
transports, profiles, a real service, controlled exact-transport handshake completion, replacement
grace overlap, retirement, late dispatch after close, timeout, and manager disposal. The closed-
transport case proves local retirement cannot execute the frame or punish a healthy replacement.
The real-shutdown case defers a guarded call on a negotiating transport onto the real handshake wait, then
runs `StateManager.stop`, which settles that wait with `false` before the P2P manager is disposed; it asserts
the call never ran, the transport was not closed, and no blacklist or retry-bound strike was recorded.
The request-during-negotiation case uses the real pending-request correlation path and proves no
premature guard response is sent: the caller settles only after the queued RPC replays once. The
two waiter-expiry cases read the strike count and the suspension rather than the profile verdict, which is the oracle
separating an expired deadline from proven misconduct; the non-negotiating case still reads the
recorded verdict. The disposal case starts a handshake wait on a fresh transport that never
authenticates, with a 600-second timeout far beyond the test timeout, awaits the runtime RPC root's real
shutdown hook `localRpc.dispose()` (the harness root's override only releases staged holds and then calls
`MainRpcService.dispose()`), then waits again on the same transport; both waits must return `false`, so
only disposal can have settled them in time. It does not read the order of the later negotiation and lobby
cleanup.

## Tests

- `passes a transport with a completed peer profile`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P1
- `queues fire-and-forget calls behind one waiter and replays them in order`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P2
- `holds a request response until the queued RPC replays`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P3
- `disconnects and blacklists a non-negotiating unverified peer`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P4, INTEGRATION-TEST-RPC-4-EXZ35F.P3
- `clears a timed-out queue and starts a fresh waiter for a later call`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P5, UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P6
- `isolates queues and waiters between transports`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P7
- `rejects unauthenticated profiles through both addressless punishment branches`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P8, UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P9
- `uses a custom failure handler without built-in punishment`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P10
- `drops queued calls when their transport retires before authentication completes`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P11, REQ-RPC-7-9CBSHK.T1.P6
- `drops queued calls when a disposed owner receives late authentication success`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P12, REQ-RPC-7-9CBSHK.T1.P7
- `does not punish after a disposed owner's authentication waiter fails`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P13, REQ-RPC-7-9CBSHK.T1.P8
- `settles a pending handshake wait and every later wait as not completed once the runtime RPC root is disposed`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P19, UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P9
- `does not revive a timed-out queue after late authentication`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P14, REQ-RPC-7-9CBSHK.T1.P9
- `allows guarded RPCs on an authenticated transport during replacement grace`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P15, REQ-RPC-7-9CBSHK.T1.P10, REQ-UPG-2-WH7BC7.T1.P5
- `releases a queued RPC only when its exact transport authenticates`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P16, REQ-RPC-7-9CBSHK.T1.P11
- `drops a late frame dispatched after its authenticated transport closes`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P17, REQ-RPC-7-9CBSHK.T1.P12
- `suspends an identity on the expired waiter that reaches its retry bound`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P18
- `drops a deferred guarded RPC without disconnect, verdict or strike when a real shutdown settles its handshake wait`: UNIT-TEST-HANDSHAKE-GUARD-1-XHFSXX.P19
