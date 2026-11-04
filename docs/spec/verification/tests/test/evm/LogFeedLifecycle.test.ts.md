# LogFeedLifecycle.test.ts

Test file: [test/evm/LogFeedLifecycle.test.ts](../../../../../../test/evm/LogFeedLifecycle.test.ts)
Exercises: [LogFeed.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/mirror/LogFeed.ts.md)

## Overview

Each case builds a `MirrorRpcProvider` over an isolated anvil test chain with a real storage diff service following it, behind recording proxies, and watches a `ValueSet` emitter through the provider's log feed. The cases cut and restore the service connection and count the logs handed on and the `scp_subscribeContractStorage` requests; stop the last watch, cut the service again and count the requests that follow; destroy the provider with a watch and a block subscription open and count the proxies' open sockets and the unhandled rejections; hold a watch's catch-up reply, destroy the provider and count the feed's failed-read warnings on a provider whose logger records them; and cut the only node and wait for a log to arrive anyway.

## Tests

- `hands on each log once and subscribes again when the service connection is cut and restored`: REQ-CHAINOBS-3-N137ZP.T1.P2, INV-CHAINOBS-1-ASVKC1.T1.P4
- `does not reopen the service connection after the last log watch is gone`: UNIT-TEST-LOG-FEED-1-QE0G60.P1
- `closes its sockets to the service and to the node when it is destroyed with a log watch and a block subscription, and leaves no unhandled rejection`: UNIT-TEST-LOG-FEED-1-QE0G60.P2
- `stops retrying a log read that was in flight when the provider was destroyed`: UNIT-TEST-LOG-FEED-1-QE0G60.P3
- `keeps handing on logs while every node is cut`: REQ-CHAINOBS-3-N137ZP.T1.P46
