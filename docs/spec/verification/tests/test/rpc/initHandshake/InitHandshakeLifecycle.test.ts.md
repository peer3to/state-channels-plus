# InitHandshakeLifecycle.test.ts — Verification Report

> **Test file:** [test/rpc/initHandshake/InitHandshakeLifecycle.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [P2PManager](../../../../../implementation/source/src/P2PManager.ts.md)

## Overview

Completes real handshakes under all five local statuses and observes connection promotion, the
connection-hook payload, and opened-participant sync. The harness reads completion from the current
transport's authenticated address through
[`HandshakeRpcMethods`](../../../../../../../test/fixtures/customRpc/harnessControl/services/handshake/HandshakeRpcMethods.ts).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InitHandshake lifecycle routing > routes a completed handshake from NOT_OPENED without starting sync`](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts#L17) (line 17)          | [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P1`](../../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p1), [`REQ-AUTH-5-BQG9AG.T1.P1`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t1.p1) |
| [`InitHandshake lifecycle routing > routes a completed handshake from OPENED and starts participant sync`](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts#L26) (line 26)        | [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P2`](../../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p2), [`REQ-AUTH-5-BQG9AG.T1.P2`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t1.p2) |
| [`InitHandshake lifecycle routing > routes a completed handshake from SYNCED without starting sync`](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts#L35) (line 35)              | [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P3`](../../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p3), [`REQ-AUTH-5-BQG9AG.T1.P3`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t1.p3) |
| [`InitHandshake lifecycle routing > routes a completed handshake from PENDING_PARTICIPANT without starting sync`](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts#L44) (line 44) | [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P4`](../../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p4), [`REQ-AUTH-5-BQG9AG.T1.P4`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t1.p4) |
| [`InitHandshake lifecycle routing > routes a completed handshake from PARTICIPATING without starting sync`](../../../../../../../test/rpc/initHandshake/InitHandshakeLifecycle.test.ts#L55) (line 55)       | [`UNIT-TEST-HANDSHAKE-ROUTING-1-XAEYM2.P5`](../../../../../implementation/source/src/P2PManager.ts.md#unit-test-handshake-routing-1-xaeym2.p5), [`REQ-AUTH-5-BQG9AG.T1.P5`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t1.p5) |
