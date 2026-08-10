# Open Questions Register

> **Status:** Draft.
> **Scope:** The consolidated register of unresolved design decisions awaiting engineer
> resolution. OQ-1 through OQ-12 come from the engineering review of the baseline
> specification; OQ-13 onward were surfaced while reverse-engineering the implementation
> for this tree.

Documents in this tree flag unresolved decisions inline with `**Open question:**` markers; this
register mirrors those markers so nothing stays buried in a single document. An open question is a
pending engineer decision — agents and engineers MUST NOT silently pick an interpretation.
Resolving an entry goes through the governance change loop (specify → implement → verify → audit;
see [governance.md](./governance.md)): the owning document is updated, the entry here is marked
resolved with the decision, and the ID is never reused.

## Index

| ID    | Question                                                                                                                          | Source                    | Affected spec docs                                                                                                                                 | Status                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| OQ-1  | Exact kill-period and dispute-fraud-proof slashing semantics                                                                      | Review §31                | [protocol/disputes.md](./protocol/disputes.md), [protocol/fraud-proofs.md](./protocol/fraud-proofs.md)                                             | Open                   |
| OQ-2  | Penalty for submitting an invalid fraud proof                                                                                     | Review §25                | [protocol/fraud-proofs.md](./protocol/fraud-proofs.md)                                                                                             | Open                   |
| OQ-3  | Leader election beyond round-robin: revert attribution, long-range proofs                                                         | Review §34                | [protocol/finality.md](./protocol/finality.md), [protocol/state-proofs.md](./protocol/state-proofs.md)                                             | Open                   |
| OQ-4  | Dispute-reduction order-independence: proof and permutation testing                                                               | Review §12                | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-5  | Fraud-proof completeness security review                                                                                          | Review §35                | [security/open-security-review.md](./security/open-security-review.md), [protocol/fraud-proofs.md](./protocol/fraud-proofs.md)                     | Open                   |
| OQ-6  | P2P gossip rate-limiting policy                                                                                                   | Review §41                | [security/trust-model.md](./security/trust-model.md), [sdk/components.md](./sdk/components.md)                                                     | Open                   |
| OQ-7  | Necessity of the `onlySelf` self-call guard under the improved Diamond architecture                                               | Review §27                | [contracts/architecture.md](./contracts/architecture.md)                                                                                           | Open                   |
| OQ-8  | Clock-skew and bias values to be validated empirically                                                                            | Review §13                | [protocol/time.md](./protocol/time.md)                                                                                                             | Open                   |
| OQ-9  | Timeout precedence edge rules: same-fork definition, height comparison, evidence timing                                           | Review §36                | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-10 | Spectate/join failure-point details: deadlines, refunds, forced-inclusion proof                                                   | Review §20                | [protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md)                                                                             | Open                   |
| OQ-11 | Channel-balance invariant: definition per balance model and check points                                                          | Review §19                | [protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md), [concepts/state-machines.md](./concepts/state-machines.md)                 | Open                   |
| OQ-12 | Book-like overview vs. tree as the authoritative reference                                                                        | Review §2                 | [README.md](./README.md), [governance.md](./governance.md)                                                                                         | Provisionally resolved |
| OQ-13 | State proofs reject the intended mixed shape (milestones + non-final suffix)                                                      | Code                      | [protocol/state-proofs.md](./protocol/state-proofs.md), [protocol/finality.md](./protocol/finality.md)                                             | Open                   |
| OQ-14 | `reduce()` timeout fold: a dispute without a timeout can suppress a real timeout                                                  | Code                      | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-15 | Back-dated reduced-result timestamp makes `challengeDisputeReduction` unreachable                                                 | Code                      | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-16 | Slash-set lifetime: cleared on channel-storage clear, questioned in code                                                          | Code                      | [protocol/fraud-proofs.md](./protocol/fraud-proofs.md)                                                                                             | Open                   |
| OQ-17 | Proxy fallback exposes the consumer facet's `deposit`/`withdraw` externally                                                       | Code                      | [contracts/state-machine-base.md](./contracts/state-machine-base.md)                                                                               | Open                   |
| OQ-18 | Exit-recording asymmetry between `slashParticipant` and `removeParticipant`                                                       | Code                      | [concepts/state-machines.md](./concepts/state-machines.md), [contracts/state-machine-base.md](./contracts/state-machine-base.md)                   | Resolved (fix pending) |
| OQ-19 | Channel-balance invariant not enforced on snapshot update or join                                                                 | Code                      | [protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md)                                                                             | Open                   |
| OQ-20 | Outbound stream is not yet general-purpose; withdraw failure wedges snapshot advance; residual funds on close                     | Code                      | [protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md)                                                                             | Open                   |
| OQ-21 | `_tx.body` is never populated; no state-encoding version marker                                                                   | Code                      | [concepts/state-machines.md](./concepts/state-machines.md)                                                                                         | Partially resolved     |
| OQ-22 | Inauthentic on-chain block calldata: escalation is signalled but no proof is built                                                | Code                      | [sdk/block-confirmation-pipeline.md](./sdk/block-confirmation-pipeline.md), [security/open-security-review.md](./security/open-security-review.md) | Open                   |
| OQ-23 | SDK restart/recovery semantics: storage is fully in-memory                                                                        | Code                      | [sdk/components.md](./sdk/components.md)                                                                                                           | Open                   |
| OQ-24 | `shouldSignBlock` refuses to sign an on-chain-posted block when the local node is next-to-write                                   | Code                      | [protocol/finality.md](./protocol/finality.md)                                                                                                     | Open                   |
| OQ-25 | Minor SDK lifecycle races: `abort()` residual queryability, TS snapshot-event ordering, kill/counter-dispute sequencing           | Code                      | [sdk/architecture.md](./sdk/architecture.md), [sdk/components.md](./sdk/components.md), [sdk/dispute-pipeline.md](./sdk/dispute-pipeline.md)       | Open                   |
| OQ-26 | On-chain wrong-turn enforceability: the invalid-state-transition fraud proof has no generic author check                          | Code                      | [concepts/state-machines.md](./concepts/state-machines.md), [contracts/state-machine-base.md](./contracts/state-machine-base.md)                   | Open                   |
| OQ-27 | Reducer eligibility check is disabled in `reduceAndFinalize` — anyone can reduce                                                  | Code (via codex review)   | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-28 | Equal-height reduction tie-break by smaller block hash — unapproved rule, hash-grinding surface                                   | Code (via codex review)   | [protocol/disputes.md](./protocol/disputes.md)                                                                                                     | Open                   |
| OQ-29 | No signature domain separation: signatures replayable across deployments/chains                                                   | Code (via codex review)   | [security/open-security-review.md](./security/open-security-review.md)                                                                             | Open                   |
| OQ-30 | Chain-reorg handling and canonical per-channel event ordering in the SDK                                                          | Code (via codex review)   | [sdk/components.md](./sdk/components.md), [security/open-security-review.md](./security/open-security-review.md)                                   | Open                   |
| OQ-31 | Hash-only dispute with unavailable/undecodable data: availability rule undecided                                                  | Code (via codex review)   | [sdk/dispute-pipeline.md](./sdk/dispute-pipeline.md), [protocol/disputes.md](./protocol/disputes.md)                                               | Open                   |
| OQ-32 | Proof and audit size bounds (milestones, suffix blocks, signatures, auditing bytes, replay gas)                                   | Codex review              | [protocol/state-proofs.md](./protocol/state-proofs.md), [security/data-availability.md](./security/data-availability.md)                           | Open                   |
| OQ-33 | On-chain maximum participant count is not enforced                                                                                | Code (via codex review)   | [security/trust-model.md](./security/trust-model.md), [contracts/manager-and-facets.md](./contracts/manager-and-facets.md)                         | Open                   |
| OQ-34 | RPC boundary decisions: guard retry semantics, protocol versioning, ban persistence, failure-outcome policy                       | Review §43 / Code         | [sdk/rpc/README.md](./sdk/rpc/README.md)                                                                                                           | Open                   |
| OQ-35 | Handshake has no channel/identity binding — relay/reflection MITM; the signature is the whole root of trust                       | Code (§43 service review) | [sdk/rpc/handshake.md](./sdk/rpc/handshake.md), [security/trust-model.md](./security/trust-model.md)                                               | Open                   |
| OQ-36 | `onDisputeAcknowledgmentRequest` never binds `channelId` to the local channel — cross-channel ack pollution and chain-read oracle | Code (§43 service review) | [sdk/rpc/is-fork-disputed.md](./sdk/rpc/is-fork-disputed.md)                                                                                       | Open                   |
| OQ-37 | Harness-control RPC root: unguarded, network-reachable, and published in the package                                              | Code (§44 harness review) | [sdk/runtime-and-concurrency.md](./sdk/runtime-and-concurrency.md) §11.4, [security/open-security-review.md](./security/open-security-review.md)   | Open                   |
| OQ-38 | Runtime budgets and targets under the mid-range-phone envelope; multi-peer test scheduling determinism and isolation              | Review §44 / Code         | [sdk/runtime-and-concurrency.md](./sdk/runtime-and-concurrency.md) §6, §11.5                                                                       | Open                   |

