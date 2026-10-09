# WebRTCMainThreadBridge.ts

> **Source:** [src/rpc/internal/roots/WebRTCMainThreadBridge.ts](../../../../../../../../src/rpc/internal/roots/WebRTCMainThreadBridge.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/rpc/webrtc-setup.md](../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA

Bridged equivalence

- Setup: Drive offer/answer/ICE/close over the port in both channel modes; uninstall mid-flight
- Oracle: Both modes yield equivalent channel behavior; requests settle exactly once; uninstall releases resources

- [x] `UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P1` — transfer mode
- [x] `UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P2` — proxy mode equivalence
- [ ] `UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P3` — close convergence
- [ ] `UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P4` — error propagation via protocol
- [ ] `UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P5` — uninstall mid-flight
