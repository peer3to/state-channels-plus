# WebRTCSetupService.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../../../../../src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts)
>
> **Design views:** [architecture/sdk/rpc/webrtc-setup.md](../../../../../../views/architecture/sdk/rpc/webrtc-setup.md)

## Requirements

- [`INV-UPG-1-KW2A02` (Best-effort with no protocol effect)](../../../../../../../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02)
- [`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)
  Partial: [`DEF-11-JN8N6H`](../../../../../../../audit/open-findings.md#def-11-jn8n6h) unfiltered ICE targets; map-entry leak without close.
- [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)
- [`REQ-UPG-3-T1SRMS` (Single deterministic initiator)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms)

## UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H

Signaling inertness and binding

- Setup: Run success/garbage/failing signaling during live traffic; concurrent offers; orphan candidates; mismatched payload identities
- Oracle: Protocol state untouched in every case; binding follows the session; replacement closes prior; orphans ignored; [`DEF-11-JN8N6H`](../../../../../../../audit/open-findings.md#def-11-jn8n6h) documented

- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P1` — success inert until cutover
- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P2` — garbage ignored
- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P3` — replacement closes prior
- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P4` — orphan candidate
- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P5` — payload-identity inert
- [ ] `UNIT-TEST-WEBRTC-SETUP-SERVICE-1-9QST0H.P6` — hostile ICE target (documents [`DEF-11-JN8N6H`](../../../../../../../audit/open-findings.md#def-11-jn8n6h))