## OQ-1 — Kill-period and dispute-fraud-proof slashing semantics

The dispute-window "kill" flow needs an exact, engineer-confirmed rule. An uploaded dispute
records the opener's commitment immediately, so the earlier "no commitments before kill → spammer
slashed" description is wrong; implementation evidence suggests the kill period is the interval in
which an invalid committed dispute can be challenged with a dispute fraud proof and killed. The
open decision: the precise kill semantics, and **who is slashed when a dispute fraud proof is
valid, and when it is invalid**. The reconstructed window lifecycle in
[protocol/disputes.md](./protocol/disputes.md) depends on this rule. _(Review §31.)_

Code-derived edges folded into this decision: a window whose commitments are all killed stays
open and never reduces until new evidence arrives; whether kill and the follow-up counter-dispute
should be one atomic multicall (the SDK deliberately sequences them so the slash lands first);
the `postedAuditingData` rule under early finalization; and the calldata-posted-after-kill-decision
race. See [protocol/disputes.md](./protocol/disputes.md) §4 and
[sdk/dispute-pipeline.md](./sdk/dispute-pipeline.md).

Further edges surfaced by the codex-tree comparison: **an expired evidence window reopens when
its commitments were all killed** — `DisputeManagerFacet` bypasses the expiry check when the
commitment list is empty, so new evidence is accepted arbitrarily late and each acceptance
restarts the kill period (safety/griefing exposure, not only the liveness gap above; candidate
rule: reject all evidence once the window close rule is met). The economics half should also
settle: whether disputing requires a bond, whether the penalty attaches to the disputer or to a
signer whose data the disputer relayed, the malformed-vs-objectively-false distinction, where
slash value goes, and an explicit sign-off on the threshold-signed fast path (it backdates both
windows, deletes prior commitments, and trusts the dispute's own output hash — sound only under
N-of-N signatures).

## OQ-2 — Penalty for submitting an invalid fraud proof

