# WebRTCSetupRpcMethods.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/WebRTCSetupRpcMethods.ts](../../../../../../../../../src/rpc/network/services/WebRTCSetup/WebRTCSetupRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)

## UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY

Endpoint routing

- Setup: Each endpoint with valid/garbage payloads and missing identity
- Oracle: Delegation on valid; silent ignore otherwise; answer emitted as one-way call

- [ ] `UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY.P1` — offer→answer round
- [ ] `UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY.P2` — garbage offer payload
- [ ] `UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY.P3` — missing identity
- [ ] `UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY.P4` — garbage answer payload
- [ ] `UNIT-TEST-WEBRTC-SETUP-METHODS-1-RNBTQY.P5` — garbage candidate payload
