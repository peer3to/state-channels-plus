# WebRTCConnectionFactory.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../../views/architecture/sdk/rpc/webrtc-setup.md), [architecture/sdk/runtime-and-concurrency.md](../../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)

## UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM

Native provider selection

- Setup: RTC provider present / unavailable
- Oracle: Local factory or explicit error respectively

- [ ] `UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P1` — in-context
- [ ] `UNIT-TEST-WEBRTC-FACTORY-SELECT-1-36A0WM.P3` — unavailable provider rejects
