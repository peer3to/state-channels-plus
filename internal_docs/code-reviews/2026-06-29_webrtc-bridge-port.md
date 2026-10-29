# Code Review: bubble up WebRTC main-thread bridge port

- **Branch:** `feat/bubble-up-webrtc-bridge-port`
- **Base:** `dispute`
- **Commit range:** `dispute..HEAD` (HEAD = `1e9c7e9f`)
- **Date:** 2026-06-29

## Intent

Flip where the WebRTC bridge `MessagePort` originates so a worker — however
nested — can negotiate WebRTC with the real main thread. The runtime host now
mints the bridge `MessageChannel` when it can't run `RTCPeerConnection` locally
(`workerNeedsMainThreadBridge()`), registers the worker end with
`WorkerBridgeWebRTCConnectionFactory`, and posts the main-thread end up over the
runtime port (transferred). `P2pRuntimeClient` stores it; `P2pInstance.webRTCBridgePort`
exposes it. `installWebRTCMainThreadBridge(port)` binds a broker to that provided
port. The old top-down flow (main thread mints the channel + posts an `init`
message into a direct child worker) and its worker-side global init listener are
removed.

## Changed files

```
src/evm/P2pInstance.ts
src/evm/p2pRuntime/P2pRuntimeClient.ts
src/evm/p2pRuntime/P2pRuntimeHost.ts
src/evm/p2pRuntime/types.ts
src/evm/p2pRuntime/worker/protocol.ts
src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts
src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts
src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts
src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts
src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts
test/browser/webrtc-service-smoke.js
test/browser/webrtc-service-worker.js
test/evm/P2pRuntimeClient.test.ts
test/utils/WebRTCMainThreadBridge.test.ts
```

## Prior review

This change already went through an internal 8-angle review pass before this
external review; the fixes from that pass are folded into HEAD.

## Deferred-tracking

No GitHub Project board is documented for this repo (only a Trello board).
Issues repo would be `peer3to/state-channels-plus`. Deferral target to be
confirmed with the maintainer if any finding is deferred.

---

## Round 1

### Critical

### High

- R1.H1: Multiple runtime hosts in the same worker can tear down each other's
  WebRTC bridge. `bubbleWebRTCBridgePortIfNeeded()` creates and registers a new
  bridge channel for every host (`src/evm/p2pRuntime/P2pRuntimeHost.ts:100`),
  but `WorkerBridgeWebRTCConnectionFactory.registerPort()` is process-wide and
  always disposes the previously registered client before storing the new port
  (`src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts:272`).
  Each host also records only `bridgeInstalled = true`, so disposing any earlier
  host later calls `disposeBridge()` on the singleton (`src/evm/p2pRuntime/P2pRuntimeHost.ts:180`)
  and closes whichever bridge is current, not necessarily its own
  (`src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts:288`).
  A nested worker running more than one `p2pSetup` therefore lets the later host
  break the earlier host's WebRTC, and the earlier host's teardown can break the
  later host.

### Medium

- R1.M1: A failed bridge-port transfer leaves a half-installed worker bridge.
  The host registers `bridge.port1` in the singleton before transferring
  `bridge.port2` over the runtime port (`src/evm/p2pRuntime/P2pRuntimeHost.ts:101`
  and `src/evm/p2pRuntime/P2pRuntimeHost.ts:104`). If that `post` throws
  because the transfer list is unsupported, mismatched, or the runtime port is
  already closing, `buildRuntime` catches the error and still posts `ready`
  (`src/evm/p2pRuntime/P2pRuntimeHost.ts:240` and
  `src/evm/p2pRuntime/P2pRuntimeHost.ts:247`). However the registered port is
  not cleared, so `createWebRTCConnectionFactory()` later sees `hasPort()` and
  returns the bridge factory (`src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts:15`)
  even though no main-thread broker ever received the other end. WebRTC setup
  then sends requests into an unpaired bridge and waits for the 30s bridge
  timeout instead of failing fast or falling back.

### Low

### Response

- **R1.H1 — fixed.** Confirmed: the bridge teardown I added was singleton-wide,
  so an earlier host's dispose could close a later host's bridge. Made
  `disposeBridge(port)` scoped to the exact worker-end port — it no-ops if a
  later host already replaced the singleton's port — and the host now passes its
  own worker-end port to it. Note: the worker-bridge factory is a per-realm
  singleton, so a worker realm supports one SDK host (threaded mode, the
  production path, gives each host its own worker). Two simultaneous inline hosts
  sharing one realm sharing one bridge is a pre-existing architectural
  constraint; the teardown fix ensures hosts no longer close each other's bridge.

- **R1.M1 — fixed.** Confirmed: `registerPort` ran before the transfer `post`,
  so a failed transfer left the worker end registered (`hasPort()` true) with no
  paired broker, causing 30s request timeouts. Reordered: transfer the
  main-thread end first, register the worker end only after it succeeds, so a
  failed transfer leaves nothing registered and `createWebRTCConnectionFactory`
  fails fast instead.

---

## Round 2

Files changed to address Round 1: `src/evm/p2pRuntime/P2pRuntimeHost.ts`,
`src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts`.

### Critical

### High

### Medium

### Low

No findings.

### Response

Round 1 fixes (host-scoped bridge teardown + transfer-before-register) verified;
no new issues. Review complete after 2 rounds — 2 findings fixed, 0 skipped, 0
deferred.
