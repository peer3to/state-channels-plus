# RpcNodes.test.ts

Test file: [test/evm/RpcNodes.test.ts](../../../../../../test/evm/RpcNodes.test.ts)
Exercises: [RpcNodeProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md), [MultiRpcProvider.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md)

## Overview

Every case except the pure backoff check runs a private Hardhat node per test with one or two
WebSocket proxies in front of it ([fixture](../../../../../../test/fixtures/node/RpcNodesFixture.ts)).
A proxy stands in for a separate endpoint of the same chain: a test cuts its sockets, refuses new
ones, restores it, or holds one method's requests, and the proxy records which methods reached it.
Oracles compare answers with the node's own HTTP answers and check which proxy saw
`eth_getBalance`, `eth_sendRawTransaction` or `eth_subscribe`. Absence checks use a one-second
window as the test input. Transaction receipts are read from the node directly; ethers' receipt
wait is tested once, with two confirmations, after both sockets reconnected. Further cases blackhole a proxy (socket open, nothing forwarded) to prove the heartbeat ends a silent socket, swallow a forwarded transaction's reply before cutting the node, start a second private chain to prove a node on another chain is refused, and destroy or stop the provider with requests in flight or waiting.

Later cases check that a node destroyed during a pending attempt logs nothing and raises no
unhandled rejection (a logger whose entries the test reads), that a heartbeat answered with an
error keeps the socket, that an error answer is returned without failover, that the provider warns
once per outage of every node, that malformed endpoints, an invalid signer secret and a `LOG_QUERY_MAX_BLOCKS` of zero or a fraction open no node,
and that `readLogPages` reads a private chain longer than three windows through a proxy that rejects
wider reads, window by window, and answers the failed window for a retry.

The unsubscribe case removes the last block listener with the proxy holding the node's answer to
the socket's `eth_unsubscribe`, then releases the answer and destroys the provider in the same turn;
no unhandled rejection may surface.

## Tests

- `doubles the reconnect delay from 250 ms up to a 5 s bound`: UNIT-TEST-RPC-NODE-1-VTXH1M.P1, REQ-CHAINOBS-3-N137ZP.T1.P1
- `answers a request held while its node is cut once the node is back`: UNIT-TEST-RPC-NODE-1-VTXH1M.P2
- `hands every reopened socket to its watchers as reopened`: UNIT-TEST-RPC-NODE-1-VTXH1M.P3
- `fails requests at once while its node has never connected`: UNIT-TEST-RPC-NODE-1-VTXH1M.P4
- `keeps reconnecting a node that refused its first connection`: UNIT-TEST-RPC-NODE-1-VTXH1M.P5, REQ-CHAINOBS-3-N137ZP.T1.P3
- `never reconnects after stopReconnecting`: UNIT-TEST-RPC-NODE-1-VTXH1M.P6
- `fails a request held for a reconnect when destroyed`: UNIT-TEST-RPC-NODE-1-VTXH1M.P7
- `sends a transaction to the first node only while it is connected`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P1, REQ-CHAINOBS-2-2NCSQ3.T1.P1
- `fails a transaction over to the next node while the first is cut`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P2, REQ-CHAINOBS-2-2NCSQ3.T1.P2
- `holds a transaction while no node is connected and sends it once one reconnects`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P3, REQ-CHAINOBS-2-2NCSQ3.T1.P5
- `answers reads through the next node while the first is cut`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P4, REQ-CHAINOBS-2-2NCSQ3.T1.P3
- `fails a read over to the next node when the first drops mid-request`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P5, REQ-CHAINOBS-2-2NCSQ3.T1.P4
- `relays each new block once from the node sockets without polling`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P6
- `leaves no unhandled rejection when a node socket's unsubscribe is answered after destroy`: UNIT-TEST-RPC-NODE-1-VTXH1M.P11
- `starts the runtime chain context while one of its nodes is unreachable`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P5, REQ-CHAINOBS-1-5JTHY8.T1.P5
- `fails runtime startup when no node is reachable and names every node`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P6, REQ-CHAINOBS-1-5JTHY8.T1.P6
- `refuses a node that serves another chain than the first connected node`: UNIT-TEST-RPC-NODE-1-VTXH1M.P8, REQ-CHAINOBS-1-5JTHY8.T1.P8
- `marks a node whose socket stops answering as dead and fails the read over`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P12, REQ-CHAINOBS-3-N137ZP.T1.P6
- `fails a transaction over to the next node when the first drops after forwarding it`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P7, REQ-CHAINOBS-2-2NCSQ3.T1.P7
- `resolves a transaction wait from a node socket's block event after a reconnect`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P8, REQ-CHAINOBS-3-N137ZP.T1.P9
- `rejects a read in flight when destroyed`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P9, REQ-CHAINOBS-2-2NCSQ3.T1.P8
- `rejects a read waiting for a node when destroyed`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P10, REQ-CHAINOBS-2-2NCSQ3.T1.P9
- `rejects a read waiting for a node when reconnects stop`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P11, REQ-CHAINOBS-2-2NCSQ3.T1.P10
- `starts the runtime chain context without waiting for a silent node`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P7, REQ-CHAINOBS-1-5JTHY8.T1.P7
- `logs nothing and leaves no unhandled rejection when destroyed during a connection attempt`: UNIT-TEST-RPC-NODE-1-VTXH1M.P9
- `keeps a node whose heartbeat is answered with an error`: UNIT-TEST-RPC-NODE-1-VTXH1M.P10, REQ-CHAINOBS-3-N137ZP.T1.P16
- `passes the first node's error answer to the caller without failing over`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P13, REQ-CHAINOBS-2-2NCSQ3.T1.P11
- `warns once per outage of every node and again after a reconnect`: UNIT-TEST-MULTI-RPC-1-SVGGZ5.P14, REQ-CHAINOBS-2-2NCSQ3.T1.P12
- `rejects startup over a malformed endpoint before any node opens and without its secret`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P10, REQ-CHAINOBS-1-5JTHY8.T1.P9
- `rejects startup over an invalid signer secret without opening a node`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P11, REQ-CHAINOBS-1-5JTHY8.T1.P10
- `reads logs in ascending windows and hands each window over before reading the next`: UNIT-TEST-LOG-PAGES-1-39HC9S.P1, REQ-CHAINOBS-3-N137ZP.T1.P14
- `answers the failed window so a retry reads only from there`: UNIT-TEST-LOG-PAGES-1-39HC9S.P2, REQ-CHAINOBS-3-N137ZP.T1.P15
- `rejects startup over a log window that is not a positive integer without opening a node`: UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P12, REQ-CHAINOBS-1-5JTHY8.T1.P11
