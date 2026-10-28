# WebRTCConnectionGrace.test.ts

Test file: [test/transport/WebRTCConnectionGrace.test.ts](../../../../../../test/transport/WebRTCConnectionGrace.test.ts)
Exercises: [WebRTCSetupService](../../../../implementation/source/src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts.md)

## Overview

Each test runs the P2PManager probe inside the host. It installs a stand-in connection factory on the
real setup service, opens a connection, and hands the service a recording data channel, so the
service creates and owns the WebRTC transport. It then reports the given connection and path states,
in Chrome's order where it matters, waits where a step says so, and waits past the 5 s grace where the
case needs it. The waits run on fake timers in the peer's own thread: 1 ms short of the grace or
1 ms past it, so the grace boundary is exact and no test waits in real time. It returns whether each transport's channel is open, which peers' factory connections the
service closed, which peers the service still tracks, and the setup service's warning and info
messages. One case never hands the service a data channel, so the connection has no transport when it
fails or closes.

## Tests

- `keeps the transport of a connection whose path recovers within the grace, and logs the loss and the recovery`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P1, REQ-UPG-9-60XCXK.T1.P1
- `keeps the transport open during the grace`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P2, REQ-UPG-9-60XCXK.T1.P2
- `closes the transport of a connection whose path is still down when the grace ends, with one grace for repeated reports`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P3, REQ-UPG-9-60XCXK.T1.P3
- `closes the transport and its connection at once when the connection or its path fails or closes, also a DTLS failure on a working path`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P4, REQ-UPG-9-60XCXK.T1.P4
- `closes the transport at once when the connection fails during the grace, and the grace closes nothing more`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P5, REQ-UPG-9-60XCXK.T1.P5
- `ends the grace when the path recovers while the connection state stays disconnected, as in Node`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P6, REQ-UPG-9-60XCXK.T1.P6
- `gives each path loss its own full grace`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P7, REQ-UPG-9-60XCXK.T1.P7
- `closes a replaced connection's transport when its replacement starts, without closing the replacement's connection`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P8, REQ-UPG-9-60XCXK.T1.P8
- `closes and forgets a connection that fails or closes during a grace before it has a transport`: UNIT-TEST-WEBRTC-SETUP-SERVICE-2-8TNH4Q.P9, REQ-UPG-9-60XCXK.T1.P15
