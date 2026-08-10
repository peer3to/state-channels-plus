# InitHandshakeService — Peer Authentication at the Transport Edge

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** The `initHandshakeService` RPC service: the challenge/response protocol that proves a
> transport-level counterparty controls a claimed EVM key, the only service that runs _before_ the
> handshake guard admits anything, and the point at which a raw transport becomes an authenticated
> `PeerProfile`. This document goes deep on the service; the shared dispatch, guard, wire-envelope
> and outcome-class machinery it sits in is specified once in the model doc — [./README.md](./README.md) —
> and not restated here.

Related: [../components.md](../components.md) §2 (service summary), [./README.md](./README.md)
§5.2/§7 (`HandshakeCompletedGuard`, endpoint contract), [../../security/trust-model.md](../../security/trust-model.md)
(Byzantine peers, transport trust), [../../open-questions.md](../../open-questions.md) (OQ-29, OQ-34,
DEF-8).

Code (paths relative to this file; repo root = `../../../../../`):

- [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)
- [src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts)
- [src/rpc/guards/HandshakeCompletedGuard.ts](../../../../../src/rpc/guards/HandshakeCompletedGuard.ts)
- callers: [src/transport/HolepunchTransport.ts](../../../../../src/transport/HolepunchTransport.ts),
  [src/transport/WebRTCTransport.ts](../../../../../src/transport/WebRTCTransport.ts),
  [src/utils/node/LocalDiscoveryServer.ts](../../../../../src/utils/node/LocalDiscoveryServer.ts)
- state consumers: [src/P2PManager.ts](../../../../../src/P2PManager.ts),
  [src/ProfileManager.ts](../../../../../src/ProfileManager.ts),
  [src/PeerProfile.ts](../../../../../src/PeerProfile.ts)

---

## 1. Purpose & position in the connection lifecycle

Establishing a transport ([`src/transport/`](../../../../../src/transport)) only produces a byte
pipe to an unauthenticated counterparty. Nothing about a fresh `HolepunchTransport`,
`WebRTCTransport`, or `LocalTransport` tells the node _who_ is on the other end: the discovery and
NAT-traversal layers advertise an EVM address as plaintext registration metadata
([`LocalDiscoveryServer`](../../../../../src/utils/node/LocalDiscoveryServer.ts) registration carries
a `peerAddress` string), but no transport cryptographically binds that address to control of the
corresponding private key. `InitHandshakeService` is the mechanism that supplies that proof.

Its place in the lifecycle:

1. A transport is constructed. Every network transport immediately calls
   `initHandshakeService.initHandshake(this)` from its constructor / channel-open hook
   ([`HolepunchTransport`](../../../../../src/transport/HolepunchTransport.ts) line 24,
   [`WebRTCTransport.startHandshake`](../../../../../src/transport/WebRTCTransport.ts) line 51,
   [`LocalDiscoveryServer`](../../../../../src/utils/node/LocalDiscoveryServer.ts) lines 600/978).
   Both peers do this, so **two challenge/response exchanges cross the same transport, one per
   direction**.
2. The service is the _only_ built-in that carries no `HandshakeCompletedGuard` — it is the
   authenticator and must accept pre-session traffic ([./README.md](./README.md) §5.2). Every other
   service refuses a transport until this service has written a completed `PeerProfile`.
3. On success the transport becomes an "open connection" ([`P2PManager.addConnection`](../../../../../src/P2PManager.ts)),
   the guarded services open, and the node may kick off a WebRTC upgrade and a post-handshake state
   sync.

The service therefore straddles the trust boundary: its endpoints run against wholly unauthenticated
input, and their correctness is what every downstream guard relies on.

---

## 2. Owned state

All per-peer handshake state is keyed by the **transport object** (per-connection), held in `WeakMap`/
`WeakSet` so it is collected when the transport is GC'd — there is no explicit teardown of these maps
on disconnect. Longer-lived identity/blacklist state lives on the `PeerProfile` (keyed by EVM address),
written only at finalization.

