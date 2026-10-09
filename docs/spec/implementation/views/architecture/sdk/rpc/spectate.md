# SpectateService — Trustless Pre-Commit State Synchronization

> **Specification subject:** [specification/architecture/rpc.md](../../../../../specification/peer-communication/rpc.md)

> **Scope:** The `spectateService` RPC surface: the `onSpectateRequest` responder endpoint, the
> `sync` / `applySyncResponse` requester path, and the proof-generation
> (`generateSyncPayload`) / proof-verification machinery. This document owns the **RPC ingress
> contract and Byzantine surface** of spectate synchronization. It references the shared peer-RPC
> model ([./README.md](./README.md)) and the protocol-level spectate flow
> ([../../protocol/cross-layer-messages.md](../../../../../specification/settlement/cross-layer-messages.md) §3) rather than
> restating them.
> **ID prefix:** `SPC` (`INV-SPC-n`, `REQ-SPC-n`).

Related: [./README.md](./README.md) (dispatch, guards, delivery modes, failure outcomes,
one-in-flight-per-peer replay rule), [../../protocol/cross-layer-messages.md](../../../../../specification/settlement/cross-layer-messages.md)
§3 (spectate-before-join, the enumerated abort conditions [`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)), §6 (the channel-balance
invariant [`INV-MSG-6-1C22RD` (Balance invariant)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-6-1c22rd)), [../../open-questions.md](../../../../../specification/open-questions.md) ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5), [`OQ-10-04YNC4` (Spectate/join failure-point details)](../../../../../specification/open-questions.md#oq-10-04ync4), [`OQ-19-Y8FDQX` (Channel-balance invariant enforcement points)](../../../../open-questions.md#oq-19-y8fdqx), [`DEF-5-E8TP9N`](../../../../../audit/open-findings.md#def-5-e8tp9n)).

---

Proof construction, trusted-start tiers and retained persistence use the shared
[AgreementManager report](../../../../source/src/agreementManager/AgreementManager.ts.md).
Latest final state is supplied for replay; if the anchor is that final point, its block and snapshot
are retained too. With newer finality no separate old-anchor proof is required. Whole earlier
milestones are skipped; a milestone crossing the matching anchor keeps its verified suffix.
Thrown execution and RPC failures propagate; they are not false proof verdicts.

## 1. Purpose and owners

Synchronization obtains a provable final state and replays its unfinalized tail without submitting
an on-chain transaction. The service owns request coordination, payload checks and persistence.
[AgreementManager](../../../../source/src/agreementManager/AgreementManager.ts.md) owns milestone
construction, trusted-start verification and retained proof history. The
[SpectateService file report](../../../../source/src/rpc/network/services/spectate/SpectateService.ts.md)
records source anchors and component obligations; the
[RPC endpoint report](../../../../source/src/rpc/network/services/spectate/SpectateRpcMethods.ts.md)
records ingress behavior.

`sync` is an awaited `Promise<boolean>`. Initial connection and queue recovery own the lifecycle
consequence of false. A thrown execution or RPC failure propagates without a peer-proof verdict.
Initial connection selects an authoritative chain-eligible peer before starting sync.

## 2. Owned state

`inFlightByPeerAddress` is a map from normalized peer address to the original request and its
result promise. A concurrent request waits. It reuses false, or a successful result covering the
same channel and fork at a sufficient height. Otherwise it starts the required request after the
first completes. The owner removes its entry in `finally`.

Verification always uses that original requester-owned target. The responder cannot change the
request by echoing different coordinates. Verified persistence runs under the state-manager mutex;
request waiting does not hold that mutex.

## 3. Request, verification and persistence

The responder rejects malformed heights before chain work. It starts with the mirrored chain
snapshot and reads authoritative chain dispute status. It follows committed dispute windows and
computes their successors; latest mode derives the chain's latest provable fork rather than taking
the responder's local active fork. A computed successor can be served before local genesis
installation. A pinned request accepts its fork or a proven descendant; the same-fork endpoint must
reach its requested minimum height. An unavailable proof returns undefined to the RPC endpoint.

The payload includes fork lineage, genesis snapshot and state, milestone proof and supporting
snapshots, latest finalized full state and outbound ranges. An empty milestone proof denotes genesis.
The latest finalized state may be above the older chain anchor; that old anchor block need not be
included. When the anchor itself is latest final, its milestone block and state are supplied.

The requester decodes the payload, fetches chain truth, verifies the dispute-window lineage and
claimed genesis, and checks the requested fork and outbound commitments. Already-adopted leading
windows are skipped only after their chain-final successor links are checked. At most one remaining
window is reduced locally for this verification, only when every dispute names this channel and
that window's fork ("dispute window mismatch" otherwise); the call reports whether it executed the reduction
or returned early because the window was already reduced.

Milestone verification calls `AgreementManager.verifyStateProof`: local finalized state, local
diamond, then chain. Missing starts or false results permit the next tier; throws do not. The
proof endpoint must reach the known final point. The verified walk determines the replay base;
the supplied full state must match that finalized snapshot's hash. The latest-fork outbound run is
checked from the on-chain snapshot when it is on the proven fork (else from the fork genesis) to that
state, and only the blocks above the on-chain snapshot are stored; the balance check uses the same state.

Persistence reconstructs retained milestone support, merging matching overlapping blocks and their
signatures. It does not require skipped historical blocks. It stores final snapshot and full state,
then passes the unfinalized suffix through the ordinary spectating ingest path from the verified
predecessor. A milestone crossing an anchor retains its verified suffix. Conflicting final state
or a failed payload check rejects the response. A window's inbound blocks are stored only when this
request's own local reduction executed, since only that call checked them; no other window persists
its inbound list, and chain events or chain-log recovery deliver its genuine blocks.

`persistSyncPayload` runs under the state-manager mutex and aborts at mutex entry when the runtime
is disposed. When this peer already holds the replay base or a later point on that fork, it keeps
its local state and writes only the served history. A sync conflict found while staging or
committing the verified history aborts persistence; `applySyncResponse` then blacklists the
responder (`rejectSync`) and returns false. A persistence abort while the runtime is disposed
returns false with no `rejectSync`. A disposed runtime makes `applySyncResponse` return false at
entry, with no verdict on the peer.

## 4. Failure and threat boundaries

Invalid encoded payloads and completed invalid-proof checks blacklist the responder and return
false. Request timeout, refusal or transport loss uses a counted retry close and returns false;
these are not proof of Byzantine behavior. Errors after decode that represent internal execution
or chain reads are logged and rethrown. The outer caller handles runtime shutdown or recovery.

The responder still blacklists a requester when it cannot construct the requested proof. Honest
stale requests and adoption-time blacklist races remain open policy questions. This is separate
from the requester's corrected transport-error handling. Proof-serving cost and per-peer resource
limits also remain open. A handshake-completed observer can request a proof; no participant-only
access policy is introduced here.

Balance verification protects the syncing peer against an unbacked state even when participants
signed it. This client check does not establish that every on-chain snapshot update enforces the
same balance invariant. See the owning balance and snapshot subjects.

## 5. Failure outcomes

| Path                  | Failure                                               | Result                                                            |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Responder             | Missing peer identity or unprovable requested target  | Blacklist requester and reject request                            |
| Request               | Timeout, refusal or lost transport                    | Counted retry close; false                                        |
| Payload               | Undecodable payload or completed invalid verification | Blacklist responder; false                                        |
| Internal verification | Thrown local execution or chain-read failure          | Log and rethrow; no peer verdict                                  |
| Caller                | Sync returns false                                    | Caller owns initial-connect abort or established-runtime recovery |

## 6. Invariants

<a id="inv-spc-1-zv8qm5"></a>

### INV-SPC-1-ZV8QM5 — Payload validated against own chain reads

A returned `SyncPayload` is validated against the requester's own on-chain reads and contract logic (dispute walk, milestones, outbound ranges, balance invariant) before any state effect; nothing in the payload is trusted on receipt.

- [x] `INV-SPC-1-ZV8QM5.T1.P1` — valid case
- [x] `INV-SPC-1-ZV8QM5.T1.P2` — zero/empty/no-op where meaningful
- [x] `INV-SPC-1-ZV8QM5.T1.P3` — direct invalid/opposite
- [x] `INV-SPC-1-ZV8QM5.T1.P6` — relevant race

<a id="inv-spc-2-rphnj5"></a>

### INV-SPC-2-RPHNJ5 — Payload verified against own request

A payload is always verified against the requester's own `SyncRequest` (channel/fork/height from the `sync` closure), never the responder's echo.

<a id="inv-spc-3-ep3tpg"></a>

### INV-SPC-3-EP3TPG — One in-flight sync per peer

At most one in-flight sync per peer (`inFlightByPeerAddress`); the set is cleaned up in `finally` on every path.

- [x] `INV-SPC-3-EP3TPG.T1.P1` — valid case

<a id="inv-spc-4-wvxs19"></a>

### INV-SPC-4-WVXS19 — Fail-closed spectating

Spectating rejects invalid evidence. The caller owns failure handling; a verified replay prefix may remain persisted before a later block fails ([`REQ-MSG-9-BFN9P5` (Spectating MUST be fail-closed)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-9-bfn9p5)).

- [x] `INV-SPC-4-WVXS19.T1.P1` — valid case
- [x] `INV-SPC-4-WVXS19.T1.P3` — malformed input
- [x] `INV-SPC-4-WVXS19.T1.P4` — direct invalid/opposite
- [x] `INV-SPC-4-WVXS19.T1.P10` — adversarial input
- [x] `INV-SPC-4-WVXS19.T1.P11` — partial failure

<a id="inv-spc-5-rhb7tk"></a>

### INV-SPC-5-RHB7TK — Adopted snapshot satisfies the balance invariant

The latest finalized snapshot a spectator adopts satisfies the channel-balance invariant ([`INV-MSG-6-1C22RD` (Balance invariant)](../../../../../specification/settlement/cross-layer-messages.md#inv-msg-6-1c22rd)) checked client-side against chain-anchored deposits/withdrawals.

<a id="inv-spc-6-2ne2ra"></a>

### INV-SPC-6-2NE2RA — Sync sends no on-chain transaction

No step of a sync sends an on-chain transaction; all contract verification runs against the local EVM or as `staticCall`.

<a id="req-spc-1-h10r5k"></a>

### REQ-SPC-1-H10R5K — Prove at least the requested height

The responder MUST prove at least the requested height on that fork or a verified successor whose lineage contains it; an unrelated fork or above-latest same-fork height is refused.

- [x] `REQ-SPC-1-H10R5K.T1.P1` — valid case
- [x] `REQ-SPC-1-H10R5K.T1.P2` — zero/empty/no-op where meaningful
- [x] `REQ-SPC-1-H10R5K.T1.P3` — direct invalid/opposite
- [x] `REQ-SPC-1-H10R5K.T1.P4` — exact boundary
- [x] `REQ-SPC-1-H10R5K.T1.P6` — relevant race

<a id="req-spc-2-45c3ct"></a>

### REQ-SPC-2-45C3CT — Availability failures are not Byzantine

Request-path failures MUST distinguish availability/transport failure from Byzantine evidence before permanent exclusion.

<a id="req-spc-3-azbkr1"></a>

### REQ-SPC-3-AZBKR1 — No permanent blacklist for can't-prove-yet

An honest can't-prove-yet request MUST NOT permanently blacklist the requester.

<a id="req-spc-4-g5xxb2"></a>

### REQ-SPC-4-G5XXB2 — Resource-bounded proof serving

Proof-serving MUST be resource-bounded per peer.

## 7. Verification

Concrete test evidence is owned by the downstream verification layer. This section defines implementation-specific obligations only.

## 8. Future Work

_Non-normative._

- Settle responder-side handling of honest unprovable requests ([`DEF-5-E8TP9N`](../../../../../audit/open-findings.md#def-5-e8tp9n), §4.3).
- Bring spectate proof generation under the central RPC rate limiter with a higher per-request cost
  weight ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5), §4.4).
- Decide whether spectate access control is ever wanted (participant-vs-observer guard, [`REQ-RPC-5-CV1R1Y` (Resource bounds)](../../../../../specification/peer-communication/rpc.md#req-rpc-5-cv1r1y);
  §4.5).
- Track the on-chain-snapshot-update invariant enforcement ([`OQ-19-Y8FDQX` (Channel-balance invariant enforcement points)](../../../../open-questions.md#oq-19-y8fdqx)) so protection does not depend on
  the client always spectating (§4.1).

## Source admission and membership updates

Admission uses the existing sync(peer, channel, fork, minimumHeight, timeout) call. Its awaited result, in-flight coordination, verification, persistence and peer-failure handling are shared with other sync callers. BlockQueueManager awaits sync and ends intake without queueing or merging the triggering copy. Sync owns verification, state application and peer failure handling. Spectators still request/serve sync while unsolicited relaying is disabled. See [SpectateService.ts](../../../../source/src/rpc/network/services/spectate/SpectateService.ts.md).

## Gaps

- [`REQ-SPC-3-AZBKR1`](spectate.md#req-spc-3-azbkr1)
  Missing: `onSpectateRequest` blacklists the requester whenever `generateSyncPayload` cannot prove the target, including an honest can't-prove-yet request ([`DEF-10-199C7F`](../../../../../audit/open-findings.md#def-10-199c7f)).
- [`REQ-SPC-4-G5XXB2`](spectate.md#req-spc-4-g5xxb2)
  Missing: `onSpectateRequest` applies no per-peer rate or cost limit to `generateSyncPayload` ([`OQ-6-4JPNE5` (P2P gossip rate limiting)](../../../../../specification/open-questions.md#oq-6-4jpne5)).
