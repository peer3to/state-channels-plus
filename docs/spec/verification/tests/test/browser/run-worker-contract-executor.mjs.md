# test/browser/run-worker-contract-executor.mjs — Test Report

> **Test file:** [test/browser/run-worker-contract-executor.mjs](../../../../../../test/browser/run-worker-contract-executor.mjs) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The runner behind package script `test:browser:worker` serves the repo through Vite with browser
platform aliases and drives `test/browser/index.html` in headless Chromium via Playwright,
executing five in-page smokes and failing on any page error, console error, or failed request.
(0) `worker-watchdog.js` creates three executors whose worker is the scripted watchdog entry
(`test/evm/workers/browser`, selection in the worker name) and arms a watchdog trip, an autonomous
throw, and an unhandled rejection: each is one `onDetachedError` report (the trip with
`runtime: "browser"` delay data) while the executor still deploys, and because the worker funnel
marks both events handled, no worker `error` event and no console error reach the page.
(1) `WorkerContractExecutor.create` loads a custom precompile module inside a real Web Worker and
`simulateCall` returns the precompile's encoded answer with `isWorker=true` — the browser-side
proof the contract-executor worker runtime loads and executes modules off the main thread.
(2) Two main-thread `WebRTCSetupService` instances complete offer/answer/ICE over stubbed
signaling and deliver one payload in each direction. (3) The same exchange with the responder in
a dedicated worker behind `installWebRTCMainThreadBridge` in its default transfer channel mode,
and (4) again with `channelMode: "proxy"`, so both bridge channel modes carry identical
bidirectional traffic over a real `RTCPeerConnection` — the browser-only complement to the Node
worker-bridge unit suite. The smokes' fake peer managers provide `profileManager.registerTransport`, which every transport calls on
construction since the profile-ownership change; without it the WebRTC offer failed before any channel opened
and the gate timed out. Service guard placement, silent-ignore failure handling, bridge
uninstall/error-propagation oracles, and initiator selection are not asserted here, so those
permutations stay with the targeted unit suites.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`package script test:browser:worker`](../../../../../../test/browser/run-worker-contract-executor.mjs#L1) (line 1) | [`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P1`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts.md#unit-test-webrtc-main-bridge-1-7gxpta.p1), [`UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P2`](../../../../implementation/source/src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts.md#unit-test-webrtc-main-bridge-1-7gxpta.p2), [`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1`](../../../../implementation/source/src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts.md#unit-test-contract-executor-browser-runtime-1-6hx1gx.p1), [`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2`](../../../../implementation/source/src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts.md#unit-test-contract-executor-browser-runtime-1-6hx1gx.p2), [`UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3`](../../../../implementation/source/src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts.md#unit-test-contract-executor-browser-runtime-1-6hx1gx.p3), [`REQ-TIME-5-S9NQXK.T1.P3`](../../../../specification/protocol-model/time.md#req-time-5-s9nqxk.t1.p3), [`REQ-RUNTIME-6-6F4SSM.T1.P2`](../../../../specification/runtime/execution.md#req-runtime-6-6f4ssm.t1.p2) |
