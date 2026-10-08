# InitHandshakeLifecycle.test.ts

Test file: [test/rpc/initHandshake/InitHandshakeLifecycle.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts)
Exercises: [P2PManager](../../../../../implementation/source/src/P2PManager.ts.md)

## Overview

Completes real handshakes under all five local statuses and observes connection promotion, the
connection-hook payload, and opened-participant sync. The harness reads completion from the current
transport's authenticated address through
[`HandshakeRpcMethods`](../../../../../../../test/fixtures/customRpc/harnessControl/services/handshake/HandshakeRpcMethods.ts).

## Tests

- `routes a completed handshake from NOT_OPENED without starting sync`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P1, REQ-AUTH-5-BQG9AG.T1.P1
- `routes a completed handshake from OPENED and starts participant sync`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P2, REQ-AUTH-5-BQG9AG.T1.P2
- `routes a completed handshake from SYNCED without starting sync`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P3, REQ-AUTH-5-BQG9AG.T1.P3
- `routes a completed handshake from PENDING_PARTICIPANT without starting sync`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P4, REQ-AUTH-5-BQG9AG.T1.P4
- `routes a completed handshake from PARTICIPATING without starting sync`: UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P5, REQ-AUTH-5-BQG9AG.T1.P5
