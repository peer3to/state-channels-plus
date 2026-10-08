# MultiRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts)
>
> **Design views:** [runtime/chain-observation.md](../../../../../views/runtime/chain-observation.md)

## Requirements

- [`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)

## UNIT-TEST-MULTI-RPC-1-SVGGZ5

Request routing and failover

- Setup: Two real nodes behind cuttable proxies of one private chain; reads, transactions and block subscriptions.
- Oracle: The proxies record which node received each method; answers equal the node's own; no transaction reaches a second node while the first is connected; block events come without polling.

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
