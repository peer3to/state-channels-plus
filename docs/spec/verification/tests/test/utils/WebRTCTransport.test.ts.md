# test/utils/WebRTCTransport.test.ts — Test Report

> **Test file:** [test/utils/WebRTCTransport.test.ts](../../../../../../test/utils/WebRTCTransport.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [WebRTCTransport.ts](../../../../implementation/source/src/transport/WebRTCTransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite constructs `WebRTCTransport` around a typed `RTCDataChannel` boundary, a real
`ProfileManager`, and record-only logger and RPC hooks, then drives the channel-state machine
through `_send` and the channel's `onopen` callback. The oracles assert the open-state
contract: sends on a `connecting` channel queue without throwing and flush in order exactly when
the channel opens, the init handshake fires once on open (immediately when constructed already
open, never twice on a redundant open event), an open channel sends directly, and a closed
channel drops sends silently. Out of scope: RPC serialization through `ATransport.send` (the
tests call `_send` directly), close/error teardown and disconnect accounting, and the
signaling-side WebRTC setup service.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                              | Covers                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WebRTCTransport > queues sends on a connecting channel and flushes them once it opens`](../../../../../../test/utils/WebRTCTransport.test.ts#L70) (line 70) | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P1`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p.p1) |
| [`WebRTCTransport > starts the WebRTC handshake when constructed with an open channel`](../../../../../../test/utils/WebRTCTransport.test.ts#L99) (line 99)   | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P2`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p.p2) |
| [`WebRTCTransport > starts the handshake only once even if the open event fires again`](../../../../../../test/utils/WebRTCTransport.test.ts#L115) (line 115) | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P3`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p.p3) |
| [`WebRTCTransport > sends over the open data channel`](../../../../../../test/utils/WebRTCTransport.test.ts#L133) (line 133)                                  | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P4`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p.p4) |
| [`WebRTCTransport > drops sends when the channel is already closed`](../../../../../../test/utils/WebRTCTransport.test.ts#L142) (line 142)                    | [`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P5`](../../../../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p.p5) |
