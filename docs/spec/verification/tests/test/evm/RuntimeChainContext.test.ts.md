# test/evm/RuntimeChainContext.test.ts — Test Report

> **Test file:** [test/evm/RuntimeChainContext.test.ts](../../../../../../test/evm/RuntimeChainContext.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [RuntimeChainContext.ts](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite covers the chain-facing edges of the p2p runtime: URL policy, startup failure, and
client-side request timeouts. `resolveWebSocketProviderUrl` is called directly (ws/wss accepted,
http/https optimistically converted, anything else throws). The startup case runs the real
`startP2pRuntimeHost` against a deliberately unreachable provider URL and asserts the original
connection error (not a timeout) is thrown to the host caller and rejected to the paired
`P2pRuntimeClient.ready`, with the host's `WebSocketProvider.destroy` called exactly once. Two
fake-timer cases pair a real client with a scripted host port: `quiesce` must not be failed by a
client-side timer (the host owns the quiesce timeout), and an uncancellable P2P signer
`sendTransaction` mutation outlives the 30s request timeout and still resolves with the local
p2p result. The startup case demonstrates the runtime lifecycle startup-phase-failure
permutation and the host-construction-failure invariant's valid case. Full host request-surface
behavior (inline/worker equivalence, disposal settlement, signing confinement) is out of scope,
so the remaining host-protocol permutations stay unassigned.

All three manager payloads serialize `stateChannelManagerAbi`, the same combined ABI production
sends across the worker port. Host reconstruction therefore retains proxy and facet error fragments.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                        | Covers                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`RuntimeChainContext > accepts WebSocket URLs and optimistically converts HTTP URLs`](../../../../../../test/evm/RuntimeChainContext.test.ts#L19) (line 19)            | —                                                                                                                                                                                                                                          |
| [`RuntimeChainContext > rejects non-WebSocket-compatible provider URLs`](../../../../../../test/evm/RuntimeChainContext.test.ts#L34) (line 34)                          | —                                                                                                                                                                                                                                          |
| [`RuntimeChainContext > destroys the host provider and reports the original startup error`](../../../../../../test/evm/RuntimeChainContext.test.ts#L40) (line 40)       | [`REQ-RUNTIME-3-VQXW59.T1.P1`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p1), [`INV-RUN-3-1AKG2E.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#inv-run-3-1akg2e.t1.p1) |
| [`RuntimeChainContext > lets the host own the quiesce timeout`](../../../../../../test/evm/RuntimeChainContext.test.ts#L107) (line 107)                                 | —                                                                                                                                                                                                                                          |
| [`RuntimeChainContext > lets an uncancellable P2P signer mutation outlive the request timeout`](../../../../../../test/evm/RuntimeChainContext.test.ts#L168) (line 168) | —                                                                                                                                                                                                                                          |
