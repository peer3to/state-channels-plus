# Implementation Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

## Block intake: a still-syncing source takes a counted close — 2026-10-29

What changed: commit `dd162f81` narrowed the 2026-10-26 rule "the requester does not count that as a
failed sync" (see "Still-syncing responder answers at once" below) for block intake. Luka's decision A
(2026-10-29, decided during the PR #579 merge): a block's absent sender, or a queued block's source, that answers it
is still syncing takes a counted close at intake, because a peer still in its own initial sync has no
block to send. Luka's decision TO1-a (2026-10-29, PR #579 review): one still-syncing answer counts one
strike, like a failed request, however many intake callers share it.

1. [SpectateService.ts](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md):
   `syncBlockSource` is the intake and source-probe sync. It counts its waiting callers per peer, and
   `requestAndApply` gives a still-syncing answer one allow-retry close (no blacklist) when a
   block-source caller waits for it. `requestSync` callers alone get no consequence. `sync` is deleted;
   its callers use `requestSync`. `SyncOutcome.isResponderSyncing` is gone: `requestAndApply` returns
   `SyncResult.ResponderSyncing` for that answer.
2. Spec: [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../specification/peer-communication/synchronization.md#req-spc-3-azbkr1)
   and the failure-outcome table in [synchronization.md](../specification/peer-communication/synchronization.md)
   state the intake exception with one counted close per answer.
3. New cases: [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P116`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct)
   (shared answer, one strike), [`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P60`](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md#unit-test-block-queue-manager-1-yws2d2)
   (absent-sender gate) and `.P61` (expiry probe).

## Early targeted cancel, bounded stats read, strict bridge close — 2026-10-28

What changed (Luka's review decisions 1, 3 and 8; decisions 4 and 7 are recorded as findings, 2, 5
and 6 keep the code):

1. [LocalP2pSigner.ts](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md): a targeted
   connect with opening permission is tracked in `targetedConnects` from its start until its matching
   step returns. `cancelConnectToChannel` hands a running matching on the topic to
   `LobbyMatchingService.cancelMatching`, as before; when no matching runs on the topic, it marks the
   tracked connects and returns `true` if there was one. A marked connect does not start matching (the
   mark is also the `left` check `match` makes after a cleanup wait) and returns `false`. Before, a
   cancel during the connect's channel selection or on-chain status read was lost and the connect
   waited in matching without end. Requirement:
   [`REQ-TJOIN-1-5VGR1F` (Independent public options)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f),
   case [`REQ-TJOIN-1-5VGR1F.T1.P8`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f.t1.p8);
   [`UNIT-TEST-LOCAL-P2P-SIGNER-3-3XWPRV`](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md#unit-test-local-p2p-signer-3-3xwprv).
2. [LocalWebRTCConnectionFactory.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts.md)
   `createConnection`: a state report's stats read has a time limit, `STATS_READ_TIME_LIMIT_MS` (2 s).
   A read past it is handled as a failed read: the timeout Error goes to `onError` and the report goes
   on without path statistics, so a `getStats()` that never settles no longer blocks every later report.
   Case [`REQ-UPG-9-60XCXK.T1.P16`](../specification/peer-communication/transport-upgrade.md#req-upg-9-60xcxk.t1.p16).
3. [WorkerBridgeWebRTCConnectionFactory.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)
   `close` resolves only the disposal's own rejection while the bridge is disposing; every other failure
   rejects. [RemoteRoot.ts](../implementation/source/src/rpc/internal/RemoteRoot.ts.md) owns the marker:
   `childDisposedError` now returns a `RootDisposedError` (name `RootDisposedError`), and
   `isRootDisposedError` checks the name, which also survives a port hop.
   [WebRTCWorkerBridgeRoot.ts](../implementation/source/src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts.md)
   rejects its pending requests at disposal with a `RootDisposedError` too. A close requested after the
   disposal started still returns at once. Case
   [`REQ-RUNTIME-3-VQXW59.T1.P86`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p86).
4. Recorded, deferred: [`FIND-TIMEOUT-1-R8EWZ5`](open-findings.md#find-timeout-1-r8ewz5)
   (`TimeoutManager.scheduleTask` swallows task errors) and
   [`FIND-UPG-STALE-REPORT-1-PHPJ5H`](open-findings.md#find-upg-stale-report-1-phpj5h) (a stale
   bridge state report reaches the next connection).
5. Kept: a failed stats read stays a reported diagnostic that does not hold back the state change
   ([`REQ-UPG-9-60XCXK` (A direct connection survives a short path loss)](../specification/peer-communication/transport-upgrade.md#req-upg-9-60xcxk));
   an invalid relayer URL stays fatal at startup.

## Relay failure before open stays handled; uncaught non-Error reports name their escape — 2026-10-28

What changed: a relayer WebSocket that failed before it opened (mobile resume, network drop) made the
dht-relay stream reject its opening with the socket's DOM `Event`. Nothing observed that promise, so the
rejection escaped in the sdk worker, crossed the port as `String(event)` and reached the page as the fatal
"[object Event]". Luka chose option A on the SDK side: the relay pool owns that expected failure. A
component that receives a non-Error failure converts it at its own boundary; everything else handles
Errors only, and the worker funnel is the last stop for a non-Error nobody handled.

1. [HolepunchRelay.ts](../implementation/source/src/HolepunchRelay.ts.md) `connectToRelayer` observes
   `dht.ready()` and hands a failed opening to the pool. One `fail` per socket counts only the first of its
   error event, close event and failed opening, and nothing once the socket is no longer current (after
   `dispose` or a reconnect); the open handler is gated the same way, so `dispose` only releases and
   closes the socket. `relayerFailure` is the one boundary conversion: a socket `Event` becomes an Error
   naming the relayer URL, the event type and a close event's code and reason; the relay's own Error
   becomes an Error naming the relayer that keeps it as `cause`. The socket's own warn logs and the
   catch's error log are gone; the pool logs each failure once.
2. `connectToRelayer` has no try/catch. The constructor (`assertRelayerUrl`) checks every relayer URL
   once, a parsable ws: or wss: URL, and throws for the first one that is not, so an invalid URL among
   valid ones fails at startup, not at the failover that first selects it. The WebSocket constructor still
   throws for a URL it can never open (a blocked port): agent decision on Luka's request, to be confirmed,
   that this is a configuration error, fatal and not retried. DHT, Hyperswarm and `updateCallback` throws
   are internal failures and fatal too.
3. [RelayerPool.ts](../implementation/source/src/transport/relay/RelayerPool.ts.md) `onFailure` takes the
   reason and logs `Holepunch relayer failed` at warn level with the URL, reason, excluded count and
   total. It has no branch for a failure while a retry is pending: `HolepunchRelay` counts at most one
   failure per socket and opens the next socket only after the retry fired, so that case cannot occur.
   Requirement: [`REQ-UPG-5-YQV7MJ` (Relay retries converge without stale work)](../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj), cases
   [`REQ-UPG-5-YQV7MJ.T1.P9`](../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj.t1.p9) to
   [`REQ-UPG-5-YQV7MJ.T1.P14`](../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj.t1.p14).
4. [createRoot.ts](../implementation/source/src/rpc/internal/createRoot.ts.md) `startRootWorker`: the
   funnel passes an Error unchanged and turns a non-Error into one Error, "`<kind>` in the `<thread>`
   worker with a non-Error value: `<valueText(value)>`", with the value as `cause`.
   [errorMessage.ts](../implementation/source/src/utils/errorMessage.ts.md) `valueText` falls back to the
   object tag when `String()` throws (a null-prototype object). The node and browser
   [RootWorkerRuntime.ts](../implementation/source/src/rpc/internal/node/RootWorkerRuntime.ts.md)
   `onUnhandledWorkerError` pass the kind (`UncaughtFailureKind`, defined in createRoot.ts). The browser
   `error` funnel passes `event.error`, an Error or not; only an event with no error object gets an Error
   built from `event.message` and `event.filename:event.lineno:event.colno`. `errorMessage`,
   `serializeError` and the log encoder are unchanged. Requirement:
   [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../specification/runtime/execution.md#req-runtime-9-p5vpt5).
5. Residual risks: the `cause` stays in the worker; `serializeError` sends only message and stack, so the
   host sees the value's text (for an `Event`, "[object Event]") and not its fields. The fork
   still rejects its opening with a raw `Event` and leaves the promise unobserved when nobody calls
   `ready()`; another consumer of the fork would hit the same leak. The funnel's Error for a non-Error
   value carries neither that value's `eventLoopDelay` nor its `peerAddress`; Luka accepted this
   (2026-10-28). The
   all-endpoints-down policy is
   [`FIND-NO-ENDPOINT-1-JFSVS6`](open-findings.md#find-no-endpoint-1-jfsvs6).

## WebRTC bridge close during disposal; state reports go on after a throw — 2026-10-28

What changed (round-3 review fixes):

1. [WorkerBridgeWebRTCConnectionFactory.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts.md)
   `close` owns the one expected bridge failure: it resolves when the bridge is disposing or disposed
   (`isBridgeDisposing`), also for a close request in flight that the bridge disposal rejects. Every
   other close failure rejects, and `WebRTCSetupService.closeConnection` leaves it unhandled, which is
   fatal. The factory keeps its bridge after the bridge closed, so a close during the host's
   `p2pManager.dispose` no longer throws "WebRTC worker bridge is not initialized"; the other
   operations on a closed bridge throw "WebRTC worker bridge is closed". Requirement:
   [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59),
   case [`REQ-RUNTIME-3-VQXW59.T1.P85`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p85).
2. [LocalWebRTCConnectionFactory.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts.md)
   `createConnection`: a throw in the state handling is raised once, off the report chain, as an
   unhandled rejection; the chain goes on, so later state changes are still reported. Before, the
   rejected chain re-raised the same error at every later change and reported nothing more.
3. A bridge close request that fails for another reason while the bridge is disposing now rejects; see
   "Early targeted cancel, bounded stats read, strict bridge close" above.

## WebRTC connection state handling failures are fatal — 2026-10-28

What changed (review fixes on the connection grace of
[`REQ-UPG-9-60XCXK` (A direct connection survives a short path loss)](../specification/peer-communication/transport-upgrade.md#req-upg-9-60xcxk)):

1. [LocalWebRTCConnectionFactory.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts.md)
   `createConnection`: the state-report chain does not catch a throw in the state handling: it
   escapes as an unhandled rejection (fatal, through the worker funnel) instead of a logged factory
   error. A `getStats()` rejection still is reported through `onError` and does not hold back the state
   change; a non-Error rejection is converted at that boundary by `statsReadFailure`.
2. [WebRTCSetupService.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/WebRTCSetupService.ts.md)
   `closeConnection`: a failed factory close is no longer swallowed at verbose level; it escapes as an
   unhandled rejection. `handleConnectionStateChange` on `failed`/`closed` cancels the grace task, and
   when the connection has no transport yet it stops tracking the connection and closes it in the
   factory. Connection and ICE state names are named union types
   ([WebRTCConnectionTypes.ts](../implementation/source/src/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts.md)).
3. Decided 2026-10-28 (see "Early targeted cancel, bounded stats read, strict bridge close" above): a
   failed stats read stays a reported diagnostic; a `getStats()` call that never settles is cut off
   after 2 s; the swallowed task errors of `TimeoutManager.scheduleTask` are
   [`FIND-TIMEOUT-1-R8EWZ5`](open-findings.md#find-timeout-1-r8ewz5). Still open, Luka decides: the
   grace end without a transport only resets the grace.

## Leave watchdog checks membership before its self-removal dispute — 2026-10-26

Before this change, a leave watchdog that expired disputed the fork unconditionally. When the remaining
participants' exit snapshot had already landed but the leaver's membership check had not yet observed it, the
watchdog started the self-removal dispute anyway; a leaver behind that snapshot failed to build its proof (below
its anchor), and the dispute error was fatal although the leave settled
([`FIND-LEAVE-5-7071C7`](open-findings.md#find-leave-5-7071c7)). In the
[LeaveChannelService report](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md)
`onWatchdog` now requests the serialized membership check, waits for it, and returns when the exit ended (settled,
or disposed) or was restarted; only an exit still pending after that check disputes. Evidence:
[`REQ-LIF-10-QR8NQ9.T1.P37`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p37) with
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P53`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9) (an event-triggered check already parked on its chain read; it fails with the
`this.exit !== exit` return removed: "below its anchor"),
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P54`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9) (the leaver received no chain event, so only the watchdog's own check
sees the settlement; it times out waiting for `onLeftChannel` with the `this.requestCheck()` line removed), and
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P55`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9) (disposal during the watchdog's own parked check; the check resumes after the disposal cut-off and its
dispute never reaches the chain).

The window after that check is closed too. An exit snapshot that lands while the self-removal dispute is
built moves the leaver's anchor past its latest block; in the
[AgreementManager report](../implementation/source/src/agreementManager/AgreementManager.ts.md)
the sibling `tryBuildStateProof` returns no proof below the anchor (this view is behind the chain), as
`tryBuildFinalProofAt` and `computeLocalFinalizedSnapshot` already did, and `buildStateProof` delegates to it and
keeps the one "below its anchor at height …" throw. In the
[DisputeManager report](../implementation/source/src/disputeManager/DisputeManager.ts.md) `dispute` treats a
construction with no proof as a no-op like `ErrorCantParticipateInDispute`: marker rolled back, info log, no
upload. Only `DisputeBuilder.constructDispute` calls `tryBuildStateProof`: `reconstructAuditingData`,
`buildFinalProof`, the snapshot update and spectate serve keep calling `buildStateProof` and its throw; the audit's
early proof build in `EventHandler` still resolves any failed build to undefined, as
[`UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P23`](../implementation/source/src/eventHandlers/EventHandler.ts.md#unit-test-event-handler-1-rz2c7w) requires. Evidence:
[`REQ-LIF-10-QR8NQ9.T1.P38`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p38) with
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P56`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9) (the watchdog's check finds the exit pending, the
construction is parked, the exit snapshot lands, then it is released),
[`UNIT-TEST-DISPUTE-MANAGER-1-SQV6ZD.P55`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-1-sqv6zd) and
[`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P66`](../implementation/source/src/agreementManager/AgreementManager.ts.md#unit-test-agreement-manager-1-kj6q9d). Switching `constructDispute` back to `buildStateProof`
makes the first two fail with "below its anchor". [`FIND-LEAVE-5-7071C7`](open-findings.md#find-leave-5-7071c7) is resolved.

## Still-syncing responder answers at once — 2026-10-26

What changed: a peer that is still in its own initial sync answers a sync request at once that it is not
synced yet, and the requester does not count that as a failed sync. Why: a candidate that asked a
participant still in its own initial sync waited for that sync, timed out after 6 s and aborted as
did-not-sync; the page then excluded a healthy table. Luka chose option a: "A peer that is still in its own
initial sync answers a sync request at once with 'not synced yet', and does not wait. The requester does
not count that as a failed sync: it syncs from another table member instead. A real sync failure still
aborts at once, as today." Narrowed for block intake on 2026-10-29: see "Block intake: a still-syncing
source takes a counted close" above.

1. [SpectateRpcMethods.ts](../implementation/source/src/rpc/network/services/spectate/SpectateRpcMethods.ts.md)
   `onSpectateRequest`: an OPENED responder returns `{ isResponderSyncing: true }` at once. It no longer
   waits on its own initial sync, and the "own initial sync failed" refusal is gone.
2. [SpectateService.ts](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md):
   `SpectateResponse` is the payload or the syncing note; `requestSync` returns `SyncResult` (`Synced`,
   `Failed`, `ResponderSyncing`). A syncing responder gives no disconnect and no strike (narrowed for
   block intake on 2026-10-29).
3. [P2PManager.ts](../implementation/source/src/P2PManager.ts.md) initial sync: `syncConnectedParticipant`
   records participants checked while a request runs in `waitingParticipants`. On `ResponderSyncing`,
   `onResponderSyncing` does not abort, syncs from the waiting participants, and asks the syncing peer again
   after half an agreement window. The first such answer from a peer re-arms the two-window deadline. A
   running sync holds an elapsed deadline and keeps the deadline it has. The abort log is now "No
   participant could serve the initial sync within its window; aborting".
4. Spec: [synchronization.md](../specification/peer-communication/synchronization.md) failure outcomes,
   [`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag) and
   [`REQ-SPC-3-AZBKR1` (No permanent exclusion for can't-prove-yet)](../specification/peer-communication/synchronization.md#req-spc-3-azbkr1);
   [targeted-channel-join.md](../specification/peer-communication/targeted-channel-join.md) initial load and
   [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6).
   The [`REQ-SPC-3-AZBKR1.T1`](../specification/peer-communication/synchronization.md#req-spc-3-azbkr1.t1) permutations 2 and 3 and the endpoint cases 4 to 8 of
   [`UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH`](../implementation/source/src/rpc/network/services/spectate/SpectateRpcMethods.ts.md#unit-test-spectate-methods-1-zab4yh) described the waiting responder and are deleted;
   new cases are [`REQ-SPC-3-AZBKR1.T1.P4`](../specification/peer-communication/synchronization.md#req-spc-3-azbkr1.t1.p4)–`.P6`,
   [`REQ-AUTH-5-BQG9AG.T3.P5`](../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag.t3.p5)–`.P6`,
   [`UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P9`](../implementation/source/src/rpc/network/services/spectate/SpectateRpcMethods.ts.md#unit-test-spectate-methods-1-zab4yh)–`.P11`, [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P115`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct) and
   [`UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P43`](../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-1-9dnsrz)–`.P48`.
5. Tests: the H11 cases in
   [E2E-BotConnectionFixes.test.ts](../verification/tests/test/e2e/E2E-BotConnectionFixes.test.ts.md).
   The "requester times out" and "responder sync already failed" cases are gone; "another participant
   serves", "no participant serves in time" and "responder answers at once" are new.
   [`UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P114`](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md#unit-test-spectate-service-1-sjbyct) (two-window default) moved to the P2PManager timeout test.
   [`UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P47`](../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-1-9dnsrz) (a running sync holds the deadline) and `.P48` (only the first
   syncing answer re-arms it) have no test yet.
6. [`FIND-SYNC-OBSERVER-1-YF6CJA`](open-findings.md#find-sync-observer-1-yf6cja) states the new fix.

## Pending requests survive transport retirement — 2026-10-26

Luka's transport-upgrade design: the new connection is established first and communication moves
to it. The old and the new transport carry the same EVM-authenticated identity, so they are
interchangeable. Plan 28 asked that pending requests stay pending when the old transport is retired;
the implementation had reversed this and rejected them. Effect: a spectate sync to a phone peer was
rejected 4 s after a Holepunch-to-WebRTC upgrade, the SDK aborted, and the poker manager excluded a
healthy table.

1. [P2PManager.ts](../implementation/source/src/P2PManager.ts.md) `closeConnection` moves the
   closing transport's pending requests, with their deadlines, to another live transport of the
   same peer (`profile.getLiveTransports()`, without the closing one). Only a peer with no other
   live transport rejects them ("Peer disconnected before RPC response arrived").
2. [ARpcRouter.ts](../implementation/source/src/rpc/router/ARpcRouter.ts.md) adds
   `movePendingRpcRequests(from, to)`.
3. Spec: [rpc.md](../specification/peer-communication/rpc.md) correlation text and
   [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../specification/peer-communication/rpc.md#req-rpc-2-szdttm),
   [transport-upgrade.md](../specification/peer-communication/transport-upgrade.md) failure
   outcomes, and [`REQ-TJOIN-4-SDPZJW.T1`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-4-sdpzjw.t1)
   now state the move.
4. Test: `original transport retirement keeps its pending request pending on the replacement, whose
reply settles it` ([`UNIT-TEST-P2P-MANAGER-1-9DNSRZ.P25`](../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-1-9dnsrz),
   [`REQ-TJOIN-4-SDPZJW.T1.P3`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-4-sdpzjw.t1.p3)).
5. [createRoot.ts](../implementation/source/src/rpc/internal/createRoot.ts.md) `fetchedFiles` logs
   `requestMs`, `responseMs` and `protocol` (debug diagnostics only).
6. Fixed by Luka's decision: [`FIND-RPC-7-8JDKBK`](open-findings.md#find-rpc-7-8jdkbk). The remote
   side fired `onDisconnection` when its peer retired the old transport while still connected over
   the new one. [NetworkTransport.ts](../implementation/source/src/transport/NetworkTransport.ts.md)
   `afterClose` now fires it for an unexpected close only when the peer has no other live transport
   (`isPeerStillConnected`). [transport-upgrade.md](../specification/peer-communication/transport-upgrade.md)
   [`REQ-UPG-2-WH7BC7` (Re-authentication before cutover)](../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7)
   states the rule. Test: `reports no disconnection when the remote retires the original transport
while the replacement stays live, and one when the last transport closes`
   ([`UNIT-TEST-ATRANSPORT-1-7DGX9R.P13`](../implementation/source/src/transport/NetworkTransport.ts.md#unit-test-atransport-1-7dgx9r),
   [`REQ-UPG-2-WH7BC7.T1.P6`](../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7.t1.p6)).

Related items not changed:

- `DeferredAdmissionGuard` drops inbound requests queued on the old transport, as
  [`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) requires.
- Frames that arrive on a closed old transport are dropped (`src/rpc/router/NetworkRpcRouter.ts:80`).

## WebAssembly failure diagnostics and startup-failure log upload — 2026-10-26

Luka asked for all logging possible after a phone stopped fatally with `RuntimeError: unreachable`
in the prover's `__wbindgen_malloc` ([`FIND-RUNTIME-3-NWSN74`](open-findings.md#find-runtime-3-nwsn74)). His decision:
these diagnostics only; no change to the slot count, self-matching, or the number of instances.

1. New file [threadResources.ts](../implementation/source/src/utils/threadResources.ts.md) (no
   specified behavior; new family
   [`UNIT-TEST-THREAD-RESOURCES-1-AY7843`](../implementation/source/src/utils/threadResources.ts.md#unit-test-thread-resources-1-ay7843)).
   At its first import in a thread it wraps the `WebAssembly` `Instance` and `Memory` constructors,
   `instantiate` and `instantiateStreaming`, and counts this thread's live and created instances and
   memories; `trackWorker` counts root workers until their first shutdown ends. `getThreadResources`
   adds the JavaScript heap where the browser reports it; `getRuntimeEnvironment` reads the device
   from the navigator and, once the browser answers, the high-entropy client hints. `index.ts`,
   `internalRoot.ts` and `createRoot.ts` import it first, so it counts every instance created after.
2. [errorWire.ts](../implementation/source/src/rpc/internal/errorWire.ts.md): `SerializedError.wasmDiagnostics`.
   `serializeError` keeps the diagnostics of an earlier hop, or takes them now for a WebAssembly
   failure (a `RuntimeError`, `CompileError` or `LinkError`, or a message that names WebAssembly or
   Wasm memory): this thread's resources, a memory probe run once per thread, and the device.
   `deserializeError` restores the field. The SDK exports `getErrorWasmDiagnostics` and the types
   `RuntimeEnvironment`, `ThreadResources`, `WasmFailureDiagnostics` and `WasmMemoryProbe`.
3. Logs: [RemoteRoot.ts](../implementation/source/src/rpc/internal/RemoteRoot.ts.md) "Worker failed with pending requests" adds
   `wasm` and `resources`; [createRoot.ts](../implementation/source/src/rpc/internal/createRoot.ts.md) "Root worker started" and "Child
   root ready" add `resources`; [setupP2pRuntime.ts](../implementation/source/src/evm/p2pRuntime/setupP2pRuntime.ts.md) logs
   "Runtime resources" (resources and device) at debug level after its setup steps.
4. A worker whose startup fails serializes the error (this takes the WebAssembly diagnostics).
   When its root has a logger that is not disposed, it logs `Root worker startup failed` at error
   level with `error` and `wasm`, and lets that upload settle within the flush bound
   (`LogUploader.settleRealmUploads(CRASH_LOG_FLUSH_MS)`) before it posts `startupFailed`. Its
   parent still terminates a worker that never became ready without a drain wait, so the worker
   uploads its own lines before it reports the failure.
   Requirement: [`REQ-LOG-10-69CTN1` (A thread that is ending waits only for its own logs)](../specification/runtime/log-collection.md#req-log-10-69ctn1); new
   permutation [`REQ-LOG-10-69CTN1.T1.P6`](../specification/runtime/log-collection.md#req-log-10-69ctn1.t1.p6).

The logs now carry the user agent and, where the browser gives them, the device model and
platform version. They go only to the configured log endpoint, as every log line does.

The cases left untested here have tests since 2026-10-29 (PR #579 review): `.P5` and `.P6` of the
new family (`instantiateStreaming`, a refused probe grow), `.P6` of
[`UNIT-TEST-REMOTE-ROOT-1-7D9JVE`](../implementation/source/src/rpc/internal/RemoteRoot.ts.md#unit-test-remote-root-1-7d9jve), and `.P42` of
[`UNIT-TEST-ROOT-CREATION-1-1NWN3V`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v) with [`REQ-LOG-10-69CTN1.T1.P6`](../specification/runtime/log-collection.md#req-log-10-69ctn1.t1.p6); see
[the verification assessment](verification.md). Assessment: the reports match the code.

## Application chain access, local join-signature answers, closed-transport frames — 2026-10-26

Luka decided these changes in the shared poker client manager plan (poker-contracts
`9-shared-poker-client-manager`, section "Implementation-review decisions").

1. The SDK exports `createRpcNodesProvider(config, logger)` and the type `MultiRpcProvider` from
   [`index.ts`](../implementation/source/src/index.ts.md). [RuntimeChainContext](../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md) builds the
   runtime's provider through it; a start with no reachable endpoint now fails with "Chain access requires a
   reachable WebSocket provider at …". Requirement:
   [`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8).
2. [MultiRpcProvider](../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md) handles contract-log subscriptions itself:
   `_getSubscriber` gives an `event` subscription an `RpcNodesLogSubscriber`, which subscribes the filter on every
   node socket, also on reopened ones, and relays each log once by `blockHash:index`, dropping a log 128 or more
   blocks below the highest delivered log. Block and log relaying share `RpcNodesSocketSubscriber`. Logs a node missed
   while disconnected are not read again ([`FIND-RPC-4-7H2R11`](open-findings.md#find-rpc-4-7h2r11)); removals are not reported
   ([`FIND-RPC-6-CZ4GCV`](open-findings.md#find-rpc-6-cz4gcv)). In [RpcNodeProvider](../implementation/source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md),
   `NodeSocket.send` returns a never-settling answer for an `eth_subscribe` that failed because the socket was
   destroyed, so a destroy right after a subscription leaves no unhandled rejection; an error answer on a live
   socket still does ([`FIND-RPC-5-G4WNX5`](open-findings.md#find-rpc-5-g4wnx5)). The provider still never throws after its start
   while every endpoint is down ([`FIND-RPC-3-FY8YV3`](open-findings.md#find-rpc-3-fy8yv3)).
3. [JoinChannelService](../implementation/source/src/rpc/network/services/joinChannel/JoinChannelService.ts.md) `signJoinRequest` does only local
   work: the deadline against `Clock.getTimeInSeconds()`, and threshold membership through the new
   [MembershipService](../implementation/source/src/stateManager/membership/MembershipService.ts.md) `isSignerInThresholdSet`, which reads the local
   diamond mirror first and the chain only when the mirror does not list the signer. Requirement:
   [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v).
4. [NetworkRpcRouter](../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md) `onRpc` drops a frame whose transport is closed, and
   [WebRTCTransport](../implementation/source/src/transport/WebRTCTransport.ts.md) `onMessage` returns early on a closed transport. The old
   receive-after-close case of the network router family is deleted with its test. Requirement:
   [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../specification/peer-communication/rpc.md#req-rpc-6-e60s4j).

The exported entry's startup failure
([`UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P13`](../implementation/source/src/evm/p2pRuntime/RuntimeChainContext.ts.md#unit-test-runtime-chain-urls-1-vrhevw)) and the 128-block bound
([`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P18`](../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md#unit-test-multi-rpc-1-svggz5)) now have tests in
[RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md); each failed with the code
temporarily broken and passed with it restored. The WebRTC closed-transport early return
([`UNIT-TEST-WEBRTC-TRANSPORT-1-XEP60P.P6`](../implementation/source/src/transport/WebRTCTransport.ts.md#unit-test-webrtc-transport-1-xep60p)) now has a test in
[WebRTCTransport.test.ts](../verification/tests/test/utils/WebRTCTransport.test.ts.md); it failed with the early return removed.

Recorded today without a code change: the stale-proof blacklist of an honest sync responder
([`FIND-SYNC-7-SHT5K7`](open-findings.md#find-sync-7-sht5k7)), the duplicate probe sync during an initial sync
([`OQ-IMPL-SYNC-PROBE-1-1288ZV` (Duplicate probe sync during a runtime's initial sync)](../implementation/open-questions.md#oq-impl-sync-probe-1-1288zv)), the rejoin-after-eviction race
([`OQ-SPEC-JOIN-REJOIN-1-D506RT` (Rejoin after eviction collects against the disputed snapshot)](../specification/open-questions.md#oq-spec-join-rejoin-1-d506rt)) and the spectator reduction without the reduced latest
state snapshot ([`OQ-SPEC-REDUCE-SPECTATOR-1-1YWDC5`](../specification/open-questions.md#oq-spec-reduce-spectator-1-1ywdc5)).

## Initial-sync deadline hold, two-window sync default, browser worker failure cause and drain — 2026-10-26

Luka decided these changes in the shared poker client manager plan (poker-contracts
`9-shared-poker-client-manager`, section "Implementation-review decisions"). The two-window default is his
decision there: "The SDK spectate sync waits two agreement times before it gives up on a peer's answer".

1. The initial-sync deadline does not abort while a completed handshake's participant check, or the sync it
   started, is still running. The [P2PManager report](../implementation/source/src/P2PManager.ts.md) owns it:
   `syncIfParticipant` counts the running checks, with their syncs, in `participantChecksInFlight`, and
   `expireInitialSyncDeadline` marks an elapsed deadline as held (`isInitialSyncDeadlineHeld`) while one runs.
   Each check's `finally` fires a held deadline once no check or sync runs: a check that answers "not a participant", a check on a closed transport, and
   a rejected check (logged at error level and rethrown) all end in the abort. A settle cancels the deadline.
   Requirement: [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6).
2. The [SpectateService](../implementation/source/src/rpc/network/services/spectate/SpectateService.ts.md) `sync`
   default timeout is two agreement windows for every caller: the initial sync (which no longer passes its own
   timeout), and the block queue's exact-block sync for an absent sender and `probeSource`. The synchronization,
   targeted-join and runtime specifications no longer name a one-window default.
3. A browser worker failure carries its real cause. The browser
   [`createRootWorker`](../implementation/source/src/rpc/internal/browser/RootWorkerRuntime.ts.md) handles the
   error event, fails the root with a summary that names the cause, and logs `Root worker failed` with the event
   type, worker URL, worker name and time since spawn. Only a load or parse failure gets the one bounded
   diagnostic fetch, once. A failing log write does not change the outcome. Requirement:
   [`REQ-RUNTIME-8-M3ENFM` (An isolated context's failure names its cause)](../specification/runtime/execution.md#req-runtime-8-m3enfm).
4. A ready browser worker drains before it is terminated. `closeRootWorker` posts a closing message after the
   child settled its log uploads; the browser `drain` waits for it at most `CRASH_LOG_FLUSH_MS` plus the 1 s
   `ROOT_WORKER_CLOSE_MARGIN_MS` and warns when the bound wins. [`createRoot`](../implementation/source/src/rpc/internal/createRoot.ts.md)
   drains only a child that reached readiness, and drains before it closes the child connection. Requirements:
   [`REQ-RUNTIME-7-A2VAR0` (Bounded isolated-context teardown)](../specification/runtime/execution.md#req-runtime-7-a2var0),
   [`REQ-LOG-10-69CTN1` (A thread that is ending waits only for its own logs)](../specification/runtime/log-collection.md#req-log-10-69ctn1).

The cases left untested here have browser gate tests since 2026-10-29 (PR #579 review): an `ErrorEvent`
with no message ([`REQ-RUNTIME-8-M3ENFM.T1.P6`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p6)), a repeated load or parse failure event after the fetch
started ([`REQ-RUNTIME-8-M3ENFM.T1.P7`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p7)), the drain of a worker that already failed
([`REQ-RUNTIME-7-A2VAR0.T1.P15`](../specification/runtime/execution.md#req-runtime-7-a2var0.t1.p15)), and the host not reporting a handled failure event as an uncaught
error ([`REQ-RUNTIME-8-M3ENFM.T1.P8`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p8)); see [the verification assessment](verification.md).

Separate gap fill: [StepTimer.ts](../implementation/source/src/utils/StepTimer.ts.md) and
[EvmCustomPrecompiles.ts](../implementation/source/src/evm/EvmCustomPrecompiles.ts.md) came with HEAD `6bf307f32`
without file reports; both reports are now added. They are not part of the changes above.

## Authoring rollback after a refused inbound message — 2026-10-16

Observed 2026-10-16 on a live poker table: a player's `playTransaction` applied its action to the local VM, then the
pending inbound JOIN in the same transition was refused by the state machine, and the call threw without restoring
the VM. The local turn moved with no block stored, so every later action of that player failed as not its turn. The
[BlockProductionService report](../implementation/source/src/stateManager/block/BlockProductionService.ts.md) now
restores the VM on every exit that does not commit the block, through the one restore owner in
[SnapshotAssemblyService](../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md) that block
ingest already used. Evidence:
[`UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P15`](../implementation/source/src/stateManager/block/BlockProductionService.ts.md#unit-test-block-production-1-5ed0eb), which fails without the restore. Luka
decided that inbound consumption must succeed:
[`REQ-SM-12-J6QD9B` (Every chain-accepted inbound message MUST be processed successfully)](../specification/protocol-model/state-machines.md#req-sm-12-j6qd9b) requires a state machine to
process every chain-accepted inbound message, and the only allowed failure, running out of gas with a retry on fewer
inbound blocks, is deferred in
[`FIND-INBOUND-GAS-1-2BZ8DE`](open-findings.md#find-inbound-gas-1-2bz8de). The poker state machine's refusal of that
JOIN is fixed in poker-contracts. The full SDK gate passed on 2026-10-16
(`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3848/3848).

## PR #553 review corrections — 2026-10-15

A leave that ends in a non-final self-removal reduction that leaves no participant has two posters of the reduced
fork: the leaver's post once the reduced result is committed, and the reducer's adoption. The second post sent is
refused with `RaceConditionGenesisTimestampNotAvailable`, because the first one closed the channel. The adoption
treated that refusal as a failure and retried once. The
[ReductionExecutor report](../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md) now lists it
as a settled adoption refusal: after a mined reduce this revert can only mean that storage was cleared by a close.
[`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) and the
[LeaveChannelService report](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md) now
state the two posters, which matches the condition approved on 2026-10-14. Evidence:
[`REQ-LIF-10-QR8NQ9.T1.P31`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p31) with
[`UNIT-TEST-REDUCTION-EXECUTOR-1-DGAD37.P23`](../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md#unit-test-reduction-executor-1-dgad37)
(the adoption loses and is not retried) and
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P47`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9)
(the leaver's post loses, is logged, and is not fatal).

A post queued while the leaver's earlier post of that zero-participant state runs, for example by the reduced
result committed during the install-time post, was replayed only through the exit-block path and dropped. The
[LeaveChannelService report](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md) now
replays it through the membership check too, so the leaver still closes the channel when the reducer's adoption
and its retry fail. Evidence:
[`REQ-LIF-10-QR8NQ9.T1.P32`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p32) with
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P48`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9),
which fails without the replay.

That replay first ran both follow-ups. For an exit-block leaver whose exit leaves no participant, both post, so
the check queued another post behind the exit-block post, and refused posts ran back to back with no new block.
A queued post now gets one follow-up: the exit-block post when an exit block is committed, the membership check
otherwise. Evidence:
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P49`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9),
which fails with both follow-ups.

New tests close the leaver self-removal gaps, with no behavior change. A leaver whose latest state already excludes
it disputes with self-removal; removing an absent signer is a no-op, so the reduced fork pays its exit-block exit
exactly once ([`REQ-SM-10-JD8TSF.T1.P8`](../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf.t1.p8)).
A watchdog that expires after the leaver's observed-dispute submission starts no second dispute
([`REQ-LIF-10-QR8NQ9.T1.P33`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p33)); a self-removal
upload refused because the exit snapshot already landed is not fatal
([`REQ-LIF-10-QR8NQ9.T1.P34`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p34)); and a JOIN that
lands after every participant's exit block makes every exit post wait for the watchdogs' self-removal disputes, whose
reduction seats the joiner as the only participant and keeps the channel open
([`REQ-LIF-10-QR8NQ9.T1.P35`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p35)). The honest-leaver
overlap of [`REQ-DISPUTE-PIPE-8-BVR8XV.T1`](../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv.t1)
had lost its permutation; it is restored as `P11` and mapped to its existing test. Each new test fails with its guard
removed.

New tests close three join gaps, with no behavior change:
[`REQ-JOINSIG-4-3NBKHK.T1.P6`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p6)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P104`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(a prepared join to a full channel aborts),
[`REQ-JOINSIG-4-3NBKHK.T1.P7`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p7)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P105`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(a full-channel refusal is not retried after the snapshot moves), and
[`REQ-JOINSIG-1-8X1A4V.T1.P24`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p24)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P106`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(the top-up retry cap). Each of the five tests fails with its guard removed. They passed in the full SDK gate on
2026-10-15 (`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3847/3847).

## Concurrent joins exhaust the one join retry — 2026-10-15

Observed 2026-10-15 on a live poker bot: a synced spectator submitted its first join to a new table and was
refused with `ErrorJoinChannelConfirmationNotThresholdSigned`. The join retried at once: the fresh collection read
the threshold set, collected from it and was refused again with the same error within one second, and the refusal
aborted the runtime. Root cause: several peers joined the table at the same time. Each join that lands widens the
threshold set, so the retry's fresh confirmation was refused again for yet another newly landed joiner, and the
rule of one retry made that second refusal final.

A first fix waited, before the retry, until the joiner's threshold set read listed the refused set. Luka rejected
it: a threshold refusal proves the wider set is already on chain, so a fresh read at the refusal or later sees it,
and the wait guarded a case that does not occur. The wait, its staging and its evidence were removed.

Luka approved the fix. In the [ChannelJoinService report](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md)
`runJoin` and `runTopUp` now retry recursively: while a submission is refused and
`shouldRetryWithFreshConfirmation` judges the refusal a race against the latest submission's pins (a widened
threshold set, or a snapshot moved to a stored one), they collect a fresh confirmation and submit again. The
number of retries is capped at the channel's maximum participant count (the deployed value the runtime already
holds in its queue storage; no extra chain read). One cap covers both races: each threshold
refusal means one more member landed, and the set cannot grow past that count, since enforcement refuses a join
to a full channel finally with `ErrorTooManyParticipants`. The join keeps its earlier invariants each round: the
refused attempt is marked retrying before the decision, a join that ended or a runtime disposed during the fresh
collection submits nothing more, a collection that fails ends the join `SYNCED` without abort (a top-up returns
`false` and keeps its participation), and a runtime disposed while a submission is pending handles no refusal.
The specification states the rule in
[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
and [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7).
Evidence: [`REQ-JOINSIG-1-8X1A4V.T1.P19`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p19)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P93`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(two joins land one after another while the joiner's submissions are held; it lands on its third submission),
[`REQ-TJOIN-5-Q795M7.T1.P25`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p25)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P97`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
and [`REQ-JOINSIG-1-8X1A4V.T1.P22`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p22)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P96`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(a join and a top-up whose snapshot moves twice); all three fail on the code with one retry. The cap:
[`REQ-JOINSIG-1-8X1A4V.T1.P20`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p20)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P94`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(a channel of four, a snapshot move before each of five submissions) and
[`REQ-JOINSIG-1-8X1A4V.T1.P21`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p21)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P95`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(the second landed join fills the channel; the retry's `ErrorTooManyParticipants` is final). The disposal guard
keeps its evidence:
[`REQ-JOINSIG-1-8X1A4V.T1.P18`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p18)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P92`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb).
Concurrent joiners still race on chain and pay gas for refused submissions; coordinating them is deferred in
[`FIND-JOIN-2-EK5DWW`](open-findings.md#find-join-2-ek5dww). These passed in the full SDK gate on 2026-10-15
(`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3847/3847).

Luka's decision 2026-10-15 on full channels: a connect's first join reads the chain's seated and pending
participants before it collects; a channel already at its maximum participant count gets no countersignature
request and no submission. A full channel, found by that read or by enforcement's `ErrorTooManyParticipants`
refusal (also of a retry), aborts the runtime by default, which suits bots; the new connect option
`shouldSpectateWhenFull` keeps it `SYNCED` spectating instead. This changes the earlier final refusal, which only
returned to `SYNCED`. `ChannelJoinService` owns the rule: `collectAndJoinChannel` does the read
(`isChannelFull`, through `MembershipService.getOnChainParticipantUnion`) and the collection, and both the read
and `onJoinRefused` use `onChannelFull` for the reaction; the prepared-confirmation `joinChannel` makes no read
and uses the default. The specification states it in
[`REQ-JOINSIG-4-3NBKHK` (Full-channel join)](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk).
Evidence: [`REQ-JOINSIG-4-3NBKHK.T1.P1`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p1)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P98`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(fails on the code without the read: the founders answer three requests),
[`REQ-JOINSIG-4-3NBKHK.T1.P2`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p2)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P99`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb),
[`REQ-JOINSIG-4-3NBKHK.T1.P3`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p3)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P100`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb),
[`REQ-JOINSIG-4-3NBKHK.T1.P4`](../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk.t1.p4)
with [`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P101`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)
(a pending participant fills the channel; a seated-only read would collect),
and the updated [`REQ-JOINSIG-1-8X1A4V.T1.P21`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p21) (now an abort). These passed in the full SDK gate on 2026-10-15
(`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3847/3847).

## Lone leaver's self-removal reduction is never posted — 2026-10-14

Observed 2026-10-14 on a live poker bot: the last participant of a channel left. No one could co-sign its exit,
so the leave watchdog started the self-removal dispute. That dispute is threshold-final at upload: the chain
commits the reduced result at once but does not change the channel's snapshot. The leaver installed the reduced
genesis, which has no participant, and kept `PARTICIPATING` until the chain drops it. Only a post of the reduced
fork drops it (with no participant the post closes the channel), and nobody posted it: the reduction executor
adopts a fork only after its own non-final reduce is mined, the leave posts only on finalized blocks after a
committed exit block, and a fork with no participant has no further block. `checkLeft` then found the signer gone
locally but still on chain and returned, so `onLeftChannel` never came and the application's leave waited forever.

Luka approved the fix. In the [LeaveChannelService report](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md)
`checkLeft` now starts one exit post when an exit is pending, the signer is not in the installed state, the chain
still lists it, and the installed state has no participant. The post runs through the existing exit-post path
(`postStateSnapshotWait` on the installed fork), so its single-flight rule, refusal list and fatal handling are
unchanged. The fork preparation walks from the disputed on-chain fork through its final reduced result to the
installed genesis; the same-fork part is empty because the new fork holds no block. The mined post closes the
channel, and the existing snapshot event path drops the membership and emits `onLeftChannel`. A reduced state
that keeps other participants is left to them (their next post or the reducer's fork adoption carries it), so the
leaver posts nothing there; a signer already off the chain drops its membership as before. The specification
states the case in [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9).
Evidence: [`REQ-LIF-10-QR8NQ9.T1.P29`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p29) and
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P45`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9)
(both time out waiting for `onLeftChannel` on the code before the fix), and
[`REQ-LIF-10-QR8NQ9.T1.P30`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p30) with
[`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P46`](../implementation/source/src/stateManager/membership/LeaveChannelService.ts.md#unit-test-leave-channel-service-1-cx6qh9) for the reduced state that keeps other participants. These passed
in the full SDK gate on 2026-10-15 (`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3847/3847).

## Exit post after the channel closed — 2026-10-14

Observed 2026-10-14 in the poker gate: two members left in the same snapshot post and the chain closed the
channel. A third member, seated through spectator sync after an early outbound block was already on chain, still
had an exit post queued. That post ran after the close was mined. The same-fork preparation read the deleted chain
snapshot (fork ID zero), took the local fork-genesis fallback and walked the outbound blocks from that genesis to
the finalized head. The member did not hold the early block, so the walk threw `Block hash … not found in
storage`. The leave service rethrows any error that is not a chain refusal, so the runtime host failed and the
application treated the runtime as dead before its terminal leave settled.

Luka approved the fix. `prepareUpdateSnapshotSameFork` in the
[SnapshotUpdateService report](../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md)
now returns the empty, not postable result when the base snapshot read from the chain has fork ID zero, before the
genesis fallback, the state proof and the outbound walk. Fork ID zero means the chain holds no snapshot for the
channel: it was never opened or it was closed (the zero-participant close deletes the snapshot). An open channel
always has a nonzero fork ID (a hash of its snapshot data), and a base passed in from the fork-update preparation is
a genesis snapshot with a nonzero fork ID, so no other path reaches the check. With no chain snapshot, no same-fork
or fork update can land (the same-fork update needs equal fork IDs; the fork update needs a reduction chain from the
current fork), so the fallback prepared nothing usable here. Every other path is unchanged. The specification states
the case in [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9). Evidence:
[`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P23`](../implementation/source/src/stateManager/snapshotUpdate/SnapshotUpdateService.ts.md#unit-test-snapshot-update-service-1-a4b38n)
and [`REQ-LIF-10-QR8NQ9.T1.P26`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p26); both passed in
the canonical gate run-3197 on 2026-10-14 (`yarn test:parallel:distributed --test-parallel-script --test-browser`,
3770/3770), which ran the content committed as `c4948a5`. After that run the P26 staging was changed in review
(AO2: the remaining founders keep authoring until the leaver is SYNCED, CY1: the missing-block premise uses the
control query); the oracle is unchanged.

## Bounded root worker drain — 2026-10-14

Observed 2026-10-14: a poker bot disposed a `P2pInstance` whose runtime host ran in a worker thread. The host
acknowledged its lifecycle dispose, but the worker thread never exited. `createWorkerShutdown` waits for
`exit` with no timeout, so `P2pInstance.dispose()` and the client's leave stayed pending forever. Inspection
of the stuck worker found no active handle or request, only one `Timeout` resource (most likely the
inspector's), Hyperswarm and HyperDHT destroyed and both UDX sockets closed. Something Node does not list
held the loop ([`FIND-WORKER-DRAIN-1-EKYJQV`](open-findings.md#find-worker-drain-1-ekyjqv)).

Luka approved a bounded drain and its diagnostics. The node
[`closeRootWorker`](../implementation/source/src/rpc/internal/node/RootWorkerRuntime.ts.md) now unreferences the
bootstrap port instead of closing it and arms an unreferenced deadline (`ROOT_WORKER_DRAIN_TIMEOUT_MS`, five
seconds). If the loop has not drained by then, the worker posts its active, referenced libuv handles and its
active resource kinds over the bootstrap port and exits itself with `ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE`
(86). `createRootWorker` treats that code during an expected shutdown as a drain timeout, not a failure, and
warns through the parent root's logger, which [`createRoot`](../implementation/source/src/rpc/internal/createRoot.ts.md)
now passes in. The parent still never terminates a worker. The browser worker is unchanged: its shutdown
terminates the worker, which is safe in browsers, so it cannot hang this way. Requirement:
[`REQ-RUNTIME-7-A2VAR0` (Bounded isolated-context teardown)](../specification/runtime/execution.md#req-runtime-7-a2var0).
The three drain cases passed in the SDK gates run-3195, run-3196 and run-3197 on 2026-10-14; run-3197
(`yarn test:parallel:distributed --test-parallel-script --test-browser`, 3770/3770) ran the content committed as
`c4948a5`.

## Worker teardown stall before the drain bound — 2026-10-14

Observed 2026-10-14 on live poker bots that run the SDK built from `c4948a5`: right after a protocol bust
("Left the channel", SYNCED, peers disconnected) the application disposed the runtime. The parent logged the
host's lifecycle `dispose` reply (`ok`, about 1.4 s) and then waited for the worker's `exit` forever; no drain
warning ever appeared, in two of three bots within five minutes. The parent had closed its connection
(`isClosed`) and waited in `createWorkerShutdown`. The worker listed no active handle or request and one
referenced `Timeout` resource. A drain bound that had been armed would have ended that worker within five seconds
whatever held its loop, so the worker never armed it: its teardown stopped before `closeRootWorker` armed the
deadline.

Cause, reproduced with real workers: the node `closeRootWorker` closes every handle Node lists, in one
`forEach`. A dgram (UDP) socket whose owner already called `close()` stays listed until its close completes,
and a second `close()` throws `ERR_SOCKET_DGRAM_NOT_RUNNING` synchronously. The throw rejected `closeRootWorker`
before it closed the remaining handles, unreferenced the bootstrap port or armed the deadline. The rejection
reached `RuntimeLifecycleService.completeDisposal`'s catch, which reports to the host root; that root is
disposing, its logger is disposed, so its error callback swallows the report. A worker whose loop is then still
held, by a remaining handle or by a referenced timer, lives forever with no warning. In the SDK runtime host the
only dgram owner is werift (WebRTC in Node through `get-webrtc`), whose ICE sockets close asynchronously when
peer connections close at disposal and whose own `close` wraps the same throw; werift's referenced timers match
the one `Timeout` seen. The bots' WebRTC use at the bust is not confirmed from their logs. The first hypothesis,
a `disposed` request that stays pending when the parent closes its connection first, is refuted: an
instrumented worker shows the close rejecting the pending request and the teardown continuing.

Fix: `closeHandle` absorbs a handle's refusal of a second close (`ERR_SOCKET_DGRAM_NOT_RUNNING` only; any
other close error is rethrown), so the remaining handles still close and the loop drains. `closeRootWorker` now arms the 5 s `ROOT_WORKER_DRAIN_TIMEOUT_MS` deadline first, before it closes
any handle, so nothing in the handle closing can skip the bound. The exit is unconditional: diagnostics
collection and the post run in `try` and `process.exit(86)` in `finally`, so a failed collection posts no
diagnostics and the worker still exits (review FY1). The parent handler is unchanged: an expected shutdown that ends with exit 86
warns with the worker, `drainTimeoutMs` and the diagnostics, and an exit the owner did not request stays fatal,
code 86 included (review TO1). The parent still never terminates a worker.

A first version of this fix also bounded the whole worker teardown: per-step deadlines (a 30 s teardown bound
from accepting the dispose, the drain bound from closing connections) reported through a lifecycle hook, with the
pending step in the diagnostics. It was removed in review as over-engineered: the observed stall was the refused
close, which the fix above removes, and a domain cleanup that never settles is not observed.

Native resources (review FO1): a worker that exits itself with a bound native udx socket open ends cleanly and
the parent process survives (child-process case; also scratch runs with a live Hyperswarm and with udx sockets
mid-close, where the parent's `terminate()` did not abort either). The `workerShutdown.ts` premise holds for that
case; a native request that never completes is still not covered.

The worker startup timing hook (`workerStartupTiming.ts`) is deleted with its report. It timed a worker's
first `message`, which root workers never posted, so it never ran; the drain message would have made it log a
wrong boot time. The runner's `workerBootMs` marker summing now has no emitter (it always read 0).

## PR #520 third-review and CI corrections (2026-10-07)

The [localDiamond report](../implementation/source/src/utils/localDiamond.ts.md) now anchors its
conformance claims to the current declarations and expressions. The
[stale-membership test report](../verification/tests/test/e2e/E2E-StaleMembershipDispute.test.ts.md)
records direct malicious-dispute submission instead of a double-sign trigger that also opened an
unrelated honest dispute. The
[balance-invariant test report](../verification/tests/test/e2e/disputeValidation/balanceInvariant.test.ts.md)
records the previously approved 15-second evidence window for both sequential audit orders.
Their existing membership-fraud, exact-counter, slash and reduction oracles are retained.
The CI artifacts demonstrate expired evidence/kill windows, not an invalid membership-proof verdict.
No SDK or contract behavior changes are made for these failures; the sync-reduction gas finding remains deferred.

## PR #520 second-review corrections (2026-10-07)

The local-first revert behavior is unchanged: local errors propagate without a chain fallback.
The [local-mirror test plan](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1)
now names separate fatal-revert permutations for the four audit predicates and dispute construction.
Their existing declarations are mapped in the
[audit-read report](../verification/tests/test/unit/DisputeValidationServiceLocalFirst.test.ts.md)
and [construction report](../verification/tests/test/unit/DisputeManagerLocalFirst.test.ts.md).
The [local binding report](../implementation/source/src/utils/localDiamond.ts.md) also removes
obsolete revert-fallback claims and gives the helper's two revert tests explicit obligations.
This repairs traceability, not the deferred sync-reduction gas finding; that finding remains open.
Runtime validation is recorded in the private round-two assessment; this paragraph makes no
claim that the full gate passed on the modified tree.

## PR #520 author decisions (2026-10-07)

Luka confirms the deliberate fixture timing increases, including `balanceInvariant`’s 15-second evidence
window, as exceptions permitted by the test guidance. Keep PR #520 targeting `crew/cost-scheduler`;
its base-relative integration scope is intentional. Neither decision certifies runtime tests or closes
unrelated protocol findings. The P2P timing changes were also explicitly requested earlier.

Luka deferred SO1 and its complete local/on-chain reduction gas investigation outside this PR; see
[`FIND-SYNC-REDUCTION-GAS-1-AJE985`](open-findings.md#find-sync-reduction-gas-1-aje985).
Successful on-chain replay must be established in the follow-up. Local exhaustion alone does not prove
on-chain impossibility, and this PR does not change reduction failure handling.

## Join and top-up retry after a snapshot move — 2026-10-11

Luka's review-six XO1 decision makes the automatic snapshot-race retry one logical join, encapsulated
inside [ChannelJoinService](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md).
The public promise stays pending during the internal retry; the refused attempt exposes no transient
`SYNCED`, membership-end event or final failure. Retire its deadline and stale checks before the fresh
collection. The one-retry bound, same balance and existing final outcomes remain unchanged. This is a
deep-module ownership decision, not a new public retry API or feature-specific RPC recovery path.

`runJoin` awaits fresh collection without settling the public promise; the refused attempt's record is
marked retrying, so join checks skip it, and its timer is cancelled; after collection a disposed runtime or
a record that is no longer current submits nothing ([`FIND-JOIN-RETRY-LIFETIME-1-447RDE`](open-findings.md#find-join-retry-lifetime-1-447rde)). A refusal for a threshold
set a landed join widened (`ErrorJoinChannelConfirmationNotThresholdSigned`) takes the same retry. After
its own force-join dispute starts, `checkJoin` runs `checkJoinDropped`, which drops an observed join that
both the local state and the chain omit (review six FR1). The owner cases and their mapped tests passed in
the recorded full SDK gate.

Review 8 RO1 (2026-10-11): a check already past its entry guard could still end the join after the record
became retrying, because its continuation checked only the record id. `runJoin` now marks the refused record
retrying and cancels its timer before the retry-eligibility read, and every check, timer callback and record
update re-reads that the record is current and not retrying (`isActive`) after its awaited reads. Implemented;
the interleaving case is added in this pass and its verification is pending the next gate.

`hasSnapshotMovedToStoredOne` throws on a failed read under the SDK-wide RPC assumption. A failed fresh
collection returns `false` with no second submission and ends the join `SYNCED` without abort; top-up
failure keeps participation. A second submission failure is final under its existing classification.
Uncertain submissions are not retried. No code or test was changed by this decision. The
intermediate-state and lifetime cases ([`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P74`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb)–`.P77`) are mapped to
tests that passed in the recorded full SDK gate.
Owning requirement: [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v).

## Live blocks wait for the initial sync — 2026-10-11

Luka decided review 7 FO1: a live block that a peer sends while the runtime runs its initial sync is
retained, not dropped for later redelivery. The new `WaitForSyncStatusGuard` in the `StateTransitionService`
RPC guard chain holds such an RPC until the status is `SYNCED`, `PENDING_PARTICIPANT` or `PARTICIPATING`, then
runs it again through the whole guard chain and normal validation and fork handling, in arrival order; the
sender does not resend it. A retained block neither advances state nor starts a second sync, and the initial
sync applies its own blocks through the ingest service, outside this RPC path. An abort drops what is
retained. The `BlockQueueManager` branch that dropped a different-fork block while `OPENED` is removed. This
is a new guard, not `DeferredAdmissionGuard`, and it inherits none of its expiry or transport policies.
Implemented; the specification sentence, owner cases and tests are added in this pass, and verification is
pending the next gate.

## Local discovery dial marks per session — 2026-10-09

The [local adapter](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md) keeps its process-wide in-flight dial set per manager for cross-topic de-duplication. Each mark now records the dial attempt that owns it, and the mark is also recorded in the discovery session that made it. A session's leave removes the marks its dials still own. Before this change, the mark of a dial still in flight survived the leave until that dial's socket closed, so a later observation of the topic could not dial the peer until then (the P32 defect). Clearing the mark at leave opened a new window: the old dial's late close could delete a mark that a newer session had set for its own dial, and one more dial to the peer could then start on another topic before the first one authenticated. Dial ownership (2026-10-10) closes that window: a close or a leave removes a mark only while its own attempt still owns it. A peer that is really connected is still refused by the open-connection and live-profile checks, so no duplicate live connection results. Component cases [`UNIT-TEST-LOCAL-DISCOVERY-SERVER-1-1W1GY5.P17`](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md#unit-test-local-discovery-server-1-1w1gy5) (a later observation dials while the left dial's close lags; also [`REQ-LOBBY-9-N894C0.T1.P32`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p32)) and `.P18` (the left dial's late close keeps the newer mark, and a third topic starts no second dial; also [`REQ-LOBBY-9-N894C0.T1.P33`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p33)) cover this. Both fail on the code before the respective change. A public lobby rematch end-to-end case with a held close is not added: holding the close needs inline mode and a paused private socket, and the component cases drive the same `joinDiscoveryKey`/`leaveDiscoveryKey` path the lobby uses.

## Local discovery endpoint replacement

The local adapter now retains the latest endpoint announcement per peer within its topic session and resolves it at retry. Previously an announcement arriving during a stale endpoint dial could be discarded by cross-topic deduplication, leaving retries permanently targeting the closed port. The existing authenticated transport and pending-dial admission gates remain; new endpoint metadata does not bypass authentication. Pending-dial admission spans only the currently joined topic sessions: a leave drops its session's pending-dial marks, so a rejoin dials before the left dial's socket finishes closing ([`FIND-DISCOVERY-2-0FP84C`](open-findings.md#find-discovery-2-0fp84c)). See the [source report](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md) and [component evidence](../verification/tests/test/utils/LocalDiscoveryServer.test.ts.md). Historical cost run 435 and FIFO (`-w 6`) run 436 were reported to pass all 3,405 tasks, including Forge and both browser gates, with no starvation or infrastructure retries. Their exact source SHA has not been established; they are not evidence that the current PR head passes. Subsequent runner and dispute-test changes require fresh validation.

## Runtime cleanup and context forwarding

[LocalDiscoveryServer](../implementation/source/src/utils/node/LocalDiscoveryServer.ts.md) checks the accepting manager before constructing an inbound transport, including while shared discovery remains active. [LoggerService](../implementation/source/src/rpc/internal/services/logger/LoggerService.ts.md) suppresses context echo to the inbound connection, so rapid channel changes do not replay older values between adjacent roots. These repairs preserve the existing lifecycle and identity requirements.

## Root ownership and startup

[AInternalRpcRoot](../implementation/source/src/rpc/internal/AInternalRpcRoot.ts.md) owns the parent and children and the shared disposal sequence. Each concrete root implements abstract instance startup and disposal. Common creation constructs the class and retains the instance before awaiting startup; no separate static lifecycle interface remains. Host preparation stops and drains work before recursive child disposal; final cleanup runs even after an earlier failure. [RemoteRoot](../implementation/source/src/rpc/internal/RemoteRoot.ts.md) keeps RPC access, diagnostics and connection lifetime together. Application setup remains outside the client communication root.

The bridge tree is host, worker bridge, then main-thread broker. The port travels through services; external broker installation does not block readiness. An unattached broker connection can be disposed without waiting for installation. Built-in worker URLs are internal platform assets. Thin worker entries explicitly start their roots. Root imports are inert; class names no longer select bootstrap. Worker policy is common and threadName is diagnostic global state. Public worker overrides and the separate executor dependency bag are removed.

Each RuntimeHost creates its fallback bridge and binds its factory to that host’s WebRTC setup service. Native WebRTC still uses the local factory. Separate inline hosts cannot replace each other’s bridge or peer maps.

## Shared runtime RPC ownership

Each manager now owns one [NetworkRpcRouter](../implementation/source/src/rpc/router/NetworkRpcRouter.ts.md), constructed before services and without active constructor work. The manager no longer inherits request tracking. Unused manager routing delegates have been removed; transport ingress, requests, broadcasts and disconnect rejection reach that same router directly. Network/internal services and internal roots have explicit category bases and reside under `src/rpc`; all routers share `src/rpc/router`.

The manager dependency remains explicit after extraction: live connections, root, logger, scheduling and peer-policy methods are used directly. No smaller dependency abstraction is needed for this move. Common transport forwarding uses a typed sender/router contract. Network conversion and internal structured clone remain distinct, including live-resource transfers. Receive-after-close behavior is preserved: internal input is filtered at the runtime router, while network admission remains unchanged. No new universal closed guard is claimed.

The runtime refactor separates [network transports](../implementation/source/src/transport/NetworkTransport.ts.md)
from [internal port transports](../implementation/source/src/transport/InternalTransport.ts.md).
[ARpcRouter](../implementation/source/src/rpc/router/ARpcRouter.ts.md) owns all request registration,
correlation, deadlines and settlement. [RpcDispatch](../implementation/source/src/rpc/RpcDispatch.ts.md)
owns endpoint lookup and one response-send attempt. The shared router awaits service.runRPC. RpcDispatch keeps execution and response construction together; category services retain local guard and error/reply policies. Guard replay calls the original service, whose consumed verdict prevents early acknowledgements. Independent transport callbacks preserve concurrent ingress. Peer admission, authenticated
replacement response admission belongs to NetworkRpcRouter; penalties remain manager operations and peer guards remain network-service policy.

Each SDK/client/executor endpoint composes one root across its connections. SDK setup owns
executor creation and the common facade in both placements. Inline calls cross a MessageChannel;
abort disposes the owning host root and its children in both placements. Local initiation sends a disposal notification before closing its parent connection; request-driven cleanup sends its response first. Parent handles retire the connection and await worker shutdown without sending another cleanup request to a closed port. The engineer confirmed full abort cleanup on 2026-09-11.

The old SDK, executor, WebRTC and logger protocols, duplicate pending registries, logger bus and
standalone public executor factory are removed. Domain error preparation, signer encodings,
readiness order, worker first-fatal error selection and report-and-continue callbacks retain their
owners. Explicit transfer lists reach postMessage once. The impact checker reads removed reports
from the selected Git comparison and keeps missing ownership/migration visible.

Logger collection walks each root’s parent and child connections, including worker
children owned by inline SDK roots. Each caller receives its local upload outcome; gossip has no global completion total. The removed folded-summary collection policy imposes no current completion obligation; other logger limitations remain separately recorded. Manifest functions and live resources cannot
cross the approved inline structured-clone boundary.

The simplification review fixes narrow bytes32 inputs through an assertion signature and remove the remaining queue-key forwarding method. The separate import-order change preserves all non-import executable statements, all imported bindings, and side-effect import boundaries. Runtime initialization order is checked by the distributed and browser gates; TypeScript suppression comments remain attached to their original imports.

Post-handshake connection ownership is now centralized in `P2PManager`. Local channel status is
the only admission input: every completed live transport is promoted, while `OPENED` alone performs
the participant read and sync. Join and spectate RPC paths provide no alternate promotion or
peer-supplied membership hint. Participant-read failure, close, disposal, and replacement races are
contained without undoing valid authentication or creating a late connection.

Every network transport creates an addressless `PeerProfile` immediately, and the Holepunch ban handle is
stored there before authentication. `ProfileManager` authenticates and indexes that same profile and
owns all ban/unban policy. Generic transports expose no SDK ban handle. Fallback release checks the
profile's full live transport set, so a non-preferred WebRTC transport in upgrade grace keeps Holepunch
banned and explicit blacklist state wins.
Authentication is also a final admission gate: a late Holepunch connection cannot replace healthy
WebRTC or reattach an excluded identity, while a fallback after current-WebRTC close can become
current and carry traffic.
Relay retry state has one owned timer, which success cancels before resetting the pool. Holepunch
topic join/leave retains its byte-exact `Buffer` contract.

Join admission now keeps recorded membership separate from countersign eligibility: snapshot and
pending participants remain members, on-chain-slashed members lose veto power, and slashed members
cannot top up. The public paths preserve exact fork/snapshot pins and deadline semantics and invoke
the manager's atomic composable-deposit path; the manager, not the facet, owns the inbound JOIN
append and cumulative-total update.

Off-chain join authorization uses the same slash-excluding threshold set on collector and
responder paths. The collector now rejects a deadline with no positive collection window before
it signs or sends requests; positive windows cap every request at the earlier of the agreement
timeout and the join deadline. The responder keeps the inclusive deadline boundary used by
on-chain submission.

Snapshot submission now has explicit component obligations for admissible submission, unresolved
reduction stand-down, unconsumed-inbound preparation refusal, and no on-chain mutation after that
refusal. Forced-inclusion verification follows the pending JOIN through reduction into the
successor participant set and through one complete leader-election cycle where the joiner authors
an accepted block.

The runtime lifecycle waits for the application root's readiness hook before admission and preserves readiness failures while disposing partial resources. Each isolated context starts monitoring after its own ready work and uses the same configured fatal-delay threshold. The test harness starts its main-thread monitor after initial peer setup.

Runtime extension boundaries no longer depend on constructor identity for RPC services, transports, or ethers Result values. They validate the complete public shape consumed by the caller, so compatible SDK and ethers copies can coexist in one production bundle without breaking proxy resolution, dispatch overloads, or result normalization. The linked source reports and runtime design views record these boundaries; engineer review remains pending.

Inbound RPC endpoint authorization is separate from those structural checks. The dispatcher walks the
application methods hierarchy only up to `ANetworkRpcMethods.prototype`, accepts function-valued data properties,
rejects base members and accessors, and invokes the captured function on both delivery paths. This resolves
[`DEF-7-PK564B`](open-findings.md#def-7-pk564b) without breaking inherited application endpoint families.

RPC wire parsing, ingress ordering, guards, and every implemented request-settlement path now have
exact component obligations and evidence. Request settlement remains partial because there is no
cancellation API. Resource control remains partial: the frame-size bound exists, but pending-call,
per-peer, and aggregate work limits do not. Protocol compatibility remains missing because neither
the envelope nor handshake negotiates a version. [`DEF-8-HWJ10N`](open-findings.md#def-8-hwj10n)
is resolved: handler and guard response sends use one guarded attempt, then disconnect on failure
without a second send or unhandled rejection.

The authenticated-RPC guard records admission per exact transport. A replaced but open authenticated
pipe remains valid during upgrade grace overlap. Queued work releases only when its own transport
authenticates; closure, timeout, and disposal clear it, and stale failure cannot punish a replacement.
A frame dispatched after local transport close is dropped instead of treating retirement as peer malice.

The runtime event bridge also preserves application-defined hook names and cloneable payloads without adding
those names to the SDK hook declaration. The EventBus source report and real worker-to-client test now own
that extension contract.

The canonical codec now exposes typed decode overloads for every mapped protocol and proof schema,
including the previously omitted inbound-hash dispute proof. Its source report covers the full enum,
EVM-result, Result-normalization, cache, and failure surface.

The ethers Result proxy now keeps callback-wrapper identity after one listener removal, so repeated
registrations can also be removed repeatedly through the original callback. Its source report now
records the complete method, listener, event-log, query, and passthrough boundary instead of only
the structural Result predicate.

Other file reports' requirement bullets, recorded divergences, and unit families remain visible in generated coverage.

Balance validation, byte/key conversion, same-block copy merge, frame classification and log reporting have single owners. Extraction retains input/error order, raw commitment comparisons, timestamp-defined checks, response precedence and platform timer lifetime. Existing strategy instanceof checks remain. The deleted connectivity utility had no reachable consumer; each of its five data-type IDs retains other source contributors.

## Targeted pre-open channel join assessment — 2026-08-31

The implementation keeps `joinLobby` and `connectToChannel` as separate public wrappers over one generic
matcher and one negotiation service. The targeted wrapper holds a fixed ID, consumes direct mode-specific
negotiation outcomes, performs one exact-channel post-open entry, and calls existing sync and membership
owners. Full balances survive client/worker/peer encodings. The state machine's neutral zero and existing
lesser-than operation remain the remote trust boundary. Match acceptance removes matcher timeout and
cancellation ownership before negotiation.

SO5 is deliberate: one valid selected-peer response supplies usable state for later enforcement; selected-peer
failure proves the early cooperation precondition failed and permits no fallback before abort. RO3 is peer
identity response authority, not rebinding or resend. RY3 is targeted-only and skips opening submission after
the attempt has handed off to an authoritative open. Pending/participating failures preserve the attached
runtime. The normal Hyperswarm one-live-connection-per-unique-peer handoff remains an accepted production
assumption; automated coverage uses `DEBUG_LOCAL_TRANSPORT` and proves only transient duplicate cleanup.

## Focused safety follow-up — 2026-09-01

LocalDiscovery topic sessions now own active dial keys and capped-backoff retry timers. An authenticated close
recreates an eligible connection only while the exact session remains active; `leave` removes the session and
cancels its timers before closing registry and listener ownership. The existing `P2PManager` blacklist check
blocks replacement. `MembershipService.joinChannel` now sets local pending status before contract invocation,
restores `SYNCED` only after a proven no-commitment result, and preserves pending on uncertainty. Force-join
checks defer until authoritative on-chain membership and a usable window, with one stored start flag.

## Peer-fault call-site audit — 2026-09-01

The audited ingress and handshake call sites now state `DisconnectPolicy.BLACKLIST` with a reason at
the one close entry point for attributable wire violations (2026-09-18: the former
`disconnectAndBlacklistPeer` helper is gone). The switch prefers the authenticated address, so a
fault received on a retired transport still blacklists the current profile and closes both current
and reporting transports.
Lifecycle cleanup, network loss, timeouts without proof, response-send failure, and local dispatch
exceptions continue to call `disconnectConnection`.

Logger service composition follow-up: logger binding and release now belong to LoggerService. The root exposes generic close subscriptions and retains explicit common-service composition. Existing readiness points and collection behavior remain unchanged.

Common lifecycle composition: every internal endpoint owns readiness and quiescence through its lifecycle service; root disposal owns the child cascade and local cleanup. SDK deployment completion remains separate. Repeated cleanup shares completion, and domain readiness points stay unchanged. Forced port removal remains distinct from graceful request/acknowledgement cleanup.

## Common root creation follow-up

[createRoot](../implementation/source/src/rpc/internal/createRoot.ts.md) now owns channel creation, parent/child registration, exact inline links and worker cleanup. SDK and executor callers pass their receiving root class and entry URL. Thin worker entry files call the shared worker startup with their root class; root imports do not start workers. Built-in launch sites import bundler-emitted URLs internally; the platform adapter creates the module worker.

All launched roots use the shared worker-global initializer before domain imports. Inline hosts do not receive a worker-close hook. On Node, unexpected executor exit supplies the fatal cause before transferred-port close settles requests. Concrete root cleanup runs before platform shutdown. The old runtime and entry reports moved with their obligations; no new network exposure or request registry was added.

Current source counts and per-owner changes are recorded in the implementation handoff after verification.

## Initialized root creation follow-up

The free createRoot function takes the root class and an explicit worker URL, then awaits initialization and child readiness; SDK contract deployment follows separately. Common RootErrorService owns upward autonomous reports and startup failure settlement. RpcContractExecutor only adapts the consumer interface. Disposing the executor handle retires that child in either placement. StateManager abort invokes full host-root cleanup, including its executor; domain cleanup remains the final host-owned phase.

Engineer approvals and review fingerprints remain engineer-owned. This update does not clear unrelated audit queues.

## Explicit root creation API

The free createRoot function now constructs local top-level roots or connected children with an explicit parent. Top-level application handlers stay local; child startup keeps the existing clone boundary. SDK root observation retains connection-before-observer and observer-before-child-start order. RootCreation adds two real SDK placement cases and retains child creation/failure recovery cases. Existing approval and impact queues remain unchanged by this API decision.

## Generic worker creation

Root classes now pass directly to createRoot. One platform worker creator takes an explicit URL, with no per-root factory or entry wrapper. Built-in URL selection remains internal; startup payloads carry domain configuration without worker URL overrides. The shared worker globals use one path for all launched roots. Relevant startup, error, cleanup and browser evidence is being refreshed; engineer fingerprint approval remains pending.

Unexpected Node worker exit now reports failure for every root, including SDK roots, through the same owner path. All roots use the shared platform resource limits and graceful-shutdown policy. The platform creator does not restrict creation to named roots.

The shared global initializer does not create window. A temporary unified shim did so in Node SDK workers and changed Holepunch platform selection; the existing lobby E2E exposed it. The corrected initializer keeps the generic startup path while preserving Node/browser detection.

## Client-root ownership and initialization

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation returns a typed remote root handle, and without an explicit parent it adds one hidden parent for that worker alone (see the parentless-worker section below). Its transport and connection record are private.

The new creation cases exercise delayed standalone initialization, parentless worker creation and cleanup, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. Logger connection discovery now follows root relationships without caller registration; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parented and parentless workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

A worker exit during an awaited disposal now rejects that acknowledgement and removes its child connection. It is not ignored as an expected late exit; already closed connections still preserve their settled result. The real-worker regression checks repeat disposal and parent usability.

## Implicit root startup wiring

Common creation now attaches the parent before the concrete parameterless start() and owns parent-close disposal, response-before-close cleanup and readiness. Host and broker roots use the inherited typed parent reference. Concrete roots contain domain initialization only. Focused root creation, lifecycle, executor and bridge verification belongs to this follow-up; earlier full-suite results are historical. No engineer approval is granted here.

Executor monitoring and logger ownership now belong to ContractExecutorRoot. The service selects its clock from explicit request data before falling back to Clock and receives its logger directly. Logger instances share one monitor per thread; non-owner disposal does not stop it. Focused clock, monitoring and worker-error evidence is recorded in the executor-dependencies follow-up. No engineer approval is granted.

## Logger gossip follow-up

The engineer replaced acknowledged global flushes with best-effort generation gossip. [LoggerService](../implementation/source/src/rpc/internal/services/logger/LoggerService.ts.md) owns its attached store map and one scalar index; [Logger](../implementation/source/src/utils/logging/Logger.ts.md) owns local uploading and one optional service reference in sharedResources. Common roots create logging before startup. Equal/older generations are suppressed even after the window; invalid indexes are rejected. Remote delivery is not claimed by a local promise. Late entries can wait for another generation under the accepted timing assumption. Existing HTTP retries and secret-field encoding remain with the uploader.

Since 2026-10-20 one bounded, acknowledged flush exists again, on the abort path only: an aborting runtime asks every reachable thread to upload now and then disposes as in any other abort; the disposal stops the producers and then waits for all of the uploads, until one deadline shared by every thread in the flush (the abort time plus the configured bound), before it ends any thread ([`REQ-LOG-11-F5TJQC` (An aborting runtime uploads its logs before it disposes)](../specification/runtime/log-collection.md#req-log-11-f5tjqc)). The engineer chose this because disposal ends the worker threads and lost every worker log of a real dispute. At the deadline each thread only stops waiting. A worker thread that ends cancels every upload of its realm still running, whoever started it, before its loop drains, so an open request or its retry cannot keep the worker alive past its end. Logger disposal cancels nothing, so the main thread and inline realms keep their uploads running after disposal. Ordinary gossip still never waits for acknowledgments.

The obsolete folded-summary finding no longer describes the current contract. Source and test changes require engineer re-verification; no approval register was changed.

The application-defined cloneability limit is tracked as [`OQ-AUDIT-RUNTIME-1-3P2PTW` (Application module cloneability)](open-questions.md#oq-audit-runtime-1-3p2ptw).

Review 10 aligns the quiescence permutation with fresh later drains and assigns the concurrent-drain evidence. Manager disposal now has one registered-transport walk; live leave/dispute disconnection keeps its existing behavior. Bootstrap payload typing and unknown WebRTC state have shared owners. Failed-setup tests distinguish application descendants from caller-owned siblings and the separate inline discovery lifetime. Crash stream checks use receiver arrivals after the trigger. The reviewed directory links and store-limit descriptions are updated; engineer approvals remain untouched.

## Review 14 lifecycle and host isolation corrections

Admitted disposal now reaches final connection and worker closure even if its parent disappears while domain cleanup is held. The response hook runs after failed posts as well as successful replies; failed application setup uses the same closure. A fatal child cause is recorded before close observers run, so client cleanup does not emit a second generic host error. Pending request diagnostics retain the exact wire request IDs.

Each fallback SDK host owns its WebRTC factory. Threaded placement remains preferred; multiple inline hosts in a browser worker remain supported. The browser boundary exercises disposal in both sibling orders. Current evidence is recorded in the implementation record; earlier full-run results cover their earlier snapshots. No index or engineer approval was changed.

## Shared runtime review 15

Child-initiated disposal waits for a parent acknowledgement before worker exit. Parent-initiated disposal uses its existing reply; final connection and platform cleanup still run after a failed response attempt. Manager cleanup continues after individual transport failures, and concurrent discovery cleanup shares one promise. Signer message serialization preserves bytes versus text. The browser worker and WebRTC gates are now configured in the pull-request CI workflow.

The earlier log-bus collection families were withdrawn when the engineer replaced acknowledged collection with local store upload and generation-based gossip. The private implementation plan records all six withdrawn families and their replacement by the current logger-gossip family; withdrawn definitions are not restored to maintained specification tables.

## Shared cleanup helper follow-up

Ordered cleanup now uses [runCleanup](../implementation/source/src/utils/runCleanup.ts.md). Root creation attempts both endpoint closes and worker shutdown even if an earlier close fails. The first failure remains the reported cause; confirmed inline domain failures retain their original reporting owner. No wire, admission or acknowledgement ordering change is intended. Helper unit coverage and existing lifecycle fault tests verify this extraction.

## Review 17 parent-loss disposition

The engineer chose to close RY1 at the parent owner. [Root creation](../implementation/source/src/rpc/internal/createRoot.ts.md) marks expected worker shutdown before closing the owned port. A real SDK-worker regression holds client disposal until after the child exits, and observes the fatal adapter callback as well as the public error surface. Unexpected worker exits remain errors. Full and browser gates are rerun after this change and the shared cleanup extraction.

## Per-entry queue retention bound — 2026-09-08

Queue retention uses independent source allowances ([`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../specification/storage/queue.md#req-qstore-2-vywjaq)): at most N admitted
identities and N supplied values per source, including the author. The contribution map travels with the dequeued entry into ordinary validation. Later copies form an independent entry; restore merges source contributions under the limits. No queue-side recovery budget
or shared signature pool remains. Storage bounds the number of supplied values; ValidationService handles invalid values through each strategy. No queue-side encoding filter or fixed-byte bound remains. The wire intake and stored shortcut both gate
transport eligibility before retention.

The two caches accept chain current/pending membership or verified current-fork off-chain membership,
with known slash precedence. Positive hits avoid chain/VM reads. An absent source after refresh
triggers ordinary sync. Intake awaits it and returns; no candidate registry, retry-window limits,
admission cancellation or post-sync block insertion remains. SpectateService is unchanged.

Real network scenarios now cover independent supplier slots, alternate valid signatures, stored merges,
pre-dequeue accumulation, independent stored copies, unknown-source sync success/failure, pending joins and slashes. Exact evidence belongs in
the verification reports. Runtime-mode and canonical regression evidence, including environment
limits for browser execution, is recorded in the implementation handoff. Browser execution is not
inferred from TypeScript or distributed success.

[`FIND-QSTORE-3-1HF4V6`](open-findings.md#find-qstore-3-1hf4v6) is resolved for shared-slot monopolization. [`FIND-SETTLE-1-G2CPV6`](open-findings.md#find-settle-1-g2cpv6) remains open
for generic authoritative roster writes. Positive cache staleness, first-N source churn, aggregate
hash/connection/rate limits, and repeated work across later lifetimes remain explicit limits. The
reference math insertion bounds its producer and preserves balances; it does not grant chain dispute
standing before confirmed adoption. Pending joiners persist late confirmations silently until promotion,
matching the fresh-block relay guard and avoiding premature admission sync during join submission.

Both TypeScript builds, import checks, compilation and focused Docker tests pass for the source-map correction. The implementation handoff records the final canonical run and isolated guard checks; earlier ownership and byte-filter results do not verify this correction. Specification generation and ID links pass; strict completeness remains blocked by existing repository gaps and pending engineer approvals. Browser constructor wiring and its separate runtime evidence are recorded in that handoff.

The simplification review fixes narrow bytes32 inputs through an assertion signature and remove the remaining queue-key forwarding method. The separate import-order change preserves all non-import executable statements, all imported bindings, and side-effect import boundaries. Runtime initialization order is checked by the distributed and browser gates; TypeScript suppression comments remain attached to their original imports.

Post-handshake connection ownership is now centralized in `P2PManager`. Local channel status is
the only admission input: every completed live transport is promoted, while `OPENED` alone performs
the participant read and sync. Join and spectate RPC paths provide no alternate promotion or
peer-supplied membership hint. Participant-read failure, close, disposal, and replacement races are
contained without undoing valid authentication or creating a late connection.

Every transport creates an addressless `PeerProfile` immediately, and the Holepunch ban handle is
stored there before authentication. `ProfileManager` authenticates and indexes that same profile and
owns all ban/unban policy. Generic transports expose no SDK ban handle. Fallback release checks the
profile's full live transport set, so a non-preferred WebRTC transport in upgrade grace keeps Holepunch
banned and explicit blacklist state wins.
Authentication is also a final admission gate: a late Holepunch connection cannot replace healthy
WebRTC or reattach an excluded identity, while a fallback after current-WebRTC close can become
current and carry traffic.
Relay retry state has one owned timer, which success cancels before resetting the pool. Holepunch
topic join/leave retains its byte-exact `Buffer` contract.

Join admission now keeps recorded membership separate from countersign eligibility: snapshot and
pending participants remain members, on-chain-slashed members lose veto power, and slashed members
cannot top up. The public paths preserve exact fork/snapshot pins and deadline semantics and invoke
the manager's atomic composable-deposit path; the manager, not the facet, owns the inbound JOIN
append and cumulative-total update.

Off-chain join authorization uses the same slash-excluding threshold set on collector and
responder paths. The collector now rejects a deadline with no positive collection window before
it signs or sends requests; positive windows cap every request at the earlier of the agreement
timeout and the join deadline. The responder keeps the inclusive deadline boundary used by
on-chain submission.

Snapshot submission now has explicit component obligations for admissible submission, unresolved
reduction stand-down, unconsumed-inbound preparation refusal, and no on-chain mutation after that
refusal. Forced-inclusion verification follows the pending JOIN through reduction into the
successor participant set and through one complete leader-election cycle where the joiner authors
an accepted block.

The runtime lifecycle waits for the application root's readiness hook before admission and preserves readiness failures while disposing partial resources. Each isolated context starts monitoring after its own ready work and uses the same configured fatal-delay threshold. The test harness starts its main-thread monitor after initial peer setup.

Runtime extension boundaries no longer depend on constructor identity for RPC services, transports, or ethers Result values. They validate the complete public shape consumed by the caller, so compatible SDK and ethers copies can coexist in one production bundle without breaking proxy resolution, dispatch overloads, or result normalization. The linked source reports and runtime design views record these boundaries; engineer review remains pending.

Inbound RPC endpoint authorization is separate from those structural checks. The dispatcher walks the
application methods hierarchy only up to `ARpcMethods.prototype`, accepts function-valued data properties,
rejects base members and accessors, and invokes the captured function on both delivery paths. This resolves
[`DEF-7-PK564B`](open-findings.md#def-7-pk564b) without breaking inherited application endpoint families.

RPC wire parsing, ingress ordering, guards, and every implemented request-settlement path now have
exact component obligations and evidence. Request settlement remains partial because there is no
cancellation API. Resource control remains partial: the frame-size bound exists, but pending-call,
per-peer, and aggregate work limits do not. Protocol compatibility remains missing because neither
the envelope nor handshake negotiates a version. [`DEF-8-HWJ10N`](open-findings.md#def-8-hwj10n)
is resolved: handler and guard response sends use one guarded attempt, then disconnect on failure
without a second send or unhandled rejection.

The authenticated-RPC guard records admission per exact transport. A replaced but open authenticated
pipe remains valid during upgrade grace overlap. Queued work releases only when its own transport
authenticates; closure, timeout, and disposal clear it, and stale failure cannot punish a replacement.
A frame dispatched after local transport close is dropped instead of treating retirement as peer malice.

The runtime event bridge also preserves application-defined hook names and cloneable payloads without adding
those names to the SDK hook declaration. The EventBus source report and real worker-to-client test now own
that extension contract.

The canonical codec now exposes typed decode overloads for every mapped protocol and proof schema,
including the previously omitted inbound-hash dispute proof. Its source report covers the full enum,
EVM-result, Result-normalization, cache, and failure surface.

The ethers Result proxy now keeps callback-wrapper identity after one listener removal, so repeated
registrations can also be removed repeatedly through the original callback. Its source report now
records the complete method, listener, event-log, query, and passthrough boundary instead of only
the structural Result predicate.

Other file reports' requirement bullets, recorded divergences, and unit families remain visible in generated coverage.

Balance validation, byte/key conversion, same-block copy merge, frame classification and log reporting have single owners. Extraction retains input/error order, raw commitment comparisons, timestamp-defined checks, response precedence and platform timer lifetime. Existing strategy instanceof checks remain. The deleted connectivity utility had no reachable consumer; each of its five data-type IDs retains other source contributors.

Proof replay builds standalone processing input. Queue cleanup cannot cancel it through a storage handle. The replay/cleanup regression continues to exercise snapshot persistence and fork reduction.

### Optimistic membership mirror correction

The engineer removed membership generations, pending-read invalidation and automatic read retries. Cached positives remain optimistic; concurrent misses now share one in-flight refresh, cleared on completion or failure. Intake rechecks cached eligibility after ordinary sync and blacklists a sender that remains ineligible, including the accepted in-flight collision case. Observed slashes still override cached membership, and channel selection clears the three plain sets. There is no metadata wrapper or channel/fork check in membership lookups. A read already in flight can complete after a newer push; no latest-generation guarantee is claimed. Queue processing and ordinary sync remain unchanged. [MembershipService](../implementation/source/src/stateManager/membership/MembershipService.ts.md) and its [exact tests](../verification/tests/test/unit/MembershipService.test.ts.md) describe the current behavior. Earlier invalidation permutations remain withdrawn; the current shared-refresh case asserts one read for concurrent misses.

Eligibility now has three enum values. A failed refresh leaves the sets unchanged; an absent sender follows ordinary sync. The earlier unavailable-result path and its separate no-sync guarantee are withdrawn by the engineer. The ordinary sync service retains its existing peer-failure behavior.

Membership events now push into the fast sets without membership reads. A miss pulls pinned snapshot/inbound/slash data and reuses event handlers to update LocalDiamond and the fast mirror. Positive-hit staleness before unseen events remains the accepted optimistic-cache policy. Focused tests verify delivered and missed JOINs, snapshot preservation of pending JOINs, slash publication, post-sync supplier exclusion, cache cleanup and failed chain-inspection rollback. Equivalent source-address casing uses one queue allowance. The full distributed gate passes all 2,539 tests; seven automatic starvation retries recovered.

## Dispute gas estimation and the transition stipend — 2026-09-08

**Trigger.** In the poker consumer's farm runs, `applyDisputeFraudProofs` and other dispute sends
missed their windows: the kill period is 5 s in those fixtures, and the transaction preparation
(populate, sign, broadcast) held the nonce mutex for 13–15 s per send, ending in
`RaceConditionDisputeKillPeriodExpired` raised by `eth_estimateGas` itself. `uploadDispute`, which
passes an explicit gas limit, took 32 ms–1.1 s on the same node in the same minute. The cost is the
node's gas estimation, not the chain, the ZK precompile (14 calls, all under 7 ms), or poker logic.

**Mechanism, three parts.**

1. _Requirement far above usage._ `stateTransition` forwarded a fixed stipend with
   `call{gas: gasLimit}`. A dispute replay used about 3M gas but the transaction had to carry
   about 10.7M so the stipend could be granted. Every estimator has to search that gap, and every
   probe inside it is a full replay of the transition.
2. _Hardhat's search._ Hardhat runs the transaction at the block limit, then at the gas it used; when
   that fails it bisects to a 50k tolerance for up to 20 rounds with no informed first guess. Geth and
   anvil probe `(used + refund) * 64/63` first. Any diamond call fails hardhat's exact-gas probe
   because the proxy fallback's delegatecall retains 1/64 (EIP-150) and does no work afterwards.
   Hardhat's pending-block context is re-mined per probe, so chain time advances during a long
   estimate and the kill period can expire inside it.
3. _Soundness gap (now closed)._ A CALL never fails for asking more gas than remains; it hands over
   63/64 of what is left. An under-funded replay therefore silently gave the transition less than
   the stipend, the transition ran out of gas, `executeStateTransition` returned `success = false`,
   and both fraud-proof facets read that as an invalid transition. The gas a sender attached could
   decide a verdict ([`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2), [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)).

**Changes made in this tree.** _Superseded 2026-09-26 for the stipend rule and the mirror gas:
see [Signature-parity authentication, upfront replay funding, and local EVM call gas](#signature-parity-authentication-upfront-replay-funding-and-local-evm-call-gas--2026-09-27).
The list below records the 2026-09-08 state._

- [AStateMachine.sol](../implementation/source/contracts/V1/AStateMachine.sol.md): the wrapper records what the stipend call can grant (`available - available/64 - reserve`,
  capped at `gasLimit`). A transition that completes is judged on its result whatever was granted,
  since transitions may not read gas. An out-of-gas counts as exceeding the budget only when the full
  `gasLimit` was granted; otherwise it reverts with `ErrorInsufficientGasForStateTransition(required,
granted)`, a refusal rather than a verdict. An upfront `gasleft() >= stipend` guard was tried first
  and rejected by measurement: it pins the requirement at the stipend, so estimators search the
  expensive region and the geth-style first probe can never succeed.
- [StateChannelManagerProxy.sol](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md): `executeStateTransition` re-raises that refusal and turns an empty-returndata machine frame
  into `ErrorStateTransitionFrameOutOfGas`, so the facets never adjudicate an under-funded replay.
- [ContractExecutor.ts](../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md): every local EVM call is funded with 1e9 gas. The ethereumjs default of 0xffffff (about 16.7M)
  sat at the manager's dispute-execution budget, so a mirror replay could have been under-funded and
  diverged from a funded on-chain one ([`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)).
- Tests: `test/V1/AStateMachineStipend.t.sol` (8 tests) with a gas-hungry Math variant. Direct:
  a cheap transition executes below the stipend; a never-finishing one is refused below the stipend
  and reported as an invalid transition when funded. Through the manager: the honest block is judged
  below the stipend and its author keeps standing; the over-budget block reverts with the refusal
  below the stipend and slashes its author when funded; two fuzzes over attached gas from 100k to 9M
  show the honest author is never slashed and the over-budget author is slashed exactly when the call
  succeeded ([`UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF`](../implementation/source/contracts/V1/AStateMachine.sol.md#unit-test-astate-machine-2-z2xxmf), [`UNIT-TEST-MANAGER-PROXY-3-C3NY4X`](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-3-c3ny4x), [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2) P5–P8). Full Foundry suite: 120 passing.

**Measurements** (Math fixture, 10M stipend, `applyFraudProofs` over an honest block, cost of one
`eth_estimateGas` relative to one `staticCall`, median of seven):

| Node                                                      | Contracts                | 30M block      | 100M block  | 1e9 block   | Estimate    |
| --------------------------------------------------------- | ------------------------ | -------------- | ----------- | ----------- | ----------- |
| hardhat 2.20 (peer3 fork, the runner's node)              | before                   | 11.5x          | 11.5x       | 11.6x       | 511k        |
| hardhat 2.20, stock                                       | after                    | same as before |             |             | 511k        |
| hardhat 2.20 with a `(used + refund) * 64/63` first probe | after                    | 2.6x           | 2.7x        | 2.7x        | 514k        |
| hardhat 2.22 EDR (this repository's in-process network)   | before / after           | 4.7x / 4.8x    | 4.1x / 4.5x | 4.4x / 4.4x | 511k / 511k |
| hardhat 2.22 EDR                                          | upfront guard (rejected) | 4.3x           | 4.1x        | 5.3x        | 11.0M       |

Gas used by the transaction: 443k. The block gas limit does not change the estimate cost in any
row. The refund term is required for the optimistic probe: the estimate sits about 15% above gas
used because of storage refunds, so a plain 64/63 probe fails and falls back to bisection.

**Assessment.** The contract change removes the soundness gap and makes the gas a transaction needs
track the gas it uses, which is the precondition for any fast estimate. It does not by itself speed
up estimation on the runner's hardhat, whose bisection dominates. A fixed high gas limit on dispute
sends would avoid estimation but reserves block space by declared limit, not by use: three 10M
declarations fill a 30M block that could hold fifteen 2M executions. The adopted resolution is recorded
as [`FIND-GASEST-1-28J88D`](open-findings.md#find-gasest-1-28j88d): the runner's node gained Geth's
first probe, `(spent + refund) * 64/63`, in the peer3 hardhat fork (release `precompile-v2`). It
converges only because the post-hoc stipend rule made the gas a replay needs track the gas it
uses, so the two changes belong together. Metering in the local mirror was rejected as unreliable
(the mirror does not guarantee chain-equal state), and `eth_estimateGas` remains the send path,
which production nodes already answer in two or three executions.

## Block authenticity moved off the EVM — 2026-09-09

**Trigger.** A CPU profile of the poker consumer's six-player timing test showed the six
contract-executor threads busiest (about 69% of their time, ethereumjs interpreter 45%, secp256k1
recovery 8%, GC 10%), while ZK verification was negligible. Each received block executes once
([SnapshotAssemblyService.ts](../implementation/source/src/stateManager/block/SnapshotAssemblyService.ts.md),
[BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md));
stored-block re-confirmations merge signatures without execution. The redundant EVM work was the author
signature recovery, run in the EVM twice per block (intake in
[BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md) and
pre-execution in BlockIngestService), plus the consumer's own view calls per block.

_Decided 2026-09-26: the TypeScript check stays under an explicit carve-out with exact contract
parity; see [Signature-parity authentication, upfront replay funding, and local EVM call gas](#signature-parity-authentication-upfront-replay-funding-and-local-evm-call-gas--2026-09-27).
This section records the 2026-09-09 state._

**Change.** [Block.ts](../implementation/source/src/models/Block.ts.md) gains `isAuthentic`
(original signature recovers to the header participant, malformed signature is `false`);
intake reads it through the per-thread signer recovery cache. A later change removed the
`ValidationService.isBlockConfirmationAuthentic` wrapper: [BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)
decodes each incoming confirmation once with `tryFromBlockConfirmation` and checks `isAuthentic` on that
instance, which the rest of the ingest reuses, and [BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)
checks it on the entry's decoded block. [QueueStorage.ts](../implementation/source/src/storage/QueueStorage.ts.md)
builds the entry's base block with `Block.authorSignedCopy()` (renamed from `withoutConfirmationSignatures`, review 5 LO5) on its per-call copy
instead of decoding it again. No contract change: `LocalDiamond.isBlockAuthentic`
stays for the dispute path on-chain. Both call sites drop their `await`.

**Assessment.** The TypeScript and Solidity checks share one scheme (EIP-191 over
`keccak256(encodedBlock)`), and the predicate reads no state, so
[`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)'s equivalence
concern does not arise. The literal text of
[`INV-MIRROR-1-VAF778` (Single implementation)](../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778) is contradicted
and recorded as [`FIND-AUTH-1-C1ZHBJ`](open-findings.md#find-auth-1-c1zhbj) for a specification decision.
Regression: [`UNIT-TEST-BLOCK-MODEL-1-037DM6`](../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6)
P13 plus three neighbouring authenticity tests, and the forged-author E2E intake test.

## Subscription logs from a reverted block — 2026-09-09

**Trigger.** The poker consumer's parallel runs failed with peers whose genesis fork differed from
the chain's stored genesis by one second. The cause is the test node: hardhat's pending-block
simulation (`eth_estimateGas`, pending `eth_call`) mines every pending transaction into a temporary
block, notifies `newHeads` and `logs` subscribers and polling filters, then reverts the block. On a
shared node another client's estimate leaks logs of a block that never becomes canonical. The peer3
hardhat fork now mutes notifications during a simulation.

**Assessment for this repository.** The node's event path trusts the provider's log feed as
canonical and has no `removed`-log handling or block-hash confirmation. That is correct for a
well-behaved node and for the local runner after the fork fix, and it is the same assumption a real
chain breaks on a reorg. Recorded as
[`FIND-EVENTS-1-3JF8FM`](open-findings.md#find-events-1-3jf8fm) for a specification decision; no
code change made here. (As of 2026-09-09; a `removed` log is now logged and ignored, its effects
not undone.) Decided 2026-10-21: chain finality is a recorded, known-wrong assumption, and
the finding is pending on it.

## Estimate margin instead of a search — 2026-09-09

**Trigger.** With the fork's optimistic probe in place, the poker consumer's farm still measured
`eth_estimateGas` for the batched dispute `multicall` at 12 executions and 5 to 11 s per estimate,
while single-call estimates (`uploadDisputeWithCalldata`, `open`, `postBlockCalldata`) took one to
three executions. The multicall adds delegatecall frames in front of the fraud-proof path, each
retaining 1/64 of the remaining gas, so the one-boundary probe `(spent + refund) * 64/63` is short
and hardhat bisects from the block limit to a 50k tolerance. Hardhat serves one request at a time, so
each such estimate stalled every other client's reads and the interval miner for the same seconds.
Geth's estimator misses the probe for the same reason but converges in about nine executions on a
native EVM, milliseconds rather than seconds, and serves requests concurrently; on a production node
this is cost, not a stall.

**Change (fork release `precompile-v4`).** `eth_estimateGas` runs the transaction once and returns
the gas it needed before its refund (the refund counter capped as the EVM caps it, a quarter of the
net figure after EIP-3529) plus 30%, capped at the block gas limit. The exact-gas run, the probe and
the bisection are removed. The margin covers the retained gas of nested frames and refunds handed back
after they were spent. Estimates are no longer minimal; the block-packing argument against declared
limits applies to a fixed high limit, not to a proportional margin.

**Residual.** Production nodes keep their own estimators; the durable fix for their nine executions is
a shallower fraud-proof call path in the contracts, recorded for a separate review.

## Local-first dispute audit and milestone proof tiers

AgreementManager owns verification from local finalized state, local diamond and canonical chain.
Only missing or completed false results move to the next tier. Local reverts, executor failures,
required-state failures and RPC failures propagate; they do not become invalid-proof verdicts.
Independent availability, below-anchor or final-conflict counters can stop audit before these tiers.
Replay restarts from each tier's verified state. Block-specific challenge eligibility depends on
the canonical anchor, so the old pure/global header-check account no longer applies.

Construction starts from the mirrored chain anchor. Omission follows the empty-genesis or last
milestone anchor/everyone rule. Reduction and committed-result validation retain their chain-owned
computation. A different trusted start may skip older history; this is not proof that all auditors
must check identical bytes. Concrete source owners and exact permutation evidence are linked from
[disputes/state-proofs.md](../specification/disputes/state-proofs.md). The full source/test gate passed
before documentation edits; individual Covers assignments still require semantic inspection.

## Signature-parity authentication, upfront replay funding, and local EVM call gas — 2026-09-27

**Trigger.** Reviews 1–4 of the local-first change
(`temp/plan-implementation-reviews/33-dispute-rebase-local-first/`) and the engineer's decisions on
them: author signatures in TypeScript must match the contracts exactly (XO1, SR2); fraud-proof
replay is funded upfront (SO1), the send declaring its estimate plus the requirement (FR1, confirmed
by the engineer in review 5, FO1); the upfront check must come after all input-dependent work (SR1);
the previous transition's outbound messages are deleted before the check and paid outside the
budget (review 6, FO3, engineer decision; this replaced the count reset that answered FY1); the local
EVM's 1e9 call gas is dropped (SY1) and named for the local EVM (LO2); the evidence memo is invalidated
on a kill (FY1) and belongs to DisputeManager (LO1); block decoding stays in `Codec` and decoding
parity with the contracts is deferred (LO3, decision of 2026-09-27).

**Signature parity.** [SignerRecoveryCache.ts](../implementation/source/src/cache/SignerRecoveryCache.ts.md)
refuses, before recovery, every signature encoding OpenZeppelin `ECDSA.tryRecover(bytes32, bytes)`
rejects (not exactly 65 bytes, `v` not 27 or 28, `r` outside `(0, n)`, `s` outside `(0, n/2]`); ethers
had accepted compact signatures and normalized `v`. Every protocol recovery — author and
confirmation signatures in [Block.ts](../implementation/source/src/models/Block.ts.md), join, open and
dispute signatures in [SignatureUtils.ts](../implementation/source/src/utils/SignatureUtils.ts.md) — goes
through it, so author and confirmation signatures follow one rule. The dead
`UtilityFacet.isBlockAuthentic` route and interface declaration are removed.
[EcrecoverCache.ts](../implementation/source/src/cache/EcrecoverCache.ts.md) memoizes the local EVM's ecrecover
precompile; it is a pure cache and changes no answer or gas figure (tested against a plain EVM at the
precompile's acceptance and gas boundaries). [`FIND-AUTH-1-C1ZHBJ`](open-findings.md#find-auth-1-c1zhbj)
is resolved by the signature carve-out in
[`INV-MIRROR-1-VAF778` (Single implementation)](../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778).

**Decoding.** `Codec` is the only block decoder. Network intake
([BlockQueueManager.ts](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md)) decodes once with
`Block.tryFromBlockConfirmation` and then checks `isAuthentic`; the struct entry
([BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)) refuses a
confirmation that does not decode through `authenticateBlockFailed`;
[QueueStorage.ts](../implementation/source/src/storage/QueueStorage.ts.md) reuses the target's decoded block when it
merges signatures, so a network copy is decoded once.
[ValidationService.ts](../implementation/source/src/stateManager/ingest/ValidationService.ts.md) has no decoding logic:
the contract-decode path that existed for one review round (a local-diamond decode of
non-canonical bytes, with its memos) is removed. The client and contract decoders enforce the
canonical round-trip rule at the identity, commitment, storage, emission, posted-calldata, and
client-decoded-chain-data boundary (`UtilityFacet.decodeBlock`/`tryDecodeBlock`,
`postBlockCalldata`, universal `Codec.decode`, and the dispute-upload commitment comparison).
Signature-bound inputs and transient proof payloads are exempt under the engineer-narrowed scope;
[`FIND-DECODE-1-FD1V6V`](open-findings.md#find-decode-1-fd1v6v) closed on that boundary on 2026-10-15.

**Upfront replay funding.** [AStateMachine.sol](../implementation/source/contracts/V1/AStateMachine.sol.md)
refuses with `ErrorInsufficientGasForStateTransition` before the transition runs unless it can grant
the full `gasLimit`, and publishes `getStateTransitionGasRequirement`. It copies the call input and
reads the budget before the gas check and calls in assembly, so only fixed opcodes run between the
check and the call. It deletes the previous transition's outbound messages first, before the input
copy and the gas check, so the caller pays for the deletion outside the transition budget and a
transition always writes its messages into empty slots.
[UtilityFacet.sol](../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md)
`getStateTransitionReplayGas` adds the share kept at each of the five enclosing calls (multicall, facet delegatecall, `FraudProofFacet` delegatecall, `executeStateTransition`, state machine).
[DisputeManager.ts](../implementation/source/src/disputeManager/DisputeManager.ts.md) sends only the replay
transactions (the fraud-proof multicall and `applyDisputeFraudProofs`) with the signer's estimate
with its headroom plus the requirement, the requirement read once (engineer decision 2026-09-27).
The machine refuses unless the full budget is free when the replay starts; an estimator that
reports the gas spent (the peer3 hardhat fork used by poker) counts only the gas the transition
used, and the work before the replay can exceed any fixed margin over the requirement (a poker
dispute: about 3.9M before the replay, requirement 5.64M, about 9.5M needed, while the larger of
the estimate and the requirement × 1.3 gives 8.89M). The sum covers both. A searching estimator
(the SDK test node was measured to search) already includes the requirement, so the sum declares
more than needed: at least about 2.5 × the requirement with the signer's headroom. That does not
change a verdict, but it must still fit the block gas limit, which then depends on the consumer's
budgets; nothing caps the declared limit. The whole gas and estimation topic is open as
[`FIND-GASEST-2-94YFZ6`](open-findings.md#find-gasest-2-94yfz6). This
replaces the 2026-09-08 post-hoc rule, whose pending assumption (a transition cannot catch an inner
out-of-gas) did not hold.
Residual: see [security-assessment.md](security-assessment.md#gas-dependent-verdicts--2026-09-08).

**Local EVM call gas.** [ContractExecutor.ts](../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)
`localEvmCallGasLimit` funds each local EVM call with the larger of `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT`
(0xffffff), the manager's `getGasLimit` and twice its replay requirement (the requirement covers
only the budget and fixed setup; deleting previous outbound messages and copying the input come on
top), read once at host start
([P2pRuntimeHostRoot.ts](../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)) and
passed through [createContractExecutor.ts](../implementation/source/src/evm/contractExecutor/createContractExecutor.ts.md)
and [ContractExecutorService.ts](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md);
inline and dedicated-thread runtimes are tested with a budget above the default. Deviation from the
recorded decision text (`max(16.7M, getGasLimit)`): the replay term is required, because without it
every local replay would be refused by the upfront rule above. A local `stateTransition` that the
machine refuses, whose call frame runs out of gas outside the transition, or whose executor fails is
a local failure: [EvmDiamondStateMachine.ts](../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)
rethrows it (`isInvalidStateTransitionError` in
[evmErrorHandler.ts](../implementation/source/src/utils/evmErrorHandler.ts.md)) and
[BlockIngestService.ts](../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)
restores the state with no fraud proof and no dispute. The accepted residual (the 16.7M
floor) is recorded under [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)
and in [security-assessment.md](security-assessment.md#local-evm-call-gas--2026-09-26).

**Evidence memo.** [DisputeManager.ts](../implementation/source/src/disputeManager/DisputeManager.ts.md) owns it
(`shouldAddOwnEvidence`, `clearCache`); [EventHandler.ts](../implementation/source/src/eventHandlers/EventHandler.ts.md)
only calls them from `onDisputeCommitted`, `onDisputeKilled` and `onDisputeReducedResultCommitted`.
`didIDispute` stays first; a kill drops the fork's stored comparison; a comparison ended by partial
own auditing data is not stored; the reduced result prunes the entry; concurrent audits share one
comparison; a positive answer survives a failed upload; a comparison dropped while in flight cannot
erase its replacement. All of these are tested through real audits
([`UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-7-q63jzm) P1–P9).
Specified in dispute-processing stage 5
([`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

**Negotiation cleanup.** [OpenChannelNegotiationService.ts](../implementation/source/src/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md)
`clearAttempt` takes the attempt it ends and does nothing when that attempt is no longer current, so a
late opening-hook failure cannot clear its replacement.

## Host-only guard, local owners, parentless workers, and executor drain — 2026-09-29

Conformance: `LocalOnlyGuard` (removed 2026-10-16 by the application host root) implemented the host-only part of [`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) with an always-failing check, a normal-return
failure handler that delegates to `P2PManager.disconnectConnection` with `DisconnectPolicy.BLACKLIST`,
and a `WeakSet`-scoped override of `AGuard.suppressesFailureResponse`; it is exported from the guard
barrel and the public entry. For [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59), the host passes `{ owner: this }` through `StateManager` and
`P2PManager` to the custom-RPC constructor, the executor passes `router.rpcRoot` through `createEvm` to
precompile factories, `createRoot` supports parentless workers with a per-creation hidden parent, and
`ContractExecutorService` owns admission and drain with all three endpoints delegating to it and
`ContractExecutorRoot` running the drain as its disposal preparation. Node `.ts` worker preloads now
resolve from the SDK package. File reports, the guards and internal-RPC inventories, and the runtime
view record these; new component families are the local-only guard family (removed 2026-10-16),
[`UNIT-TEST-EVM-FACTORY-1-002C8D`](../implementation/source/src/evm/EvmFactory.ts.md#unit-test-evm-factory-1-002c8d), [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb), and
[`UNIT-TEST-P2P-RUNTIME-HOST-34-517JAX`](../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-34-517jax); the root-creation family replaced its parentless-rejection
permutation with six parentless-worker permutations. No contradiction is demonstrated. The executor
drain is bounded by the engineer decision [`OQ-IMPL-EXECUTOR-DRAIN-1-5D71YM` (Resolved executor admission drain bound)](../implementation/open-questions.md#oq-impl-executor-drain-1-5d71ym): `closeAdmission` races the admitted set against the exported
`IN_FLIGHT_REPLY_DRAIN_MS`, logs and abandons work still admitted at the limit, and lets disposal proceed.
The second implementation review showed that `admit` returned the operation's own promise, so a call that
completed after the limit, during the later in-flight reply drain, still returned its success to a caller
the executor had declared abandoned. By the engineer's decision (option a) `admit` now returns a
caller-facing promise behind a settle-once latch; at the limit `closeAdmission` rejects every caller still
waiting with `Contract executor shut down before the operation finished`, and the operation's later
success or failure is dropped with no host error, while work that finishes within the limit keeps its own
result or error. This matches the amended [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59) rule, which now states that the
disposal rejection holds even when the operation later succeeds or fails. The admission family has
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P5`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) for the stuck call and gained
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb), [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P7`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) and
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) for late success, late failure, and mutex-queued work released after
the limit; [`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P2`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) now names a late deploy and simulation beside the late call.

The earlier record said an unidentified transport's "handle is barred". That was wrong:
`ProfileManager.blacklistPeer(transport)` does nothing when the transport has no profile, so a transport
with neither a profile nor a proven address is only closed and nothing is barred, which is what
[`REQ-RPC-7-9CBSHK` (Guard semantics)](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) states. The `LocalOnlyGuard` (since removed) and
[P2PManager](../implementation/source/src/P2PManager.ts.md) reports now say so, matching the corrected comment in
`P2PManager.disconnectConnection`. Parentless workers now also document that a worker thread that exits
unexpectedly leaves its hidden parent live until the handle is disposed, which then releases it
([`UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v)).

A pre-existing shutdown defect is fixed in the same change: `InitHandshakeService` never settled pending
`waitForHandshakeCompleted` waits at shutdown, so a wait timer could fire after its logger was disposed and
surface as an unhandled `Logger InitHandshakeService has been disposed` error, contrary to the
detached-work rule of [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../specification/runtime/execution.md#req-runtime-3-vqxw59). The service now has a `dispose()` that
clears the completion barrier, so every pending wait settles as not completed at once, and the host
root's disposal calls it after the cut (2026-10-31, slice 3: no longer through `MainRpcService.dispose()`;
a later wait is unreachable once the cut closed every transport). The
[InitHandshakeService](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md) report records it with
[`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P19`](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r).

The first implementation review asked whether this settlement at runtime shutdown makes a
`DeferredAdmissionGuard` queue expire as a peer timeout, with a warning and an `allowRetry` disconnect
against a peer that was only mid-handshake. It does not, and no code change was made: at real runtime
shutdown the cut sets `isDisposed` before the handshake service's release runs, and
`HandshakeAdmissionPolicy.onExpired` returns early when the state manager is disposed. The settled
handshake wait therefore never leads to an expiry warning or a retry disconnect.

## Milestone-only proof update — current assessment

The proof format now contains milestones only. Same-fork anchor clipping and explicit genesis
semantics replace the old separate signed-tail model. Historical membership hops include all
consumed JOINs and never subtract later slashes. Shared verification/replay tiers distinguish false
proof results from fatal execution or RPC failures. Per-step invalidity, below-anchor,
timeout-superseded and same-height final-conflict counters use the common predicates.

Sync retains verified reconstruction data and the latest proved final full state. An older anchor
state is not separately required once newer finality is established. Audit replay persists evidence
without signing or advancing the active view. Inbound-head races reload, rebuild and retry on real
progress; stopped progress or failed loading is fatal. Initial responders are selected from chain
eligibility, and founder discovery and join observation/expiry handling have corresponding tests.

Residual questions remain explicit in [specification questions](../specification/open-questions.md):
loss of the sole higher commitment after admission closes, late-challenge recovery, stale or
adoption-racing honest sync blacklists, admission gas/length caps and whole-data challenge cost.
Per-step checking does not prove constant total gas. Other existing findings remain unchanged
unless separately revalidated. Documentation and mappings remain pending engineer review; this
assessment grants no human approval and does not claim the repository's baseline coverage queues
are empty.

## Milestone proof review repairs

The proof owner now separates an exact final height from later virtual-voting support, including stored evidence above a frozen view. Verification returns its actual trusted start atomically with the verdict. Audit rechecks conflicting final history after asynchronous verification and refused persistence. The invalid-step handler no longer walks an unrelated final milestone to decide omission permission. Membership deadline work retains a join generation and fork across reads and scheduling, and missing old history uses an explicit validation-strategy deviation. These repairs preserve the existing finality, checked-region persistence and lifecycle rules.

The exact-height participant-change follow-up adds no production behavior. Its owner-level coverage checks join and exit union evidence beyond the requested final height, removal of the sole later required vote, and both single-hop and two-hop construction from audit evidence above a frozen view. The original whole-plan review inventory remains separate from this scoped correction.

## Dispute output state load, local budget exhaustion, and reduce gas — 2026-10-07

**Dispute output computation loads the state once.** `_generateDisputeOutputState` now calls
`setState` once, applies joins, slashes and removals to the loaded machine, and calls `getState`
once; its callers and the two fraud-proof facets read the output participants from the loaded
machine instead of loading the same encoded state again (the deleted `_getStateMachineParticipants`).
Each removed load was of exactly the state the previous step read back, so outputs are unchanged;
the change only removes gas that grew with the application state's size and pushed a dispute over a
large poker state past the poker deployment's 10M dispute execution budget (this repository's
default is 3M,
[StateChannelManagerProxy.sol](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L30)). Mirrors:
[DisputeVerificationFacet.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md),
[StateChannelCommon.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md),
[FraudProofFacet.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md),
[DisputeFraudProofFacet.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md).
Residual: correctness now depends on no call between the load and the read changing the loaded
state; the existing forge reduction and fraud-proof suites passed on the new code.

**A used-up local dispute budget is named.** `LocalDiamond` reverts
`ErrorDisputeExecutionOutOfGas(gasLimit, gasUsed)` when a gas-capped dispute computation used up
the gas it was forwarded and returned no data, and re-throws every other failure unchanged
([LocalDiamond.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md)).
The error stays an error, never an answer
([`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys)). The
detection counts the 1/64 that the facet keeps when a nested call runs out of gas
([LocalDiamond.sol](../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L414):
`returnData.length == 0 && gasUsed + forwarded / 64 + 5_000 >= forwarded`), so an exhausted budget
is never an empty revert, also when the gas runs out inside a state machine call. A facet revert
within the budget keeps its bytes, and an empty revert within the budget stays an empty revert,
which is still an error. Forge cases in `DisputeVerificationFacet.t.sol` cover the nested
out-of-gas, a facet revert within the budget, and an empty revert within the budget. Whether the SDK
sync path classifies this error as invalid served evidence is part of the deferred
[`FIND-SYNC-REDUCTION-GAS-1-AJE985`](open-findings.md#find-sync-reduction-gas-1-aje985).

**The reduce is sent at the signer's estimate.** `ReductionExecutor.submitDetached` no longer sends
the reduce at the fixed dispute execution gas limit, which conforms to
[`REQ-SDK-ARCH-5-AAM7YK` (Chain submissions survive concurrent inclusion)](../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk); a reduce resent
by the EVM error handler and mined is adopted like a first send
([ReductionExecutor.ts.md](../implementation/source/src/stateManager/reduction/ReductionExecutor.ts.md)).
The disposal check runs once, before `submitDetached`
([ReductionExecutor.ts](../../../src/stateManager/reduction/ReductionExecutor.ts#L275)); there is no
pre-send disposal guard any more, so a disposal during the signer's send is not intercepted: the
broadcast goes out and only the adoption after it is skipped
([ReductionExecutor.ts](../../../src/stateManager/reduction/ReductionExecutor.ts#L413), engineer
decision 2026-10-08). The harness `holdReductionAttempt(..., "submit")` parks the reduce's own chain
write (the multicall that carries `reduceAndFinalize`) and counts every chain write
([StubRpcMethods.ts](../../../test/fixtures/customRpc/harnessControl/services/stub/StubRpcMethods.ts#L1497)).
The two `ReductionManager` cases that proved the removed guard were deleted with it. The inline
case "disposal while the reduce send is held surfaces no rejection and reports no failure" that
replaced them was deleted when every test moved to worker mode (Luke 2026-10-31); the worker
`ReductionManager` cases that abort while the reduction is held prove the aborted peer's nonce is
unchanged
([ReductionManager.test.ts.md](../verification/tests/test/stateManager/ReductionManager.test.ts.md)).
Residual: a reduce send released after a full host teardown never settles (the destroyed ethers
`WebSocketProvider` hangs at populate or estimate), so its detached promise stays pending until
`DetachedPromises.awaitAllAndClear` times out; recorded under
[`FIND-ROOT-DISPOSAL-1-1ZDQAW`](open-findings.md#find-root-disposal-1-1zdqaw).

## Slash eligibility per fork — 2026-10-07

**Only participants of the disputed fork's participant state can be slashed by a dispute or a
reduction** ([`REQ-DIS-11-WQK8P2` (A dispute MUST list on-chain slashes only of participants of its latest state…)](../specification/disputes/disputes.md#req-dis-11-wqk8p2)). The on-chain slash set is channel-wide, so a
successor fork's reduction used to fold the slash of a participant an ancestor fork already
removed, and a slash set that was not empty suppressed the successor fork's timeout. Now
`_hasDisputeReason` invalidates a dispute that lists a slash outside its latest state's
participants (killed through the existing `InvalidDisputeReason` proof), construction lists only
those participants, `reduce` folds slash candidates without reading any participant set, and the
output transition applies only slashes of participants of the loaded latest state with its pending
joins; the timeout is suppressed only when such a slash took effect
([`INV-DIS-7-9GGZSD` (In a fork whose reduction applies an on-chain slash of a participant of the…)](../specification/disputes/disputes.md#inv-dis-7-9ggzsd)). The per-dispute output uses the same rule, so `_calculateRemovals` and
the unused `UtilityFacet.inParticipantUnion` are deleted. Mirrors:
[DisputeUtils.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md),
[DisputeVerificationFacet.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md),
[DisputeManager.ts.md](../implementation/source/src/disputeManager/DisputeManager.ts.md).
Residual: a reduction's eligibility relies on the state machine refusing to slash a non-participant
(`slashParticipant` returns false), as the MathStateMachine does; an integrator's machine that
reports success for an absent target would suppress the timeout again. Residual in the other
direction: the output transition adds the timeout target to the removals when no slash took effect
([DisputeVerificationFacet.sol](../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L385)),
so a consumer machine whose `_slashParticipant` returns false for a present participant also removes
the timeout target, which inverts [`INV-DIS-7-9GGZSD` (In a fork whose reduction applies an on-chain slash of a participant of the…)](../specification/disputes/disputes.md#inv-dis-7-9ggzsd) for that machine.
[AStateMachine.sol](../../../contracts/V1/AStateMachine.sol#L108-L112) now documents the contract:
`_slashParticipant` must return true for every current participant.

## Outbound run totality, best-effort upload classification, and shutdown drain — 2026-10-08

**The outbound verifier checks links before balances.** `_verifyOutboundMessageBlocks` walks the
hash chain (predecessor, height + 1), then checks the end height and end hash against the upper
snapshot, and only then sums balances through the state machine's `addBalance`, each call in a
`try`/`catch` (`_verifyOutboundMessageBlocks` in
[StateChannelCommon.sol](../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol)).
A sum that cannot be computed returns false on every path: the auditor's
`verifyOutboundRunAboveAnchor`, the on-chain counter `isDisputeOutboundRunInvalid`, the snapshot post
(`ErrorOutboundMessageBlocksInvalid`) and the sync check. This holds also when the upper head
authenticates the overflowing block, which a latest state signed only by its author can do. An
out-of-gas in `addBalance` (the caller keeps at most 1/64 of its gas) reverts
`ErrorOutboundBalanceSumOutOfGas`: no verdict, so a caller-chosen low gas limit never judges an honest
run invalid. The verdict assumes `addBalance` fails within bounded gas on a balance it cannot add.
The auditor judges the run only after its replay proved the latest state
(`verifyAndReplay` in
[DisputeValidationService.ts](../../../src/stateManager/dispute/DisputeValidationService.ts)), so a
forged latest state is countered as an invalid state proof first
([StateChannelCommon.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol.md),
[DisputeValidationService.ts.md](../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)).

**A reasonless upload refusal is classified by the estimate.** When the mined best-effort multicall
reports a last-call refusal with no reason (bare `0x`, or the proxy's `Delegatecall failed`),
`DisputeManager` uses the decoded refusal of the failed all-or-nothing estimate, and the refusal is
fatal when that estimate decoded none
([DisputeManager.ts](../../../src/disputeManager/DisputeManager.ts#L513-L517)). The
`MulticallLastCallFailed` log has one decoder, which reads only logs of the manager address with that
event's topic ([evmErrorHandler.ts](../../../src/utils/evmErrorHandler.ts#L156)). Mirrors:
[DisputeManager.ts.md](../implementation/source/src/disputeManager/DisputeManager.ts.md),
[evmErrorHandler.ts.md](../implementation/source/src/utils/evmErrorHandler.ts.md).

**Block queue disposal drains its own work.** `BlockQueueManager.dispose` waits for every in-flight
probe and recovery with `Promise.allSettled`, clears the queues and the recovery state only after
all settle, and rethrows the first rejection, so a probe failure rejects `stop()`; a fork recovery
scheduled after stop never runs
([BlockQueueManager.ts](../../../src/stateManager/ingest/BlockQueueManager.ts#L632-L644)). The sync
timeout bounds only a probe's request. `SpectateService` returns early once disposed and does not
blame the responder for a disposal. Both are instances of
[`FIND-ROOT-DISPOSAL-1-1ZDQAW`](open-findings.md#find-root-disposal-1-1zdqaw).

## Browser late link after disposal — 2026-10-14

**A browser local-discovery link that opens after its runtime was disposed gets no transport.** The
link socket's open handler now closes the socket when its P2P manager is disposed, as the Node
discovery already does for its dial
([LocalDiscoveryServer.ts](../../../src/utils/browser/LocalDiscoveryServer.ts#L157)). Before, an
inline browser runtime disposed while a link was still connecting built a transport on the disposed
manager, and its logger threw `Logger "P2PManager" has been disposed` on the page (seen in the
`run-transport-local-e2e.mjs` gate). Evidence: [`REQ-RUNTIME-3-VQXW59.T1.P83`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p83) in that gate, red before
the fix and green after. Mirror:
[LocalDiscoveryServer.ts.md](../implementation/source/src/utils/browser/LocalDiscoveryServer.ts.md).
Another instance of
[`FIND-ROOT-DISPOSAL-1-1ZDQAW`](open-findings.md#find-root-disposal-1-1zdqaw).

## First-join collection failure aborts instead of escaping — 2026-10-26

**What.** A join confirmation the network does not give is now one typed error. `JoinChannelService`
asks every threshold member in parallel, keeps each member's outcome (a signature, or a failure:
`unreachable`, `no-answer`, `wrong-signer`), and after all are in throws one `JoinCollectionError`
that names each failed member
([JoinChannelService.ts](../../../src/rpc/network/services/joinChannel/JoinChannelService.ts),
[JoinCollectionError.ts](../../../src/rpc/network/services/joinChannel/JoinCollectionError.ts)). Chain
reads, the `Clock`, the join-expired checks and local signing still throw their own errors; those stay
fatal. A join deadline that passes during the reachability grace is a configuration error (a join
lifetime shorter than two agreement windows), so it stays fatal too. `ChannelJoinService` owns the
outcome: its `collectConfirmation` catches only `JoinCollectionError`, warns "The join confirmation could
not be collected; nothing is submitted", and returns no confirmation. A first join through
`collectAndJoinChannel` then calls `stateManager.abort()` and returns `false`, so the runtime aborts and
disposes with nothing submitted. A committed caller's top-up through connect now goes through
`collectAndTopUp`, which returns `false` with no abort and nothing submitted
([LocalP2pSigner.ts](../../../src/evm/signer/LocalP2pSigner.ts)). A race retry's fresh collection keeps
its `SYNCED`/`false` outcome only for the typed error; any other error now rejects the call
([ChannelJoinService.ts](../../../src/stateManager/membership/ChannelJoinService.ts)).

**Why.** Engineer decision (Luka, 2026-10-26, option 1a). A Mac join failed fatally: two threshold
members' join-signature replies were lost on WebRTC links that dropped seconds after they opened (see
[`FIND-UPG-DROP-1-ETY2PS`](open-findings.md#find-upg-drop-1-ety2ps)). The specification already said
that a failed first-join collection aborts and disposes, but the code let the RPC timeout escape the
connect call, so the integrator (poker) treated it as fatal. The specification now also states that the
failure names every failed member and that only a collection failure has this outcome
([`REQ-JOINSIG-2-RR2G4Q` (All-or-nothing unanimity)](../specification/peer-communication/join-authorization.md#req-joinsig-2-rr2g4q),
[`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)).

**Disposed-logger guard.** The abort disposes the joiner while its inbound handlers may still run. A
handler that ends after that disposal logged its error or sent its reply through the disposed logger,
which throws, so its dispatch rejected. `ANetworkRpcService.runRPC` now skips the error log, the reply
and the async-send error log when its logger is disposed: a disposed runtime answers nobody and logs
nothing ([ANetworkRpcService.ts](../../../src/rpc/network/ANetworkRpcService.ts),
[`REQ-RPC-2-SZDTTM` (Request lifecycle)](../specification/peer-communication/rpc.md#req-rpc-2-szdttm)). The guard reads the
logger, not `stateManager.isDisposed`: `abort()` marks the state manager disposed before its teardown
ends, and loopback control requests sent during that teardown still need their replies.

**Tests.** `JoinChannelSignatureRequest.test.ts`: the unreachable and fault cases check the error's
name and exact message, one case names two failed members, and the silent-member case holds the
responder's answers with `holdJoinSignatureResponses` (the old delay stub is deleted). Three new
connect cases: a first join with one silent member returns `false`, aborts, disposes and submits
nothing; a participating member's top-up with one silent member returns `false`, keeps its status and
submits nothing; a first join whose threshold set read fails (`failNextJoinThresholdRead`) rejects with
no abort and no submission. `ARpcService.test.ts` "ANetworkRpcService on a disposed runtime" releases a
held handler into a disposed inline responder and expects every dispatch to resolve (staging in
`test/fixtures/DisposedResponderStaging.ts`). The hold control is not released on harness disposal; the
tests release it in `finally`
([`FIND-HARNESS-HOLD-1-9B480C`](open-findings.md#find-harness-hold-1-9b480c)). Mirrors:
[JoinChannelService.ts.md](../implementation/source/src/rpc/network/services/joinChannel/JoinChannelService.ts.md),
[JoinCollectionError.ts.md](../implementation/source/src/rpc/network/services/joinChannel/JoinCollectionError.ts.md),
[ChannelJoinService.ts.md](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md),
[LocalP2pSigner.ts.md](../implementation/source/src/evm/signer/LocalP2pSigner.ts.md),
[ANetworkRpcService.ts.md](../implementation/source/src/rpc/network/ANetworkRpcService.ts.md).
