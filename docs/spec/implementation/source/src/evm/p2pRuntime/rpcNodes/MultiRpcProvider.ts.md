# MultiRpcProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts)

## Requirements

- [`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)
  Partial: `forward` fails over only on a dropped socket, on a read's internal error without revert data and on the latest block read answered with no block (one more pass after `MISSING_LATEST_BLOCK_RETRY_MS` when every node answers it so); a node's rate-limit answer or an answer from a node behind the requested block is final, and fatal for the runtime ([`FIND-RPC-8-59FKS6`](../../../../../../audit/open-findings.md#find-rpc-8-59fks6)).
- [`REQ-MIRROR-5-N5SZC9` (With proven chain reads, the chain answers alone)](../../../../../../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9)
- [`REQ-LC-11-MTCBF9` (With the reads compared, each answer is checked against the endpoint's at its…)](../../../../../../specification/runtime/light-client.md#req-lc-11-mtcbf9)
- [`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8)
- [`REQ-LC-1-JT5PKT` (Reads at the latest block are answered from proven state of one block)](../../../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt)
- [`REQ-LC-8-BBYC51` (A participant follows the channel it has selected)](../../../../../../specification/runtime/light-client.md#req-lc-8-bbyc51)

## UNIT-TEST-MULTI-RPC-1-SVGGZ5

Request routing and failover

- Setup: Two real nodes behind cuttable proxies of one private chain; reads, transactions, block subscriptions and contract-log subscriptions on a log-emitting contract; a proxy can answer a request, unforwarded, with the JSON-RPC internal error, without revert data or carrying revert data `0x` as Hardhat answers a revert; a proxy can answer a method, unforwarded, with a fixed result once or every time; a proxy can be cut while the other answers; a manual-seal node holding a sealed contract that stores its creation timestamp, with the wall clock past that second.
- Oracle: The proxies record which node received each method; answers equal the node's own; no transaction reaches a second node while the first is connected, also when the first answers it with its internal error; a read answered with the internal error without revert data goes to the next connected node, and with no other node connected it rejects at once; an internal error carrying revert data is final; the latest block read answered with no block goes to the next node, gets one more pass when every node answers it so, and then rejects, while a block read by an unmined number answered with no block is the answer; block events and logs come from the node sockets without polling, each once, as logs bound to this provider; removing the last log listener sends one `eth_unsubscribe` to every node; a gas estimate names the pending block, so a call valid only after the latest block's second estimates; a call only the pending block reverts is estimated at the latest block, and one both blocks revert rejects with the pending block's revert, unless the pending estimate was the node's internal error without revert data: then the latest block's revert; the fallback holds for an estimate carrying the sender's pending nonce.

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
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P13` — first node's error answer, other than its internal error, returned without failover
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P14` — one warning per outage of every node, again after a reconnect
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P15` — each matching log relayed once from both node sockets, bound to the provider, with no `eth_newFilter`
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P16` — logs keep coming through the second node socket after the first node drops, each once
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P17` — removing the last log listener unsubscribes every node socket with no unhandled rejection and leaves no listener
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P18` — a log 128 or more blocks below the highest delivered log is not relayed, and a log 127 blocks below it is
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P19` — a call answered with the first node's internal error fails over to the second node
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P20` — a call answered with every node's internal error rejects with it as a `CALL_EXCEPTION`
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P21` — a transaction answered with the first node's internal error rejects with it, and the second node never receives it
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P22` — a call answered with the first node's internal error carrying revert data rejects as a `CALL_EXCEPTION`, and the second node is not asked
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P23` — a call answered with the first node's internal error while the second node is cut rejects as a `CALL_EXCEPTION` within the absence window, without waiting for a reconnect
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P24` — the latest block read answered with no block by the first node fails over to the second node
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P25` — the latest block read answered with no block by both nodes once is answered on a second pass
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P26` — the latest block read answered with no block by both nodes twice rejects as `UNKNOWN_ERROR`
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P27` — a block read by an unmined number answered with no block is returned, and the second node is not asked
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P28` — a latest block read answered with no block by the first node and with the internal error by the second rejects with the internal error, without a second pass
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P29` — a gas estimate names the pending block and succeeds for a call valid only after the latest block's second
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P30` — a call only the pending block reverts is estimated at the latest block
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P31` — a call both blocks revert rejects as `CALL_EXCEPTION` with the pending block's revert
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P33` — a node that answers the pending estimate with its internal error and no revert data gives no verdict: the estimate rejects with the latest block's revert and its data
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P32` — an estimate carrying the sender's managed nonce while its own transaction is unsealed falls back to the latest block
- [x] `UNIT-TEST-MULTI-RPC-1-SVGGZ5.P34` — the network is the serving node's: no node is asked for the chain id beyond its socket's own detection
