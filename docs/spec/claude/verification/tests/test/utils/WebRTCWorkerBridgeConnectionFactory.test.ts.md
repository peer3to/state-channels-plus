# test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts — Test Report

> **Test file:** [test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts](../../../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [WorkerBridgeWebRTCConnectionFactory.ts](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the worker-side `WorkerBridgeWebRTCConnectionFactory` singleton over a real
`MessageChannel`: it registers `port1` and calls `createOffer`/`acceptOffer`, while the test
plays the main-thread bridge on `port2`, answering the factory's `request` messages with
`channel`, `state`, `iceCandidate`, and `response` protocol messages from
`WebRTCBridgeProtocol`. The oracles assert that a proxy-mode `channel` event materializes a
`WebRTCDataChannelLike` whose `send` routes back to the bridge as a `proxySend` message, that
`state` and `iceCandidate` events reach the registered connection callbacks, that the request
promise resolves with the bridge's SDP result, and that disposing the final owner rejects the
in-flight request with a "disposed" error instead of hanging. Out of scope: `waitForPort`
pre-arrival resolution (ports are registered before any call), behavioral parity with
`LocalWebRTCConnectionFactory`, deserialization of `ok: false` bridge error responses, and the
main-thread half of the bridge (owned by the WebRTCMainThreadBridge suite). Those untested
scenarios are the P1–P3 and per-method parity P5–P7 permutations, which stay unassigned; only
port-loss behavior is covered in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                     | Covers                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`WorkerBridgeWebRTCConnectionFactory > creates a proxy data channel from bridge channel events`](../../../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts#L24) (line 24)         | —                                                                                                                                                                                                                |
| [`WorkerBridgeWebRTCConnectionFactory > routes bridge state and ICE events to connection callbacks`](../../../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts#L85) (line 85)      | —                                                                                                                                                                                                                |
| [`WorkerBridgeWebRTCConnectionFactory > rejects in-flight requests when the shared bridge is disposed`](../../../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts#L154) (line 154) | [`UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P4`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md#unit-test-worker-bridge-factory-1-c3nbb8.p4) |
