# test/utils/WebRTCTransport.test.ts — Test Report

> **Test file:** [test/utils/WebRTCTransport.test.ts](../../../../../../test/utils/WebRTCTransport.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [WebRTCTransport.ts](../../../../implementation/source/src/transport/WebRTCTransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite uses full SDK setup, real WebRTC negotiation and real data exchange. Delegating observers record send and handshake order. Connecting sends wait until the channel opens, then reach the remote channel before the handshake starts. Open construction starts one handshake, a repeated open callback does not restart it, open sends reach the receiver, and closed sends produce no channel send. Shared setup and cleanup live in the transport fixture.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                            | Covers                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCTransport > queues sends on a connecting channel and flushes them once it opens`](../../../../../../test/utils/WebRTCTransport.test.ts#L4) (line 4) | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P1`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p) |
| [`WebRTCTransport > starts the WebRTC handshake when constructed with an open channel`](../../../../../../test/utils/WebRTCTransport.test.ts#L7) (line 7)   | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P2`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p) |
| [`WebRTCTransport > starts the handshake only once even if the open event fires again`](../../../../../../test/utils/WebRTCTransport.test.ts#L10) (line 10) | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P3`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p) |
| [`WebRTCTransport > sends over the open data channel`](../../../../../../test/utils/WebRTCTransport.test.ts#L13) (line 13)                                  | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P4`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p) |
| [`WebRTCTransport > drops sends when the channel is already closed`](../../../../../../test/utils/WebRTCTransport.test.ts#L16) (line 16)                    | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P5`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p) |
