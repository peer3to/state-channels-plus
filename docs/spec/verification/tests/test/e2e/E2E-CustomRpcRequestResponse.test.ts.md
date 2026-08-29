# test/e2e/E2E-CustomRpcRequestResponse.test.ts — Test Report

> **Test file:** [test/e2e/E2E-CustomRpcRequestResponse.test.ts](../../../../../../test/e2e/E2E-CustomRpcRequestResponse.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single large test builds two full `EvmStateMachine.p2pSetup` instances by hand (no shared
harness): it deploys the full contract stack, loads the PingPong custom RPC manifest by module
path (a default export resolved host-side via `resolveCustomRpcManifest`), opens a channel, and
waits for mutual handshakes using only client-side `p2pEventHooks` forwarded over the runtime
port. It then drives the custom `pingService` entirely from the client through
`hostRpc.<service>.<method>()`: a self-call with no target (loopback on the peer's own host),
request/response in both directions targeted by EVM address with the typed `SumResponse` payload
(sum, nonce, requester) asserted exactly, a fire-and-forget `sendOne` that must resolve without
error, and a remote handler failure that must propagate back across the port as an `Error`
carrying the original message. The oracles are the returned payload values and the error shape;
delivery of the fire-and-forget message and guard/dispatch internals are out of scope (the
PingService suite covers one-way delivery, and the RPC unit suites cover wire shape and
dispatch).

Both manager-address connections use `connectStateChannelManager` with the consumer facet ABI. The
client can resolve `deposit`, and a host-side custom RPC calls that consumer function through
`StateManager.stateChannelManagerContract`. The same worker/runtime boundary therefore proves both
runtime sides keep SDK and consumer ABI fragments during a complete two-peer setup.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: custom RPC request/response over the runtime port > lets a client drive hostRpc.request()/sendOne() across the port (self + peer)`](../../../../../../test/e2e/E2E-CustomRpcRequestResponse.test.ts#L120) (line 120) | [`REQ-RPC-1-FF89Z0.T1.P1`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0.t1.p1), [`REQ-RUN-8-A4B4SA.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-8-a4b4sa.t1.p1), [`UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P1`](../../../../implementation/source/src/rpc/resolveCustomRpcManifest.ts.md#unit-test-resolve-custom-rpc-1-tq6bp6.p1), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P4`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p4), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P11`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p11), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P15`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p15), [`INTEGRATION-TEST-RPC-5-ACP2QT.P4`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-5-acp2qt.p4), [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P8`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p8) |
