# RpcNodeProvider.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts)
>
> **Design views:** [runtime/chain-observation.md](../../../../../views/runtime/chain-observation.md)

## Requirements

- [`REQ-CHAINOBS-2-2NCSQ3` (One endpoint per request, with failover)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3)
- [`REQ-CHAINOBS-3-N137ZP` (Per-endpoint observation with reconnect and catch-up)](../../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)

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
