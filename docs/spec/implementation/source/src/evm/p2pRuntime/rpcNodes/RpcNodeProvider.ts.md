# RpcNodeProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts)

## Requirements

- [`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)
- [`REQ-CHAINOBS-3-N137ZP` (Manager events from the storage diff service, through connection loss)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
- [`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-RPCMIRROR-4-H35NFC` (A read is never older than a block the peer already saw)](../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-4-h35nfc)

## UNIT-TEST-RPC-NODE-1-VTXH1M

Connection lifecycle of one endpoint

- Setup: A real private node behind a cuttable WebSocket proxy; cut, restore, stop and destroy.
- Oracle: Requests answer correctly after a reconnect; watchers see each reopened socket; no reconnect after stopReconnecting; no request hangs after destroy.

- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P1` — backoff values and cap
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P2` — request held while cut answers after restore
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P3` — reopened socket handed to watchers
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P4` — never-connected node fails at once
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P5` — refused first connection keeps retrying
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P6` — no reconnect after stopReconnecting
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P7` — destroy fails a held request
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P8` — node on another chain refused
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P9` — destroyed during a pending attempt: no log, no unhandled rejection
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P10` — heartbeat answered with an error keeps the socket
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P11` — a socket's unsubscribe answered after destroy: no unhandled rejection
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P12` — a socket's unsubscribe answered with an error by a live node: no unhandled rejection, reads continue
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P13` — a socket's `eth_subscribe` cancelled by the provider's destroy right after a log subscription: no unhandled rejection
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P14` — a socket to a node that serves no Ethereum RPC opens once the node answers the heartbeat request, without asking its chain id
- [x] `UNIT-TEST-RPC-NODE-1-VTXH1M.P15` — a socket to a node that serves no Ethereum RPC reopens after a cut without asking its chain id, and a request held meanwhile is answered
