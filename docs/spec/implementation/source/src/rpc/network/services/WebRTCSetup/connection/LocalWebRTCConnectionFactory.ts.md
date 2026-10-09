# LocalWebRTCConnectionFactory.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)

## UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ

Connection lifecycle

- Setup: Offer/accept/replace/orphan/close per address
- Oracle: Replacement closes prior; orphans no-op; callbacks fire; close deletes

- [ ] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P1` — offer then replace
- [ ] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P2` — accept path
- [ ] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P3` — orphan answer
- [ ] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P4` — close cleanup
- [ ] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P5` — orphan candidate
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P6` — two browser main-thread connections exchange one payload each way through a real RTCPeerConnection
