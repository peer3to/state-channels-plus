# test/e2e/E2E-PingService.test.ts — Test Report

> **Test file:** [test/e2e/E2E-PingService.test.ts](../../../../../../test/e2e/E2E-PingService.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single test proves the custom-RPC extension point end to end over real peer transports: the
`PeerTestHarness` starts two peers with the PingPong manifest loaded by module path, opens the
channel, and connects them through the real handshake. It then exercises both delivery modes of
the custom services between authenticated peers, targeted by EVM address: fire-and-forget pings in
both directions, where the oracle is the recorded state on the far side (the responder's received
ping nonce, the sender's received pong nonce from the reply, and the relay service's record —
proving the one-way payload arrived intact and triggered the service logic), and a
request/response `sum` call whose typed response (sum, nonce, requester identity) is asserted
exactly alongside the responder's recorded nonce. Wire-format validation, guard ordering, and the
runtime-port crossing are out of scope — the services here run over the harness's loopback
`hostRpc` and network transports; `E2E-CustomRpcRequestResponse` owns the runtime-port variant.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                  | Covers                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`E2E: PingPongService (custom RPC) > should let two peers call custom Ping/Pong RPC services`](../../../../../../test/e2e/E2E-PingService.test.ts#L19) (line 19) | [`REQ-RPC-1-FF89Z0.T1.P2`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0.t1.p2) |
