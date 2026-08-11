# WebRTCSetupService — Post-Handshake Signaling for the WebRTC Transport Upgrade

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The `webRTCSetupService` RPC service: the offer/answer/ICE signaling that upgrades an
> authenticated peer connection from its bootstrap transport (Holepunch / local discovery) to a direct
> `WebRTCTransport`. This document goes deep on the service; shared dispatch, guards, wire envelope,
> and outcome classes are specified once in the model doc — [./README.md](./README.md) — and not
> restated. The peer authentication this service depends on is specified in
> [./handshake.md](./handshake.md).

Related: [../components.md](../components.md) §2, [./README.md](./README.md) §7 (endpoint contract,
"silent ignore"), [../../security/trust-model.md](../../security/trust-model.md), [../../open-questions.md](../../open-questions.md)
(OQ-6, OQ-34).

Code (paths relative to this file; repo root = `../../../../../`):

- [src/rpc/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts)
- [src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts)
- [src/rpc/services/WebRTCSetup/connection/](../../../../../src/rpc/services/WebRTCSetup/connection/)
  (`WebRTCConnectionFactory`, `LocalWebRTCConnectionFactory`, worker-bridge factory, provider)
- [src/transport/WebRTCTransport.ts](../../../../../src/transport/WebRTCTransport.ts)
- callers / consumers: [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)
  (`initiateWebRTC` trigger), [src/P2PManager.ts](../../../../../src/P2PManager.ts),
  [src/ProfileManager.ts](../../../../../src/ProfileManager.ts)

---

## 1. Purpose & position in the connection lifecycle

The bootstrap transport that carries the handshake ([./handshake.md](./handshake.md)) may be a relayed
or hub-mediated path (Holepunch NAT traversal, a local discovery relay). Once two peers are mutually
authenticated, the node can attempt a **direct** peer-to-peer WebRTC data channel and migrate traffic
onto it. `WebRTCSetupService` carries the SDP offer/answer and ICE-candidate signaling for that
negotiation; the resulting `RTCDataChannel` is wrapped in a `WebRTCTransport`, which then runs its own
handshake and, on completion, replaces the old transport in the peer's profile
([`ProfileManager.updateTransport`](../../../../../src/ProfileManager.ts), [./README.md](./README.md)
§6.8).

Position: strictly **after** authentication. The service carries a `HandshakeCompletedGuard`
([`WebRTCSetupService` constructor](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts)
line 45), so every remote signaling method is refused unless the sender transport already maps to a
completed `PeerProfile`. The upgrade is _initiated_ from
[`InitHandshakeService.maybeFinalizeHandshakeOnceFromTransport`](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts):
when either side prefers WebRTC, the current transport is not already WebRTC, and
`localAddress < completedPeerAddress` (a deterministic single-offerer tiebreak that avoids offer glare),
the lower-addressed peer calls `initiateWebRTC(transport)`.

The service is best-effort infrastructure, not a protocol-critical path: if signaling fails the peer
simply keeps using its existing transport. That framing is why every failure is silently ignored (§4).

---

## 2. Owned state

