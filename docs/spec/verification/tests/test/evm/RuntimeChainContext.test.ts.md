# RuntimeChainContext.test.ts

Test file: [test/evm/RuntimeChainContext.test.ts](../../../../../../test/evm/RuntimeChainContext.test.ts)
Exercises: [RuntimeChainContext.ts](../../../../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md)

## Overview

The suite checks provider URL conversion and the client boundary through [real SDK staging](../../../../../../test/fixtures/node/RuntimeChainContextFixture.ts). Startup against an unreachable provider rejects setup with ECONNREFUSED, destroys the host provider once and leaves no partial root registered. Held quiesce and leaveLobby responses use real SDK connections: the client keeps one pending request with no timer, then settles it when the response is released. The same fixture checks the consumer ABI and SDK facet error remain available. These cases do not wait thirty seconds or use a replacement RPC implementation.

Provider cleanup also covers no subscriptions, an active block subscription and repeated destruction through the standard provider API.

## Tests

- `accepts WebSocket URLs and optimistically converts HTTP URLs`: none
- `rejects non-WebSocket-compatible provider URLs`: none
- `destroys the host provider and reports the original startup error`: REQ-RUNTIME-3-VQXW59.T1.P1, INV-RUN-3-1AKG2E.T1.P1
- `lets the host own the quiesce timeout`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P10
- `lets an uncancellable P2P signer mutation outlive the request timeout`: none
- `destroys its provider without subscriptions and permits repeated cleanup`: UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3
- `destroys its provider with a block subscription and permits repeated cleanup`: UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4
- `uses PROVIDER_URL alone when PROVIDER_URLS is unset`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P1, REQ-CHAINOBS-1-5JTHY8.T1.P1
- `uses PROVIDER_URL alone when PROVIDER_URLS is empty`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P2, REQ-CHAINOBS-1-5JTHY8.T1.P2
- `lists PROVIDER_URLS in priority order in place of PROVIDER_URL`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P3, REQ-CHAINOBS-1-5JTHY8.T1.P3
- `rejects a PROVIDER_URLS entry that is not WebSocket-compatible`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P4, REQ-CHAINOBS-1-5JTHY8.T1.P4
- `rejects an endpoint with a fragment, naming it by scheme and host only`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P8
- `rejects an endpoint with an out-of-range port without its secret`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P9
