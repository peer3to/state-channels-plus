# test/e2e/E2E-PingService.test.ts — Test Report

> **Test file:** [test/e2e/E2E-PingService.test.ts](../../../../../../test/e2e/E2E-PingService.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

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

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: PingPongService (custom RPC) > should let two peers call custom Ping/Pong RPC services`](../../../../../../test/e2e/E2E-PingService.test.ts#L18) (line 18)                                 | [`INV-RPC-1-SJS2T6.T1.P1`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6.t1.p1), [`REQ-RPC-1-FF89Z0.T1.P2`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0.t1.p2), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P5`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p5), [`INTEGRATION-TEST-RPC-2-PBZ4QY.P1`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-2-pbz4qy.p1) |
| [`E2E: PingPongService (custom RPC) > blacklists a peer that sends an inherited method name without affecting another session`](../../../../../../test/e2e/E2E-PingService.test.ts#L96) (line 96) | [`REQ-RPC-6-E60S4J.T1.P6`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j.t1.p6), [`INTEGRATION-TEST-RPC-2-PBZ4QY.P3`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-2-pbz4qy.p3)                                                                                                                                                                                                                                              |
| [`E2E: PingPongService (custom RPC) > returns one response for an empty request id over the peer transport`](../../../../../../test/e2e/E2E-PingService.test.ts#L144) (line 144)                  | [`REQ-RPC-1-FF89Z0.T1.P8`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0.t1.p8)                                                                                                                                                                                                                                                                                                                                                                                      |
| [`E2E: PingPongService (custom RPC) > blacklists a multibyte oversized sender without affecting another session`](../../../../../../test/e2e/E2E-PingService.test.ts#L170) (line 170)             | [`REQ-RPC-5-CV1R1Y.T1.P2`](../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y.t1.p2), [`INTEGRATION-TEST-RPC-2-PBZ4QY.P4`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-2-pbz4qy.p4)                                                                                                                                                                                                                                              |