| State                                 | Where                          | Written / read                                                                                                     | Lifetime / cleanup                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionFactory`                   | `WebRTCSetupService`           | lazily created on first offer/answer/ICE (`getConnectionFactory`)                                                  | service-lifetime singleton; picks `LocalWebRTCConnectionFactory` when `RTCPeerConnection` is available, else the worker-bridge factory ([`createWebRTCConnectionFactory`](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts)) |
| `connectionMap`                       | `LocalWebRTCConnectionFactory` | `Map<checksumAddress, RTCPeerConnection>`                                                                          | **strong** map keyed by EVM address; an entry is replaced (old one `close()`d) when a new offer/answer for the same address arrives, and deleted by `close(peerAddress)`. Leaks if `close` is never reached (§4.4).                                           |
| per-connection callbacks              | created per `createConnection` | `onIceCandidate` / `onDataChannel` / `onConnectionStateChange` / `onError` closures bound to a fixed `peerAddress` | live for the `RTCPeerConnection` lifetime                                                                                                                                                                                                                     |
| `WebRTCTransport.pendingOutboundRpcs` | `WebRTCTransport`              | buffered sends before the channel opens; flushed on open, cleared on close                                         | per transport                                                                                                                                                                                                                                                 |

The service holds no per-peer _session_ state of its own beyond the factory's address-keyed connection
map. Crucially, the peer address used everywhere is read from `senderTransport.peerAddress` (written by
the handshake), **never from the signaling payload** — see §4. On disconnect the `WebRTCTransport._close`
path calls `closeWebRTCConnection(peerAddress)`, which removes the map entry; there is no other explicit
cleanup hook tied to `disconnectConnection`.

---

## 3. Algorithm, per public method

Three public `RpcMethods`, all **one-way (fire-and-forget)** signaling
([`WebRTCSetupRpcMethods`](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts)).
Params are `JSON.parse`d raw — **not** `Codec`-decoded — and handed to the WebRTC stack. Every method
is wrapped in a try/catch whose only action is a log (`logger.verbose`/`error`): **silent ignore**.

Shared preamble for all three: `peerAddress = this.senderTransport.peerAddress`; if absent, log and
return. Because the guard already required a completed profile, `peerAddress` is normally present; the
check defends the degenerate case.

### 3.1 `onOfferWebRTC(serializedOffer)` — responder side of the SDP exchange

1. Read `peerAddress` from the sender transport (not the payload).
2. `offer = JSON.parse(serializedOffer)`.
3. `answer = await service.acceptWebRTCOffer(peerAddress, offer)` →
   `factory.acceptOffer(normalizedPeerAddress, offer, callbacks)`:
    - `createConnection` closes any existing connection for that address and builds a new
      `RTCPeerConnection`; installs `onicecandidate`/state callbacks; registers `ondatachannel` to wrap
      the negotiated channel in a `WebRTCTransport`.
    - `setRemoteDescription(offer)` → `createAnswer()` → `setLocalDescription(answer)`.
4. Reply is **not** an RPC response (this is fire-and-forget); instead the answer is sent back as its
   own one-way call: `remoteRpc.webRTCSetupService.onAnswerWebRTC(JSON.stringify(answer)).sendOne(peerAddress)`.

### 3.2 `onAnswerWebRTC(serializedAnswer)` — initiator applies the answer

1. `peerAddress` from transport.
2. `answer = JSON.parse(serializedAnswer)`.
3. `service.applyWebRTCAnswer(peerAddress, answer)` → `factory.applyAnswer` →
   `setRemoteDescription(answer)` on the existing connection for that address (no-op if none exists).

### 3.3 `onIceCandidate(serializedCandidate)` — trickle ICE

1. `peerAddress` from transport.
2. `candidate = JSON.parse(serializedCandidate)`.
3. `service.addWebRTCIceCandidate(peerAddress, candidate)` → `factory.addIceCandidate` →
   `connection.addIceCandidate(new RTCIceCandidate(candidate))` on the existing connection (no-op if
   none). Candidates the local stack generates flow outward through the `onIceCandidate` callback →
   `serializeAndSendIceCandidate` → `onIceCandidate(...).sendOne(peerAddress)`.

### 3.4 Local (non-remote) methods

`initiateWebRTC(transport)` (offerer): resolves the peer's checksummed address from its profile,
`createOffer` (which creates the data channel and wraps it as a `WebRTCTransport` via `onDataChannel`),
then `onOfferWebRTC(serializedOffer).sendOne(adr)`. `getWebRTCConnectionState`, `closeWebRTCConnection`
are local helpers (state readout, teardown). These are on the service, not the `RpcMethods` class, so
they are not remotely callable (REQ-RPC-1).

---

## 4. Byzantine assessment

Every remote method here is reachable **only** by an already-authenticated peer (the guard). That
removes the pre-authentication exposure that dominates [./handshake.md](./handshake.md) §4, and it
narrows the adversary to "a peer whose EVM identity is proven but who behaves maliciously." The model
doc records the outcome as "silent ignore" ([./README.md](./README.md) §7/§8); this section assesses
whether silent-ignore is _safe_ here.

### 4.1 Address spoofing — is the EVM↔transport binding forgeable? (handled)

The strongest structural defense: the peer address that keys every WebRTC connection is taken from
`senderTransport.peerAddress`, set by the handshake, and **never** from the signaling payload. A
malicious peer therefore cannot drive or hijack _another_ peer's connection slot — it can only affect
the connection keyed by its own authenticated address. `normalizePeerAddress` checksums it, and
`findWebRTCTransport` further scopes lookups to `TransportType.WEBRTC` connections whose `peerAddress`
matches. This is the property that makes the broader silent-ignore acceptable: signaling spoofing
across identities is closed at the key, not by payload validation.

### 4.2 Malformed / malicious SDP and ICE payloads (partially handled; residual delegated)

Params are `JSON.parse`d raw and passed to `setRemoteDescription` / `addIceCandidate`. A non-JSON
string throws in `JSON.parse` → caught → ignored, so a malformed frame cannot crash the handler. But a
_well-formed JSON that is a malicious SDP/candidate_ is handed straight to the WebRTC implementation
(`werift` in node, the browser stack, or a worker bridge). There is **no schema, size, or content
validation** at this boundary — no `Codec`, no field checks. Consequences:

- **SDP parser exposure.** The safety of parsing a hostile SDP is entirely the WebRTC library's
  responsibility. This is an **accepted residual risk** delegated to that dependency; the SDK adds no
  defense. It should be stated as a dependency assumption rather than assumed away.
- **ICE candidate → outbound connectivity.** ICE candidates carry peer-advertised IP/port pairs, and
  the local stack will send STUN/connectivity-check traffic to them. An authenticated peer can supply
  candidates pointing at arbitrary third-party hosts, inducing the node to emit packets toward those
  hosts (a limited SSRF / reflection primitive). This is **inherent to ICE** and not currently
  constrained. **Open question (divergence class: decision pending):** whether advertised candidate
  addresses should be filtered (e.g. reject non-routable/loopback or off-peer targets) or whether the
  volume is bounded by the rate limiter alone. _(Inferred concern — derived from the ICE data flow,
  not from an observed exploit.)_

**Is silent-ignore safe for these?** For malformed input: yes — dropping a bad offer/answer/candidate
only fails the upgrade, and the peer keeps its working transport, so there is no protocol-liveness cost
and no reason to escalate to disconnect. For the ICE-target and SDP-parser concerns, silent-ignore is
orthogonal (those payloads are _well-formed_ and get processed); the residual is about processing, not
about the ignore policy.

### 4.3 Protocol-order abuse (handled by no-op semantics)

`onAnswerWebRTC` / `onIceCandidate` for an address with no in-progress connection are no-ops
(`if (!connection) return`). An answer arriving before any offer, duplicate answers, or ICE before the
remote description, are absorbed without effect. There is no strict state machine to desynchronize into
a bad state — the worst case is a failed or reset negotiation, which is tolerable (§1).

### 4.4 Resource abuse (unhandled — accepted gap)

- **Connection churn.** Each `onOfferWebRTC` calls `createConnection`, which `close()`s the peer's
  existing `RTCPeerConnection` and builds a new one, plus a new `WebRTCTransport` via `onDataChannel`
  (which starts a fresh handshake). A peer that repeatedly sends offers forces repeated
  `RTCPeerConnection` allocation, channel setup, and handshake work. There is no per-peer rate limit
  ([./README.md](./README.md) §9, [OQ-6](../../open-questions.md)).
- **Map growth / leak.** `connectionMap` is a strong `Map` keyed by address; entries are freed only via
  `close(peerAddress)` (from `WebRTCTransport._close` / `closeWebRTCConnection`). A negotiation that
  never reaches a transport close can leave an entry resident. Bounded by the number of distinct
  authenticated peers, so not unbounded, but not actively reaped either.
- **Amplification.** `onOfferWebRTC` triggers an outbound `onAnswerWebRTC`, and ICE triggers outbound
  candidates — each inbound signaling frame can produce outbound work/traffic. Bounded per authenticated
  peer; folded into the central rate-limiter direction (OQ-6). Classified **missing**.

### 4.5 Information disclosure

An offer/answer exchange reveals this node's ICE candidates (its own IP/port/relay set) to the
authenticated peer — standard for WebRTC and unavoidable for a direct connection. No additional secret
is exposed by the service.

### 4.6 Silent-ignore verdict

Silent-ignore is **safe as a failure policy** for this service: the peer is already authenticated
(cannot cheaply flood pre-auth), the service is non-critical (failure degrades gracefully to the
existing transport), the address binding prevents cross-identity spoofing (§4.1), and out-of-order
messages are harmless no-ops. The residual risks that remain (SDP-parser exposure, ICE-target
reflection, unbounded churn) are _not_ about the ignore policy and are not addressed by changing it;
they need dependency assumptions, optional candidate filtering, and the central rate limiter
respectively.

---

## 5. Failure outcomes

Consistent with [./README.md](./README.md) §8 ("WebRTC signaling failure (any) → Silent ignore"):

| Trigger                                                                                  | Method                              | Consequence                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Missing `senderTransport.peerAddress`                                                    | any of the three                    | Log, return (ignore)                                                                                                             |
| `JSON.parse` failure (malformed payload)                                                 | any                                 | Caught, `logger.verbose`, ignore                                                                                                 |
| Factory / WebRTC-stack error (`setRemoteDescription`, `addIceCandidate`, offer creation) | any                                 | Caught, logged, ignore                                                                                                           |
| No connection for the address (answer/ICE before offer)                                  | `onAnswerWebRTC` / `onIceCandidate` | Silent no-op                                                                                                                     |
| Guard failure (unauthenticated / pre-handshake sender)                                   | dispatch, before any method         | Per `HandshakeCompletedGuard` — disconnect (+blacklist), or queue-and-retry during negotiation ([./README.md](./README.md) §5.2) |

No WebRTC-signaling failure ever disconnects or blacklists the sender **from within this service**;
the only disconnect path is the shared guard, which runs before the service's code. No mismatch with
the model table.

---

## 6. Invariants

| ID         | Invariant                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-WRTC-1 | The peer address keying every WebRTC connection is read from the authenticated `senderTransport.peerAddress`, never from the signaling payload; a peer can only affect its own connection slot.                                                                                                                   |
| INV-WRTC-2 | All three remote signaling methods are one-way and reachable only behind `HandshakeCompletedGuard`; they never run for an unauthenticated transport.                                                                                                                                                              |
| INV-WRTC-3 | Every signaling handler catches its own failures and neither throws to the dispatcher nor disconnects/blacklists the peer (silent-ignore), so a failed upgrade degrades to the existing transport.                                                                                                                |
| INV-WRTC-4 | Only one peer offers per upgrade (`localAddress < completedPeerAddress` tiebreak), avoiding offer glare.                                                                                                                                                                                                          |
| REQ-WRTC-1 | Signaling payloads (`serializedOffer`/`serializedAnswer`/`serializedCandidate`) crossing into the WebRTC stack MUST be treated as untrusted; the SDK adds no schema validation and delegates SDP/ICE parsing safety to the WebRTC implementation — this delegation MUST be documented as a dependency assumption. |

---

## 7. Verification

- **Unit / component.** [test/utils/WebRTCTransport.test.ts](../../../../../test/utils/WebRTCTransport.test.ts)
  — the transport queues sends on a connecting channel and flushes on open, starts the handshake exactly
  once on open (INV-WRTC linkage to handshake), sends over an open channel, drops sends on a closed
  channel. [test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts](../../../../../test/utils/WebRTCWorkerBridgeConnectionFactory.test.ts)
  — the worker-bridge factory constructs proxy channels, routes state/ICE events to callbacks, and
  rejects in-flight requests on bridge disposal.
- **End-to-end.** [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts)
  "should update existing profile transport on WebRTC upgrade" drives a real offer via `initiateWebRTC`
  and asserts the profile is upgraded in place from `HOLEPUNCH` to `WEBRTC` (INV-WRTC-4 offerer path,
  and the §1 upgrade→profile-replacement flow). Transport-mode coverage:
  [test/e2e/E2E-RuntimeTransportModes.test.ts](../../../../../test/e2e/E2E-RuntimeTransportModes.test.ts).
- **Known gaps (`none — gap`).**
    - No test feeds a **malicious/malformed SDP or ICE** payload to `onOffer/onAnswer/onIceCandidate` and
      asserts silent-ignore (INV-WRTC-3) and that no cross-identity effect occurs (INV-WRTC-1).
    - No test asserts a signaling frame **cannot key another peer's address** via the payload (INV-WRTC-1).
    - No test for **offer-churn / connection-reset** resource behavior (§4.4).
    - No test constrains **ICE candidate targets** (§4.2) — currently unconstrained by design.

---

## Future Work

_Non-normative._

- Decide whether to filter advertised ICE candidate targets (reject loopback/non-routable/off-peer) to
  bound the reflection primitive (§4.2), or accept it under the rate limiter.
- Bound signaling frequency (offer/answer/ICE) under the central RPC rate limiter and its prioritization
  scheme ([OQ-6](../../open-questions.md), [./README.md](./README.md) §9); signaling is bulk/best-effort
  and should rank below dispute/handshake traffic.
- Actively reap stale `connectionMap` entries on peer disconnect rather than relying on the transport
  close path (§2/§4.4).
- State the WebRTC-library SDP/ICE parsing trust boundary as an explicit dependency assumption in
  [../../security/trust-model.md](../../security/trust-model.md) (REQ-WRTC-1).

---

## Traceability

| ID         | State          | Statement                                                                                              | Implementation                                                                                                                                                                                                                                                  | Verification evidence                                                                                                                                                         |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-WRTC-1 | Design pending | Connection key comes from the authenticated transport, never the payload.                              | [WebRTCSetupRpcMethods](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts) (`senderTransport.peerAddress`), [WebRTCSetupService.normalizePeerAddress/findWebRTCTransport](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts) | none — gap (no payload-address-spoof test)                                                                                                                                    |
| INV-WRTC-2 | Design pending | One-way signaling methods reachable only behind `HandshakeCompletedGuard`.                             | [WebRTCSetupService constructor](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts) (`this.guards`), [HandshakeCompletedGuard](../../../../../src/rpc/guards/HandshakeCompletedGuard.ts)                                                        | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts) (upgrade runs post-handshake); none — gap (no pre-handshake signaling-rejection test) |
| INV-WRTC-3 | Design pending | Handlers silent-ignore all failures; no throw, no disconnect from the service.                         | [WebRTCSetupRpcMethods](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts) (try/catch → log)                                                                                                                                                 | none — gap (no malformed-payload silent-ignore test)                                                                                                                          |
| INV-WRTC-4 | Design pending | Single offerer via `localAddress < completedPeerAddress`.                                              | [InitHandshakeService.maybeFinalizeHandshakeOnceFromTransport](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)                                                                                                                           | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts) (WebRTC upgrade)                                                                      |
| REQ-WRTC-1 | Design pending | Signaling payloads are untrusted; SDP/ICE parsing safety is a documented WebRTC-dependency assumption. | [WebRTCSetupRpcMethods](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts) (`JSON.parse` → stack), [connection/](../../../../../src/rpc/services/WebRTCSetup/connection/)                                                                    | none — gap (no adversarial SDP/ICE suite; dependency assumption not yet in trust-model)                                                                                       |