| Field                            | Type                                 | Written by                                                          | Read by                                                | Lifetime / cleanup                                                                                              |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `inFlightHandshakeTransports`    | `WeakSet<ATransport>`                | `markHandshakeInFlight` (initiator start; responder after replying) | `isNegotiating` (drives the guard retry-queue)         | added at start of either role; `delete`d in `maybeFinalizeHandshakeOnceFromTransport`; else GC'd with transport |
| `ackedTransports`                | `WeakSet<ATransport>`                | `markAcked` (on receiving an ack)                                   | `didReceiveAck`, `isNegotiating`, duplicate-ack check  | never explicitly cleared; GC'd with transport                                                                   |
| `ackTimeoutScheduled`            | `WeakSet<ATransport>`                | `ensureHandshakeAckTimeoutScheduled`                                | itself (dedupes the timer)                             | idempotence guard; GC'd with transport                                                                          |
| `remotePreferredTransportMap`    | `WeakMap<ATransport, TransportType>` | `setRemotePreferredTransport` (initiator, from response)            | `isNegotiating`, finalization gate                     | GC'd with transport                                                                                             |
| `verifiedPeerAddressByTransport` | `WeakMap<ATransport, string>`        | `recordVerifiedPeerAddress` (initiator, after signature verify)     | finalization, ack-timeout fallback                     | GC'd with transport; also mirrored onto `transport.peerAddress`                                                 |
| `handshakeBarrier`               | `EventBarrier`                       | `signal()` at finalization                                          | `waitForHandshakeCompleted` (guard retry-queue waiter) | service-lifetime singleton                                                                                      |
| `timeoutManager`                 | ref                                  | constructor                                                         | ack-timeout scheduling                                 | service-lifetime                                                                                                |

Identity outputs written elsewhere at finalization:

- `transport.peerAddress` — the checksummed EVM address, set in `recordVerifiedPeerAddress` and again
  in finalize. This is the field `ATransport.isSamePeer` and address-targeted delivery rely on.
- `PeerProfile` (`isHandshakeCompleted`, transport binding) in `ProfileManager` — the authoritative,
  churn-surviving identity record ([./README.md](./README.md) §6.8).

**Observed asymmetry (documentation debt).** Only the **initiator** of an exchange verifies a
signature and writes `verifiedPeerAddressByTransport`. The **responder** signs and waits for an ack
but never itself verifies the caller in that exchange. Mutual authentication is achieved because both
peers initiate — full completion requires _this_ node to have verified the peer (its initiator role)
**and** received the peer's ack (its responder role); see §3.4. The ack is not itself an authenticity
proof (§4).

---

## 3. Algorithm, per method and per role

Two public `RpcMethods` endpoints exist ([`InitHandshakeRpcMethods`](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts)):
`onInitHandshakeRequest` (request/response) and `onInitHandshakeAck` (fire-and-forget). The initiator
half (`runHandshake`, `handleHandshakeResponse`) lives on the service and is _not_ remotely callable —
it is driven locally by `initHandshake(transport)`.

### 3.1 What is signed

The signed message is a domain-tagged string, never the bare hash:

```
HANDSHAKE_DOMAIN = "peer3:init-handshake:v1"
message          = `${HANDSHAKE_DOMAIN}:${ethers.hexlify(challengeHash)}`
signature        = signMessage(message)        // EIP-191 personal_sign
signer           = ethers.verifyMessage(message, signature)
```

`buildHandshakeChallengeMessage` uses `hexlify` so initiator (local) and responder (wire) derive an
identical string regardless of input casing. The domain tag is the single versioned identifier on the
wire (`peer3:init-handshake:v1`, REQ-SDK-3); it scopes exactly one message type and is the
**signing-oracle defense**: protocol blocks are EIP-191 signatures over a _raw 32-byte keccak hash_,
so a signature over a domain-prefixed string is structurally incapable of colliding with a block
signature even when the peer sets `challengeHash = keccak256(encodedBlock)` (§4, INV-HSK-2, and the
`ver` note under [OQ-29](../../open-questions.md)).

### 3.2 `onInitHandshakeRequest(challengeHash, time)` — responder, request/response

