# test/evm/RuntimeChainContext.test.ts — Test Report

> **Test file:** [test/evm/RuntimeChainContext.test.ts](../../../../../../test/evm/RuntimeChainContext.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [RuntimeChainContext.ts](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite checks provider URL conversion and the client boundary through [real SDK staging](../../../../../../test/fixtures/node/RuntimeChainContextFixture.ts). Startup against an unreachable provider rejects setup with ECONNREFUSED, destroys the host provider once and leaves no partial root registered. Held quiesce and leaveLobby responses use real SDK connections: the client keeps one pending request with no timer, then settles it when the response is released. The same fixture checks the consumer ABI and SDK facet error remain available. These cases do not wait thirty seconds or use a replacement RPC implementation.

Provider cleanup also covers no subscriptions, an active block subscription and repeated destruction through the standard provider API.

## Tests and covered test IDs

| Test                                                                                                                                                                       | Covers                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`RuntimeChainContext > accepts WebSocket URLs and optimistically converts HTTP URLs`](../../../../../../test/evm/RuntimeChainContext.test.ts#L16) (line 16)               | —                                                                                                                                                                                                                                    |
| [`RuntimeChainContext > rejects non-WebSocket-compatible provider URLs`](../../../../../../test/evm/RuntimeChainContext.test.ts#L31) (line 31)                             | —                                                                                                                                                                                                                                    |
| [`RuntimeChainContext > destroys the host provider and reports the original startup error`](../../../../../../test/evm/RuntimeChainContext.test.ts#L37) (line 37)          | [`REQ-RUNTIME-3-VQXW59.T1.P1`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p1), [`INV-RUN-3-1AKG2E.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#inv-run-3-1akg2e) |
| [`RuntimeChainContext > lets the host own the quiesce timeout`](../../../../../../test/evm/RuntimeChainContext.test.ts#L41) (line 41)                                      | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P10`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z)                                                                                 |
| [`RuntimeChainContext > lets an uncancellable P2P signer mutation outlive the request timeout`](../../../../../../test/evm/RuntimeChainContext.test.ts#L45) (line 45)      | —                                                                                                                                                                                                                                    |
| [RuntimeChainContext > destroys its provider without subscriptions and permits repeated cleanup](../../../../../../test/evm/RuntimeChainContext.test.ts#L10) (line 10)     | [`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3`](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md#unit-test-runtime-chain-cleanup-1-3h7pt8)                                                             |
| [RuntimeChainContext > destroys its provider with a block subscription and permits repeated cleanup](../../../../../../test/evm/RuntimeChainContext.test.ts#L13) (line 13) | [`UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4`](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md#unit-test-runtime-chain-cleanup-1-3h7pt8)                                                             |
