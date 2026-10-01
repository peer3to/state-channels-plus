# E2E-MultiRpcNodes.test.ts — Test Report

> **Test file:** [test/e2e/E2E-MultiRpcNodes.test.ts](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts) > **Status:** Authored; engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A three-peer session where one peer reaches the single test node through harness-owned WebSocket
proxies (`rpcNodeProxiesByPeer`). Cutting a proxy drops that peer's sockets only; the node and the
other peers are untouched. The first case cuts the peer's only endpoint, lets another peer top up
on chain, checks the cut peer has not seen it, restores the endpoint and waits until the reconnect
catch-up applies the inbound message exactly once. The second case gives the peer two endpoints:
one event is streamed by both, then the first endpoint is cut and the peer itself prepares and
sends a top-up through the second one; the handler count shows each event once and the second
proxy received the transaction. A third case holds the reconnect's catch-up read at the proxy while a
newer event reaches the reopened subscription live, then releases the read and checks both events
were processed once. A fourth case makes the first catch-up read fail and checks the missed event
still arrives through a retry while the node stays connected. Exactly-once checks wait for the
peer's scheduled events to drain before comparing counts.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Multiple RPC nodes > delivers an event emitted while the peer's only RPC node was cut through the reconnect catch-up`](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts#L15) (line 15)         | [`REQ-CHAINOBS-3-N137ZP.T1.P5`](../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp.t1.p5)                                                                                                                      |
| [`E2E: Multiple RPC nodes > delivers every event exactly once and keeps sending through the second RPC node when the first is cut`](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts#L138) (line 138) | [`INV-CHAINOBS-1-ASVKC1.T1.P7`](../../../../specification/runtime/chain-observation.md#inv-chainobs-1-asvkc1.t1.p7), [`REQ-CHAINOBS-2-2NCSQ3.T1.P6`](../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3.t1.p6) |
| [`E2E: Multiple RPC nodes > delivers the event missed while cut when a newer event arrives during the catch-up read`](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts#L56) (line 56)                 | [`REQ-CHAINOBS-3-N137ZP.T1.P7`](../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp.t1.p7)                                                                                                                      |
| [`E2E: Multiple RPC nodes > retries a failed catch-up read while the node stays connected`](../../../../../../test/e2e/E2E-MultiRpcNodes.test.ts#L103) (line 103)                                         | [`REQ-CHAINOBS-3-N137ZP.T1.P8`](../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp.t1.p8)                                                                                                                      |
