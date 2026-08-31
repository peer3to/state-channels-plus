# test/browser/run-worker-contract-executor.mjs — Test Report

> **Test file:** [test/browser/run-worker-contract-executor.mjs](../../../../../../test/browser/run-worker-contract-executor.mjs) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The runner behind package script `test:browser:worker` serves the repo through Vite with browser
platform aliases and drives `test/browser/index.html` in headless Chromium via Playwright,
executing five in-page smokes and failing on any page error, console error, or failed request
(the logger's own error-level console writes are log output, not failures: the crash-log
smoke's deliberate worker crash is captured through them).
(1) `WorkerContractExecutor.create` loads a custom precompile module inside a real Web Worker and
`simulateCall` returns the precompile's encoded answer with `isWorker=true` — the browser-side
proof the contract-executor worker runtime loads and executes modules off the main thread.
(2) Two main-thread `WebRTCSetupService` instances complete offer/answer/ICE over stubbed
signaling and deliver one payload in each direction. (3) The same exchange with the responder in
a dedicated worker behind `installWebRTCMainThreadBridge` in its default transfer channel mode,
and (4) again with `channelMode: "proxy"`, so both bridge channel modes carry identical
bidirectional traffic over a real `RTCPeerConnection` — the browser-only complement to the Node
worker-bridge unit suite. (5) A browser main realm with a real crash-log receiver (the repo's
`crash-log-server.js` on a fresh directory): a vm worker beneath it crashes on a timer and collects
on its own, then `logger.uploadLogs` runs a collection over the worker port; the round reports both
realms ok, and the server holds a `vm` chunk and a `main` chunk carrying the marker under the main
realm's identity — the browser-host permutation of log collection. Service guard placement, silent-ignore failure handling, bridge
uninstall/error-propagation oracles, and initiator selection are not asserted here, so those
permutations stay with the targeted unit suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`package script test:browser:worker`](../../../../../../test/browser/run-worker-contract-executor.mjs#L1) (line 1) | [`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P1`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts.md#unit-test-webrtc-main-bridge-1-7gxpta.p1), [`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P2`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts.md#unit-test-webrtc-main-bridge-1-7gxpta.p2), [`REQ-LOG-8-B7VN3J.T1.P5`](../../../../specification/runtime/log-collection.md#req-log-8-b7vn3j.t1.p5) |
