# LocalWebRTCConnectionFactory.test.ts

Test file: [test/utils/LocalWebRTCConnectionFactory.test.ts](../../../../../../test/utils/LocalWebRTCConnectionFactory.test.ts)
Exercises: [LocalWebRTCConnectionFactory](../../../../implementation/source/src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts.md)

## Overview

Opens a connection through the real factory over a stand-in RTCPeerConnection that dispatches both
state events to added listeners, ICE first as a browser does, or only the ICE event as werift does, and answers `getStats` with a fixed report: a transport, its selected
candidate pair, and the pair's local and remote candidates. A held first `getStats` call makes one
stats read slow, to show that later reports wait for it; a failing `getStats` shows that the change
is still reported. Closing the connection, or opening the peer's next one, shows that the old
connection reports nothing more.

## Tests

- `reports each state change with its selected path's stats, in the order of the changes, also when the first stats read is slow`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P1, REQ-UPG-9-60XCXK.T1.P9
- `reports an ICE change that comes without a connection-state change, as werift reports a recovered path`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P6, REQ-UPG-9-60XCXK.T1.P14
- `reports state changes without path stats where the runtime has no getStats`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P2, REQ-UPG-9-60XCXK.T1.P10
- `reports a state change whose stats read fails, without path stats, and reports the failure`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P3, REQ-UPG-9-60XCXK.T1.P11
- `reports nothing more for a connection once it is closed, also a change whose stats read was running`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P4, REQ-UPG-9-60XCXK.T1.P12
- `reports nothing more for a connection replaced by the peer's next one, and reports the next one's changes`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P5, REQ-UPG-9-60XCXK.T1.P13
