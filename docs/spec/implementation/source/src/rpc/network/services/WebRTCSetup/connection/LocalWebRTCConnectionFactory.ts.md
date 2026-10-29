# LocalWebRTCConnectionFactory.ts

> **Source:** [src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts](../../../../../../../../../../src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts)

## Requirements

- [`REQ-UPG-1-MFBTZ1` (Identity-bound signaling)](../../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1)
- [`REQ-UPG-9-60XCXK` (A direct connection survives a short path loss)](../../../../../../../../specification/peer-communication/transport-upgrade.md#req-upg-9-60xcxk)
- [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../../../../../../../../specification/runtime/execution.md#req-runtime-9-p5vpt5)

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

## UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W

State reports with path statistics

- Setup: Open a connection over a stand-in RTCPeerConnection that dispatches its state events to added listeners and whose `getStats` calls can be held one by one, held without end under fake timers, or made to fail; change both states, or only the ICE state as werift does; close it while a report waits, and replace it with the peer's next connection; repeat with a stand-in that has no `getStats`.
- Oracle: Every ICE and connection-state change of the current connection, also an ICE change alone, is reported once, in the order of the changes, with the selected candidate pair's statistics where the runtime has them: the pair the transport names, else the pair marked selected (Firefox), else no pair fields; a failed statistics read is reported as an error and the change still is; a statistics read that has not settled within `STATS_READ_TIME_LIMIT_MS` (2 s) is reported as a failed read, and the change is reported without statistics at that limit, not before; a throw in the state handling is not reported as a factory error and escapes once as an unhandled rejection, and later changes are still reported; a closed or replaced connection reports nothing more.

- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P1` — each change is reported with its selected path's statistics, in the order of the changes, also when the first stats read is slow
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P2` — a runtime without `getStats` reports changes without path statistics
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P3` — a failed stats read is reported, and the change is reported without path statistics
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P4` — a closed connection reports nothing more, also a change whose stats read was running
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P5` — a replaced connection reports nothing more; the next one's changes are reported
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P6` — an ICE change without a connection-state change is reported (werift)
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P7` — without transport statistics the pair marked selected gives the path statistics (Firefox)
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P8` — while no candidate pair is selected only the transport statistics are reported
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P9` — a throw in the state handling escapes exactly once as an unhandled rejection, is not reported as a factory error, and later changes are still reported
- [x] `UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P10` — a stats read that never settles is reported as a failure at the 2 s limit, the change is reported then without path statistics, and a later change is reported with its statistics
