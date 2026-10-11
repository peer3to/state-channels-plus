# E2E-CustomRpcRequestResponse.test.ts

Test file: [test/e2e/E2E-CustomRpcRequestResponse.test.ts](../../../../../../test/e2e/E2E-CustomRpcRequestResponse.test.ts)

## Overview

A single large test builds two full `EvmStateMachine.p2pSetup` instances by hand (no shared
harness): it deploys the full contract stack, loads the PingPong custom RPC manifest by module
path (a default export resolved host-side via `resolveCustomRpcManifest`), preselects the channel
through the harness-only selected-key control, opens it, dispatches the detached connection setup, and waits for mutual handshakes using only client-side
`p2pEventHooks` forwarded over the runtime port. It then drives the custom `pingService` entirely from the client through
`hostRpc.<service>.<method>()`: a self-call with no target (loopback on the peer's own host),
request/response in both directions targeted by EVM address with the typed `SumResponse` payload
(sum, nonce, requester) asserted exactly, a fire-and-forget `sendOne` that must resolve without
error, and a remote handler failure that must propagate back across the port as an `Error`
carrying the original message. The oracles are the returned payload values and the error shape;
delivery of the fire-and-forget message and guard/dispatch internals are out of scope (the
PingService suite covers one-way delivery, and the RPC unit suites cover wire shape and
dispatch).

The test quiesces both runtime hosts before returning and requires the detached connect operations
to have settled without errors. Teardown remains leak detection rather than feature cleanup.

Both manager-address connections use `connectStateChannelManager` with the consumer facet ABI. The
client can resolve `deposit`, and a host-side custom RPC calls that consumer function through
`StateManager.stateChannelManagerContract`. The same worker/runtime boundary therefore proves both
runtime sides keep SDK and consumer ABI fragments during a complete two-peer setup.

## Tests

- `lets an inline client drive self and peer RPC with failure recovery`: REQ-RPC-1-FF89Z0.T1.P1, UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P1, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P4, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P11, UNIT-TEST-RPC-HANDLER-1-8BP2K8.P15, INTEGRATION-TEST-RPC-5-ACP2QT.P4, UNIT-TEST-MANAGER-BINDING-1-WB503Z.P8
- `lets a worker client drive self and peer RPC with failure recovery`: none