Whether and how a sender is penalized for submitting an invalid **fraud proof** (as opposed to an
invalid dispute) is an open detail, not an assumed rule. The current implementation slashes the
submitter when a proof does not validly slash the claimed participant; the intended protocol rule
needs engineer confirmation before it is normative. _(Review §25.)_

## OQ-3 — Leader election beyond round-robin

The carried-forward-suffix safety argument depends on round-robin leader election. Under another
policy, a valid non-final suffix may be reverted, with different safety, liveness, and
accountability risks. Unresolved: the exact attribution and penalty rules for each objectively
provable violation under a non-round-robin schedule, its interaction with virtual voting and
longest-valid-chain reduction, the circumstances in which a state may revert, and how long-lived
channels keep milestone-chain proofs bounded and prevent or recover from long-range conflicting
histories. _(Review §34.)_

## OQ-4 — Dispute-reduction order-independence

Reduction is intended to converge to the same result regardless of the order in which valid
dispute inputs are applied, even though the chain serializes transactions. The exact merge/
reduction rules and a proof that conflicting orderings cannot change the result are not yet
specified, and the property is not yet verified by permutation, adversarial, and on-chain
integration tests. Until then it MUST NOT be described as CRDT-like. _(Review §12.)_

Code-derived sharpening: order independence is currently violated in principle. Killing a
commitment removes it by swap-with-last, reordering the survivor set that `reduce()` consumes
positionally, and order-sensitive consumers exist (slash application order can change the
serialized output state and therefore the successor `forkId`; the empty-timeout fold of OQ-14 is
last-writer-wins). Candidate directions: canonicalize (sort) the survivor set before reduction,
or prove and permutation-test independence including kills and slash-application order. See
[protocol/disputes.md](./protocol/disputes.md) §5 (INV-DIS-5).

## OQ-5 — Fraud-proof completeness security review

The current fraud-proof list must not be treated as complete. A dedicated security review must ask
which objectively provable violations lack a fraud proof and which attack paths are not prevented,
detected, or recoverable — across block production, signatures/equivocation, virtual voting, state
proofs and milestone hops, membership changes, message streams, snapshot updates, proof
submission, slash-set handling, reduction, timing, data availability, RPC trust, leader election,
and cross-layer interactions. Tracked in detail by
[security/open-security-review.md](./security/open-security-review.md). _(Review §35.)_

## OQ-6 — P2P gossip rate limiting

No gossip rate-limiting policy is designed yet. Needed: the unit of limiting, identity/peer scope,
burst behavior, queue and backpressure rules, prioritization of protocol-critical messages,
consequences of exceeding limits, and interaction with retries, offline peers, and transport
differences — without preventing honest recovery, block confirmation, or dispute escalation. The
thresholds and enforcement mechanism are unresolved engineering work, required before the P2P
security model is complete. _(Review §41.)_

**Engineer direction (2026-08-10):** enforcement lives in a **single, central rate limiter at
the RPC level**, shared across all RPC services (possibly scoped per peer) — deliberately not
per-service limits — so one clean mechanism protects everything. This limiter is also what
bounds the pre-execution block queue: a finite admission rate times the fixed entry lifetime
gives a bounded queue, so the queue needs no cap of its own (see
[sdk/block-confirmation-pipeline.md](./sdk/block-confirmation-pipeline.md) §3.1). Still open:
the thresholds, burst/backpressure behavior, prioritization, and whether an additional fixed
per-peer limit is wanted. Implementation is required before production.

## OQ-7 — `onlySelf` guard under the improved Diamond architecture

The planned Diamond refactor (selector-based routing, focused facets, versioned diamond storage)
changes the call topology the `onlySelf` self-call guard was designed for. Whether the guard
remains necessary must be re-evaluated from first principles before it is preserved or removed.
_(Review §27.)_

## OQ-8 — Clock-skew and bias values

The time model requires an explicit maximum clock skew and a deliberate bias/lag that trades
responsiveness against false time-based failures. The concrete values are a configuration decision
that must be chosen and validated empirically under representative delay, skew, reorganization,
and block-production conditions. _(Review §13.)_

Code-derived specifics: the sync tolerance factor is unresolved in code (1× vs. 2× average block
time, a live TODO); the clock syncs once per session (at init and on provider replacement) with no
periodic re-sync cadence defined; no explicit maximum-skew constant exists anywhere; and the
default window values (15/5/30/30 s) are development defaults. See
[protocol/time.md](./protocol/time.md) §2–3.

## OQ-9 — Timeout precedence edge rules

The timeout reduction rules (slashes suppress timeouts in a fork; at most one timeout per fork,
targeting the lowest timed-out height) have unresolved edges: what exactly counts as _the same
fork_, how block heights are compared across different proven histories, when submitted evidence
becomes available to the timeout target, and how a fraud proof revealed by that evidence changes
an already proposed timeout. _(Review §36.)_

Code-derived edges: whether "any non-timeout dispute cancels the proposed timeout" is intended
(see OQ-14 for the suppression fold); the exact inclusive/exclusive boundary comparisons of the
`Timeout*` dispute-fraud-proof rules; and unquantified underlying-chain timestamp-manipulation
bounds relative to the protocol windows. See [protocol/disputes.md](./protocol/disputes.md) §6 and
[protocol/time.md](./protocol/time.md) §5.3.

## OQ-10 — Spectate/join failure-point details

The admission flow (spectate → unanimous join authorization → deposit → inbound inclusion →
forced inclusion via dispute if ignored) needs exact parameters for every failure point: the
deadlines, required signatures and message contents, ordering rules, the forced-inclusion proof,
and the refund or exit behavior when a deposit is acknowledged on-chain but never included.
_(Review §20.)_

