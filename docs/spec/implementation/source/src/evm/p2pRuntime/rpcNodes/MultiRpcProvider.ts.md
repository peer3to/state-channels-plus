# MultiRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts)

## Requirements

- [`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)
- [`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8)

## UNIT-TEST-MULTI-RPC-1-SVGGZ5

Request routing and failover

- Setup: Two real nodes behind cuttable proxies of one private chain; reads, transactions, block subscriptions and contract-log subscriptions on a log-emitting contract.
- Oracle: The proxies record which node received each method; answers equal the node's own; no transaction reaches a second node while the first is connected; block events and logs come from the node sockets without polling, each once, as logs bound to this provider; removing the last log listener sends one `eth_unsubscribe` to every node.

- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P1` — transaction to the first node only
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P2` — transaction fails over while the first is cut
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P3` — transaction waits while no node is connected
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P4` — read fails over while the first is cut
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P5` — read in flight when the first node drops
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P6` — each block relayed once without polling
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P7` — transaction in flight when the first node drops after forwarding it
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P8` — transaction wait resolves from a reopened socket
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P9` — destroy rejects a request in flight
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P10` — destroy rejects a waiting request
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P11` — stopReconnecting rejects a waiting request
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P12` — silent node marked dead and the read failed over
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P13` — first node's error answer returned without failover
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P14` — one warning per outage of every node, again after a reconnect
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P15` — each matching log relayed once from both node sockets, bound to the provider, with no `eth_newFilter`
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P16` — logs keep coming through the second node socket after the first node drops, each once
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P17` — removing the last log listener unsubscribes every node socket with no unhandled rejection and leaves no listener
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P18` — a log 128 or more blocks below the highest delivered log is not relayed, and a log 127 blocks below it is
