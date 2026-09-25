# WebRTCProvider.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/connection/WebRTCProvider.ts](../../../../../../../../../../src/rpc/network/services/WebRTCSetup/connection/WebRTCProvider.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../../views/architecture/sdk/rpc/webrtc-setup.md), [architecture/sdk/runtime-and-concurrency.md](../../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF

Detection

- Setup: Run with and without a global RTC constructor
- Oracle: Provider returned or absence signaled; no platform sniffing

- [ ] `UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF.P1` — present
- [ ] `UNIT-TEST-WEBRTC-PROVIDER-1-DFS5TF.P2` — absent

## UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS

Provider loading

- Setup: Use the real global constructor or an isolated module environment; assert constructor identity, unchanged import rejection details, unavailable-provider message and Node non-worker result.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P1` — returns the real global WebRTC constructor
- [x] `UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P2` — propagates a rejected provider import without wrapping it
- [x] `UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P3` — keeps the unavailable-provider error for a module without a constructor
- [x] `UNIT-TEST-WEB-RTCPROVIDER-32-GQWRRS.P4` — does not classify the Node global as a browser worker