Code-derived specifics: the SDK auto-signs any structurally valid join request (a code TODO marks
the missing admission-policy hook), so unanimity is currently signature collection, not consent;
the inclusion deadline is a heuristic (`participants + 1` blocks), not a normative rule;
concurrent-join semantics are undefined; spectate-time simulation of consumer side effects is
stubbed; and the first inbound block's height is not bound to the lower snapshot. See
[protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md) §3–4.

Two more from the codex-tree comparison: the SDK promotes itself to `PENDING_PARTICIPANT`
**before** the join transaction is even sent (never waiting for a canonical chain event; a
dropped transaction leaves the node pending — candidate rule: stage locally, promote on the
canonical event, roll back on reorg); and the spectate path **blacklists a peer for any request
failure**, including plain timeouts and transport errors — conflating unavailability with
Byzantine behavior, contrary to the fault taxonomy in
[security/trust-model.md](./security/trust-model.md).

## OQ-11 — Channel-balance invariant definition

The aggregate channel-balance invariant (claimed in-channel value is backed by deposits minus
withdrawals under the application's balance algebra) protects late joiners syncing from a
snapshot against undercollateralized colluding states. Unresolved: the precise invariant per
supported balance model (integer, composite, non-fungible), its snapshot proof inputs, exactly
when it is checked, and how it treats joins, deposits, withdrawals, and exits. _(Review §19.)_
Where it is enforced today is itself a gap — see OQ-19.

## OQ-12 — Book-like overview vs. tree as authoritative reference

How to retain a book-like, top-to-bottom onboarding overview while keeping the documentation tree
as the maintainable authority. **Current resolution:** the root [README.md](./README.md) is the
onboarding overview; the tree is the authoritative reference; both must stay consistent (see
[governance.md](./governance.md) §5). Revisit only if the two drift in practice. _(Review §2.)_

## OQ-13 — State proofs reject the intended mixed shape

The intended model allows a proof of milestones (finality anchors) followed by a trailing
non-final suffix of signed blocks. The implementation rejects that combination:
`StateProofFacet` accepts milestones **or** a suffix, and forces suffixes to start at fork
genesis; the SDK's proof assembly mirrors this. Consequence: once any milestone exists, a
non-final suffix past the last anchor cannot be presented, so disputes may operate on a staler
state than designed. Comments in `ProofTypes.sol` and helper code describe the intended mixed
shape, so this looks like an implementation cut, not a decision. Confirm the intended shape and
extend the proof format, or amend the model. See
[protocol/state-proofs.md](./protocol/state-proofs.md) §8.

## OQ-14 — Empty-timeout fold can suppress a real timeout

`DisputeVerificationFacet.reduce()` folds timeouts by taking the minimum `blockHeight` without
checking `participant != address(0)`, so any committed dispute _without_ a timeout (height 0)
wipes a real timeout claim. This conflicts with the lowest-real-height rule of review §36.
Decide whether this is a bug (likely) or intended "any non-timeout dispute cancels the timeout"
semantics, then fix and test accordingly. See [protocol/disputes.md](./protocol/disputes.md) §6.

## OQ-15 — `challengeDisputeReduction` is currently unreachable

Every commit path back-dates `reducedResult.timestamp` by `evidenceTime`, so the reduce-challenge
period is already expired at commit and finalization is immediate (on-chain recomputation makes
the result objectively correct). Decide whether the challenge entry point is dormant scaffolding
for the intended optimistic-reduction design (review §32) or should be removed. See
[protocol/disputes.md](./protocol/disputes.md) §5.

Delta (via codex comparison): the backdating is also inside the challenge-**replacement** path
itself — a successful challenge commits its replacement with
`block.timestamp - getEvidenceTime()`, so even if challenges become reachable, a replaced result
finalizes instantly and can never itself be challenged. Candidate rule: a replacement starts a
fresh `evidenceTime` challenge period at the replacement transaction's timestamp.

## OQ-16 — Slash-set lifetime across parallel windows

`_clearDisputeData` deletes the on-chain slash set when channel storage is cleared, and a code
`TODO!` questions this: a slash consumed by one fork's reduction could be needed by a parallel
window. Define the slash set's ownership and lifetime rules. See
[protocol/fraud-proofs.md](./protocol/fraud-proofs.md) §6.

## OQ-17 — Consumer-facet functions are externally reachable

The proxy's fallback forwards every unmatched selector to the integrator's consumer facet, so
`deposit`/`withdraw` are directly externally callable; an unguarded `withdraw` implementation
would be drainable. Decide: a framework-level guard, or a documented integrator obligation with
review guidance. See [contracts/state-machine-base.md](./contracts/state-machine-base.md).

## OQ-18 — Exit-recording asymmetry between slash and remove

The external `slashParticipant` wrapper appends the resulting `ExitChannel` to the machine's
outbound buffer; `removeParticipant` returns it without appending (the dispute pipeline
compensates by using return values). Inert today, but which layer owns recording the exit message
should be decided deliberately. See [concepts/state-machines.md](./concepts/state-machines.md)
§6.4 and [contracts/state-machine-base.md](./contracts/state-machine-base.md).

**Resolved (2026-08-10):** the wrappers MUST be symmetric — both record the exit through
`_addExitChannel`. The only intended difference between removal and slashing lives in the hooks'
balance semantics: `_removeParticipant` is the less aggressive path and may return the
participant's full held balance; `_slashParticipant` applies the application-defined penalty.
Recorded normatively as REQ-SM-8 in
[concepts/state-machines.md](./concepts/state-machines.md). The implementation change
(`removeParticipant` also calling `_addExitChannel` on success) is pending; until it lands the
Current: notes in the affected documents stand.

## OQ-19 — Channel-balance invariant enforcement points

The aggregate balance invariant is currently checked only at spectate sync (client-side static
call) and via the `DisputeInvalidBalanceInvariant` fraud proof. It is not run on snapshot update
— despite a code comment declaring that intent — and not at on-chain join. Confirm and implement
the intended check sites, or record the omission as an accepted limitation with its risk. See
[protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md) §6. Pairs with OQ-11.

Additional unchecked site (via codex comparison): at `open()`, the consumer facet's
`openChannelGenesis` return — the genesis state and participant list — is adopted without
cross-checking the participants against the joins that actually deposited and without a balance
check of the genesis state against total deposits. A buggy or hostile consumer can open a channel
whose membership does not match depositors.

## OQ-20 — Outbound stream generality and failure behavior

`_processCustomOutboundMessage` unconditionally reverts and its override point sits on
`StateChannelCommon`, which integrators do not extend, so the outbound stream is not yet
general-purpose (inbound has a proper hook on `AStateMachine`). A failing consumer `withdraw`
reverts the entire snapshot advance, wedging the stream. Residual funds on channel close are a
live `TODO` (treasury). Define the custom-outbound registration point, per-message failure
isolation, and the close-out path. See
[protocol/cross-layer-messages.md](./protocol/cross-layer-messages.md) §1–2, §5.

Enrichment (via codex comparison): the failure-isolation decision is really _atomic range vs.
commit-a-prefix_ — prefix processing lowers retry cost but needs exact next-height semantics and
per-message consumer-failure classification (including reentrancy, duplicate calls, and a
consumer that succeeds then returns malformed data). The close-out decision should cover the full
empty-channel terminal rule: remaining balance destination, pending inbound value, unresolved
outbound value, slash proceeds, dispute-data retention, and who may submit final cleanup.

## OQ-21 — `_tx.body` population and state-encoding versioning

`AStateMachine.stateTransition` injects only `_tx.header`; `_tx.body` is never populated — decide
whether to populate it (making the full transaction visible to the machine) or remove it. See
[concepts/state-machines.md](./concepts/state-machines.md) §2.1. Still open.

**Resolved (2026-08-10) — state-encoding versioning:** the state machine is immutable per
channel; upgrades to state-machine logic, if any, affect only newly opened channels. No
state-encoding version marker is needed, and an existing channel MUST NOT change its encoding.
Recorded normatively in REQ-SM-4 in
[concepts/state-machines.md](./concepts/state-machines.md).

## OQ-22 — Inauthentic on-chain calldata is not escalated

When a block delivered via a `BlockCalldataPosted` event fails authenticity checks — an objective
fault committed on-chain — `CalldataCommittedStrategy` signals escalation but builds no fraud
proof and opens no dispute (two code TODOs). The required proof type is unresolved. Feeds the
completeness review (OQ-5). See
[sdk/block-confirmation-pipeline.md](./sdk/block-confirmation-pipeline.md) §4.1.

## OQ-23 — SDK restart and recovery semantics

All SDK storage domains are in-memory; a restarted participant has no persisted history and the
recovery procedure (resync from peers, from chain calldata, or via dispute) is unspecified. This
also bounds unbounded-memory growth over channel lifetime. See
[sdk/components.md](./sdk/components.md) (storage) and the watchtower assumption in
[security/trust-model.md](./security/trust-model.md).

Related running-node case (via codex comparison): when a still-participating node observes a
canonical `StateSnapshotUpdated` it does not know locally, there is no recovery-only mode — the
handler warns-and-ignores while spectating and, for an active participant, throws fatally after
one reduce attempt. The intended behavior (fetch from untrusted sources, verify against the
chain anchor, resume) needs an algorithm decision.

## OQ-24 — `shouldSignBlock` refusal when next-to-write

`StateManager.shouldSignBlock` refuses to sign an on-chain-posted block when the local node is
the next-to-write. The rule is not stated anywhere as intended protocol behavior; confirm intent
and specify it (or remove it). See [protocol/finality.md](./protocol/finality.md) §8.

## OQ-25 — Minor SDK lifecycle races

Grouped smaller items, each a code TODO or observed race: `abort()` disposes the manager graph
but not the runtime control port (residual queryability); the TypeScript
`onStateSnapshotUpdated` handler is not `(blockNumber, logIndex)`-ordered, unlike the
LocalDiamond mirror; and kill/counter-dispute sequencing (see OQ-1). See
[sdk/architecture.md](./sdk/architecture.md), [sdk/components.md](./sdk/components.md), and
[sdk/dispute-pipeline.md](./sdk/dispute-pipeline.md).

## OQ-26 — On-chain wrong-turn enforceability

**Decided (2026-08-10):** turn authorization is a protocol-layer responsibility, enforced
generically for all state machines — the SDK validation pipeline rejects a wrong-author block
before it reaches `stateTransition`, and in-contract turn checks are optional defense in depth
(REQ-SM-6 / REQ-CON-7 corrected accordingly).

**Remaining question — the on-chain side.** Observed facts: the
`BlockInvalidStateTransition` handler (`FraudProofFacet._handleBlockInvalidStateTransition`)
re-executes the transition and compares snapshot hashes; it never consults `getNextToWrite`.
The SDK escalates a detected wrong leader through the same `invalidStateTransitionDetected`
path as any invalid transition. The comment above `AStateMachine.stateTransition` still says
wrong-turn fraud-proof soundness depends on the implementation's own check, and the passing
wrong-turn Foundry test relies on `MathStateMachine`'s in-contract `require`.

Inferred concern: against a state machine with no in-contract guard, a wrong-turn block that
otherwise executes correctly re-executes successfully with a matching snapshot — the fraud proof
returns invalid and the self-slashing guard punishes the honest submitter.

Options for engineer resolution: (a) add a generic author-vs-`getNextToWrite` check to the
on-chain handler (or a dedicated wrong-author fraud-proof type); (b) confirm that no on-chain
wrong-turn proof is ever needed (a wrong-turn block can never finalize or enter a valid state
proof) and change the SDK escalation so it does not submit an unsound proof; or (c) some
combination. The stale source comment at `AStateMachine.stateTransition` should be updated with
the resolution.

## OQ-27 — Reducer eligibility is disabled

`reduceAndFinalize` has its `canParticipateInDisputes(channelId, msg.sender)` check commented
out, while dispute upload and `challengeDisputeReduction` enforce it — so today anyone can
reduce, but only eligible participants can upload or challenge. Decide who may reduce: anyone
(permissionless, with anti-spam), a deterministic eligible participant first with permissionless
fallback, or a threshold-signed fast path with fallback. Then make every entry point consistent.
See [protocol/disputes.md](./protocol/disputes.md) §5. _(Surfaced via the codex-tree
comparison.)_

## OQ-28 — Equal-height reduction tie-break

When two valid dispute candidates carry the same `transactionCnt`, `reduce()` picks the one with
the numerically smaller block hash. The rule is deterministic and cheap but has never been
engineer-approved, and it gives a block author a hash-grinding surface: transaction encoding can
be varied to win same-height ties. Alternatives: prefer stronger confirmation evidence, or treat
same-height distinct valid candidates as slashable equivocation. Decision criteria: no benefit
from grinding, compatibility with virtual votes and membership changes, bounded gas, and a clear
fraud target. See [protocol/disputes.md](./protocol/disputes.md) §5. _(Surfaced via the
codex-tree comparison.)_

## OQ-29 — Signature domain separation

Every protocol signature (blocks, transactions, joins, opens, disputes) is a plain
EIP-191 `signMessage(keccak256(abi.encode(struct)))` — no EIP-712 domain, no chainId, no
verifying-contract address, no protocol version, no object-type tag beyond the struct shape. And
`OpenChannel.channelId` is caller-chosen. Consequence: signatures are replayable across manager
deployments and across chains that host the same channelId. Decide the signed-domain policy
(bind protocol version, chain, manager deployment, object type; keep on-chain verification
affordable) and the migration plan for proofs signed under the old scheme. Feeds the
completeness review (OQ-5). See
[security/open-security-review.md](./security/open-security-review.md). _(Surfaced via the
codex-tree comparison.)_

## OQ-30 — Chain-reorg handling and canonical event ordering

The SDK's event cursor is a bare block number (no block hash, transaction index, or log index),
so a same-height reorg is undetectable and there is no rollback journal; and chain logs dispatch
concurrently with no cross-log ordering, so any two same-channel events can apply out of
canonical order (OQ-25 flagged one handler; the problem is general). Candidate rule: a canonical
`(blockNumber, blockHash, txIndex, logIndex)` cursor, one ordered application per channel, and
reorg rollback. Affects join, dispute, reduction, and withdrawal decisions — a reorg attack
surface the security review must cover. See [sdk/components.md](./sdk/components.md) and
[security/open-security-review.md](./security/open-security-review.md). _(Surfaced via the
codex-tree comparison; supersedes the event-ordering item of OQ-25.)_

## OQ-31 — Hash-only dispute availability rule

Disputes commit on-chain by hash; when a verifier cannot obtain or decode the backing data (bad
ABI, missing local anchor, withholding peers), the SDK audit currently stops without a fireable
proof — the unauditable dispute escapes any consequence. Silent acceptance is not an acceptable
end state. Options: mandatory calldata for disputes, a bounded data-request phase, an
availability proof, or exclusion of unauditable candidates. See
[sdk/dispute-pipeline.md](./sdk/dispute-pipeline.md) (audit-skip paths). _(Surfaced via the
codex-tree comparison.)_

## OQ-32 — Proof and audit size bounds

Nothing bounds proof sizes: milestones per proof, block confirmations, signed-suffix length,
signatures per object, message blocks and messages per block, disputes per window, fraud proofs
per call, auditing bytes, or on-chain replay gas (the state-proof facet has a live TODO on
missing gas limits). The transport's global frame cap is not a proof bound. Bounds must come
from target-chain calldata/gas measurements and client CPU/memory tests. Distinct from OQ-6
(gossip rate limiting). See [protocol/state-proofs.md](./protocol/state-proofs.md) and
[security/data-availability.md](./security/data-availability.md). _(Surfaced via the codex-tree
comparison.)_

## OQ-33 — Maximum participant count is not enforced

The contracts enforce a minimum of two participants but no maximum; unbounded sets grow the
O(n²) duplicate/threshold loops and dispute/proof gas without bound. The design target is small
partitions (about six, at most roughly ten). Decide the benchmark-backed hard limit and enforce
it in `open`/`join` (and RPC) rather than degrading without bound. See
[security/trust-model.md](./security/trust-model.md) (topology) and
[contracts/manager-and-facets.md](./contracts/manager-and-facets.md). _(Surfaced via the
codex-tree comparison.)_

## OQ-34 — RPC boundary decisions

Grouped decisions surfaced while specifying the peer-RPC model
([sdk/rpc/README.md](./sdk/rpc/README.md), review §43); each is marked in place in that document:

- **Guard retry vs. request/response.** The handshake guard queues rejected calls for retry, but
  a queued _request_ has already been answered with a guard error — its later retried response
  arrives as an unknown `requestId` and is dropped, so retry only benefits fire-and-forget
  sends. Also, guard `onFailure` disconnects before the error response is sent. Decide the
  intended queue/retry semantics per delivery mode.
- **Protocol versioning.** No version negotiation or compatibility scheme exists anywhere in the
  RPC layer (only the `peer3:init-handshake:v1` domain tag). Couples to OQ-29 (signature
  domains): one versioning decision should cover both.
- **Ban persistence before a profile exists.** A "blacklist" verdict against a peer with no
  established profile is disconnect-only (`profile?.blacklist()` no-ops), so a pre-handshake
  abuser can reconnect freely. Decide whether bans persist by transport-level address.
- **Failure-outcome policy consistency.** Endpoint outcomes are currently per-service accidents:
  join-signature validation failures are penalty-free request errors (free probing), while
  spectate failures blacklist permanently (DEF-5); WebRTC signaling failures are silently
  ignored. Decide one policy table — which failure classes disconnect, blacklist, error, or are
  ignored — and make endpoints conform.

## OQ-35 — Handshake channel/identity binding (relay MITM)

The session handshake signs only `peer3:init-handshake:v1:<challengeHash>`. It binds nothing about
the transport, the session, or the two parties' identities, and no network transport
(Holepunch/WebRTC/local) authenticates its channel — so the handshake signature is the entire
root of trust for peer identity. An on-path attacker can forward a victim's live signature over
the initiator's random challenge and make the initiator believe it is authenticated to the victim
over the attacker's transport (relay/reflection MITM); the only limiter is the `agreementTime`
skew window. Decide the binding: include the two EVM identities and a transport/session binding in
the signed payload (EIP-712 or a domain-tagged struct), coordinated with OQ-29 (signature domains)
and OQ-34 (protocol versioning) so one scheme covers all three. Until resolved, the trust model
MUST state that peer authentication assumes no on-path adversary between two honest peers — a
strong assumption for a p2p system. See [sdk/rpc/handshake.md](./sdk/rpc/handshake.md) §4.1 and
[security/trust-model.md](./security/trust-model.md). _(Surfaced by the §43 service review; the
most serious RPC finding.)_

## OQ-36 — `is-fork-disputed` missing channel binding

`onDisputeAcknowledgmentRequest` never checks the request's `channelId` against the local
`stateManager.channelId`, and its chain fallback queries the shared manager contract. An attacker
who opens a throwaway channel and disputes it can get victims to acknowledge and permanently
record forks belonging to a foreign channel, and use the endpoint as a free chain-read oracle. The
duplicate-key check keys on `forkId` only, ignoring channel. Decide the channel-binding check and
the ack-record keying; also whether acks should be signed (see the documentation-debt note below).
See [sdk/rpc/is-fork-disputed.md](./sdk/rpc/is-fork-disputed.md) §6.6. _(Surfaced by the §43
service review.)_

Related (documentation debt / decision pending): dispute acknowledgments are **unsigned**, so the
model doc's "building on an acknowledged dead fork is provably byzantine" overstates — the ack
record is local opinion, not portable fraud-proof evidence. Signed acks would connect
dead-fork building to the fraud-proof layer. And the three ack maps are never pruned; their
lifetime relative to fork finalization is undefined.

## OQ-37 — Harness-control surface exposure

The test harness registers `HarnessControlRpc` as an ordinary custom-RPC root: **11 services, 207
public endpoints, zero guards** (`ARpcService.guards` defaults to `[]` and no harness service
overrides it). Because service resolution is structural over any transport, any peer connected to
a harness-built peer can invoke them — including `scenario.exec`, which rebuilds a supplied source
string with `new Function` and runs it against the live `StateManager` (arbitrary code execution in
the host realm), `handshake.signMessage` (a signing oracle), and `signer` (imports other peers'
private keys). The root also ships: `tsc` emits `dist/test/fixtures/customRpc/harnessControl/`,
`package.json` `files` includes `dist`, and `exports["./test-harness"]` re-exports it, so it is the
default root for any downstream consumer building peers with the harness.

Today the blast radius is bounded only by production `p2pSetup` registering the bare
`MainRpcService`. Decide: restrict harness services to the trusted loopback transport and exclude
them from the published artifact (REQ-RUN-10's intended rule), or accept "test peers only run on
closed networks" as an explicit, documented limitation. See
[sdk/runtime-and-concurrency.md](./sdk/runtime-and-concurrency.md) §11.4. _(Surfaced by the §44
harness review; production gate.)_

## OQ-38 — Runtime budgets, scheduling determinism, and test isolation

Follow-ons to the 2026-08-10 runtime decisions (REQ-RUN-13/14/15):

- **Memory budget under the phone envelope (blocks REQ-RUN-13).** Default-on workers put three
  execution contexts per peer on a device with a few hundred MB of usable heap. _Resolved
  2026-08-10:_ placement does not vary by device — no profile branching; the envelope is a hard
  budget the implementation must meet. _Still open:_ the concrete per-context budget, the
  aggregate per-peer ceiling, the reduced per-worker cap (1024 MB is CI containment and too high),
  and the measurement showing three contexts fit. Until these exist the default-flip is blocked.
- **Worker capability detection.** Flipping the defaults requires detecting runtimes that deny
  workers and falling back inline; the mechanism and its failure behavior are undesigned. This is
  a fallback path, not a device profile.
- **Throughput/latency targets.** None exist, so REQ-RUN-14 is a memory envelope only and the
  measurement §44 requires cannot be defined. Decide block-confirmation round-trip, dispute-path
  latency, and sustained rate at six participants.
- **Default-flip prerequisites.** Whether flipping the worker defaults requires runtime
  feature-detection with automatic inline fallback (browsers that deny workers).
- **Equivalence oracle scope.** Whether event _ordering_ must match exactly or only the emitted
  multiset (REQ-RUN-15 currently says same set/payloads).
- **Test scheduling and isolation.** No cross-peer deterministic scheduler exists — coordination is
  polling plus event barriers and cooperative hold/release stubs; and the default is one shared
  chain and discovery registry per machine, with concurrent tests separated only by account-range
  slots and a stamped channel id. Decide whether to commit to a determinism mechanism and whether
  the isolation guarantee should be one chain per test process.

See [sdk/runtime-and-concurrency.md](./sdk/runtime-and-concurrency.md) §6 and §11.5.

## Implementation defects with a proposed direction

Distinct from open questions: for these, the finding is verified in code and a reasonable
direction exists, but the direction still needs engineer confirmation before implementation.
Each should become a normal fix + test once confirmed.

| ID     | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Proposed direction                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| DEF-1  | `open()` does not check `participants.length == balances.length` (out-of-bounds or silently ignored extras) and accepts `address(0)` participants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Add explicit length and nonzero-address requires.                                                     |
| DEF-2  | `OutboundMessagesProcessed` is emitted by [`StateSnapshotFacet`](./contracts/manager-and-facets.md) but absent from the SDK's dispatched-event set — local withdrawal accounting can go stale.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Dispatch it idempotently, or document that `WithdrawalsUpdated` fully substitutes.                    |
| DEF-3  | `LocalDiamond.onChannelOpened` builds the genesis inbound message block in memory and never persists it — the local mirror diverges from the production `open` path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Persist it (or delete the dead code deliberately).                                                    |
| DEF-4  | _Withdrawn (2026-08-10)._ The original claim — that the deploy helper's `?? 0` produces zero-length dispute windows — was false: the proxy constructor ([`StateChannelManagerProxy.sol`](../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol) L54–58) maps every `0` argument to a nonzero default (15/5/30/30 s), so `0` is a deliberate "use default" sentinel ([`manager-and-facets.md` §3](./contracts/manager-and-facets.md)). The real residual concern is tracked in OQ-8: those defaults are unvalidated development values still needing target-chain analysis before production. No deploy-time change is warranted. |
| DEF-5  | Spectator blacklists a peer on any request failure, conflating unavailability with Byzantine behavior (see OQ-10 addendum).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Separate invalid-evidence from transport/availability failure before permanent exclusion.             |
| DEF-6  | Join status is set to `PENDING_PARTICIPANT` before the join transaction is sent, never gated on a canonical chain event (see OQ-10 addendum).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Stage the request; promote on canonical event; roll back on reorg.                                    |
| DEF-7  | RPC dispatch accepts prototype-inherited method names (`hasMethod` uses `in`), so `toString`/`hasOwnProperty`/`constructor` are remotely callable on every `RpcMethods` class (see [sdk/rpc/README.md](./sdk/rpc/README.md) §2.1).                                                                                                                                                                                                                                                                                                                                                                                                                     | Require own-property lookup plus a function check on the `RpcMethods` instance.                       |
| DEF-8  | A `sendRpcResponse` throw inside the dispatcher's catch path escapes as an unhandled rejection on closed transports ([sdk/rpc/README.md](./sdk/rpc/README.md) §6.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Catch, log, and treat as a transport disconnect.                                                      |
| DEF-9  | Block ingest wraps everything in try/catch → `false` → disconnect+blacklist the sender, so a _local_ chain-provider failure (kill-period read in `maybeScheduleForkRecovery`) blacklists an honest gossiper for our own infrastructure fault ([sdk/rpc/state-transition.md](./sdk/rpc/state-transition.md) §4.1).                                                                                                                                                                                                                                                                                                                                      | Partition input faults from local faults; never penalize a peer for a local error.                    |
| DEF-10 | `onSpectateRequest` blacklists the requester whenever `generateSyncPayload` returns `undefined`, which also fires when a lagging responder honestly cannot prove a queue-pinned fork/height — weaponizable to make honest nodes blacklist each other ([sdk/rpc/spectate.md](./sdk/rpc/spectate.md) §4.2; responder-side mirror of DEF-5).                                                                                                                                                                                                                                                                                                              | Distinguish "cannot prove yet" from "provably bad request" before blacklisting.                       |
| DEF-11 | `WebRTCSetupService` passes attacker-supplied ICE candidates to the stack unfiltered, letting an authenticated peer induce STUN/connectivity traffic toward arbitrary third-party hosts (reflection primitive) ([sdk/rpc/webrtc-setup.md](./sdk/rpc/webrtc-setup.md) §4.2).                                                                                                                                                                                                                                                                                                                                                                            | Filter candidate targets, or accept as residual under the central rate limiter (OQ-6) with rationale. |
| DEF-12 | `OpenChannelNegotiationService.openProposal` does not validate `amount` — `NaN`/`Infinity`/negative pass the `typeof` checks and reach `BigInt()`/ABI encoding as an escaping throw (REQ-RPC-2 violation). Unreachable while the service stays unwired.                                                                                                                                                                                                                                                                                                                                                                                                | Validate `amount` is a finite non-negative integer before use.                                        |
