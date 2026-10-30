# Specification Assessment

> **Agent assessment:** In progress.
> **Engineer disposition:** Pending.

The migrated protocol documents retain the reconstructed requirements, but their neutral templates and
interoperability cases are not yet complete. The generated specification index is the current queue.

The peer-communication layer now separates the handshake contract from post-authentication
engagement. The handshake specification ends at an authenticated identity-bound session and states
the objective boundary explicitly: mutual key proof, bidirectional inclusive clock compatibility
with an independent exchange-freshness bound, objective-facts-only separation, and the current
uniform-continued-interaction baseline; a future subjective engagement policy is an open question,
not interim behavior. The local-lifecycle engagement and catch-up contract is owned by the
synchronization specification. Fallback policy now covers both the SDK ban handle and final
authenticated admission: a healthy current direct transport and explicit exclusion refuse late bootstrap
connections, while explicit policy release checks the full live set before unbanning. Authenticated-RPC guard work is
scoped to its transport and owner lifetime, and a late frame after local transport close is dropped
without peer punishment. Bounded relay retry cancellation and byte-exact
discovery topic leave semantics are unchanged. Each behavior has an
explicit black-box plan and permutation set; the newly added clock-boundary, separation, baseline,
and opened-non-participant permutations are planned but not yet covered by executable evidence;
engineer disposition remains pending.

## 2026-10-26 — Application chain access, local join-signature answers, closed-transport frames

