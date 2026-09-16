# test/rpc/initHandshake/InitHandshakeSuspension.test.ts — Test Report

> **Test file:** [test/rpc/initHandshake/InitHandshakeSuspension.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [InitHandshakeService.ts](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the real handshake inside a worker-hosted runtime over a recording Holepunch
socket, so each case is a genuine wire exchange rather than a stubbed call. Constructing the
transport starts the node's own challenge; the probe then answers it, refuses it, leaves it
unanswered, or has the router reject the pending request as a closed transport, which is how the
four request-leg failure causes are reached. Every oracle reads the peer-info ban calls, the
socket's destroyed flag and the profile's blacklist and suspension flags separately, so a
suspension can never be mistaken for a penalty and a missing close is visible. The
refusal-ordering case records how many frames had been written when the socket was destroyed and
compares that with the index of the error response, which fails if the transport is closed before
the refusal reaches the wire.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                       | Covers                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`InitHandshake suspension policy > suspends a verified peer whose handshake ack never arrives`](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts#L24) (line 24)            | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P10`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p10), [`REQ-AUTH-4-JWCF71.T1.P2`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p2)                                                                                    |
| [`InitHandshake suspension policy > suspends a peer that never answers the handshake challenge`](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts#L41) (line 41)            | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P6`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p6)                                                                                                                                                                                                        |
| [`InitHandshake suspension policy > suspends a peer that refuses the handshake challenge`](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts#L55) (line 55)                  | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P11`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p11), [`REQ-AUTH-4-JWCF71.T1.P5`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p5)                                                                                    |
| [`InitHandshake suspension policy > sends the skew refusal before closing the connection`](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts#L69) (line 69)                  | [`UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P8`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeRpcMethods.ts.md#unit-test-init-handshake-methods-1-2739t4.p8), [`REQ-AUTH-4-JWCF71.T1.P6`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p6)                                                                                   |
| [`InitHandshake suspension policy > suspends nothing when the connection is gone before the response`](../../../../../../../test/rpc/initHandshake/InitHandshakeSuspension.test.ts#L87) (line 87)      | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P12`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p12), [`REQ-AUTH-4-JWCF71.T1.P8`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p8)                                                                                    |

[`REQ-AUTH-4-JWCF71.T1.P3`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p3)
(a penalized identity refused at verification) has no covering declaration anywhere yet.
