# WebRTCBridgeService.ts

> **Source:** [src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX

Error round trip

- Setup: Serialize/deserialize varied errors
- Oracle: Message/name preserved; non-Error inputs handled

- [ ] `UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P1` — Error round trip
- [ ] `UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P2` — non-Error input
- [ ] `UNIT-TEST-WEBRTC-BRIDGE-PROTOCOL-1-VF15NX.P3` — unknown message ignored by consumers
