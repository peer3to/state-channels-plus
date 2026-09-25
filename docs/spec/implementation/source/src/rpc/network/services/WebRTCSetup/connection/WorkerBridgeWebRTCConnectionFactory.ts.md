# WorkerBridgeWebRTCConnectionFactory.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/rpc/webrtc-setup.md](../../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8

Port lifecycle and parity

- Setup: Calls before/after port arrival; both channel modes; bridge errors
- Oracle: Pre-port waits resolve on arrival; behavior matches the local factory; errors deserialize

- [ ] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P2` — createOffer parity
- [ ] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P3` — bridge error propagation
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P4` — port loss behavior
- [ ] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P5` — acceptOffer parity
- [ ] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P6` — addIceCandidate parity
- [ ] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P7` — close parity
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P8` — Independent bridge instances: disposing one leaves another usable
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P9` — Accepts a real remote offer and exchanges channel data. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P10` — Keeps missing-peer answer ICE and close operations as no-ops. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P11` — Recovers negotiation after a synchronous post failure. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P12` — Ignores a late negotiation response after an explicit timeout. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P13` — Creates a proxy data channel from bridge channel events. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P14` — Routes bridge state and ICE events to connection callbacks. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P15` — Recursive root disposal is idempotent
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P16` — Delivers real connection changes only to replacement callbacks. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P17` — Ignores retired provider channel callbacks after reconnect. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P18` — Sends only one proxy close while closing and after closure. Use real provider/channel callbacks and verify subsequent traffic or unchanged ownership after the trigger
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P19` — Two inline hosts share one fallback browser worker; disposing the first leaves the second host’s bridge usable
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P20` — Two inline hosts share one fallback browser worker; disposing the second leaves the first host’s bridge usable
- [x] `UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P21` — Broker error endpoint restores its error and an abnormal bridge closure notifies the factory owner
