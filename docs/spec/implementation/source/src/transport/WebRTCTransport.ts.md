# WebRTCTransport.ts

> **Source:** [src/transport/WebRTCTransport.ts](../../../../../../src/transport/WebRTCTransport.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)

## UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P

Direct-channel send and handshake lifecycle

- Setup: Construct `WebRTCTransport` with a real provider channel and the actual SDK manager router; observe and delegate the real handshake and send operations
- Oracle: Connecting sends wait and flush in order; open starts one handshake and sends directly; closed drops sends

- [x] `UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P1` — connecting sends queue and flush in order on open
- [x] `UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P2` — construction with an open channel starts the handshake
- [x] `UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P3` — a repeated open event does not start another handshake
- [x] `UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P4` — an open channel sends directly
- [x] `UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P5` — a closed channel drops sends
