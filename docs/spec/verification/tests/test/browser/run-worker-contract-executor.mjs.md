# run-worker-contract-executor.mjs

Test file: [test/browser/run-worker-contract-executor.mjs](../../../../../../test/browser/run-worker-contract-executor.mjs)

## Overview

The browser job in the CI workflow runs this gate inside the distributed runner image, under the environment's container limits (read-only root, no capabilities, a 256 MB `/tmp`), after installing and compiling in that same container, and reports the peak `/tmp` use. Local runs remain available through the package script. CI execution itself is established only after the workflow runs on a pull request.

Fourteen named Node test declarations drive the browser page in Chromium. The gate is one task of the runner's browser tier, so these declarations also run on a distributed worker, launched through the `browser-test` Hardhat task. Contract, clock, detached-error and WebRTC fixtures use full SDK setup. Each page or worker realm deploys the stack once, and every SDK setup in that realm reuses the deployment with its own provider and clock, so no scenario pays for more than one deployment. The main-thread WebRTC case reaches the actual SDK service's local factory; dedicated-worker and proxy cases run full SDK setup in an application worker and forward its supplied bridge port to an SDK-owned main-thread broker. Each asserts one real data payload in each direction. Reconnect, pending teardown and native transfer-failure cases use the real provider and shared RPC. The crash-log cases use the real receiver. The nested case requires new main, SDK and VM streams under its own channel after a genuine executor error, then checks the local report reason. Shared setup and browser-error checks remain common; the fixtures do not supply fake managers or implement service routing.

The clock case brackets its asynchronous read with wall-time samples. It checks that the host Clock's adjustment falls within that interval, allowing the existing one-second sampling boundary; reply latency does not count as clock drift. The host adjustment is the value the Clock settled on after the requested 600-second shift, because the Clock sync keeps any offset within one average block time; the case also checks that it is within 60 seconds of 600, so the shift took effect.

## Tests

- `browser performance reporting uses long-task metadata`: UNIT-TEST-BROWSER-LOGGER-1-6FCT8F.P1
- `browser worker executes a contract`: UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P4, UNIT-TEST-BROWSER-EXECUTOR-URL-1-YNHKVA.P1
- `browser worker advances adjusted chain time`: REQ-TIME-5-S9NQXK.T1.P3, REQ-RUNTIME-6-6F4SSM.T1.P2
- `browser worker reports detached errors and keeps serving`: UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P1, UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P2, UNIT-TEST-CONTRACT-EXECUTOR-BROWSER-RUNTIME-1-6HX1GX.P3
- `browser main-thread WebRTC exchanges messages`: UNIT-TEST-LOCAL-WEBRTC-FACTORY-1-6YHWHJ.P6
- `browser dedicated-worker WebRTC exchanges messages`: UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P1, UNIT-TEST-BROWSER-HOST-URL-1-SD21T9.P1
- `browser proxy-worker WebRTC exchanges messages`: UNIT-TEST-WEBRTC-MAIN-BRIDGE-1-7GXPTA.P2
- `browser SDK WebRTC reconnects and exchanges new messages`: none
- `browser SDK WebRTC rejects pending negotiation on final teardown`: none
- `browser SDK WebRTC caches auto fallback after a native transfer failure`: none
- `browser SDK WebRTC caches auto fallback after a native transfer failure`: REQ-RUNTIME-3-VQXW59.T1.P55, UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P19
- `fallback browser worker keeps its first inline SDK host usable after disposing the second`: REQ-RUNTIME-3-VQXW59.T1.P56, UNIT-TEST-WORKER-BRIDGE-FACTORY-1-C3NBB8.P20
- `browser crash-log collection uploads every realm`: none
- `browser nested SDK and executor workers gossip crash logs`: REQ-LOG-8-B7VN3J.T1.P5

The detached-error fixture selects its scripted executor by the built-in worker asset URL, not the removed rpc-root name prefix. The focused browser run verifies watchdog, throw and rejection reporting while the executor remains usable.