Inputs: `challengeHash` (peer-chosen), `time` (peer's claimed clock, seconds). Return: `HandshakeResponse
= { signature, responseTime, preferredTransport }`.

Stages ([`InitHandshakeRpcMethods.onInitHandshakeRequest`](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts)):

1. **Decode / shape validation, before signing.** `!ethers.isHexString(challengeHash, 32)` or
   `!Number.isFinite(time)` → log, `disconnectConnection(senderTransport)`, `throw`. Rejecting a
   non-finite `time` here is load-bearing: a `NaN` would slip past the `Math.abs(...) > agreementTime`
   comparison below (every comparison with `NaN` is `false`), letting a peer steer what gets signed
   with an out-of-window timestamp.
2. **Time-skew check.** `timeDifference = time - localTime`; `Math.abs(timeDifference) > agreementTime`
   → log, disconnect, `throw`. Bounds how stale/future a challenge may be to one `agreementTime`
   window (read from chain time config, [../../protocol/time.md](../../protocol/time.md)).
3. **Sign.** `signMessage(buildHandshakeChallengeMessage(challengeHash))` — a domain-tagged signature
   over the peer's challenge. This is a signing action taken on behalf of an unauthenticated caller
   (§4, oracle discussion).
4. **State transition.** `markHandshakeInFlight(senderTransport)` and
   `ensureHandshakeAckTimeoutScheduled(senderTransport)` — the responder now expects the initiator's
   ack and arms the timeout.
5. **Output.** Returns `{ signature, responseTime: localTime, preferredTransport }`; the dispatcher
   sends it as the `{ok:true, result}` reply. A thrown error becomes an `{ok:false}` reply _and_ the
   handler has already torn the transport down.

### 3.3 Initiator half — `runHandshake` / `handleHandshakeResponse` (service-local)

`initHandshake(transport)` → `void runHandshake(transport)` (fire-and-forget background task):

1. **Generate challenge.** `challengeHash = keccak256(randomBytes(32))`, `initTime = now`. The
   challenge lives only in this closure — there is no shared challenge map — so it is unguessable and
   single-use per exchange.
2. `markHandshakeInFlight(transport)`.
3. **Request.** `remoteRpc.initHandshakeService.onInitHandshakeRequest(challengeHash, initTime)
.request(transport, { timeoutMs: agreementTime * 1000 })`. On timeout / rejection →
   `disconnectConnection(transport)`, return (no blacklist — identity unproven).
4. **`handleHandshakeResponse`** (wrapped in try/catch so a malformed signature that makes
   `verifyMessage` throw disconnects instead of escaping as an unhandled rejection):
    - **RTT check.** `rtt = now - initTime > agreementTime` → disconnect, return.
    - **Response-timestamp skew.** `Math.abs(responseTime - initTime) > agreementTime` → disconnect.
    - **Verify signature.** `signerAddress = verifyMessage(buildHandshakeChallengeMessage(challengeHash),
signature)`. This is the only authentication step: it proves the responder holds the key for
      `signerAddress`.
    - **Blacklist check.** `isBlacklisted(signerAddress)` → disconnect.
    - `recordVerifiedPeerAddress(transport, signerAddress)` (checksums, sets `transport.peerAddress`).
    - `setRemotePreferredTransport(transport, preferredTransport)`.
    - `void maybeFinalizeHandshakeOnceFromTransport(transport)`.
    - **Send ack.** `remoteRpc.initHandshakeService.onInitHandshakeAck(challengeHash).sendOne(transport)`
      — tells the peer we authenticated them.
    - `ensureHandshakeAckTimeoutScheduled(transport)`.

### 3.4 `onInitHandshakeAck(challengeHash?)` — fire-and-forget

1. **Duplicate check.** `didReceiveAck(senderTransport)` → `disconnectAndBlacklistPeer(senderTransport,
"protocol violation: duplicate handshake ack")`, return. (Replay-as-violation, REQ-RPC-6.)
2. `markAcked(senderTransport)`.
3. `void maybeFinalizeHandshakeOnceFromTransport(senderTransport)`.

`challengeHash` is **diagnostic only** — a log-correlation id. It is explicitly _not_ trusted for any
decision (INV-HSK-4). The parameter is optional and never validated because nothing depends on it.

### 3.5 Finalization — `maybeFinalizeHandshakeOnceFromTransport`

Idempotent gate; returns early unless **all** hold:

- `verifiedPeerAddressByTransport.has(transport)` — this node verified the peer (initiator role done);
- `didReceiveAck(transport)` — the peer acked our response (responder role done);
- `remotePreferredTransportMap.get(transport) !== undefined` — set during the initiator flow;
- `!stateManager.isDisposed`.

When satisfied:

1. Create or update the `PeerProfile` for `verifiedPeerAddress` (`registerProfile` new, else
   `updateTransport` — the latter keeps the profile object identity across a transport upgrade and
   schedules the old transport's retirement after an `agreementTime` grace,
   [`ProfileManager.updateTransport`](../../../../../src/ProfileManager.ts)).
2. `transport.peerAddress = verifiedPeerAddress`; `profile.setIsHandshakeCompleted(true)`;
   `inFlightHandshakeTransports.delete(transport)`.
3. `p2pManager.addConnection(transport)` — only now is it an "open connection".
4. **WebRTC upgrade decision.** If either side prefers WebRTC, the current transport is not already
   WebRTC, and `localAddress < completedPeerAddress` (deterministic single-initiator tiebreak to avoid
   glare), call `webRTCSetupService.initiateWebRTC(transport)` (see [./webrtc-setup.md](./webrtc-setup.md)).
5. **Post-handshake sync.** If the channel is `OPENED` and the peer `canParticipateInDisputes`,
   `spectateService.sync(...)`. The `canParticipateInDisputes` call is a chain read wrapped so that a
   post-disposal rejection is swallowed.
6. `p2pEventHooks.onConnection?.(...)`; `handshakeBarrier.signal()` (releases the guard retry-queue
   waiter, [./README.md](./README.md) §5.2).

### 3.6 Timeouts and their consequences

- **Response timeout** (initiator): `agreementTime` → `disconnectConnection`. No blacklist — the peer
  never proved an identity to blacklist.
- **Ack timeout** (`ensureHandshakeAckTimeoutScheduled`, armed by both roles, deduped by
  `ackTimeoutScheduled`): after `agreementTime`, if `!didReceiveAck` → if a peer address is known
  (`transport.peerAddress || verifiedPeerAddressByTransport.get(transport)`),
  `disconnectAndBlacklistPeerByEvmAddress`; else `disconnectConnection`. So a peer this node has
  _verified_ (initiator role complete) but which never acks gets blacklisted by address; an unverified
  peer is merely disconnected.

### 3.7 Sequence diagram (mutual, both directions on one transport)

```mermaid
sequenceDiagram
    participant A as Node A (has key kA)
    participant T as transport (untrusted pipe)
    participant B as Node B (has key kB)

    Note over A,B: both call initHandshake on transport construction

    A->>T: onInitHandshakeRequest(chA, tA)   %% A initiator
    T->>B: (relayed bytes)
    B->>B: validate hex32/finite, skew<=agreementTime
    B->>B: sign(domain:chA) with kB
    B-->>A: {sig_kB, tB, preferB}
    A->>A: RTT & skew ok; verifyMessage -> addrB; not blacklisted
    A->>A: recordVerifiedPeerAddress(addrB); setRemotePreferred
    A->>B: onInitHandshakeAck(chA)   %% "I authenticated you"
    B->>B: markAcked

    Note over A,B: symmetric exchange in the other direction
    B->>A: onInitHandshakeRequest(chB, tB)   %% B initiator
    A->>A: sign(domain:chB) with kA -> {sig_kA,...}
    A-->>B: response
    B->>B: verify -> addrA; ack
    B->>A: onInitHandshakeAck(chB)
    A->>A: markAcked

    Note over A: finalize when verified(addrB) AND acked AND remotePreferred
    A->>A: create/update PeerProfile(addrB), addConnection, maybe WebRTC/sync
    Note over B: same on B's side -> PeerProfile(addrA)
```

---

## 4. Byzantine assessment

The service runs entirely pre-authentication; `check`/guards protect _nothing_ here (there is no
guard on this service). Every vector below is available to any transport-level counterparty.

### 4.1 `onInitHandshakeRequest`

**Malformed payload.** Handled. Non-32-byte `challengeHash` or non-finite `time` are rejected before
any signing (INV-HSK-3); the `Number.isFinite` check specifically closes the `NaN`-through-skew hole.
Note `params` arity/types are _not_ checked by the dispatcher ([./README.md](./README.md) §4) — a peer
may pass extra or wrong-typed params; the two positional reads plus the explicit `isHexString`/
`isFinite` tests contain that.

**Signing-oracle abuse.** Handled for cross-protocol reuse. The responder signs _any_ well-formed
32-byte challenge on request — it is, by construction, an oracle for `sign(peer3:init-handshake:v1:X)`.
Domain separation (INV-HSK-2) makes the output unusable as a block signature or in any other protocol
domain, and this is pinned by [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts).
**Residual, and the core concern:** the oracle is still exploitable _inside_ the handshake domain for a
**relay / reflection (man-in-the-middle) attack**, because the signed message binds nothing but the
challenge:

> The signature covers only `domain:challengeHash`. It does not cover the transport, a session id,
> the initiator's identity, or the responder's claimed address. An attacker M sitting on A's transport
> can, when A (initiator) sends challenge `chA`, open its own connection to victim V and call
> `onInitHandshakeRequest(chA, ·)`; V signs `domain:chA` with its key; M returns V's signature to A.
> A now verifies `addrV` and believes it is authenticated to V over M's transport. The reverse
> direction relays symmetrically. The transport layers (Holepunch, WebRTC, LocalDiscovery) supply no
> independent channel authentication to detect this. The only limiter is the `agreementTime` skew /
> RTT window, which bounds the relay to a short interval but does not prevent it.

This is not currently handled and is not recorded elsewhere. **Open question (defect-candidate,
divergence class: decision pending):** should the handshake bind the peer identity and a channel/
session token into the signed message (e.g. sign over `domain : challenge : localAddr : remoteAddr`
or over a transport-derived key) so a relayed signature cannot authenticate a third party? This is
adjacent to but distinct from [OQ-29](../../open-questions.md) (cross-deployment domain separation)
and the protocol-versioning item in [OQ-34](../../open-questions.md); it should be raised for an
engineer decision. _(Inferred concern — the reflection path is derived from the code, not observed in
a test.)_

**Replay of a captured handshake.** Handled against a _fresh_ challenger. Each initiator picks a new
`keccak256(randomBytes(32))` challenge and verifies the signature against exactly that challenge, so a
passively captured `(challenge, signature)` pair cannot satisfy a later, different challenge. Replay is
only useful in the live relay above, where the attacker forwards in real time.

**Resource abuse (pre-guard flood).** Unhandled — accepted gap. This endpoint runs before any guard
and performs an ECDSA `signMessage` per call; there is no per-peer or global rate limit
([./README.md](./README.md) §9, REQ-RPC-7 / [OQ-6](../../open-questions.md)). A peer can flood
handshake requests to burn signing CPU, and — because a pre-profile "blacklist" is disconnect-only
(§5, [./README.md](./README.md) §8) — reconnect freely to continue. Classified **missing** (rate
limiting is an accepted, unimplemented direction).

**Information disclosure.** Minimal. A successful response reveals the node's `preferredTransport`,
its clock (`responseTime`), and that it holds the local signer key (it always does). No secret is
exposed.

### 4.2 `onInitHandshakeAck`

**Spoofed / unsolicited ack.** Handled by construction, not by rejection. An ack alone cannot complete
a handshake: finalization also requires `verifiedPeerAddressByTransport` and `remotePreferred`, both of
which are only set after this node verified a valid signature over its _own_ random challenge (needs the
peer's private key). A forged ack thus sets `ackedTransports` but cannot forge identity. The unauthenticated
`challengeHash` is ignored for decisions (INV-HSK-4).

**Duplicate ack (replay / protocol-order abuse).** Handled: second ack →
`disconnectAndBlacklistPeer`. **Residual nuance (documentation debt):** at the moment a duplicate ack
arrives, a `PeerProfile` may not yet exist (the first ack can precede this node's own verification, so
finalize returned early and created no profile). `disconnectAndBlacklistPeer` uses
`profile?.blacklist()`, which no-ops without a profile ([`P2PManager.disconnectAndBlacklistPeer`](../../../../../src/P2PManager.ts)),
so the "blacklist" degrades to a plain disconnect exactly in the pre-profile case — the same weakness
flagged generally in [./README.md](./README.md) §8 and [OQ-34](../../open-questions.md) (ban
persistence before a profile exists).

**Racing two handshakes / protocol-order abuse.** Sending an ack before ever issuing a request, or
interleaving acks with requests, cannot advance state past the verification gate (above). Because
`onInitHandshakeAck` is `void`-typed it is a fire-and-forget method and may even be _broadcast_ by a
misbehaving sender; the handler tolerates arbitrary delivery.

**Resource abuse.** Same unbounded-frame concern as §4.1; ack handling itself is cheap (set membership).

### 4.3 Identity binding — what actually ties the EVM address to the transport

Only the local verification step binds them: after `verifyMessage`, this node writes
`transport.peerAddress` and (at finalize) a `PeerProfile`. Every later trust decision — guard pass,
`isSamePeer` response correlation ([./README.md](./README.md) §6.5), address-targeted delivery — trusts
that binding. It is sound **only under the assumption that the transport is not a relay** (§4.1). The
transports provide no cryptographic peer identity of their own, so the handshake signature is the
entire root of trust, and its lack of channel binding is the single largest residual risk in this
service.

---

## 5. Failure outcomes

Consistent with the model's classification table ([./README.md](./README.md) §8):

| Trigger                                   | Method / role                             | Consequence                                                                         |
| ----------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Non-hex32 challenge or non-finite time    | `onInitHandshakeRequest`                  | Disconnect + `{ok:false}` request error (throw)                                     |
| Request time outside `agreementTime` skew | `onInitHandshakeRequest`                  | Disconnect + request error                                                          |
| Response timeout                          | `runHandshake` (initiator)                | Disconnect, **no blacklist** (identity unproven)                                    |
| RTT or response-timestamp outside window  | `handleHandshakeResponse`                 | Disconnect, no blacklist                                                            |
| Undecodable / invalid signature           | `handleHandshakeResponse` (verify throws) | Disconnect, no blacklist                                                            |
| Verified signer is blacklisted            | `handleHandshakeResponse`                 | Disconnect                                                                          |
| Duplicate ack                             | `onInitHandshakeAck`                      | Disconnect + blacklist — **degrades to disconnect-only when no profile yet** (§4.2) |
| Ack never arrives                         | ack-timeout task                          | Blacklist by verified address if known, else disconnect                             |

**Flagged mismatch vs. the model table.** [./README.md](./README.md) §8 lists "Duplicate handshake ack
→ Disconnect + blacklist" unconditionally; in practice the blacklist half is conditional on a profile
already existing (§4.2). Documentation debt — the tables should agree, or the code should pin the
transport-level address so the ban actually persists.

---

## 6. Invariants

| ID        | Invariant                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| INV-HSK-1 | A `PeerProfile` is marked `isHandshakeCompleted` only after this node both (a) verified the peer's signature over the domain-tagged challenge _it_ generated and (b) received the peer's ack, with the peer's preferred transport known — i.e. both directions completed on the transport. |
| INV-HSK-2 | The responder signs only `peer3:init-handshake:v1:<hexlified challenge>`, never a bare 32-byte hash; a handshake signature cannot collide with a block signature.                                                                                                                          |
| INV-HSK-3 | A request with a non-32-byte challenge or non-finite time is rejected before any signing action.                                                                                                                                                                                           |
| INV-HSK-4 | The `challengeHash` carried on an ack is diagnostic only and never authenticates or authorizes anything.                                                                                                                                                                                   |
| INV-HSK-5 | Request and response are accepted only within one `agreementTime` skew window (request time, RTT, and response-timestamp checks).                                                                                                                                                          |
| REQ-HSK-1 | `initHandshakeService` carries no guard and every endpoint MUST be safe against wholly unauthenticated, adversarial input (pre-authentication ingress).                                                                                                                                    |
| REQ-HSK-2 | Any message the node signs on behalf of an unauthenticated caller MUST be domain-separated so it cannot be reused in another signature domain (signing-oracle hygiene).                                                                                                                    |

---

## 7. Verification

- **Unit / boundary.** [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts)
  — domain-separation round-trip, non-collision with block signing (INV-HSK-2 / REQ-HSK-2), and
  casing-invariant message derivation.
- **End-to-end.** [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts):
  handshake completion + profile creation (INV-HSK-1); WebRTC transport upgrade updates the profile in
  place (§3.5); request-time skew disconnect, no-response disconnect, response-timestamp mismatch
  disconnect, undecodable-signature disconnect (INV-HSK-5); duplicate-ack disconnect + blacklist
  (§3.4). Broader authentication / signing-oracle coverage is cross-listed in
  [./README.md](./README.md) §12.
- **Known gaps (`none — gap`).**
    - No test exercises the **relay / reflection** vector of §4.1 (no adversarial MITM harness). This is
      the highest-value missing test.
    - No test pins the **pre-profile duplicate-ack** degradation (§4.2 / §5) — i.e. that "blacklist"
      becomes disconnect-only when finalize has not yet created a profile.
    - No pre-guard **flood / rate-limit** test (nothing to test until [OQ-6](../../open-questions.md)).
    - No test asserting the mutual, two-direction finalization gate (that a single-direction handshake
      does not complete a profile).

---

## Future Work

_Non-normative._

- Bind peer identity and a channel/session token into the signed handshake message to close the relay/
  reflection MITM (§4.1); coordinate with [OQ-29](../../open-questions.md) domain separation and the
  protocol-versioning decision in [OQ-34](../../open-questions.md) so one signed-domain scheme covers
  deployment scoping, protocol version, and channel binding.
- Persist pre-profile bans by transport-level address so a rejected pre-handshake peer cannot reconnect
  freely ([OQ-34](../../open-questions.md), [./README.md](./README.md) §8).
- Fold the pre-guard signing endpoint under the central RPC rate limiter ([OQ-6](../../open-questions.md),
  [./README.md](./README.md) §9), with handshake traffic prioritized above bulk sync.

---

## Traceability

| ID        | Statement                                                                                           | Implementation                                                                                                                                                                                                                                    | Verification evidence                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-HSK-1 | Profile completes only after verify + ack + preferred-transport on the transport (both directions). | [InitHandshakeService.maybeFinalizeHandshakeOnceFromTransport](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)                                                                                                             | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts) (completion + profile); none — gap (no single-direction-does-not-complete assertion) |
| INV-HSK-2 | Responder signs the domain-tagged message; no block-signature collision.                            | [InitHandshakeService.buildHandshakeChallengeMessage / HANDSHAKE_DOMAIN](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)                                                                                                   | [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts)                                                |
| INV-HSK-3 | Non-hex32 challenge / non-finite time rejected before signing.                                      | [InitHandshakeRpcMethods.onInitHandshakeRequest](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts)                                                                                                                        | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts) (time-skew cases); none — gap (no explicit non-hex32 / NaN unit test)                |
| INV-HSK-4 | Ack `challengeHash` is diagnostic only, never trusted.                                              | [InitHandshakeRpcMethods.onInitHandshakeAck](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts)                                                                                                                            | none — gap (no test feeds a mismatched ack challenge)                                                                                                                        |
| INV-HSK-5 | Request/response accepted only within one `agreementTime` skew window.                              | [InitHandshakeRpcMethods.onInitHandshakeRequest](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts), [InitHandshakeService.handleHandshakeResponse](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts) | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts) (Time Validation)                                                                    |
| REQ-HSK-1 | Unguarded service; every endpoint safe against unauthenticated adversarial input.                   | [InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts) (no `this.guards`)                                                                                                                               | [test/e2e/E2E-InitHandshake.test.ts](../../../../../test/e2e/E2E-InitHandshake.test.ts); none — gap (no MITM/relay or flood suite)                                           |
| REQ-HSK-2 | Messages signed for unauthenticated callers are domain-separated.                                   | [InitHandshakeService.HANDSHAKE_DOMAIN](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts)                                                                                                                                    | [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts)                                                |