Luka decided these in the shared poker client manager plan (poker-contracts
`9-shared-poker-client-manager`, "Implementation-review decisions").
[`REQ-CHAINOBS-4-JA3YF8` (Application chain access over the same endpoint set)](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8) is new: the
application uses the SDK's provider over the same endpoints, and a contract-log subscription on it
comes from every node socket, each log once. Its limits (no re-read, no removal report, no throw during a
full outage) are stated in the chain-observation assumptions and tracked as findings.
[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v) and the responder algorithm now say that a
countersigner answers from local reads, with a chain read only when its local view does not list it.
The RPC ingress algorithm now drops a frame on a closed transport before step 1. Each change has new
planned permutations; the application startup failure through the exported entry
([`REQ-CHAINOBS-4-JA3YF8.T1.P7`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p7)), the reconnected endpoint
([`REQ-CHAINOBS-4-JA3YF8.T1.P5`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p5)) and the 128-block bound
([`REQ-CHAINOBS-4-JA3YF8.T1.P6`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p6)) are covered by tests in
[RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md). The bound text now matches the code: a log
128 or more blocks below the highest delivered log is not delivered. The overview now limits the no-gap
rule to the runtime's own observation; an application log subscription can leave a gap
([`FIND-RPC-4-7H2R11`](open-findings.md#find-rpc-4-7h2r11)). The rejoin-after-eviction and spectator-reduction questions moved
from the audit register to
[`OQ-SPEC-JOIN-REJOIN-1-D506RT` (Rejoin after eviction collects against the disputed snapshot)](../specification/open-questions.md#oq-spec-join-rejoin-1-d506rt) and
[`OQ-SPEC-REDUCE-SPECTATOR-1-1YWDC5`](../specification/open-questions.md#oq-spec-reduce-spectator-1-1ywdc5), and the duplicate probe
sync question to [`OQ-IMPL-SYNC-PROBE-1-1288ZV` (Duplicate probe sync during a runtime's initial sync)](../implementation/open-questions.md#oq-impl-sync-probe-1-1288zv).

## 2026-10-13 — Message-block tip stays height-based

Ljuba reversed the earlier decision on [`FIND-STORAGE-2-NK2XBF`](open-findings.md#find-storage-2-nk2xbf): the
specification was wrong, not the code. [`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)
now describes the height tip: a direct store moves it by height and it may sit above a gap, while a
verified run moves it only on exact extension. Exact extension broke block production above a missed
inbound log and late-auditor dispute construction. Safety stays at the read layer through
[`REQ-MSGSTORE-2-8RDXPZ` (Linked backward range reads)](../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz). The strongest
rejected alternative was strict extension with forward catch-up and a snapshot-anchor seed. The tip
decision changed no production code. Blocks recovered from base-layer logs take the tip-moving
store and follow the height rule; only proof material and non-extending verified runs opt out. The
consumer rules have their own plan,
[`REQ-MSGSTORE-1-6ME9D7.T2`](../specification/storage/message-blocks.md#req-msgstore-1-6me9d7.t2). On 2026-10-14 Ljuba decided to remove
`getLatestMessageBlocks`, which truncated a walk from the tip without reporting the gap and had no
production caller ([`FIND-STORAGE-7-GK913E`](open-findings.md#find-storage-7-gk913e)); every range read now reports the missing
hash. Engineer review remains pending.

## 2026-08-31 — Targeted pre-open channel join

The maintained specification now gives one owner to each phase: caller-topic matching, mode-bound
negotiation, exact-channel synchronization, and receipt-gated membership. RO2 keeps `timeoutMs` and targeted
cancellation inside unmatched rendezvous. RO3 authorizes a pending RPC response by authenticated peer across
a live transport upgrade. RO4 permits one bounded re-entry into the locked target after authoritative open,
never a general-lobby or target-selection retry. RO5 separates terminal full-flow tests from bounded probes.
PY1 gives initial load two independent local windows and exact recovery one. RY3 makes fixed-target open win
after local signing but before submission. [`OQ-10-04YNC4` (Spectate/join failure-point details)](../specification/open-questions.md#oq-10-04ync4)
is partially resolved; [`DEF-5-E8TP9N`](open-findings.md#def-5-e8tp9n),
[`DEF-6-B4ZN7S`](open-findings.md#def-6-b4zn7s), and
[`DEF-10-199C7F`](open-findings.md#def-10-199c7f) have dated dispositions. Engineer review remains pending.

## 2026-09-01 — Discovery replacement and pre-submission membership protection

[`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
now requires replacement discovery for an eligible closed peer while the caller still observes the exact
topic, plus a hard stop after leave and under the existing blacklist policy. The membership invariants now
place `PENDING_PARTICIPANT` before contract invocation, preserve it when submission outcome is uncertain, and
gate force-join escalation on authoritative on-chain membership and a usable dispute window.

## 2026-09-01 — Attributable peer-fault consequences

RPC ingress, handshake, and lobby matching now use one consequence rule. A malformed or forbidden
protocol action blacklists only when an authenticated peer identity makes the fault attributable.
Transport loss, response timeout, cleanup, send failure, and an unclassified local handler error
remain disconnect-only.

## 2026-10-11 — One logical join through snapshot-race retry

Luka resolved review six XO1: the automatic retry is encapsulated as a deep module inside
`ChannelJoinService`, and the public promise stays pending until the overall operation reaches its
final specified outcome. No intermediate `SYNCED`, `onLeftChannel`, public resolution or rejection is
exposed during fresh collection/retry. The refused attempt's old deadline and stale checks must be
retired so they cannot terminate that operation. The one-retry limit and final success/failure rules
remain; this neither hides final errors nor introduces theoretical RPC-outage recovery.

The join authorization, targeted join and SDK ownership specifications now agree, and so does the
implementation: `runJoin` marks the refused attempt's record retrying (checks skip it, its timer is
cancelled) and, after the fresh collection, submits nothing when the runtime is disposed or the record
is no longer current ([`FIND-JOIN-RETRY-LIFETIME-1-447RDE`](open-findings.md#find-join-retry-lifetime-1-447rde)). The requirement and owner cases map tests
that hold the fresh collection across the old deadline and dispose during it; they passed in the recorded
full SDK gate.

Review 8 RO1 (2026-10-11): those tests covered checks that start after the record became retrying, not a
check already past its entry guard. The implementation now retires both: the refused record is marked
retrying before the retry-eligibility read, and every check re-reads that its record is current and not
retrying after its awaited reads, before it drops the membership, records an observation or arms a timer.
Implemented; the interleaving case is added in this pass and its verification is pending the next gate.

## 2026-10-11 — Live blocks wait for the initial sync (review 7 FO1)

Luka decided review 7 FO1: a live block received during the initial sync is retained until the runtime is
`SYNCED`, `PENDING_PARTICIPANT` or `PARTICIPATING`, then processed through normal validation and fork handling
without redelivery; it neither advances state early nor starts a second sync. The earlier drop-and-redeliver
behavior is rejected. The implementation is a new `WaitForSyncStatusGuard` in the `StateTransitionService`
RPC guard chain; the block queue's initial-sync drop branch is removed. The specification sentence and owner
cases are added in this pass; verification is pending the next gate.

## 2026-10-11 — Threshold-set refusal is the same one-retry race; post-dispute join settlement

Luka decided that a join or top-up refused with `ErrorJoinChannelConfirmationNotThresholdSigned` (a join
that landed first widened the threshold set with its pending participant) gets the same single retry with a
fresh collection as a snapshot move to a stored snapshot. Two synced spectators joining one table at once
therefore both land: the second costs one more collection, which the first (now pending) joiner
countersigns, and one more submission. [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v) and [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7) state the rule; the one-retry
limit is unchanged and a refused retry stays final (it still aborts, as every final race refusal does).
The bound on funded submissions per call is still two, so the retry adds no unbounded cost; the
countersigner admission rules are unchanged.

Review six FR1 is implemented: after its own force-join dispute starts, the join check still settles the
join, and an observed join that both the installed local state and the chain omit drops to `SYNCED` and
emits `onLeftChannel`, so a leave requested before that dispute (whose self-removal the reduction applies
after consuming the JOIN) no longer leaves the runtime pending. The force-join path's chain-absence branch
covers the same drop before any dispute. Both are now owner cases of the join service with mapped tests.

## 2026-10-11 — CY1 membership-read ownership decision

Luka accepted consolidation into `MembershipService`, preserving three distinct read policies:
local-only pending-join observation starts force-join counters at local observation; local-first pending
membership with chain confirmation on absence protects departure; direct-chain seated-plus-pending
membership prevents premature join expiry or dropping. These are not identical duplicate operations,
and the review establishes no correctness bug. Ownership is specified under
[`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6).
No new cache, outage fallback, or API shape is authorized by this decision.

The consolidation is implemented: `MembershipService` owns the three reads as `isSignerPendingInMirror` (local-only), `isSignerPendingOnChain` (local-first, chain confirms absence) and `isSignerOnChain` (chain seated plus pending), and `ChannelJoinService` and `EventHandler` call them. [`FIND-MEMBERSHIP-READ-OWNER-1-8826AS`](open-findings.md#find-membership-read-owner-1-8826as) is resolved for implementation. The callers' existing cases passed in the recorded full SDK gate. The caller-boundary cases `.P70`–`.P77` had no assigned evidence there; their mappings to existing tests and new cases for the rest are being added in this pass. No engineer fingerprint approval is recorded.

## 2026-10-11 — FY2 optional calldata disposition

Luka retained current behavior: omitting auditing data that becomes optional after dispute construction
is a low-priority optimization, out of scope for this change. Required data availability remains mandatory;
posting valid optional data is still valid and costs extra calldata. The scope is recorded in
[`REQ-DA-1-NVV85Z` (Block data whose calldata commitment is posted MUST be recoverable from the…)](../specification/security/data-availability.md#req-da-1-nvv85z), the dispute construction
specification and the builder report. The future optimization is
[`OQ-IMPL-DISPUTE-CALLDATA-1-S2XEBS` (Optional auditing calldata on a reused dispute)](../implementation/open-questions.md#oq-impl-dispute-calldata-1-s2xebs); it is not a current approval or design blocker.
The generic generated unresolved-question count includes future questions too; that count does not
reclassify this explicitly non-blocking optimization as a required change.

Reviewer correction, separate from Luka's cost-priority decision: `LocalDiamond.hasDisputeReason` is pure
and delegates to `_hasDisputeReason`. The helper checks timeout, eligible slashes, self-removal, forced
inbound and the flag, not a live window. The builder starts with a false flag and sets
`requireExistingDisputeWindow` from absence of an independent reason. Merely opening a window changes
neither those inputs nor the result; a false flag does not prohibit an open window. FY2's proposed
independent window-opening invalidation has no basis in this code. This assessment accepts only the
stated extra-calldata case, not every caching scenario. No source, test, evidence mapping or engineer
fingerprint approval is changed by this disposition.

## 2026-10-11 — Evidence signatures and exit-post errors

Luka rejected review 5 XO3/TY5's proposed requirement that an extra signature on the unchanged latest
block force recomputation or inclusion in the uploaded dispute. Signatures prove authenticity, finality,
and validity of a reachable latest state; they are not an independent evidence-comparison dimension.
A newer block changing the latest state remains a distinct case. This is recorded in
[`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](../specification/disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m).
All signature validation and other outcome-changing evidence remain required.

The current working-tree `DisputeBuilder` has no signatures in `DisputeInputs`; it rebuilds the proof
when the latest block height changes during construction. The earlier review's signature fingerprint
claim is stale. This documentation task makes no source fix and claims no new test evidence. The false
late-confirmation test description is removed. The newer-block case ([`UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P2`](../implementation/source/src/disputeManager/DisputeBuilder.ts.md#unit-test-dispute-builder-1-hzmqmn))
is mapped to its test, which passed in the recorded full SDK gate; the unchanged-block case (`.P1`) keeps the
decided cache behavior and remains untested. The unused fixture helpers were removed (KY1).

XO2/DY3's stale membership-refresh oracle is corrected in the specification, file report and both audit
entries: a chain search with no needed log returns no answer; failed reads or local application reject.
FO1's accepted behavior is specified by [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9),
and is now implemented: `LeaveChannelService` logs the listed exit-post chain refusals through the internal logger
and lets any other error reach fatal runtime handling. Missing evidence is tracked by
[`FIND-EXIT-POST-1-AQZZVF`](open-findings.md#find-exit-post-1-aqzzvf). These decisions do not grant fingerprint approval.

## 2026-10-11 — SDK-wide RPC availability decision

Luka resolved staged SDK review 5 XO1 and OO1: SDK feature logic assumes a stable, always-available RPC
connection. Planned redundancy will provide availability; no redundancy mechanism or implementation status
is claimed here. RPC outage handling is one SDK-level concern, not feature-by-feature recovery logic.
The [SDK assumptions](../specification/runtime/sdk.md#assumptions-and-constraints) now state this scope.
The join retry's failed snapshot read keeps its throw, without refusal cleanup, fallback, or a dedicated
failure-injection test for that theoretical outage. Both join specifications now distinguish an infrastructure
error from a normal no-retry outcome under
[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v).
No implementation case or test mapping changes follow from this clarification.

Legitimate chain refusals retain their specified handling; unexpected errors must not be swallowed.
Luka also accepted review 5 FO1's separation of expected exit refusals and unexpected errors in voice
discussion. This disposition records no fingerprint approval.

## 2026-10-10 — Log recovery keeps no RPC-failure paths

Engineer decision (Luka): the SDK carries no code whose only job is to survive a failing RPC node; redundancy is
planned. Log recovery now rejects on a failed chain read and on a local failure while applying a recovered log,
for every caller (membership refresh, reduction, audit, dispute construction, block calldata recovery). The
attempt loop with a widening span stays: it bounds the search when the first span estimate is too small and
ends when the chain does not return the log, which is a protocol outcome, not a failure.
[`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) now says a
chain search that does not return a needed log leaves the refresh unanswered; a failed chain read or local application rejects; `.T1.P45` and `.T1.P46` are new.
[`REQ-CHAINOBS-3-N137ZP.T1.P23`](../specification/runtime/chain-observation.md#req-chainobs-3-n137zp.t1.p23) is
reworded from "survives a failed middle window" to "rejects the recovery". Review six XY9 split it: `.T1.P23` now covers only a local failure while applying a recovered log, and
[`REQ-CHAINOBS-3-N137ZP.T1.P33`](../specification/runtime/chain-observation.md#req-chainobs-3-n137zp.t1.p33) covers a failed authoritative chain read in a slash recovery. A failed log
query inside the search has no test; under the SDK-wide RPC availability assumption none is added. Tests that only exercised surviving
a failed read are deleted. The recovery search is a generator of logs; it takes no predicate callbacks or
dispatch flag. Engineer review remains pending.

## 2026-10-10 — One membership-end signal: `onLeftChannel`

Engineer decision (Luka): `leaveChannel` returns at once, and the `onLeftChannel` event reports the end of the
runtime's membership whatever ended it (its leave, an exit it authored alone, a slash, an eviction or another
participant's block); applications subscribe to it instead of awaiting the leave. The end is observed when the
signer is in neither the local state nor the chain's membership; a removal by a snapshot the runtime never produced
emits the event instead of aborting. A join the chain has not shown still aborts on such a snapshot: it never
seated the signer. The outer instance disposes itself after the event when a leave was requested. A failure that
stops a leave is fatal for the runtime instead of rejecting a leave promise, and a self-removal dispute that loses
the evidence race waits for the window's reduction in every case.
[`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay),
[`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) and
[sdk.md](../specification/runtime/sdk.md) state it; [`REQ-LIF-10-QR8NQ9.T1.P20`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p20) and `.T1.P21` are new and the
leave permutations that named a promise or a rejection are reworded. Engineer review remains pending.

## 2026-10-11 — One owner for the own join; every drop to `SYNCED` is `onLeftChannel`

The SDK moves the own join and top-up out of the membership service into one join owner, and deletes the
public own-join state query (`getOwnJoinState` and its `OwnJoinState` type). A pending join ends when the
status leaves `PENDING_PARTICIPANT`; a join that the chain has not shown when its authorization expires on
chain, and that the chain does not list, ends `SYNCED`. `onLeftChannel` fires on every drop of a participant
or pending joiner to `SYNCED`, whatever caused it, a finally refused or an expired join included; a join
failure that aborts fires it before `onAbort`. A pending join at the leave watchdog's expiry waits again
instead of disputing. A failed chain read in the force-join path is an internal failure, not a deferral.
The force-join height bound in [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally pending before acknowledgement)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) now counts from the observation of the own JOIN,
as [`INV-TJOIN-2-H7JSQM` (Local pending protection for submitted joins)](../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm) already stated, not from the submission height.
A snapshot the runtime never produced no longer aborts an unobserved join: the join service ends a join
that does not land. An observed join that the chain no longer lists ends when its force-join dispute is due,
instead of deferring. The leave watchdog waits for any join in progress.
Blocks finalized while an exit post runs queue one more post after it, unless that post landed the exit: the
block that finalizes the exit can arrive during a post, and a leaver commits no later block.
[`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9),
[`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay),
[`INV-TJOIN-2-H7JSQM` (Local pending protection for submitted joins)](../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm),
[`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally pending before acknowledgement)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)
and [sdk.md](../specification/runtime/sdk.md) state it. [`REQ-LIF-10-QR8NQ9.T1.P22`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p22), `.T1.P23`,
[`REQ-TJOIN-7-NNGTAY.T1.P12`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1.p12) and [`INV-TJOIN-2-H7JSQM.T2.P11`](../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm.t2.p11) are new; the permutations for the
missing-dispute-marker throw (TJOIN-7 `.T1.P9`) and the own-join state read (TJOIN-2 `.T2.P5`) are deleted. The old stored
force-join marker was replaced by an ID-bound join record (`ForceJoinStorage` `JoinRecord`, keyed by submission id), so [`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg) covers the force-exit flag and that record. The record keeps four storage permutations in the [ForceJoinStorage report](../implementation/source/src/storage/ForceJoinStorage.ts.md): read before start, start/read/update/clear, repeated clear, and an update for an earlier submission id that changes nothing. All four are mapped to their tests, which passed in the recorded full SDK gate. Engineer review remains pending.

## 2026-10-10 — Any dispute during a leave gets the leaver's self-removal at once

Engineer decision (Luka, restated; it was not written down before): while a leave is pending, from the leave
call and, for an authored exit, from its block, any dispute observed on the fork makes the leaver submit its own
dispute with self-removal at once; it does not wait for a watchdog. An exit post with nothing to send because a
dispute is open ends the exit post wait. The leave completes only when the leaver observes the on-chain snapshot
that removes it, after the window's reduction and snapshot update.
[`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) and
[`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) state it;
[`REQ-LIF-10-QR8NQ9.T1.P18`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p18) and
[`.T1.P19`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p19) are new. An earlier sentence that
made a nothing-to-post exit wait for the watchdog while the signer was still on chain contradicted the rule and is
replaced. Engineer review remains pending.

## 2026-10-10 — Idempotent inbound mirror and a pinned membership refresh

Engineer decision (Luka): applying an inbound message block to the local mirror is idempotent whatever its
source, the mirror's inbound head only moves forward, the membership refresh applies the whole pending run at
the chain position of its pinned read, and the refresh's apply step makes no chain read its pinned read already
answers ("query the RPC node the fewest times possible").
[`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) and
[`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) state it, with
new permutations [`REQ-MIRROR-2-E9F3TM.T1.P4`](../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm.t1.p4)–`.P6` and [`REQ-GOSSIP-4-J5Z4DF.T1.P41`](../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df.t1.p41)–`.P44`; each has a test that
fails on the old code. The local diamond's inbound family no longer has an event-coordinate gate (a recovered
older log must still be stored); the chain contract's duplicate revert is unchanged. A pending joiner's refresh now makes one multicall and no separate pending-set read: the pending check reads the local diamond, which the refresh filled with its pinned inbound run before it applies the snapshot; the same local-first check spares the chain read on a live snapshot log when the local diamond lists the signer. Residuals: when the local diamond's pending set does not list the signer, the apply step still reads the chain, because a JOIN that landed after the local diamond's inbound head may already be observed; a snapshot the mirror drops as older no longer reaches membership (the
handler compares the mirrored snapshot after applying, a local read, no chain call); Luka decided the spectate
path's apply of a current on-chain read at the trusted coordinate stays, because that read is the latest chain
state when it is made; a late or recovered log for
a block the chain already pruned is stored again below the snapshot head; and an equal-height block with another
hash does not move the mirror head, where the TypeScript store accepts it. Engineer review remains pending.

## 2026-10-10 — Countersigners do not check the join pins; membership refresh applies each inbound block once

Engineer decision (Luka): a countersigner no longer refuses a join request because its chain view differs
from the joiner's snapshot or fork pin. [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
now says the collector pins its collection and carries the pins to submission, where enforcement checks
them, and that the countersignature covers only the encoded join. The signer-side check gave no consent it
could enforce, because the pins are separate contract arguments, and it failed live joins that raced another
player's exit snapshot. The request no longer carries the pins. [`REQ-JOINSIG-1-8X1A4V.T1.P2`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p2) is reworded to
the race that now succeeds, and its former third permutation and the third requirement's pin-mismatch permutation are retired with the refusal they
described. Authority is unchanged: enforcement still checks the pins, unanimity of the current threshold set
and the deadline at submission, and a moved snapshot meets the existing one retry. Mixed versions are not
supported: an old countersigner still refuses a new collector's request.

[`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
now states that the eligibility refresh applies each missing inbound message block to the local mirror once
and that a failed chain read or local state application is fatal; only a chain search that does not return a needed log leaves it unanswered. Before, the
refresh applied the recovered pending run a second time through the trusted local path, the local diamond
reverted, and the warning hid it, so a snapshot participant whose spectate sync also failed could be
blacklisted. New permutations `.T1.P38`–`.T1.P40` have tests that fail on the old code. The two mirror residuals first found here (a later live log for a block the refresh applied, and a gap below
the mirror's inbound head) are fixed by the idempotent inbound mirror entry above. Engineer decision (Luka,
2026-10-10): the one chain read the apply step can still make (a pending signer missing from the local diamond's pending set) stays and may end the refresh with an error; RPC redundancy is planned, so no failure handling is added for
it. Engineer review remains pending.

## 2026-10-10 — Leave fallback without a block bound; exit post waits for the inbound

Engineer decision (Luka): a terminal leave no longer falls back after `N + 1` committed blocks. An application
may let one writer author several blocks in a row, so the count could run out before the leaver's turn, while
the leaver authors its exit on its own turn anyway. [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
now bounds the wait only by the leave watchdog, and
[`REQ-TJOIN-7-NNGTAY.T1.P5`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay.t1.p5)
is reworded in place. A writer set that never gives the leaver a turn still meets the watchdog. Engineer decision
(Luka), the same day: a fully signed exit whose snapshot post is blocked by an inbound message that the exit
snapshot has not consumed waits for a finalized block that consumes it and posts once more, within the leave
watchdog; [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) states the rule,
[`REQ-LIF-10-QR8NQ9.T1.P12`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p12) and
[`REQ-LIF-10-QR8NQ9.T1.P13`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p13) are new, and
[`REQ-ENFSNAP-3-VD9T8A.T2.P2`](../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a.t2.p2) is
reworded. The wait adds no authority and no peer consequence: a check that is still blocked sends nothing, and
the chain's inbound-consumption gate is unchanged. Its cost is at most one more snapshot post and one proof
build per finalized block during the watchdog. Engineer review remains pending.

## 2026-10-10 — One join or top-up retry after a snapshot move

Engineer decision (Luka): when a join's or top-up's snapshot pin goes stale because the channel snapshot moved,
and the new snapshot is in the runtime's storage, the submission is collected again and retried once on every
route; otherwise the behavior is unchanged. A first decision limited the retry to the connect route; Luka then
made it general, since the race can happen on any route. [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
now allows exactly that one retry for a first join on the public prepared-join route and on a connect, and
[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
states the rule for joins and top-ups and that a retry is a fresh collection, never a resubmission of the
stale one. The public-route permutation that kept the abort is replaced by
[`REQ-TJOIN-5-Q795M7.T1.P21`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p21),
and [`REQ-MSG-10-7JS45Q.T2.P3`](../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t2.p3)
replaces the old E42 abort oracle. The retry adds no authority: every threshold member countersigns again,
and enforcement checks the new pins and the current threshold set. Its cost is bounded to one more
countersignature round and one more funded submission per join or top-up. Residual: the rule keys on the snapshot move, not on the revert reason, so any proven failure that coincides with a move to a stored
snapshot gets the one retry; a pin the runtime never stored gets none. A
snapshot observation omitting an unseated joiner does not itself abort it; when the new snapshot is
unstored, no retry is available and the final submission-refusal path determines the outcome. A collection failure of the fresh collection itself (a threshold member unreachable,
with no answer or with a wrong-signer answer) ends the call `false` with no second
submission: a first join becomes `SYNCED`, a top-up keeps participating; any other error of the fresh collection
rejects the call (Luka, 2026-10-10, narrowed 2026-10-26;
[`UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P60`](../implementation/source/src/stateManager/membership/ChannelJoinService.ts.md#unit-test-channel-join-service-1-bjkheb), `.P64`). The older contradiction in targeted-channel-join.md between "proven
first-join failure aborts" and a proven failure that restores `SYNCED` is resolved by Luka (2026-10-10): the
specification now states the implemented behavior, where only a race or authorization revert of the join aborts
and disposes, and any other proven failure restores `SYNCED`. Engineer review remains pending.

## 2026-10-09 — Open-connection observation

[`REQ-SDK-ARCH-7-H64K87` (Open connections are observable)](../specification/runtime/sdk.md#req-sdk-arch-7-h64k87)
adds a public snapshot of the active peer connections, each with the peer's identity and transport kind,
and an event that emits the new set once after each real change, expected and unexpected closes alike.
It is a local observation surface only: it changes no peer-visible behavior, no penalty, and no
admission decision. Every permutation has a test. Engineer review remains pending.

## 2026-10-09 — Worker configuration bootstrap

[`REQ-CONFIG-4-WW7BRX` (Isolated contexts start with their creator's configuration)](../specification/runtime/configuration.md#req-config-4-ww7brx)
requires every isolated context to hold its creator's effective configuration before it builds any
component, so a consumer's worker that never restores configuration itself still logs, stores, and
uploads logs as its creator does. The configuration is copied only across the participant's own context
boundary and never reaches peers. The browser-worker permutation
[`REQ-CONFIG-4-WW7BRX.T1.P2`](../specification/runtime/configuration.md#req-config-4-ww7brx.t1.p2) and the
no-own-configuration permutation
[`REQ-CONFIG-4-WW7BRX.T1.P3`](../specification/runtime/configuration.md#req-config-4-ww7brx.t1.p3) are tested
since 2026-10-10: a browser gate starts a parentless browser worker root with the page's config, and a Node
worker root with no config of its own uploads its logs with the creator's config. The bootstrap is now the
only config owner; no SDK root installs a config itself. Engineer review remains pending.

## 2026-10-09 — Lobby leave result

[`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
now gives the public lobby leave one meaning per result. The leave ends every ordinary join on its topic,
cancels active matching, and waits until those joins have settled. True means the runtime is out of the
lobby with no channel; false means the leave changed nothing, because no ordinary join was on the topic or
a join's negotiation opened a channel first. The leave still cannot cancel a negotiation after the matching
handoff, so it adds no new abort path and no new peer consequence. A leave never ends a targeted attempt;
the derived-topic case [`REQ-LOBBY-9-N894C0.T1.P31`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p31) is covered by the DiscoveryRuntimePort case for a leave of a targeted connect's derived topic. Engineer review remains pending.

## 2026-10-09 — Lobby dial suppression ends with its topic observation

[`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
still lets the discovery adapter skip a second dial to a peer that already has a dial in flight, across
topics too, but now requires that ending a topic observation releases the suppression it holds. A dial
whose close arrives after the leave can no longer stop a later observation, such as a fresh match after an
unsigned failure, from reconnecting the peer. Admission, penalties and the live-connection check are
unchanged. [`REQ-LOBBY-9-N894C0.T1.P32`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p32)
has a component test. On 2026-10-10 the same rule gained
[`REQ-LOBBY-9-N894C0.T1.P33`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p33):
a left dial's late close must not remove the mark of a newer dial to the same peer, so each mark is owned by
its dial attempt. Engineer review remains pending.

## Milestone-only proof update — current assessment

The proof format now contains milestones only. Same-fork anchor clipping and explicit genesis
semantics replace the old separate signed-tail model. Historical membership hops include all
consumed JOINs and never subtract later slashes. Shared verification/replay tiers distinguish false
proof results from fatal execution or RPC failures. Per-step invalidity, below-anchor,
timeout-superseded and same-height final-conflict counters use the common predicates.

The finality owner also includes consumed JOIN participants absent from both endpoint sets after
an atomic join and exit. Sequential and concurrent audits retain one conflicting final block;
a later conflicting audit is countered, including when a separate balance fault killed the first
dispute. Unhandled upload and kill contract errors are logged and fatal.

Sync selects an authenticated replay state; a held matching state can replace earlier served bytes.
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
