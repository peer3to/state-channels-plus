# WebRTCTransport.test.ts

Test file: [test/utils/WebRTCTransport.test.ts](../../../../../../test/utils/WebRTCTransport.test.ts)
Exercises: [WebRTCTransport.ts](../../../../implementation/source/src/transport/WebRTCTransport.ts.md)

## Overview

The suite uses full SDK setup, real WebRTC negotiation and real data exchange. Delegating observers record send and handshake order. Connecting sends wait until the channel opens, then reach the remote channel before the handshake starts. Open construction starts one handshake, a repeated open callback does not restart it, open sends reach the receiver, and closed sends produce no channel send. Shared setup and cleanup live in the transport fixture.

## Tests

- `queues sends on a connecting channel and flushes them once it opens`: UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P1
- `starts the WebRTC handshake when constructed with an open channel`: UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P2
- `starts the handshake only once even if the open event fires again`: UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P3
- `sends over the open data channel`: UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P4
- `drops sends when the channel is already closed`: UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P5
