# LocalWebRTCConnectionFactory.test.ts

Test file: [test/utils/LocalWebRTCConnectionFactory.test.ts](../../../../../../test/utils/LocalWebRTCConnectionFactory.test.ts)
Exercises: [LocalWebRTCConnectionFactory](../../../../implementation/source/src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts.md)

## Overview

Opens a connection through the real factory over a stand-in RTCPeerConnection that dispatches both
state events to added listeners, ICE first as a browser does, or only the ICE event as werift does, and answers `getStats` with a fixed report: a transport, its selected
candidate pair, and the pair's local and remote candidates. A held first `getStats` call makes one
stats read slow, to show that later reports wait for it; a failing `getStats` shows that the change
is still reported. A `getStats` call held without end under sinon fake timers shows that the report waits
exactly until the 2 s limit, then goes on without stats and with the timeout reported, and that the next
change is reported with its stats. Closing the connection, or opening the peer's next one, shows that the old
connection reports nothing more. A report with no transport entry and a pair marked selected is
Firefox's; a transport with no selected pair is a connection still checking. A state callback that
throws at its first report shows the throw escaping exactly once as an unhandled rejection, recorded
by the shared fixture recorder after a real macrotask, while the next report and a later state
change are still delivered.

## Tests

- `reports each state change with its selected path's stats, in the order of the changes, also when the first stats read is slow`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P1, REQ-UPG-9-60XCXK.T1.P9
- `reports an ICE change that comes without a connection-state change, as werift reports a recovered path`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P6, REQ-UPG-9-60XCXK.T1.P14
- `reports state changes without path stats where the runtime has no getStats`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P2, REQ-UPG-9-60XCXK.T1.P10
- `reports a state change whose stats read fails, without path stats, and reports the failure`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P3, REQ-UPG-9-60XCXK.T1.P11
- `reports a state change whose stats read never settles after the time limit, without path stats, and still reports the later changes`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P10, REQ-UPG-9-60XCXK.T1.P16
- `reports nothing more for a connection once it is closed, also a change whose stats read was running`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P4, REQ-UPG-9-60XCXK.T1.P12
- `reports nothing more for a connection replaced by the peer's next one, and reports the next one's changes`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P5, REQ-UPG-9-60XCXK.T1.P13
- `reads the pair marked selected where the runtime has no transport stats, as Firefox reports it`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P7
- `reports only the transport stats while no candidate pair is selected`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P8
- `raises a throw in the state handling once as an unhandled rejection, not as a reported factory error, and still reports the later changes`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-2-FY5T0W.P9
