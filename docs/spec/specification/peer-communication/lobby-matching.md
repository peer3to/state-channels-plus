# Caller-Topic Lobby Matching

> **Agent status:** Maintained protocol specification.
> **Engineer verification:** Pending.
> **Scope:** Discovery rendezvous and exclusive two-peer matching before channel-term negotiation.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Discovery sources and caller topic](#discovery-sources-and-caller-topic)
- [Matching state machine](#matching-state-machine)
- [Role convergence](#role-convergence)
- [Selection and commitment](#selection-and-commitment)
- [Failure and recovery](#failure-and-recovery)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A lobby lets peers that share one caller-supplied rendezvous topic authenticate, advertise whether
they can form a channel, and converge on one exclusive pair. The matcher is channel-agnostic: it returns
one eligible committed peer and does not start negotiation or inspect its outcome. Ordinary `joinLobby`
owns clean-signer and `DISCOVERING` policy, then starts transcript-derived negotiation. Targeted
`connectToChannel` retains its selected channel in `NOT_OPENED`, computes a domain-separated target topic,
and starts fixed-ID negotiation. Probes may compose the same services directly. The internal match
identifies the two peers and one fresh attempt. It does not choose a channel ID or open a channel.
Explicit leave settles the client's pending join result only while matching is active. After commitment,
it reports that cancellation is unavailable and the host continues negotiation or signed-attempt
observation through its normal outcome.

Ordinary discovery is a no-channel lifecycle role. A peer in ordinary discovery has an active caller topic
and no selected channel ID. A peer targeting a concrete channel is outside ordinary discovery but may run
the generic matcher on its derived target topic. A participating peer is outside every matching route.
Entering discovery never clears or abandons a live channel role implicitly.

## Discovery sources and caller topic

Permissionless event indexers are the normal source for finding candidate open channels. An indexer
may be incomplete, stale, filtered, or unavailable. The authoritative manager exposes a paged set of
currently open channel IDs as a trustless fallback. That set proves only that a channel currently has
an on-chain snapshot. A caller still reads the snapshot and applies its own admission and availability
policy before joining.

Lobby rendezvous is separate from open-channel enumeration. Each application supplies the same
32-byte topic to the peers it wants in one lobby. The topic is obtained out of band. There is no
global, implicit, fixed, or fallback lobby topic. A caller may supply a derived topic, and the matcher
uses that topic exactly without deriving another. Knowing the topic is an invitation to
connect, not proof of identity; peers authenticate before matching state can be created.

Default construction has no `shouldMatchPeer` filter and admits authenticated eligible peers. A
host-loaded custom RPC root may synchronously replace the matching service with one carrying a local
filter before readiness. Module identity and serializable application options may cross the runtime port;
the function and any generic allow/deny policy do not.

## Matching state machine

One discovery session moves through these states:

1. **None.** The peer has joined the caller topic but has no matching role.
2. **Advertiser.** The peer announces availability and may accept one picker.
3. **Selector.** The peer records available advertisers and has at most one outgoing selection.
4. **In-flight selection.** The selector waits for one correlated pick result or commitment result.
5. **Reserved advertiser.** The advertiser has accepted one selector and rejects later picks as busy.
6. **Committed pair.** Both peers have acknowledged the same attempt and ordered challenge pair.
7. **Released attempt.** The lease is cleared and the peer either resumes matching or leaves discovery.

An ordinary role transition is deferred while a selector request or advertiser reservation is
outstanding. A committed pair accepts no further lobby work. Before commitment, explicit leave,
replacement discovery entry, an optional caller timeout, or disposal settles the local matching
operation once and removes its topic state, timers, advertisements, reservations, and subscriptions.
Matching has no implicit deadline. After commitment, matching has handed off to negotiation: a lobby
leave request reports that cancellation is no longer available and does not mutate the attempt.
Successful opening or runtime disposal later removes topic membership. Leaving the rendezvous stops
new discovery but does not close an established authenticated transport; the selected channel lifecycle
owns that connection after commitment.

Authenticated lobby transports remain outside ordinary channel connection tracking and broadcasts while
matching. Commitment promotes only the selected profile into negotiation and closes every non-selected
lobby transport. A healthy replacement transport authenticated for that selected profile during the
commitment-to-negotiation handoff joins the same promoted profile; it is not treated as late lobby traffic
or a disconnect. Cancellation, replacement, timeout, disposal, and unsigned negotiation failure close the
whole session transport set. An ordinary unsigned retry leaves discovery, closes the selected handoff, and
performs a fresh join of the same caller topic with no retained candidates, reservations, or connections.
Targeted unsigned failure leaves its derived topic without automatic re-entry and retains the selected ID
for a later explicit call.

An optional timeout belongs only to unmatched work. Omitted or `null` is unbounded. Acceptance cancels and
removes the timer before returning the match, so no old deadline can affect negotiation or later owners.
Both public cancellation wrappers independently call the same unmatched cleanup operation. Cancellation
during an in-flight commit waits for its existing result: accepted commitment wins, while normal timeout
or punishment cleanup permits the pending cancellation to settle.

## Role convergence

Each session starts with role `none`. On the first authenticated role exchange:

- when both peers have no role, canonical address order assigns the lower address advertiser and the
  higher address selector;
- when one peer has no role, it adopts the opposite of the advertised role;
- later role assignments carry a monotonically newer epoch, including after retry or re-entry on the
  same topic, so delayed advertisements cannot replace current state.

After bootstrap, advertiser and selector roles last for a random duration within deployment-configured
bounds. A selector tries another known candidate immediately after a busy or rejected result. Only
candidate exhaustion schedules a fresh randomized switch to advertiser. A peer with no authenticated
candidates remains an advertiser so a newly arriving selector can match without waiting for another
role cycle.

## Selection and commitment

Availability is an unsolicited one-way advertisement and expects no response. Operations whose sender
needs an outcome use correlated request and response delivery.

A selector sends one pick containing a fresh attempt nonce, its current role epoch, and a fresh
32-byte selector challenge. An advertiser accepts atomically only when its advertised epoch is still
current and it has no reservation. Acceptance consumes availability, records the selector and attempt,
and returns a fresh 32-byte advertiser challenge. Every later explicit picker receives `busy`; no busy
message is sent to uninvolved peers. Invalid or policy-rejected picks return `rejected` without creating
a reservation.

Once an advertiser has committed or otherwise stopped matching, a later correlated pick receives
`rejected`. Silence is reserved for an unreachable peer. This prevents an honest selector from treating
ordinary completed-session traffic as a timeout violation.

After acceptance, the selector commits the same attempt and ordered challenge pair. The advertiser
validates it and returns a correlated acknowledgement. Only that acknowledgement commits the pair.
Both peers then know the selected peer, attempt, lower-address challenge, and higher-address challenge.
The lobby transcript contains no channel ID.

## Failure and recovery

- A selector holds its role while its pick or commitment request is pending. Request failure or silence
  is an agreement-window protocol failure: the silent peer is excluded and matching resumes.
- An advertiser holds its role while reserved. If no valid commitment arrives within the agreement
  window, it excludes the silent selector, releases the reservation, applies any deferred role change,
  and advertises again when still an advertiser. Recovery does not reset its existing role timer.
- Loss of the selected profile's final live transport before commitment is a neutral abort. The lease is
  released without exclusion and matching resumes immediately. Replacing one transport while another
  remains live is not profile loss.
- Stale, duplicate, malformed, wrong-topic, wrong-epoch, wrong-attempt, wrong-role, unauthenticated, self,
  and policy-rejected traffic does not mutate matching state.
- A committed counterparty that abandons channel negotiation is excluded immediately. Before the honest
  peer signs, it may release the attempt. After it signs, it keeps observing the chain until the channel
  opens or the signed payload expires; runtime cleanup cannot revoke a signature already issued.

## Requirements and invariants

**<a id="inv-lobby-1-tw7rzt"></a>`INV-LOBBY-1-TW7RZT` — Exclusive match ownership.** A selector has at most one
outgoing selection, an advertiser has at most one reservation, and one committed attempt names exactly
two mutually acknowledged peers. Lobby matching never chooses a channel ID.

**<a id="req-lobby-1-pztpkd"></a>`REQ-LOBBY-1-PZTPKD` — Caller-owned rendezvous.** Discovery uses exactly the
caller-supplied 32-byte topic. No default or fallback topic exists, and traffic from another topic cannot
create candidates or mutate the session.

**<a id="req-lobby-2-tswrv6"></a>`REQ-LOBBY-2-TSWRV6` — Authenticated admission.** A peer becomes a candidate and
may affect matching only after identity authentication on the active topic. Discovery has no selected
channel ID and cannot overlap a live targeted-channel role. Lobby transports do not enter ordinary
connection tracking; commitment promotes only the selected profile and closes every other lobby transport.

**<a id="req-lobby-3-q9wy40"></a>`REQ-LOBBY-3-Q9WY40` — Convergent roles.** Canonical identity order assigns
opposite roles when two no-role peers meet; a lone no-role peer adopts the opposite advertised role;
epochs reject delayed role state; randomized role duration and exhaustion delay prevent synchronized
role oscillation.

**<a id="req-lobby-4-e0tarv"></a>`REQ-LOBBY-4-E0TARV` — Atomic selection.** An advertiser accepts only the first
valid current-epoch pick and returns busy only to later explicit pickers. A selector keeps one correlated
pick or commitment request in flight and retries other candidates without conflicting work.

**<a id="req-lobby-5-vtrx8c"></a>`REQ-LOBBY-5-VTRX8C` — Mutual commitment.** A match completes only after both peers
acknowledge the same fresh attempt and ordered challenge pair. Availability is one-way; pick and commit
carry correlated outcomes. The runtime host passes a committed match directly into negotiation and
returns only the final join outcome to the client.

**<a id="req-lobby-6-qszexp"></a>`REQ-LOBBY-6-QSZEXP` — Lease-safe role timing.** Role transitions are deferred
while a selector request or advertiser reservation exists. Busy and rejected selectors retry immediately;
only candidate exhaustion adds a fresh randomized advertiser-switch delay.

**<a id="req-lobby-7-bxq1qa"></a>`REQ-LOBBY-7-BXQ1QA` — Symmetric timeout punishment.** Pick or commit silence is
bounded by the agreement window and excludes the silent peer. Both sides release the failed lease and
resume matching without accepting a late result from the expired attempt.

**<a id="req-lobby-8-31be0f"></a>`REQ-LOBBY-8-31BE0F` — Profile-loss recovery.** Loss of a candidate's final live
transport before commitment releases matching immediately without exclusion. A healthy replacement or
fallback transport preserves the candidate and outstanding attempt. After commitment, a replacement
transport for the selected profile is promoted into the existing negotiation handoff without reopening
matching, disconnecting the selected profile, or excluding it.

**<a id="req-lobby-9-n894c0"></a>`REQ-LOBBY-9-N894C0` — Bounded inactive ingress and cleanup.** Inactive, completed,
malformed, stale, and duplicate lobby traffic cannot mutate state. Repeated ignored traffic is bounded per
peer. Matching has no default timeout; an explicit positive finite caller timeout may bound it. Leave,
replacement entry, explicit timeout, and disposal use one idempotent matching cleanup and settle the local
match operation once. Matching-phase leave reports success; after commitment it reports that handoff is
complete and cannot cancel negotiation. A correlated pick for the active topic after matching stopped
receives `rejected` rather than being dropped silently. Removing lobby discovery membership does not close
an established peer transport that has moved into the channel lifecycle. Every non-success cleanup closes
all lobby-owned transports. An unsigned negotiation failure also closes the selected handoff and leaves the
topic before a fresh match rejoins the same caller topic. While a caller still observes a lobby topic, its
discovery adapter MUST remain able to produce a replacement connection after an eligible authenticated
transport closes. The adapter MUST stop replacement work when topic observation ends, and an existing local
ban or blacklist MUST prevent a replacement connection to that peer.

## Assumptions and constraints

- The network is partially synchronous within the configured agreement window when progress is expected.
- The lobby forms two-party matches only. Multi-party channel formation is unsupported.
- The caller distributes the rendezvous topic securely enough for its application. Topic knowledge is not
  authentication and does not replace identity proof or reputation policy.
- Availability is transient. Neither an indexer result nor a lobby advertisement guarantees that a peer
  will accept, fund, or complete a channel.
- Randomized role bounds and reputation policy are deployment inputs and must be equal to the intended
  liveness and abuse limits.

## Security considerations

Protected assets are peer identity, exclusive pairing, opening-signature intent, and bounded node resources.
The trust boundaries are the caller-supplied topic, unauthenticated transport ingress, authenticated peer
messages, permissionless indexers, and the chain/RPC view. Identity authentication, topic scoping, epoch and
attempt binding, atomic reservations, correlated outcomes, and timeout punishment stop cross-topic injection,
double reservation, replay, and silent lease capture. Final-profile-loss recovery avoids punishing ordinary
transport replacement. Residual risks are invitation-topic leakage, Sybil candidates accepted by weak caller
policy, temporary indexer omission, timing failure outside partial synchrony, and resource use from traffic
below the configured abuse bound.

## Verification and test plan

| Plan item                                                 | Requirements / invariants                                    | Setup and stimulus                                                                                                                                                                                                                                                                                                                         | Expected result                                                                                                                                                                                                                                                                                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-lobby-1-tw7rzt.t1"></a>`INV-LOBBY-1-TW7RZT.T1` | [`INV-LOBBY-1-TW7RZT`](lobby-matching.md#inv-lobby-1-tw7rzt) | Run two- and many-peer lobbies with simultaneous picks and commitments.                                                                                                                                                                                                                                                                    | Every committed attempt contains one mutually acknowledged pair, with no channel ID or conflicting lease.                                                                                                                                                                                                                                                                            | <a id="inv-lobby-1-tw7rzt.t1.p1"></a>`INV-LOBBY-1-TW7RZT.T1.P1` — one outgoing selector request; <a id="inv-lobby-1-tw7rzt.t1.p2"></a>`INV-LOBBY-1-TW7RZT.T1.P2` — one advertiser reservation; <a id="inv-lobby-1-tw7rzt.t1.p3"></a>`INV-LOBBY-1-TW7RZT.T1.P3` — mutual pair equality; <a id="inv-lobby-1-tw7rzt.t1.p4"></a>`INV-LOBBY-1-TW7RZT.T1.P4` — match has no channel ID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-lobby-1-pztpkd.t1"></a>`REQ-LOBBY-1-PZTPKD.T1` | [`REQ-LOBBY-1-PZTPKD`](lobby-matching.md#req-lobby-1-pztpkd) | Join equal and unequal caller topics and query indexer and on-chain discovery sources.                                                                                                                                                                                                                                                     | Equal-topic peers may match; unequal topics are isolated; stale indexer results never replace snapshot and caller policy checks.                                                                                                                                                                                                                                                     | <a id="req-lobby-1-pztpkd.t1.p1"></a>`REQ-LOBBY-1-PZTPKD.T1.P1` — equal topic; <a id="req-lobby-1-pztpkd.t1.p2"></a>`REQ-LOBBY-1-PZTPKD.T1.P2` — unequal topics; <a id="req-lobby-1-pztpkd.t1.p3"></a>`REQ-LOBBY-1-PZTPKD.T1.P3` — no default topic; <a id="req-lobby-1-pztpkd.t1.p4"></a>`REQ-LOBBY-1-PZTPKD.T1.P4` — indexer/fallback reconciliation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-lobby-2-tswrv6.t1"></a>`REQ-LOBBY-2-TSWRV6.T1` | [`REQ-LOBBY-2-TSWRV6`](lobby-matching.md#req-lobby-2-tswrv6) | Deliver lobby traffic before and after authentication, inspect connection routing before and after commitment, and attempt discovery from clean, live-channel, and concluded-channel states.                                                                                                                                               | Only authenticated active-topic peers enter matching; lobby transports stay outside ordinary connections; commitment promotes only the selected profile; discovery has no channel ID; live-channel entry rejects without side effects.                                                                                                                                               | <a id="req-lobby-2-tswrv6.t1.p1"></a>`REQ-LOBBY-2-TSWRV6.T1.P1` — pre-auth ignored; <a id="req-lobby-2-tswrv6.t1.p2"></a>`REQ-LOBBY-2-TSWRV6.T1.P2` — post-auth admitted; <a id="req-lobby-2-tswrv6.t1.p3"></a>`REQ-LOBBY-2-TSWRV6.T1.P3` — clean discovery state; <a id="req-lobby-2-tswrv6.t1.p4"></a>`REQ-LOBBY-2-TSWRV6.T1.P4` — live-channel rejection; <a id="req-lobby-2-tswrv6.t1.p5"></a>`REQ-LOBBY-2-TSWRV6.T1.P5` — stale channel event cannot alter discovery; <a id="req-lobby-2-tswrv6.t1.p6"></a>`REQ-LOBBY-2-TSWRV6.T1.P6` — session-local transports, selected-only promotion, and discarded peers excluded from ordinary broadcasts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-lobby-3-q9wy40.t1"></a>`REQ-LOBBY-3-Q9WY40.T1` | [`REQ-LOBBY-3-Q9WY40`](lobby-matching.md#req-lobby-3-q9wy40) | Exchange no-role, one-role, current-epoch, stale-epoch, and timer-driven role messages.                                                                                                                                                                                                                                                    | Peers take opposite roles and stale or synchronized transitions do not prevent convergence.                                                                                                                                                                                                                                                                                          | <a id="req-lobby-3-q9wy40.t1.p1"></a>`REQ-LOBBY-3-Q9WY40.T1.P1` — both-none ordering; <a id="req-lobby-3-q9wy40.t1.p2"></a>`REQ-LOBBY-3-Q9WY40.T1.P2` — one-none adoption; <a id="req-lobby-3-q9wy40.t1.p3"></a>`REQ-LOBBY-3-Q9WY40.T1.P3` — stale epoch; <a id="req-lobby-3-q9wy40.t1.p4"></a>`REQ-LOBBY-3-Q9WY40.T1.P4` — production jitter bounds; <a id="req-lobby-3-q9wy40.t1.p5"></a>`REQ-LOBBY-3-Q9WY40.T1.P5` — exhaustion convergence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-lobby-4-e0tarv.t1"></a>`REQ-LOBBY-4-E0TARV.T1` | [`REQ-LOBBY-4-E0TARV`](lobby-matching.md#req-lobby-4-e0tarv) | Race several valid pickers, then return accepted, busy, rejected, stale, and mismatched results.                                                                                                                                                                                                                                           | One picker reserves the advertiser; only explicit later pickers see busy; selectors retry safely.                                                                                                                                                                                                                                                                                    | <a id="req-lobby-4-e0tarv.t1.p1"></a>`REQ-LOBBY-4-E0TARV.T1.P1` — atomic acceptance; <a id="req-lobby-4-e0tarv.t1.p2"></a>`REQ-LOBBY-4-E0TARV.T1.P2` — explicit busy only; <a id="req-lobby-4-e0tarv.t1.p3"></a>`REQ-LOBBY-4-E0TARV.T1.P3` — rejection retry; <a id="req-lobby-4-e0tarv.t1.p4"></a>`REQ-LOBBY-4-E0TARV.T1.P4` — stale/mismatched result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| <a id="req-lobby-5-vtrx8c.t1"></a>`REQ-LOBBY-5-VTRX8C.T1` | [`REQ-LOBBY-5-VTRX8C`](lobby-matching.md#req-lobby-5-vtrx8c) | Advertise repeatedly, accept a pick, and deliver valid, duplicate, malformed, and mismatched commitments.                                                                                                                                                                                                                                  | Availability creates no request lease; only one valid acknowledged commitment resolves both peers to the same transcript.                                                                                                                                                                                                                                                            | <a id="req-lobby-5-vtrx8c.t1.p1"></a>`REQ-LOBBY-5-VTRX8C.T1.P1` — one-way advertisement; <a id="req-lobby-5-vtrx8c.t1.p2"></a>`REQ-LOBBY-5-VTRX8C.T1.P2` — valid acknowledgement; <a id="req-lobby-5-vtrx8c.t1.p3"></a>`REQ-LOBBY-5-VTRX8C.T1.P3` — challenge/attempt equality; <a id="req-lobby-5-vtrx8c.t1.p4"></a>`REQ-LOBBY-5-VTRX8C.T1.P4` — malformed/duplicate commit no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| <a id="req-lobby-6-qszexp.t1"></a>`REQ-LOBBY-6-QSZEXP.T1` | [`REQ-LOBBY-6-QSZEXP`](lobby-matching.md#req-lobby-6-qszexp) | Fire role timers during held selector and advertiser leases, then settle them through every outcome.                                                                                                                                                                                                                                       | No conflicting role work starts; deferred transitions run after settlement; reservation recovery preserves the original timer.                                                                                                                                                                                                                                                       | <a id="req-lobby-6-qszexp.t1.p1"></a>`REQ-LOBBY-6-QSZEXP.T1.P1` — selector timer deferred; <a id="req-lobby-6-qszexp.t1.p2"></a>`REQ-LOBBY-6-QSZEXP.T1.P2` — advertiser timer deferred; <a id="req-lobby-6-qszexp.t1.p3"></a>`REQ-LOBBY-6-QSZEXP.T1.P3` — valid commit before deferred transition; <a id="req-lobby-6-qszexp.t1.p4"></a>`REQ-LOBBY-6-QSZEXP.T1.P4` — exhaustion uses fresh delay; <a id="req-lobby-6-qszexp.t1.p5"></a>`REQ-LOBBY-6-QSZEXP.T1.P5` — reservation recovery does not reset timer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-lobby-7-bxq1qa.t1"></a>`REQ-LOBBY-7-BXQ1QA.T1` | [`REQ-LOBBY-7-BXQ1QA`](lobby-matching.md#req-lobby-7-bxq1qa) | Suppress pick, pick response, commit, and commit response; then deliver late frames.                                                                                                                                                                                                                                                       | The silent peer is excluded at the bound, leases release, matching resumes, and late traffic is inert.                                                                                                                                                                                                                                                                               | <a id="req-lobby-7-bxq1qa.t1.p1"></a>`REQ-LOBBY-7-BXQ1QA.T1.P1` — selector request silence; <a id="req-lobby-7-bxq1qa.t1.p2"></a>`REQ-LOBBY-7-BXQ1QA.T1.P2` — advertiser commit silence; <a id="req-lobby-7-bxq1qa.t1.p3"></a>`REQ-LOBBY-7-BXQ1QA.T1.P3` — release and retry; <a id="req-lobby-7-bxq1qa.t1.p4"></a>`REQ-LOBBY-7-BXQ1QA.T1.P4` — late result ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| <a id="req-lobby-8-31be0f.t1"></a>`REQ-LOBBY-8-31BE0F.T1` | [`REQ-LOBBY-8-31BE0F`](lobby-matching.md#req-lobby-8-31be0f) | Close unauthenticated, authenticated, preferred, fallback, retired, and final transports while matching, then complete an upgrade during commitment handoff.                                                                                                                                                                               | Only final profile loss aborts the attempt; replacement and fallback preserve it; neutral loss does not exclude; the committed profile's replacement joins the existing handoff.                                                                                                                                                                                                     | <a id="req-lobby-8-31be0f.t1.p1"></a>`REQ-LOBBY-8-31BE0F.T1.P1` — final unauthenticated close; <a id="req-lobby-8-31be0f.t1.p2"></a>`REQ-LOBBY-8-31BE0F.T1.P2` — final authenticated close; <a id="req-lobby-8-31be0f.t1.p3"></a>`REQ-LOBBY-8-31BE0F.T1.P3` — replacement retirement; <a id="req-lobby-8-31be0f.t1.p4"></a>`REQ-LOBBY-8-31BE0F.T1.P4` — fallback promotion; <a id="req-lobby-8-31be0f.t1.p5"></a>`REQ-LOBBY-8-31BE0F.T1.P5` — immediate neutral retry; <a id="req-lobby-8-31be0f.t1.p6"></a>`REQ-LOBBY-8-31BE0F.T1.P6` — replacement authenticated during commitment handoff is promoted without blacklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="req-lobby-9-n894c0.t1"></a>`REQ-LOBBY-9-N894C0.T1` | [`REQ-LOBBY-9-N894C0`](lobby-matching.md#req-lobby-9-n894c0) | Send stale, duplicate, malformed, inactive-session, and excessive ignored traffic; cancel, replace, explicitly time out, dispose, and retry sessions; close eligible and blacklisted transports while topic observation is active and after it ends; try leave after handoff; leave discovery after opening and send a channel transition. | Invalid traffic has no state effect and bounded authenticated abuse disconnects and excludes its sender; matching has no implicit timeout; every cleanup settles once; active topic observation redials eligible peers but not blacklisted peers; both terminal handoff owners stop redial when they leave the topic; leaving discovery preserves the established channel transport. | <a id="req-lobby-9-n894c0.t1.p1"></a>`REQ-LOBBY-9-N894C0.T1.P1` — invalid traffic no-op; <a id="req-lobby-9-n894c0.t1.p2"></a>`REQ-LOBBY-9-N894C0.T1.P2` — abuse bound; <a id="req-lobby-9-n894c0.t1.p3"></a>`REQ-LOBBY-9-N894C0.T1.P3` — matching-phase leave succeeds; <a id="req-lobby-9-n894c0.t1.p4"></a>`REQ-LOBBY-9-N894C0.T1.P4` — replacement entry; <a id="req-lobby-9-n894c0.t1.p5"></a>`REQ-LOBBY-9-N894C0.T1.P5` — explicit timeout; <a id="req-lobby-9-n894c0.t1.p6"></a>`REQ-LOBBY-9-N894C0.T1.P6` — disposal; <a id="req-lobby-9-n894c0.t1.p7"></a>`REQ-LOBBY-9-N894C0.T1.P7` — post-commit pick rejected without blacklist; <a id="req-lobby-9-n894c0.t1.p8"></a>`REQ-LOBBY-9-N894C0.T1.P8` — post-open topic leave preserves the established transport for channel transitions; <a id="req-lobby-9-n894c0.t1.p9"></a>`REQ-LOBBY-9-N894C0.T1.P9` — absent or null timeout remains pending; <a id="req-lobby-9-n894c0.t1.p10"></a>`REQ-LOBBY-9-N894C0.T1.P10` — post-handoff leave reports false and negotiation continues; <a id="req-lobby-9-n894c0.t1.p11"></a>`REQ-LOBBY-9-N894C0.T1.P11` — ordinary cancellation, timeout, disposal, and unsigned retry close all session transports before fresh re-entry; <a id="req-lobby-9-n894c0.t1.p12"></a>`REQ-LOBBY-9-N894C0.T1.P12` — targeted handoff cleanup leaves the derived topic without automatic matching re-entry; <a id="req-lobby-9-n894c0.t1.p13"></a>`REQ-LOBBY-9-N894C0.T1.P13` — active topic redials an eligible peer after authenticated transport close; <a id="req-lobby-9-n894c0.t1.p14"></a>`REQ-LOBBY-9-N894C0.T1.P14` — successful completion leaves the topic and stops redial; <a id="req-lobby-9-n894c0.t1.p15"></a>`REQ-LOBBY-9-N894C0.T1.P15` — failed handoff release leaves the topic and stops redial; <a id="req-lobby-9-n894c0.t1.p16"></a>`REQ-LOBBY-9-N894C0.T1.P16` — a blacklisted peer is not redialed. |

## Future Work

_Non-normative._ A verified light client can query the authoritative open-channel set from its latest
verified manager state, replacing RPC-dependent discovery reads. Persistent availability and multi-party
formation need separate protocols. The per-transport pre-readiness queue cap and overflow outcome remain
open under [`OQ-SPEC-LOBBY-1-D65YTT`](../open-questions.md#oq-spec-lobby-1-d65ytt).
