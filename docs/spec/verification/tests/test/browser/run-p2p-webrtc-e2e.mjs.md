# test/browser/run-p2p-webrtc-e2e.mjs — Test Report

> **Test file:** [test/browser/run-p2p-webrtc-e2e.mjs](../../../../../../test/browser/run-p2p-webrtc-e2e.mjs) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The runner behind package script `test:browser:webrtc` stands up a hardhat node (switched to
interval mining so the browser's parallel HTTP nonce ordering works), a local-discovery relay
hub, and a Vite dev server with browser platform aliases plus a same-origin `/rpc` proxy, then
drives `test/browser/p2p-webrtc-e2e.html` in headless Chromium via Playwright. The page runs two
REAL `p2pSetup` peers (full SDK + EVM stack deployed with `deployFullStack`) through two paths:
(1) `p2pSetup` on the main thread with `RUN_SDK_IN_THREAD`, where each SDK worker surfaces a
WebRTC bridge port that `p2pSetup` auto-installs; (2) `p2pSetup` inside app workers, whose bridge
ports are bubbled up and installed by hand with `installWebRTCMainThreadBridge`. Oracles per
path: both peers surface/install bridge ports, each peer's `onConnection` fires for the other's
address, and a spied main-thread `RTCPeerConnection` reaches connected state — proof WebRTC
negotiation was delegated up from workers that cannot drive it themselves; any page or worker
error fails the run. This is the browser half of the dual-environment coverage for the SDK's
peer-communication stack (discovery, handshake, transport upgrade to WebRTC). It proves the
browser upgrade path works end to end but asserts no cutover-continuity, initiator-selection, or
failure-path oracles, so the transport-upgrade and WebRTC-setup permutations (which each carry
such oracles) remain with the targeted Node suites and none is assigned here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                          | Covers                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`package script test:browser:webrtc`](../../../../../../test/browser/run-p2p-webrtc-e2e.mjs#L1) (line 1) | [`INTEGRATION-TEST-BROWSER-P2P-RUNTIME-1-E8W0M2.P1`](../../../../implementation/source/src/evm/p2pRuntime/browser/README.md#integration-test-browser-p2p-runtime-1-e8w0m2.p1) |

The browser runner now opens the existing-channel fixture on chain before connection. Workers report one
serializable `{ type: "connectResult", result, status }` message per peer. The runner asserts observer `true`
at `SYNCED` and targeted `{ autoOpen: true, shouldJoin: true, balance }` success at pending or participating,
including nonempty balance data and upgraded traffic. This is browser-worker API evidence, not runtime-port
structured-clone evidence.
