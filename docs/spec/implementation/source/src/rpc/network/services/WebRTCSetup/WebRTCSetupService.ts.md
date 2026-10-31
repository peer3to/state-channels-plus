# WebRTCSetupService.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../../../../../src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts)

## Requirements

- [`INV-UPG-1-KW2A02` (Best-effort with no protocol effect)](../../../../../../../specification/peer-communication/transport-upgrade.md#inv-upg-1-kw2a02)
- [`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)
  Partial: [`DEF-11-JN8N6H`](../../../../../../../audit/open-findings.md#def-11-jn8n6h) unfiltered ICE targets; map-entry leak without close.
- [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)
- [`REQ-UPG-3-T1SRMS` (Single deterministic initiator)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-3-t1srms)
- [`REQ-UPG-9-60XCXK` (A direct connection survives a short path loss)](../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-9-60xcxk)

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

## UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q

Connection health of an upgraded transport

- Setup: Open a WebRTC connection through a stand-in connection factory inside the host and hand the service a recording data channel, so the service creates and owns the transport; report connection and path states, with waits, and wait past the 5 s grace where the case needs it.
- Oracle: The path (ICE) state decides: `disconnected` keeps the transport and starts one grace; `connected` or `completed` ends it; the grace end, or `failed`/`closed` in either state, closes the connection's own transport, and `failed`/`closed` before the connection has a transport closes its factory connection and stops tracking it; a transport closes the factory connection only while it is the peer's current one; a new connection closes the replaced connection's transport; every change is logged.

- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P1` — a path that recovers within the grace keeps the transport; the loss and the recovery are logged
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P2` — the transport stays open during the grace
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P3` — a path still down when the grace ends closes the transport; repeated reports start one grace
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P4` — `failed` or `closed` in either state closes the transport and its factory connection at once, a DTLS failure on a working path included
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P5` — a failure during the grace closes at once and the grace closes nothing more
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P6` — a recovered path ends the grace while the connection state stays `disconnected` (Node)
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P7` — each path loss gets its own full grace
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P8` — a replaced connection's transport closes when its replacement starts, without closing the replacement's factory connection
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P9` — `failed` or `closed` during a grace, before the connection has a transport, closes its factory connection and the service stops tracking it
- [x] `UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P10` — dispose closes a connection still negotiating, and a connection whose data channel arrives after the network cut closes once its transport is built
