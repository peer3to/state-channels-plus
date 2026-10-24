# Specification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved protocol behavior, assumptions, limits, constraints, and invariants requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Contents

- [Question index](#index)
- [Register assumptions and constraints](#register-assumptions-and-constraints)
- [Security impact](#security-impact)
- [Verification impact](#verification-impact)
- [Detailed open questions](#oq-1-ntjba1--kill-period-and-dispute-fraud-proof-slashing-semantics)

## Index

| ID                                                                                       | Question                                                                                                                                                    | Source                 | Affected documents                                                                                                                                                                                                         | Status                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [`OQ-1-NTJBA1`](open-questions.md#oq-1-ntjba1)                                           | Exact kill-period and dispute-fraud-proof slashing semantics                                                                                                | Specification analysis | [protocol/disputes.md](./disputes/disputes.md), [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                                                                                                     | Open                              |
| [`OQ-2-7WTV16`](open-questions.md#oq-2-7wtv16)                                           | Penalty for submitting an invalid fraud proof                                                                                                               | Specification analysis | [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                                                                                                                                                     | Resolved                          |
| [`OQ-3-1AHKGW`](open-questions.md#oq-3-1ahkgw)                                           | Leader election beyond round-robin: revert attribution, long-range proofs                                                                                   | Specification analysis | [protocol/finality.md](./protocol-model/finality.md), [protocol/state-proofs.md](./disputes/state-proofs.md)                                                                                                               | Open                              |
| [`OQ-6-4JPNE5`](open-questions.md#oq-6-4jpne5)                                           | P2P gossip rate-limiting policy                                                                                                                             | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                                                                                                       | Open                              |
| [`OQ-7-M5G9M3`](open-questions.md#oq-7-m5g9m3)                                           | Whether adjudication requires a self-call-only authorization boundary                                                                                       | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                                                                                                       | Open                              |
| [`OQ-8-PEYAAQ`](open-questions.md#oq-8-peyaaq)                                           | Clock-skew and bias values to be validated empirically                                                                                                      | Specification analysis | [protocol/time.md](./protocol-model/time.md)                                                                                                                                                                               | Open                              |
| [`OQ-9-XR1MFS`](open-questions.md#oq-9-xr1mfs)                                           | Timeout precedence edge rules: same-fork definition, height comparison, evidence timing                                                                     | Specification analysis | [protocol/disputes.md](./disputes/disputes.md)                                                                                                                                                                             | Resolved                          |
| [`OQ-10-04YNC4`](open-questions.md#oq-10-04ync4)                                         | Spectate/join failure-point details: deadlines, refunds, forced-inclusion proof                                                                             | Specification analysis | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md)                                                                                                                                                   | Partially resolved                |
| [`OQ-11-38S3SE`](open-questions.md#oq-11-38s3se)                                         | Channel-balance invariant: definition per balance model and check points                                                                                    | Specification analysis | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md), [concepts/state-machines.md](./protocol-model/state-machines.md)                                                                                 | Open                              |
| [`OQ-12-B45Q7N`](open-questions.md#oq-12-b45q7n)                                         | Book-like overview vs. tree as the authoritative reference                                                                                                  | Specification analysis | [README.md](../README.md), [governance.md](../governance.md)                                                                                                                                                               | Provisionally resolved            |
| [`OQ-16-6AVF5B`](open-questions.md#oq-16-6avf5b)                                         | Slash-set lifetime: cleared on channel-storage clear, questioned in code                                                                                    | Code                   | [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                                                                                                                                                     | Open                              |
| [`OQ-18-2NK97T`](open-questions.md#oq-18-2nk97t)                                         | Whether removal and slashing use the same canonical exit-recording behavior                                                                                 | Specification analysis | [concepts/state-machines.md](./protocol-model/state-machines.md)                                                                                                                                                           | Resolved (implemented 2026-09-07) |
| [`OQ-20-Z9361V`](open-questions.md#oq-20-z9361v)                                         | Outbound stream is not yet general-purpose; withdraw failure wedges snapshot advance; residual funds on close                                               | Code                   | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md)                                                                                                                                                   | Open                              |
| [`OQ-26-XH59SP`](open-questions.md#oq-26-xh59sp)                                         | Whether every adjudication path generically enforces next-author authorization                                                                              | Specification analysis | [concepts/state-machines.md](./protocol-model/state-machines.md)                                                                                                                                                           | Open                              |
| [`OQ-27-GT4W09`](open-questions.md#oq-27-gt4w09)                                         | Reducer eligibility check is disabled in `reduceAndFinalize` — anyone can reduce                                                                            | Code                   | [protocol/disputes.md](./disputes/disputes.md)                                                                                                                                                                             | Open                              |
| [`OQ-28-RP46PW`](open-questions.md#oq-28-rp46pw)                                         | Equal-height reduction tie-break by smaller block hash — unapproved rule, hash-grinding surface                                                             | Code                   | [protocol/disputes.md](./disputes/disputes.md)                                                                                                                                                                             | Open                              |
| [`OQ-29-EFY4NF`](open-questions.md#oq-29-efy4nf)                                         | No signature domain separation: signatures replayable across deployments/chains                                                                             | Code                   | security/open-security-review.md                                                                                                                                                                                           | Open                              |
| [`OQ-32-5NDD24`](open-questions.md#oq-32-5ndd24)                                         | Proof and audit size bounds (milestones, tail blocks, signatures, auditing bytes, replay gas)                                                               | Specification analysis | [protocol/state-proofs.md](./disputes/state-proofs.md), [security/data-availability.md](./security/data-availability.md)                                                                                                   | Open                              |
| [`OQ-33-1N5BY1`](open-questions.md#oq-33-1n5by1)                                         | Maximum participant count and required enforcement boundary                                                                                                 | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                                                                                                       | Open                              |
| [`OQ-34-FY08V2`](open-questions.md#oq-34-fy08v2)                                         | RPC boundary decisions: protocol versioning, ban persistence, and failure-outcome policy                                                                    | Code and specification | [peer-communication/rpc.md](./peer-communication/rpc.md)                                                                                                                                                                   | Open                              |
| [`OQ-38-EY27T5`](open-questions.md#oq-38-ey27t5)                                         | Runtime budgets and targets under the mid-range-phone envelope; multi-peer test scheduling determinism and isolation                                        | Code and specification | runtime/execution.md                                                                                                                                                                                                       | Open                              |
| [`OQ-39-C3EAMN`](open-questions.md#oq-39-c3eamn)                                         | Reduce: stateful (reads on-chain slashes / inbound tip) vs stateless fold over the committed dispute inputs                                                 | Engineer question      | [protocol/disputes.md](./disputes/disputes.md)                                                                                                                                                                             | Open                              |
| [`OQ-40-M12S72`](open-questions.md#oq-40-m12s72)                                         | `challengeDisputeReduction`: dormant scaffolding for optimistic reduction, or dead code to remove                                                           | Specification analysis | [protocol/disputes.md](./disputes/disputes.md)                                                                                                                                                                             | Open                              |
| [`OQ-43-HWRTNF`](open-questions.md#oq-43-hwrtnf)                                         | Delegated contest authorization: a keyless watchtower can only kill invalid disputes via fraud proofs - opening contests requires the participant's own key | Engineer question      | [security/trust-model.md](./security/trust-model.md)                                                                                                                                                                       | Open                              |
| [`OQ-44-3Y5MD7`](open-questions.md#oq-44-3y5md7)                                         | Watchtower deployment shape: an ordinary peer with spectator-equivalent access, versus a distinct delegate role                                             | Engineer question      | [security/trust-model.md](./security/trust-model.md)                                                                                                                                                                       | Open                              |
| [`OQ-45-ACZCDE`](open-questions.md#oq-45-aczcde)                                         | Subjective post-authentication engagement policy: how a node decides whether to keep interacting with a proven identity                                     | Engineer direction     | [peer-communication/handshake.md](./peer-communication/handshake.md), [peer-communication/synchronization.md](./peer-communication/synchronization.md)                                                                     | Open                              |
| [`OQ-SPEC-LOBBY-1-D65YTT`](open-questions.md#oq-spec-lobby-1-d65ytt)                     | Per-transport cap and overflow outcome for deferred pre-readiness RPC admission                                                                             | Security hardening     | [peer-communication/rpc.md](./peer-communication/rpc.md), [peer-communication/channel-negotiation.md](./peer-communication/channel-negotiation.md)                                                                         | Open                              |
| [`OQ-SPEC-OPEN-1-12RH7A`](open-questions.md#oq-spec-open-1-12rh7a)                       | Whether the base-layer open operation must reject opening terms whose deadline has passed                                                                   | Security review        | [enforcement/admission-and-funds.md](./enforcement/admission-and-funds.md), [settlement/lifecycle.md](./settlement/lifecycle.md), [peer-communication/channel-negotiation.md](./peer-communication/channel-negotiation.md) | Resolved                          |
| [`OQ-SPEC-OPEN-2-YQTTTB`](open-questions.md#oq-spec-open-2-yqtttb)                       | Minimum time an opening proposal's deadline must leave before the higher peer signs and submits                                                             | Security review        | [peer-communication/channel-negotiation.md](./peer-communication/channel-negotiation.md)                                                                                                                                   | Resolved                          |
| [`OQ-SPEC-SPECTATOR-RELAY-1-V6F216`](open-questions.md#oq-spec-spectator-relay-1-v6f216) | Future spectator relaying                                                                                                                                   | Plan                   | Current queue admission and optional promotion                                                                                                                                                                             | Future; non-blocking              |
| [`OQ-SPEC-PROOFSTORE-1-SW4ZGT`](open-questions.md#oq-spec-proofstore-1-sw4zgt)           | Retention rule for pruning below the on-chain snapshot                                                                                                      | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [storage/durability.md](./storage/durability.md)                                                                                                                       | Open                              |
| [`OQ-SPEC-PROOFSTORE-2-V4N7VH`](open-questions.md#oq-spec-proofstore-2-v4n7vh)           | Pruning above the anchor and lost exact-height checks                                                                                                       | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [storage/durability.md](./storage/durability.md), [disputes/fraud-proofs.md](./disputes/fraud-proofs.md)                                                               | Open                              |
| [`OQ-SPEC-PROOFSTORE-3-F9HWYC`](open-questions.md#oq-spec-proofstore-3-f9hwyc)           | Which membership hops the stored proof keeps                                                                                                                | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [disputes/state-proofs.md](./disputes/state-proofs.md), [storage/participant-changes.md](./storage/participant-changes.md)                                             | Open                              |
| [`OQ-SPEC-PROOFSTORE-4-DZSGJP`](open-questions.md#oq-spec-proofstore-4-dzsgjp)           | Merging a received or longer proof into the stored proof                                                                                                    | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [disputes/state-proofs.md](./disputes/state-proofs.md)                                                                                                                 | Open                              |
| [`OQ-SPEC-PROOFSTORE-5-W48ZR6`](open-questions.md#oq-spec-proofstore-5-w48zr6)           | Old-fork data after a fork change                                                                                                                           | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [peer-communication/synchronization.md](./peer-communication/synchronization.md)                                                                                       | Open                              |
| [`OQ-SPEC-PROOFSTORE-6-X70EWK`](open-questions.md#oq-spec-proofstore-6-x70ewk)           | Full-state retention                                                                                                                                        | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [storage/snapshots-and-states.md](./storage/snapshots-and-states.md)                                                                                                   | Open                              |
| [`OQ-SPEC-PROOFSTORE-7-TJW3H8`](open-questions.md#oq-spec-proofstore-7-tjw3h8)           | Extending the stored proof on demand or by vote tracking                                                                                                    | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [protocol-model/finality.md](./protocol-model/finality.md)                                                                                                             | Open                              |
| [`OQ-SPEC-PROOFSTORE-8-QR7WWQ`](open-questions.md#oq-spec-proofstore-8-qr7wwq)           | Re-rooting and base-layer finality of the adoption                                                                                                          | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [enforcement/local-mirror.md](./enforcement/local-mirror.md)                                                                                                           | Open                              |
| [`OQ-SPEC-PROOFSTORE-9-53J8GE`](open-questions.md#oq-spec-proofstore-9-53j8ge)           | Restart durability of the stored proof                                                                                                                      | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [storage/durability.md](./storage/durability.md)                                                                                                                       | Open                              |
| [`OQ-SPEC-PROOFSTORE-10-ETB3H1`](open-questions.md#oq-spec-proofstore-10-etb3h1)         | Snapshot updates that bound the stored proof                                                                                                                | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [enforcement/snapshot-adoption.md](./enforcement/snapshot-adoption.md)                                                                                                 | Open                              |
| [`OQ-SPEC-PROOFSTORE-11-J7D4H1`](open-questions.md#oq-spec-proofstore-11-j7d4h1)         | Missing-evidence policy with pruned storage                                                                                                                 | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [disputes/state-proofs.md](./disputes/state-proofs.md)                                                                                                                 | Open                              |
| [`OQ-SPEC-PROOFSTORE-12-BDFC1J`](open-questions.md#oq-spec-proofstore-12-bdfc1j)         | Ordering of stored-proof writers and readers                                                                                                                | Specification analysis | [storage/proof-store.md](./storage/proof-store.md), [storage/durability.md](./storage/durability.md), [peer-communication/synchronization.md](./peer-communication/synchronization.md)                                     | Open                              |

## Register assumptions and constraints

This register contains unresolved specification decisions only. It does not define interim behavior, authorize
an implementation assumption, or replace the owning normative document. Every question has one primary owner,
lists affected layers, presents alternatives and consequences, and remains blocking wherever different answers
would change externally observable behavior.

## Security impact

A question affecting fund safety, authorization, finality, proof soundness, availability, timing, slashing,
privacy, or resource exhaustion is security-relevant until resolved. The owning document and audit assessment
must state the conservative current boundary; agents may analyze alternatives but only an engineer may record
the decision.

## Verification impact

Each alternative must identify the black-box cases whose stimulus or oracle changes. Resolution requires an
update to the owning specification, assumptions/constraints, security analysis, verification plan,
implementation mirrors, exact test mappings, generated reports, and any invalidated approval fingerprint.

<a id="oq-1-ntjba1"></a>

## OQ-1-NTJBA1 — Remaining dispute economics and timing policy

The selected kill rules are specified in [disputes](disputes/disputes.md) and
[fraud proofs](disputes/fraud-proofs.md). A valid counter kills the invalid commitment;
invalid eligible challenges have the specified challenger penalty. An invalid first dispute
is killed before replacement in one atomic operation. The node does not send its kill alone ahead of
its own dispute to gain time (engineer decision 2026-10-08). Those choices are no longer open.

Remaining questions concern a dispute bond, the destination of slash value, the policy for
repeatedly emptied windows, and calldata arrival after a kill decision. No additional policy
is selected here. Loss of the only higher-state commitment and late-challenge recovery have
separate questions below.

<a id="oq-2-7wtv16"></a>

## OQ-2-7WTV16 — Penalty for submitting an invalid fraud proof

Whether and how a sender is penalized for submitting an invalid **fraud proof** (as opposed to an
invalid dispute) is an open protocol detail, not an assumed rule. The penalty and its threshold
effects need engineer confirmation before they are normative.

**Resolved (2026-08-13, engineer decision):** an invalid fraud-proof submission slashes the
submitter **when the submitter is a channel participant** (dispute-eligible: current or pending,
not already slashed) — the self-slashing guard is confirmed as intended design, chosen to further
disincentivize Byzantine behavior and bogus-proof spam from channel members. Non-participants stay
unpenalized deliberately: they hold no channel stake to slash, and their invalid submissions
remain no-ops. Threshold effects follow the normal slash-set rules ([`REQ-FP-4-WHKBXP`](disputes/fraud-proofs.md#req-fp-4-whkbxp)) — a self-slashed
submitter loses dispute participation and on-chain threshold membership. Rejected alternatives:
bonded submission, no-penalty-with-rate-limit, and a penalty restricted to provably malicious
submissions. Accepted consequences: honest mistakes and preflight races are slashable, so
submitters preflight proofs before sending; the residual preflight race and the batch-atomicity
interaction remain verification items. Recorded normatively as [`REQ-FP-6-TS1QAV`](disputes/fraud-proofs.md#req-fp-6-ts1qav) in
[protocol/fraud-proofs.md](./disputes/fraud-proofs.md); the current implementation already
conforms.

<a id="oq-3-1ahkgw"></a>

## OQ-3-1AHKGW — Leader election beyond round-robin

The carried-forward-suffix safety argument depends on round-robin leader election. Under another
policy, a valid non-final suffix may be reverted, with different safety, liveness, and
accountability risks. Unresolved: the exact attribution and penalty rules for each objectively
provable violation under a non-round-robin schedule, its interaction with virtual voting and
longest-valid-chain reduction, the circumstances in which a state may revert, and how long-lived
channels keep milestone-chain proofs bounded and prevent or recover from long-range conflicting
histories.

<a id="oq-6-4jpne5"></a>

## OQ-6-4JPNE5 — P2P gossip rate limiting

No gossip rate-limiting policy is designed yet. Needed: the unit of limiting, identity/peer scope,
burst behavior, queue and backpressure rules, prioritization of protocol-critical messages,
consequences of exceeding limits, and interaction with retries, offline peers, and transport
differences — without preventing honest recovery, block confirmation, or dispute escalation. The
thresholds and enforcement mechanism are unresolved engineering work, required before the P2P
security model is complete.

**Engineer direction (2026-08-10):** enforcement lives in a **single, central rate limiter at
the RPC level**, shared across all RPC services (possibly scoped per peer) — deliberately not
per-service limits — so one clean mechanism protects everything. This limiter is also what
bounds the pre-execution block queue: a finite admission rate times the fixed entry lifetime
gives a bounded queue, so the queue needs no cap of its own
([`REQ-BLOCK-PIPE-5-WJ31RG` (Pre-execution merge layer)](block-progression/block-processing.md#req-block-pipe-5-wj31rg)). Still open:
the thresholds, burst/backpressure behavior, prioritization, and whether an additional fixed
per-peer limit is wanted. Implementation is required before production.

<a id="oq-7-m5g9m3"></a>

## OQ-7-M5G9M3 — `onlySelf` guard under the improved Diamond architecture

The planned Diamond refactor (selector-based routing, focused facets, versioned diamond storage)
changes the call topology the `onlySelf` self-call guard was designed for. Whether the guard
remains necessary must be re-evaluated from first principles before it is preserved or removed.

The guard exists because the composable deposit, withdraw, and state-transition entry points are
public on the proxy yet must only run as internal steps of a larger operation; the self-call also gives
them a fresh call frame (memory and return-data isolation) that an in-frame delegation would not.
Options: make them internal to the proxy, route them but keep the guard, or keep the self-call for
frame isolation. The refactor must pick one and state why.

<a id="oq-8-peyaaq"></a>

## OQ-8-PEYAAQ — Clock-skew and bias values

The time model requires an explicit maximum clock skew and a deliberate bias/lag that trades
responsiveness against false time-based failures. The concrete values are a configuration decision
that must be chosen and validated empirically under representative delay, skew, reorganization,
and block-production conditions.

Code-derived specifics: the sync tolerance factor is unresolved in code (1× vs. 2× average block
time, a live TODO); the clock syncs once per session (at init and on provider replacement) with no
periodic re-sync cadence defined; no explicit maximum-skew constant exists anywhere; and the
default window values (15/5/30/30 s) are development defaults. See
[protocol/time.md](./protocol-model/time.md) §2–3. Also covers the unquantified underlying-chain
timestamp-manipulation bounds relative to the protocol windows (inherited from
[`OQ-9-XR1MFS`](open-questions.md#oq-9-xr1mfs) on its resolution; [protocol/time.md](./protocol-model/time.md) §5.3).

<a id="oq-9-xr1mfs"></a>

## OQ-9-XR1MFS — Timeout precedence edge rules

The timeout reduction rules (slashes suppress timeouts in a fork; at most one timeout per fork,
targeting the lowest timed-out height) have unresolved edges: what exactly counts as _the same
fork_, how block heights are compared across different proven histories, when submitted evidence
becomes available to the timeout target, and how a fraud proof revealed by that evidence changes
an already proposed timeout.

**Resolved (2026-08-14, engineer decision):**

1. **Only a slash cancels a proposed timeout** (normatively
   [`INV-DIS-7-9GGZSD`](disputes/disputes.md#inv-dis-7-9ggzsd)). Every other valid dispute input
   — self-removal-only disputes, the accused's own counter-dispute, any slash-free dispute with
   no timeout claim — leaves the timeout applied: such inputs leak no information the timed-out
   participant could not already have known or that is relevant to it, so they cannot legitimize
   ignoring the missed slot ([`INV-DIS-8-1GY6Q5`](disputes/disputes.md#inv-dis-8-1gy6q5) amended;
   permutation [`INV-DIS-8-1GY6Q5.T1.P19`](disputes/disputes.md#inv-dis-8-1gy6q5.t1.p19)). Rationale for the slash side: if the timeout still
   applied, an attacker could remove an honest participant at the cost of a slash; with
   suppression the attacker is simply slashed and no timeout applies.
2. **"The same fork" means the `forkId`** — a reality that prevails out of the dispute game after
   a genesis — never divergent block histories inside one `forkId`. Leader election is
   deterministic as a function of state, so exactly one block exists per state: intra-`forkId`
   divergence implies a double-sign by construction.
3. **Height comparison across proven histories is sound as implemented.** Fork choice inside a
   `forkId` is longest-chain (the `latestBlock` reduction rule); a submitter bringing a divergent
   history to the dispute game discloses the double-sign, and the resulting slash suppresses any
   timeout — so raw `transactionCnt`/`blockHeight` comparison needs no one-chain proof.
4. **Evidence availability needs no finer definition.** Evidence changes an already-proposed
   timeout only via the slash set at reduction time or by killing the dispute during the kill
   period — intended; the observation moment of non-slash inputs is immaterial.

[protocol/disputes.md](./disputes/disputes.md) §5, §6.1, and §6.2 record the decisions.
Remaining mechanics are implementation-tracked in [`OQ-14-5C8KV7` (Empty-timeout fold can suppress a real timeout)](../implementation/open-questions.md#oq-14-5c8kv7): the fold fix
(empty timeout structs must not participate — a defect in the slash-free case) and the exact
inclusive/exclusive boundary comparisons of the `Timeout*` dispute-fraud-proof rules.
Unquantified underlying-chain timestamp-manipulation bounds relative to the protocol windows
remain with [`OQ-8-PEYAAQ`](open-questions.md#oq-8-peyaaq) / [protocol/time.md](./protocol-model/time.md) §5.3.

<a id="oq-10-04ync4"></a>

## OQ-10-04YNC4 — Spectate/join failure-point details

The admission flow (spectate → unanimous join authorization → deposit → inbound inclusion →
forced inclusion via dispute if ignored) needs exact parameters for every failure point: the
deadlines, required signatures and message contents, ordering rules, the forced-inclusion proof,
and the refund or exit behavior when a deposit is acknowledged on-chain but never included.

Code-derived specifics: the SDK auto-signs any structurally valid join request (a code TODO marks
the missing admission-policy hook), so unanimity is currently signature collection, not consent;
the inclusion deadline is a heuristic (`participants + 1` blocks), not a normative rule;
concurrent-join semantics are undefined; spectate-time simulation of consumer side effects is
stubbed; and the first inbound block's height is not bound to the lower snapshot. See
[protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md) §3–4.

Additional implementation gaps: the SDK promotes itself to `PENDING_PARTICIPANT`
**before** the join transaction is even sent (never waiting for a canonical chain event; a
dropped transaction leaves the node pending — candidate rule: stage locally, promote on the
canonical event, roll back on reorg; the roll-back-on-reorg part is pending on the chain-finality
assumption, [chain finality](runtime/chain-observation.md#assumptions-and-constraints)); and the spectate path **blacklists a peer for any request
failure**, including plain timeouts and transport errors — conflating unavailability with
Byzantine behavior, contrary to the fault taxonomy in
[security/trust-model.md](./security/trust-model.md).

**Partially resolved (2026-08-31):** initial channel load now selects one authenticated peer and uses
two independent local agreement windows; selected-peer failure aborts the uncommitted runtime without
fallback. First-join and top-up deadlines are assigned internally, and `PENDING_PARTICIPANT` is set only
after the membership receipt succeeds. Accepted pending or participating state is preserved after later
operational failure. Refund/exit behavior for a deposit that is never included, and the full forced-inclusion
proof contract, remain open.

<a id="oq-11-38s3se"></a>

## OQ-11-38S3SE — Channel-balance invariant definition

The aggregate channel-balance invariant (claimed in-channel value is backed by deposits minus
withdrawals under the application's balance algebra) protects late joiners syncing from a
snapshot against undercollateralized colluding states. Unresolved: the precise invariant per
supported balance model (integer, composite, non-fungible), its snapshot proof inputs, exactly
when it is checked, and how it treats joins, deposits, withdrawals, and exits.
Where it is enforced today is itself a gap — see [`OQ-19-Y8FDQX` (Channel-balance invariant enforcement points)](../implementation/open-questions.md#oq-19-y8fdqx).

<a id="oq-12-b45q7n"></a>

## OQ-12-B45Q7N — Book-like overview vs. tree as authoritative reference

How to retain a book-like, top-to-bottom onboarding overview while keeping the documentation tree
as the maintainable authority. **Current resolution:** the root [README.md](../README.md) is the
onboarding overview; the tree is the authoritative reference; both must stay consistent (see
[governance.md](../governance.md) §5). Revisit only if the two drift in practice.

<a id="oq-16-6avf5b"></a>

## OQ-16-6AVF5B — Slash-set lifetime across parallel windows

`_clearDisputeData` deletes the on-chain slash set when channel storage is cleared, and a code
`TODO!` questions this: a slash consumed by one fork's reduction could be needed by a parallel
window. Define the slash set's ownership and lifetime rules. See
[protocol/fraud-proofs.md](./disputes/fraud-proofs.md) §6.

<a id="oq-18-2nk97t"></a>

## OQ-18-2NK97T — Exit-recording asymmetry between slash and remove

**Resolved and implemented (2026-09-07):** both external wrappers record one exit through `_addExitChannel` when their hook succeeds. The hooks retain their own balance semantics. The dispute consumer uses returned exits and does not consume the machine buffer; the next SDK state transition clears that buffer before executing. Absent and repeated targets add no exit. See [`REQ-SM-8-8CHSQ8`](protocol-model/state-machines.md#req-sm-8-8chsq8) and [`REQ-SM-10-JD8TSF`](protocol-model/state-machines.md#req-sm-10-jd8tsf).

<a id="oq-20-z9361v"></a>

## OQ-20-Z9361V — Outbound stream generality and failure behavior

`_processCustomOutboundMessage` unconditionally reverts and its override point sits on
`StateChannelCommon`, which integrators do not extend, so the outbound stream is not yet
general-purpose (inbound has a proper hook on `AStateMachine`). A failing consumer `withdraw`
reverts the entire snapshot advance, wedging the stream. Residual funds on channel close are a
live `TODO` (treasury). Define the custom-outbound registration point, per-message failure
isolation, and the close-out path. See
[protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md) §1–2, §5.

The failure-isolation decision is really _atomic range vs.
commit-a-prefix_ — prefix processing lowers retry cost but needs exact next-height semantics and
per-message consumer-failure classification (including reentrancy, duplicate calls, and a
consumer that succeeds then returns malformed data). The close-out decision should cover the full
empty-channel terminal rule: remaining balance destination, pending inbound value, unresolved
outbound value, slash proceeds, dispute-data retention, and who may submit final cleanup.

<a id="oq-26-xh59sp"></a>

## OQ-26-XH59SP — On-chain wrong-turn enforceability

**Decided (2026-08-10):** turn authorization is a protocol-layer responsibility, enforced
generically for all state machines — the SDK validation pipeline rejects a wrong-author block
before it reaches `stateTransition`, and in-contract turn checks are optional defense in depth
([`REQ-SM-6-BJZVQ5`](protocol-model/state-machines.md#req-sm-6-bjzvq5)).

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

<a id="oq-27-gt4w09"></a>

## OQ-27-GT4W09 — Reducer eligibility is disabled

`reduceAndFinalize` has its `canParticipateInDisputes(channelId, msg.sender)` check commented
out, while dispute upload and `challengeDisputeReduction` enforce it — so today anyone can
reduce, but only eligible participants can upload or challenge. Decide who may reduce: anyone
(permissionless, with anti-spam), a deterministic eligible participant first with permissionless
fallback, or a threshold-signed fast path with fallback. Then make every entry point consistent.
See [protocol/disputes.md](./disputes/disputes.md) §5.

<a id="oq-28-rp46pw"></a>

## OQ-28-RP46PW — Equal-height reduction tie-break

When two valid dispute candidates carry the same `transactionCnt`, `reduce()` picks the one with
the numerically smaller block hash. The rule is deterministic and cheap but has never been
engineer-approved, and it gives a block author a hash-grinding surface: transaction encoding can
be varied to win same-height ties. Alternatives: prefer stronger confirmation evidence, or treat
same-height distinct valid candidates as slashable equivocation. Decision criteria: no benefit
from grinding, compatibility with virtual votes and membership changes, bounded gas, and a clear
fraud target. See [protocol/disputes.md](./disputes/disputes.md) §5.

<a id="oq-29-efy4nf"></a>

## OQ-29-EFY4NF — Signature domain separation

Every protocol signature (blocks, transactions, joins, opens, disputes) is a plain
EIP-191 `signMessage(keccak256(abi.encode(struct)))` — no EIP-712 domain, no chainId, no
verifying-contract address, no protocol version, no object-type tag beyond the struct shape. And
`OpenChannel.channelId` is caller-chosen. Consequence: signatures are replayable across manager
deployments and across chains that host the same channelId. Decide the signed-domain policy
(bind protocol version, chain, manager deployment, object type; keep on-chain verification
affordable) and the migration plan for proofs signed under the old scheme. Feeds the
completeness review ([`OQ-5-4Q38M5` (Fraud-proof completeness security review)](../audit/open-questions.md#oq-5-4q38m5)). See
security/open-security-review.md.

<a id="oq-32-5ndd24"></a>

## OQ-32-5NDD24 — Proof and audit size bounds

No admission policy for milestone length or proof-walk gas has been selected. The pointed-step
counter avoids re-walking earlier milestones, but binding, copying and hashing the supplied data
still grows with proof size. These are separate limits: a short walk does not imply a constant
cost challenge, and a transport frame cap does not establish safe chain gas. Bounds need
measurements on the target chain and client. See [state proofs](./disputes/state-proofs.md) and
[data availability](./security/data-availability.md).

<a id="oq-33-1n5by1"></a>

## OQ-33-1N5BY1 — Maximum participant count is not enforced

The contracts enforce a minimum of two participants but no maximum; unbounded sets grow the
O(n²) duplicate/threshold loops and dispute/proof gas without bound. The design target is small
partitions (about six, at most roughly ten). Decide the benchmark-backed hard limit and enforce
it in `open`/`join` (and RPC) rather than degrading without bound. See
[security/trust-model.md](./security/trust-model.md) (topology).

<a id="oq-34-fy08v2"></a>

## OQ-34-FY08V2 — RPC boundary decisions

Grouped decisions surfaced while specifying the peer-RPC model
([peer-communication/rpc.md](./peer-communication/rpc.md)); each is marked in place in that document:

- **Deferred retry of request-style calls.** A guard failure that defers the call for replay after
  authentication still sends its declared rejection to a request-style caller at once, so the caller
  settles that correlation identity on the early rejection and the replayed copy's second response is
  ignored as unmatched ([`REQ-RPC-2-SZDTTM` (Request lifecycle)](peer-communication/rpc.md#req-rpc-2-szdttm)). Deferral
  therefore only benefits one-way calls. Decide whether request-style calls are held without an early
  rejection or never deferred. A second wrinkle: on a transport that is not negotiating, the failure
  handler closes the transport before the rejection is attempted on it.
- **Handshake channel binding.** Tracked in [`OQ-35-E5RRDF`](../implementation/open-questions.md#oq-35-e5rrdf).
- **Protocol versioning.** No version negotiation or compatibility scheme exists anywhere in the
  RPC layer (only the `peer3:init-handshake:v1` domain tag). Couples to [`OQ-29-EFY4NF`](open-questions.md#oq-29-efy4nf) (signature
  domains): one versioning decision should cover both.
- **Ban durability across reconnects.** Every live transport has an unauthenticated profile, so a
  pre-handshake verdict can ban its live Holepunch handle. Decide whether that ban must survive a
  new SDK peer handle or process restart before the EVM identity is authenticated.
- **Failure-outcome policy consistency.** _Resolved 2026-09-16._ Endpoint outcomes were per-service
  accidents: join-signature validation failures are penalty-free request errors (free probing), while
  spectate failures blacklist permanently ([`DEF-5-E8TP9N`](../audit/open-findings.md#def-5-e8tp9n));
  WebRTC signaling failures are silently ignored. The policy is now stated once as a four-outcome
  ladder that no close inherits from another caller — close with reconnect allowed; a counted close
  that spends one of the peer's bounded retries for the session; suspension for the session without a
  verdict, applied by the counted close that reaches the bound; and close and exclude with a persisted
  verdict — and only an attributable fault by the peer takes the last
  ([`REQ-RPC-6-E60S4J` (Ordered ingress verification)](peer-communication/rpc.md#req-rpc-6-e60s4j),
  [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](peer-communication/handshake.md#req-auth-4-jwcf71)).
  Silence, timeouts, clock differences, a burned lobby or negotiation window, a sync request that
  fails, and a refused or silent dispute acknowledgement are counted closes; a name this deployment
  does not have ([`REQ-RPC-8-44XECF` (Compatibility before protected calls)](peer-communication/rpc.md#req-rpc-8-44xecf)),
  a peer's polite abort, and failures that may be local keep reconnect allowed with no count
  ([`REQ-LOBBY-7-BXQ1QA` (Symmetric timeout consequence)](peer-communication/lobby-matching.md#req-lobby-7-bxq1qa),
  [`REQ-NEG-4-ZQ0985` (Committed-attempt admission and recovery)](peer-communication/channel-negotiation.md#req-neg-4-zq0985)). The counter is
  one per peer for the session, keyed by the transport key before proof and the identity after, so a
  first contact that keeps failing is refused by its key. The verdict is persisted as identity and
  reason. The rejected alternative was a lobby-session do-not-rematch set beside the ladder: it added
  bookkeeping with no distinct observable behavior once the counted close exists.
  _Rationale:_ conflating unavailability with misbehavior punishes honest peers, which the security
  review forbids as a general principle; the bound keeps a peer that never succeeds from looping
  forever. _Decided 2026-09-17:_ the sync-timeout and dispute-acknowledgment silence paths retained on
  2026-09-07 ([`DEF-5-E8TP9N`](../audit/open-findings.md#def-5-e8tp9n)) now take the counted close too.

<a id="oq-spec-lobby-1-d65ytt"></a>

## OQ-SPEC-LOBBY-1-D65YTT — Deferred-admission queue bound

The two-agreement-window admission grace permits authenticated requests to wait while local service
readiness catches up. The current protocol does not define a per-transport queue cap or the exact
overflow result. A later hardening decision must choose a small bound, decide whether overflow is a
request rejection, transport disconnect, or identity exclusion, and state how already queued requests
settle. Until then, implementations must preserve the bounded wait duration and must not claim a bounded
message count for pre-readiness traffic.

<a id="oq-38-ey27t5"></a>

## OQ-38-EY27T5 — Runtime budgets, scheduling determinism, and test isolation

Follow-ons to the 2026-08-10 runtime decisions ([`REQ-RUN-13-27YE2T` (Isolated placement is the default)](runtime/execution.md#req-run-13-27ye2t)/14/15):

- **Memory budget under the phone envelope (blocks [`REQ-RUN-13-27YE2T` (Isolated placement is the default)](runtime/execution.md#req-run-13-27ye2t)).** Default-on workers put three
  execution contexts per peer on a device with a few hundred MB of usable heap. _Resolved
  2026-08-10:_ placement does not vary by device — no profile branching; the envelope is a hard
  budget the implementation must meet. _Still open:_ the concrete per-context budget, the
  aggregate per-peer ceiling, the reduced per-worker cap (1024 MB is CI containment and too high),
  and the measurement showing three contexts fit. Until these exist the default-flip is blocked.
- **Worker capability detection.** Flipping the defaults requires detecting runtimes that deny
  workers and falling back inline; the mechanism and its failure behavior are undesigned. This is
  a fallback path, not a device profile.
- **Throughput/latency targets.** None exist, so [`REQ-RUN-14-YAHYR4` (Mid-range mobile browser envelope)](runtime/execution.md#req-run-14-yahyr4) is a memory envelope only and the
  measurement §44 requires cannot be defined. Decide block-confirmation round-trip, dispute-path
  latency, and sustained rate at six participants.
- **Default-flip prerequisites.** Whether flipping the worker defaults requires runtime
  feature-detection with automatic inline fallback (browsers that deny workers).
- **Cross-kind message ordering.** A paired channel delivers in send order and the event and error
  streams rely on it ([`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](runtime/execution.md#req-runtime-2-kbxktg)), but no
  rule states the relative order between a request's settlement and the events or host errors emitted
  around it on the same channel. Decide whether that order is guaranteed.
- **Equivalence oracle scope.** Whether event _ordering_ must match exactly or only the emitted
  multiset ([`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](runtime/execution.md#inv-runtime-1-akrhak) currently says same events).
- **Test scheduling and isolation.** No cross-peer deterministic scheduler exists — coordination is
  polling plus event barriers and cooperative hold/release stubs; and the default is one shared
  chain and discovery registry per machine, with concurrent tests separated only by account-range
  slots and a stamped channel id. Decide whether to commit to a determinism mechanism and whether
  the isolation guarantee should be one chain per test process.

<a id="oq-39-c3eamn"></a>

## OQ-39-C3EAMN — Reduce: stateful (chain-reading) or stateless (commitment-only)

**Question.** Should dispute reduction read the channel's on-chain state during execution, or
statelessly fold only the committed dispute inputs? `For this protocol version:` the fold is
stateful in exactly two fields ([disputes.md §5](./disputes/disputes.md#5-reduction-rules-and-order-independence)):
`slashedParticipants` unions in the channel's authoritative on-chain slash set (filtered to
entries with timestamp ≤ window expiry and to the participant union), and
`latestInboundMessageBlockHash/Height` is taken from the chain's inbound stream walked back to
window expiry. Everything else reduces the committed dispute set alone. Reading and verifying the
included commitments is required under either answer (`areDisputesCommitted` one-to-one matching);
the question is only whether chain state beyond those commitments feeds the fold.

- **Stateless direction.** A pure fold over verified committed inputs is reproducible from the
  committed data alone (no chain view at a particular height or time), simplifies the
  order-independence and convergence analysis ([`INV-DIS-5-J1QZ92`](disputes/disputes.md#inv-dis-5-j1qz92)), keeps the off-chain
  reducer and the on-chain apply path trivially in agreement, and fits the optimistic-reduction
  direction where challengers must cheaply re-derive the result (couples to the dormant
  `challengeDisputeReduction` question, [`OQ-40-M12S72`](open-questions.md#oq-40-m12s72)). But both stateful
  reads exist for omission resistance: chain injection of the slash set is what makes per-dispute
  subset listing safe, and the chain-read inbound tip is what makes forced inbound inclusion
  effective. A stateless reduce must re-establish both guarantees explicitly — for example,
  require disputes to commit the slash set and inbound tip and enforce completeness at
  upload/commit time instead of at reduce time.
- **Stateful direction.** Keeps the chain as the authority no disputer can omit, but ties the
  reduce result to chain-read timing (the window-expiry filters), requires an equivalent chain
  view for every off-chain recomputation and audit, and widens the surface where the off-chain
  and on-chain reducers can diverge.

**Decision needed.** Choose the model. If stateless: specify where slash-set completeness and
forced inbound inclusion are enforced instead. If stateful: specify the exact chain reads —
source, expiry filtering, and the chain view an off-chain recomputation requires — as normative
inputs of the reduction.

<a id="oq-40-m12s72"></a>

## OQ-40-M12S72 — `challengeDisputeReduction`: dormant scaffolding or dead code

**Question.** `For this protocol version:` every reduction commit path passes
`reductionTimestamp = now − evidenceTime`, so the reduce-challenge period is already expired at
commit time and finalization is immediate — the reduction is recomputed on-chain from the
committed set, so the result is objectively correct at commit. Consequently
`challengeDisputeReduction` (which requires a _non-expired_ challenge period, and on a successful
challenge slashes the previous reducer and re-commits, or slashes the challenger on a failed one)
is unreachable from any current commit path ([disputes.md §4.3](./disputes/disputes.md#43-reduction-and-finalization)). Decide whether it is
intentionally dormant scaffolding for the optimistic-reduction design or dead code to remove.

`Intended:` under the optimistic design the reduced result would be committed as a bare hash with
a real challenge period; the current immediate-finalization behavior would become the fast path.

**Couplings.** The optimistic direction interacts with [`OQ-39-C3EAMN`](open-questions.md#oq-39-c3eamn) (a stateless reduce is
cheaper for challengers to re-derive) and with [`OQ-27-GT4W09`](open-questions.md#oq-27-gt4w09) (reducer eligibility is
enforced in `challengeDisputeReduction` but disabled in `reduceAndFinalize`). If dead code:
remove the function and the challenge-period machinery it implies. If scaffolding: keep it
non-normative until the optimistic design is specified, and state explicitly that no current
commit path can be challenged.

<a id="oq-43-hwrtnf"></a>

## OQ-43-HWRTNF — Delegated contest authorization

The version-one watchtower ([`REQ-TRUST-4-KW24NF`](security/trust-model.md#req-trust-4-kw24nf))
needs its contest authorization decided. Opening a dispute and contesting a timeout require
`msg.sender == disputer` plus dispute eligibility, i.e. the participant's own funds-controlling
key; a keyless watchtower is limited to submitting dispute fraud proofs
(`applyDisputeFraudProofs` accepts valid proofs from any sender). Until decided, full offline
protection needs a node holding the participant's own key.

Alternatives: (a) contest-only delegate keys registered on-chain per participant, allowed to
submit disputes/contests but not withdrawals; (b) make additional contest paths permissionless
where safe, shrinking what a delegate needs authority for; (c) accept the replica-node requirement
and document it as the operating model. Blocking effect: the watchtower requirement
([`REQ-TRUST-4-KW24NF`](security/trust-model.md#req-trust-4-kw24nf)) and any offline-participant
product claim stay conditional until decided. Requested decision: which direction, and whether it
lands before or after version one.

`Engineer direction (recorded, still open):` a watchtower does not need authority to _commit_ to a
dispute — it only needs to kill invalid ones. A channel where no valid dispute is ever opened is an
acceptable outcome as long as no invalid dispute survives: the absent participant, once back
online, can open the valid dispute itself and settle and exit provided nobody timed it out
meanwhile. That points at alternative (b) — permissionless kill paths — rather than delegate keys.
The question stays open until watchtowers are designed; the supporting game theory is specified
then, not now.

<a id="oq-44-3y5md7"></a>

## OQ-44-3Y5MD7 — Watchtower deployment shape

The version-one watchtower ([`REQ-TRUST-4-KW24NF`](security/trust-model.md#req-trust-4-kw24nf))
has its sub-assumptions specified but not its concrete shape. The direction under consideration is
a watchtower that runs as an ordinary peer with spectator-equivalent access — one more peer status
and validation strategy — indistinguishable from a spectator to the other participants, so anyone
can run one permissionlessly and the same mechanism also serves recovery.

Alternatives: (a) the spectator-equivalent peer above; (b) a distinct delegate role with its own
peer status, authorization, and data-access rules; (c) no protocol-level shape at all — a
participant runs a second node holding its own key. Deciding this fixes what the delegate learns
(the Privacy sub-assumption) and how it obtains block history and evidence (the Data availability
sub-assumption), and it interacts with [`OQ-43-HWRTNF`](open-questions.md#oq-43-hwrtnf): a
spectator-equivalent peer is keyless, so it depends on kill paths being permissionless. Requested
decision: which shape version one targets, and whether the watchtower peer status is specified
alongside the spectator status or after it.

<a id="oq-45-aczcde"></a>

## OQ-45-ACZCDE — Subjective post-authentication engagement policy

The handshake establishes objective facts only — proven key control and clock compatibility — and
at the current baseline every completed peer proceeds to continued interaction
([`REQ-AUTH-7-VJFSD5`](peer-communication/handshake.md#req-auth-7-vjfsd5),
[`INV-AUTH-3-0QP5E9` (Objective facts only)](peer-communication/handshake.md#inv-auth-3-0qp5e9)). No specification yet
defines how a node forms a local, subjective opinion about whether to keep interacting with a
proven identity. Such an opinion may differ between nodes, must not erase or contradict the
objective authentication facts, and must remain separate from channel participation
([`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](peer-communication/synchronization.md#req-auth-5-bqg9ag)).

The future owning specification must define: admissible evidence inputs; decision outcomes and
their effect on later interaction; default behavior and policy-unavailable or policy-error
behavior; reevaluation triggers and outcome changes; persistence across reconnects or process
restarts; and the relationship between rejection, connection termination, and identity exclusion.
Candidate scenarios (non-normative, not accepted oracles): one node accepts and another rejects the
same proven identity without contradiction; a node ends later interaction without erasing the proof
result; the policy is unavailable or errors and the node must choose between continued interaction,
temporary refusal, and termination; new evidence arrives after an earlier decision and the opinion
is reevaluated. Requested decision: whether and when to specify this policy, and its default until
then (the current default is the no-opinion baseline).

<a id="oq-spec-open-1-12rh7a"></a>

## OQ-SPEC-OPEN-1-12RH7A — On-chain enforcement of the opening deadline

The opening terms carry a deadline (`OpenChannel.deadlineTimestamp`). Negotiation treats an opening
as failed when that deadline expires
([channel-negotiation.md](./peer-communication/channel-negotiation.md)). No requirement states
whether the base-layer open operation must reject terms whose deadline has passed. The open entry
point in [admission-and-funds.md](./enforcement/admission-and-funds.md) and the opening phase in
[lifecycle.md](./settlement/lifecycle.md) list no deadline check. Join and top-up do state the
rule ([`REQ-ENFADM-1-V926CA` (Self-submission with pinned state)](enforcement/admission-and-funds.md#req-enfadm-1-v926ca)).

Requested engineer decision: must open reject opening terms after their deadline?

- **Reject on-chain.** Open MUST fail when chain time is past the deadline, the same rule as join.
  A signature on opening terms then stops authorizing a channel when its window ends.
- **Leave it to the integrator.** The deadline stays an off-chain negotiation bound, and the
  integrator's deposit adapter may enforce it. A counterparty that kept the signatures can then
  open the channel at any later time, after the other side abandoned the attempt.

Blocking effect: the two answers give a different observable result for a late open, and the
question is security-relevant because it decides how long an opening signature authorizes a
channel. Until the decision, no requirement owns this behavior, so no planned test covers open
before, at, and after the deadline. The chosen rule needs a requirement and permutations in
[admission-and-funds.md](./enforcement/admission-and-funds.md), plus matching updates in the
implementation, verification, and audit layers.

**Resolved (2026-10-04, engineer decision):** reject on-chain. Open MUST fail when chain time is past
the opening deadline, with the same boundary as join: the terms are valid up to and including the
deadline. The check runs before any deposit or channel state change. The rule is normative in
[`REQ-ENFADM-4-2NN96F` (Opening terms expire at their deadline)](enforcement/admission-and-funds.md#req-enfadm-4-2nn96f), with planned permutations for open
before, at, and after the deadline and for retained signatures submitted after SDK expiry. The
opening phase in [lifecycle.md](./settlement/lifecycle.md) and the negotiation flow in
[channel-negotiation.md](./peer-communication/channel-negotiation.md) link it. Rejected alternative:
leave the deadline to the integrator, which kept a retained opening signature valid indefinitely.
Consequence: once chain time is past the deadline, retained signatures cannot open the channel for any
integrator. The SDK's own expiry observation runs `agreementTime` after the deadline on its chain-synced
clock, not on chain time, so a negotiation the SDK treats as expired cannot open the channel as long as
chain time does not trail that clock by more than `agreementTime`.

<a id="oq-spec-open-2-yqtttb"></a>

## OQ-SPEC-OPEN-2-YQTTTB — Minimum remaining window for an opening proposal

Open rejects terms past their deadline
([`REQ-ENFADM-4-2NN96F` (Opening terms expire at their deadline)](enforcement/admission-and-funds.md#req-enfadm-4-2nn96f)).
The higher peer accepted any proposed deadline after its current time and up to 120 seconds later.
A lower peer could therefore propose a deadline one or two seconds ahead. The higher peer then signs,
submits, and pays for an `open` that reverts as expired, and the failed receipt is not the proposer's
fault, so the proposer takes no strike and can repeat it.

Requested engineer decision: must the higher peer refuse a deadline that leaves less than a minimum
window, and is a too-close deadline an invalid deadline or a no-strike decline?

**Resolved (2026-10-05, engineer decision):** reject it as an invalid deadline. The higher peer rejects
a proposal whose deadline is less than 30 seconds after its current time, half of the 60-second window
an honest proposer uses. Exactly 30 seconds is accepted. The rejection is the existing invalid-deadline
outcome in [channel-negotiation.md](./peer-communication/channel-negotiation.md): exclude the proposer
before anything is signed or submitted. The rule is covered by
[`INV-NEG-1-6FW90P.T1.P11`](peer-communication/channel-negotiation.md#inv-neg-1-6fw90p.t1.p11). Rejected
alternatives: skip submission below the minimum as a no-strike decline, which saves gas but lets the
proposer waste matches without limit; and accepting and documenting the risk.

<a id="oq-spec-spectator-relay-1-v6f216"></a>

## OQ-SPEC-SPECTATOR-RELAY-1-V6F216 — Future spectator relaying

Open future design; non-blocking for the current no-relay policy ([`REQ-GOSSIP-3-HQZNQX` (Re-broadcast on growth)](peer-communication/block-gossip.md#req-gossip-3-hqznqx)).

Decide whether spectators may relay unsolicited confirmations. Relaying could improve connectivity,
but transport attribution currently makes the forwarder accountable and eligible source identities
bound retention. A future design must specify how a spectator earns a bounded source allowance,
who is punished for junk it forwards, how identity rotation is bounded, and how peers distinguish
relay authorization from author/signature membership. Keeping participant-only relaying is the
settled present behavior. A role claim or valid proof alone must not silently grant relay authority.

<a id="oq-spec-sp-recovery-1-n85p7t"></a>

## OQ-SPEC-SP-RECOVERY-1-N85P7T — Loss of the only higher-state commitment after evidence closes

A higher-state commitment can be killed after admission has closed while a lower valid commitment survives.
The peer may already have concluded that its own evidence adds nothing because its computed reduction agrees
with the higher claim. A later kill can remove that earlier prefix without creating a duplicate-upload right.
The surviving lower commitment can therefore determine reduction. Rechecking alone does not reopen admission.

Owner: [dispute processing](disputes/dispute-processing.md), particularly the more-evidence and replacement
rules. Alternatives for the engineer to choose are changing evidence retention/admission or accepting the
remaining lower-state result; neither is selected. This blocks a recovery guarantee for this scenario,
not the selected best-effort implementation. Requested decision: how, if at all, must a peer preserve or
resubmit the higher state after admission closes? The scenario remains deferred.

<a id="oq-spec-sp-late-1-t4j935"></a>

## OQ-SPEC-SP-LATE-1-T4J935 — Recovery after a late challenge fails

Audit still runs best-effort after the kill window expires. A known-expired kill preflight sends nothing;
a sent late kill that fails propagates a fatal error. Owner: [dispute processing](disputes/dispute-processing.md)
and [fraud proofs](disputes/fraud-proofs.md). The engineer must choose whether to retain the fatal stop or define
a recovery procedure, including replacement evidence. No retry or recovery is implied. This blocks a future
recovery guarantee; it does not block documentation of the selected fatal-failure behavior.

<a id="oq-spec-sync-stale-1-cjtj6s"></a>

## OQ-SPEC-SYNC-STALE-1-CJTJ6S — Too-old sync and fork-adoption blacklist policy

Current sync rejects and blacklists a responder whose proof endpoint is below local finality, even if the peer is honestly stale or restarted. A supplied earlier start reaching the local final point is acceptable. Whether to soften the too-old policy remains open. An honest response can also race fork adoption and be blacklisted; the adoption-time policy is not selected.

Owner: [synchronization](peer-communication/synchronization.md), its requester-anchored validation and failure
rules. Alternatives are retaining current exclusion or defining a distinct stale/racing-response outcome with
specified retry and attribution rules. Requested engineer decision: whether either honest stale case should
avoid blacklisting, and under what evidence. This blocks a softer policy, not the current rejection behavior.

<a id="oq-spec-clock-1-z8tbfe"></a>

## OQ-SPEC-CLOCK-1-Z8TBFE — Keeping runtime clocks in agreement over a session

Each runtime takes its offset to the chain head timestamp once per session and never again
([time](protocol-model/time.md) §2). When chain time drifts from wall time during a session,
runtimes that took their offsets at different moments hold different estimates of chain time.
Once two runtimes differ by more than `agreementTime`, the handshake time check rejects every
request between them, and subjective block validation refuses valid blocks for lack of time, so a
late runtime cannot reach the others and a pending joiner can drop a valid block.

Owner: [time](protocol-model/time.md), the estimated chain time and its skew bound
([`REQ-TIME-2-VG94S7`](protocol-model/time.md#req-time-2-vg94s7)). Alternatives: periodic or
event-driven re-sync of every runtime's offset (cadence, and how a jump interacts with timers already
armed); a process- or node-level offset taken once and shared by every runtime of that process; or an
explicit maximum skew that honest runtimes must hold, with the windows sized from it. Requested
engineer decision: which clock model the protocol requires. Until then, the guarantee holds only
while chain time tracks wall time within `agreementTime` for the whole session.

<a id="oq-spec-evidence-race-1-tknwbj"></a>

## OQ-SPEC-EVIDENCE-RACE-1-TKNWBJ — Interpreting a lost evidence race

Raised 2026-10-08. A kill-and-dispute (or fraud proofs and a dispute) goes out in one transaction
whose upload is best effort: the kill lands even when the upload is refused. An upload refused
because the evidence period already expired lost the race to another participant's evidence. For now
that refusal is a no-op, with or without a kill in front of it
([dispute processing](disputes/dispute-processing.md), [`REQ-DISPUTE-PIPE-6-6FZB9M` (Minimal intervention and convergence)](disputes/dispute-processing.md#req-dispute-pipe-6-6fzb9m)).

A leaver's self-removal upload can lose the same race;
[`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) requires it
to wait for the committed window's reduction, which removes the leaver or restarts the exit on the successor fork
(engineer decision 2026-10-10).

Owner: [dispute processing](disputes/dispute-processing.md), the kill-and-dispute and replacement rules.
Requested engineer decision: whether the node should do more after a lost race. Examples: rebuild
and upload when a kill emptied the window after the evidence end, check that the committed evidence
covers its own, or record a metric for lost races. Until the decision, the no-op stands and no
recovery is implied. This blocks a recovery guarantee for a lost race, not the selected no-op.

<a id="oq-spec-topup-1-g3d2mf"></a>

## OQ-SPEC-TOPUP-1-G3D2MF — Snapshot pin and countersignatures for a top-up

Raised 2026-10-11. A top-up uses the same confirmation as a first join: the threshold set countersigns it,
and it is pinned to the channel's on-chain snapshot, so a snapshot move before the submission lands refuses
it and needs a fresh collection ([join authorization](peer-communication/join-authorization.md),
[`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)).
A top-up comes from a signer that is already a participant: no state can reach the chain without that
signer, so the pin protects nothing that the signer's own signatures do not already protect.

Owner: [join authorization](peer-communication/join-authorization.md), the confirmation and its pin.
Alternatives: (1) keep the pin for top-ups (current); (2) drop the snapshot-hash match on chain for a
top-up only; (3) also allow a top-up without countersignatures from the other participants. Alternative
(3) needs a bound on the inbound message queue, because unsigned top-ups could flood it. Requested
engineer decision: which alternative the protocol uses. Until then, a top-up keeps the pin and the
countersignatures. This blocks a cheaper top-up path, not the current behavior.

<a id="oq-spec-proofstore-1-sw4zgt"></a>

## OQ-SPEC-PROOFSTORE-1-SW4ZGT — Retention rule for pruning below the on-chain snapshot

Raised 2026-10-17. The first phase of the stored state proof prunes only below the mirrored chain
anchor, and only inside [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](storage/durability.md#req-stor-4-mf6ft6) as written ([`REQ-PROOFSTORE-8-XWEMTJ` (Pruning below the on-chain snapshot)](storage/proof-store.md#req-proofstore-8-xwemtj)). That
requirement names conditions — the windows expired, the on-chain snapshot past the data, no
accepted synchronization or watchtower duty — but no concrete rule: which windows count, what pins
data, when the check runs, and what must be stored first. Below the anchor, stale claims meet the
anchor itself (`DisputeStateProofBelowOnChainAnchor`, `TimeoutSupersededByFinalState`). Block
fraud proofs have no window, so pruning gives up those whose evidence lay only in pruned blocks,
for example an old double sign. A timeout claim against a fully signed block needs that exact
block for `TimeoutThreshold` unless the anchor already supersedes the claim.

Readers still reach below the anchor. Every synchronization payload carries the fork genesis
snapshot, its encoded state, and the outbound message-block range from the on-chain tip to the fork
genesis, so the first phase keeps them. The participant union of the anchor block reads the snapshot
of the block below it ([`REQ-SNAPSTORE-2-Q7E6TQ` (Derived reads fail explicitly)](storage/snapshots-and-states.md#req-snapstore-2-q7e6tq)). When the anchor block removes a member,
pruning the block below it leaves that union with the anchor's own set. A late valid confirmation
of the anchor block by the removed member then reads as a signature from outside the union, which
the live pipeline strips while disconnecting its suppliers. [`INV-PROOFSTORE-2-NT5FD6` (Absence is never evidence)](storage/proof-store.md#inv-proofstore-2-nt5fd6) forbids
that punishment; what happens to the signature is open.

Owner: [state proof store](storage/proof-store.md). Affected: [durability](storage/durability.md),
[snapshot and state stores](storage/snapshots-and-states.md),
[fraud proofs](disputes/fraud-proofs.md), the watchtower data needs of [`OQ-44-3Y5MD7`](open-questions.md#oq-44-3y5md7), and the
evidence retention of [`OQ-SPEC-SP-RECOVERY-1-N85P7T`](open-questions.md#oq-spec-sp-recovery-1-n85p7t). Alternatives for the rule: (1) a retention floor at the
finalized on-chain snapshot height; prune only after the dispute window is closed; store the
snapshot durably before pruning; prune only below a watermark equal to the lower of the snapshot
height and the lowest height that the node's own signatures still reference; (2) prune at each
anchor advance once no dispute, kill, challenge, or contest window is open on the fork and no
accepted synchronization or watchtower duty pins the range; (3) prune only after a configured
margin, either a delay or a number of later anchor advances; (4) prune nothing below the anchor
until the stored proof survives restart ([`OQ-SPEC-PROOFSTORE-9-53J8GE`](open-questions.md#oq-spec-proofstore-9-53j8ge)). Alternatives for the anchor
block's union, which combine with any rule: (a) keep the snapshot of the block below the anchor
block while the anchor block is held; (b) keep the anchor block's participant union with the stored
proof; (c) merge no late confirmation into a block at or below the anchor; (d) drop such a
signature as unverifiable input, without punishment. Alternatives for the blocks of a run that
re-rooting drops from the stored proof ([`REQ-PROOFSTORE-6-38G1KC` (Re-rooting on anchor advance)](storage/proof-store.md#req-proofstore-6-38g1kc)), including support that only the
stored proof held, such as a block that conflicts with the adopted block at the anchor height and
is evidence of a double sign by its author, which also combine with any rule: (e) keep all of them
under the chosen rule, like block history below the anchor; (f) keep only the blocks that conflict
with an adopted block under the chosen rule, and let the rest go at the next prune. Requested
engineer decision: the rule, its pins, how the anchor block's union survives pruning, and how long
the blocks of a dropped run stay. This blocks first-phase pruning, not the
stored proof itself.

<a id="oq-spec-proofstore-2-v4n7vh"></a>

## OQ-SPEC-PROOFSTORE-2-V4N7VH — Pruning above the anchor and lost exact-height checks

Raised 2026-10-17. The second phase prunes ordinary blocks above the chain anchor that no milestone
run of the stored proof needs ([`REQ-PROOFSTORE-9-CZTA0N` (Pruning between proven parts of the stored proof)](storage/proof-store.md#req-proofstore-9-czta0n)). With anchor 50, a kept run [60, 61],
and final point 75, blocks 62–74 lie between two proven runs and would go while the chain anchor is
still 50. Blocks 51–59 lie between the anchor and the first kept run; whether that range is a
prunable gap too is part of this question. [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](storage/durability.md#req-stor-4-mf6ft6) forbids both as written, because the
on-chain snapshot has not advanced past those blocks. Gaps also end the history contiguity that
[`REQ-BLKSTORE-3-S9V2KC` (Tip tracking and bounded traversal)](storage/blocks.md#req-blkstore-3-s9v2kc) and [`REQ-SNAPSTORE-2-Q7E6TQ` (Derived reads fail explicitly)](storage/snapshots-and-states.md#req-snapstore-2-q7e6tq) rely on; [`FIND-STORAGE-3-GYR34M`](../audit/open-findings.md#find-storage-3-gyr34m) keeps a
tripwire on that premise.

These checks read a block at an exact height and lose their input at a pruned height:

- the final-state conflict counter (`DisputeConflictsWithFinalState`) needs a verified final point
  at exactly the disputed block's height;
- the not-latest-state counter (`DisputeNotLatestState`) scans above the dispute height for the
  disputer's own newer signature;
- the timeout audit needs the exact block with direct full signatures (`TimeoutThreshold`) and the
  block before it with its on-chain timestamp;
- same-coordinate conflict and double-sign detection (`BlockDoubleSign`) need the stored block at
  that height;
- late signatures merge only into a stored block, so a pruned block gains no votes;
- invalid-transition fraud proofs, including those embedded in a dispute counter, need the
  predecessor block, its snapshot, and its full state;
- the participant union at a kept block reads the snapshot of the block below it, so pruning the
  block just below a kept run or the newest milestone, such as 59 below the hop at 60, judges a late
  confirmation from a member that block removes against the resulting set alone.

Owner: [state proof store](storage/proof-store.md) and [durability](storage/durability.md).
Affected: [block store](storage/blocks.md), [snapshot and state stores](storage/snapshots-and-states.md),
[fraud proofs](disputes/fraud-proofs.md), [dispute processing](disputes/dispute-processing.md)
([`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)), and [block processing](block-progression/block-processing.md)
([`REQ-BLOCK-PIPE-1-SS24D1` (Unified work item)](block-progression/block-processing.md#req-block-pipe-1-ss24d1), [`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](block-progression/block-processing.md#req-block-pipe-4-cf52j6)). Alternatives: (1) amend
[`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](storage/durability.md#req-stor-4-mf6ft6) to allow pruning between independently proven milestone runs of the stored proof once
no open window or accepted duty needs the block, and accept that each listed check is unavailable
at pruned heights, with the proof tiers and the chain deciding instead; (2) as (1), but keep a
compact record per pruned height (block hash, snapshot commitment, signer set) and name the checks
it keeps; (3) as (1), but keep every block that carries the node's own signature or that an open
window can still reference; (4) no pruning above the anchor, with growth bounded only by snapshot
updates ([`OQ-SPEC-PROOFSTORE-10-ETB3H1`](open-questions.md#oq-spec-proofstore-10-etb3h1)). Each of (1) to (3) also sets its lower boundary: (i) only gaps
between two proven runs, so 51–59 stays; (ii) also the range between the anchor and the first proven
run. Requested engineer decision: whether the second phase happens, the new wording of
[`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](storage/durability.md#req-stor-4-mf6ft6), whether the range above the anchor and below the first proven run is
prunable, and for each listed check whether it may be lost, must be kept, or changes form. This
blocks the second phase, not the first.

<a id="oq-spec-proofstore-3-f9hwyc"></a>

## OQ-SPEC-PROOFSTORE-3-F9HWYC — Which membership hops the stored proof keeps

Raised 2026-10-17. Construction keeps the required finalized membership changes after the anchor
([`REQ-SP-8-9ZCCEJ`](disputes/state-proofs.md#req-sp-8-9zccej)), and the stored proof keeps them as milestones ([`REQ-PROOFSTORE-3-QDXNH9` (Extension keeps earlier evidence)](storage/proof-store.md#req-proofstore-3-qdxnh9)). A
milestone is judged from the last final snapshot before it, and its threshold is the union of the
previous set, the resulting set, and the joiners consumed in its inbound interval
([`REQ-SP-3-SP1JG4`](disputes/state-proofs.md#req-sp-3-sp1jg4)). A later milestone can therefore be proved final without an earlier join's hop
when every member of that union signs it: if all six participants sign 75, [75] alone proves 75
final from anchor 50, with F in its union. It does not prove 60 final: nothing in that proof links
60 to 75, and its final point is 75. A proof that must end at 60, such as the final-state conflict
counter at that height, still needs the hop at 60, as does a proof ending between 60 and 75 whose
run lacks the union across the join
([`REQ-PROOFSTORE-4-ZFCWNB` (Construction above the stored prefix)](storage/proof-store.md#req-proofstore-4-zfcwnb)). A participant that left in between does not sign later blocks
in normal operation, so its departure needs its own hop. A join and exit in one transition leaves
the endpoint sets unchanged, so no change point records it ([`REQ-PSCSTORE-1-7BDTEV` (Complete ordered change points)](storage/participant-changes.md#req-pscstore-1-7bdtev)); the joiner still
belongs to the next hop's union through the consumed inbound interval.

Two choices are separate. Hop selection decides which hops extension appends. Removing a hop that
is already kept is a different change: [`REQ-PROOFSTORE-3-QDXNH9` (Extension keeps earlier evidence)](storage/proof-store.md#req-proofstore-3-qdxnh9) forbids it on a newer final point,
and admits replacement evidence only when it proves the same first block.

Owner: [state proof store](storage/proof-store.md). Affected: [state proofs](disputes/state-proofs.md),
[participant change points](storage/participant-changes.md), and proof size ([`OQ-32-5NDD24`](open-questions.md#oq-32-5ndd24)).
Alternatives for hop selection: (1) one kept milestone per recorded change point; (2) only the hops
that verification of the latest final point needs: extension does not append a hop that a later
final milestone found by the same extension covers, which depends on how extension runs
([`OQ-SPEC-PROOFSTORE-7-TJW3H8`](open-questions.md#oq-spec-proofstore-7-tjw3h8)); (3) as (1), and also record a join and exit in one transition as a change
point. A further alternative removes a kept hop once a later kept milestone covers its union; it
amends the retention rule of [`REQ-PROOFSTORE-3-QDXNH9` (Extension keeps earlier evidence)](storage/proof-store.md#req-proofstore-3-qdxnh9). Both (2) and removal give up proofs ending
exactly at the hop's height and at later heights whose runs lack the union across it. Requested
engineer decision: which hops the stored proof appends, whether a kept hop may ever be removed while
the anchor is below it, whether a join and exit in one transition is a hop point, and whether
change points stay the source of hops once the stored proof exists. This blocks hop selection in
the extension rule, not the form of the stored proof.

<a id="oq-spec-proofstore-4-dzsgjp"></a>

## OQ-SPEC-PROOFSTORE-4-DZSGJP — Merging a received or longer proof into the stored proof

Raised 2026-10-17. A node with a stored proof can receive, for the same fork: the same proof again;
a proof with a later final point; a proof from an earlier or a later anchor; different valid
evidence for a kept hop; support that differs from its own history at a height; and proofs verified
in dispute audit. The intent is to keep the longest observed proof, but no rule defines "longest"
for storage. Dispute reduction selects the longest valid proved history among submitted views
([`INV-SP-6-GNW74H`](disputes/state-proofs.md#inv-sp-6-gnw74h), [`INV-FIN-8-G6V1M1`](protocol-model/finality.md#inv-fin-8-g6v1m1)); that rule does not define how a stored proof changes.

Some of these inputs can raise the final point record above the active head, for example a proof
verified in dispute audit whose final point the node has not executed. Construction of the latest
proof searches only above the record
([`REQ-PROOFSTORE-4-ZFCWNB` (Construction above the stored prefix)](storage/proof-store.md#req-proofstore-4-zfcwnb)), so a read at a requested head below the record has no
defined result.

Owner: [state proof store](storage/proof-store.md) ([`REQ-PROOFSTORE-2-99RRXK` (Seeding from a verified proof)](storage/proof-store.md#req-proofstore-2-99rrxk)). Affected:
[state proofs](disputes/state-proofs.md) ([`REQ-SP-10-JMVHTB`](disputes/state-proofs.md#req-sp-10-jmvhtb)),
[synchronization](peer-communication/synchronization.md),
[dispute processing](disputes/dispute-processing.md), and the audit finding
[`FIND-PROOF-PERSISTENCE-1-HYC9DS`](../audit/open-findings.md#find-proof-persistence-1-hyc9ds), whose follow-up direction keeps retained evidence apart from
executed history. Alternatives, some of which combine: (1) keep the stored prefix and add only hops
and final points above it; (2) replace the stored proof with a received proof whose final point is
higher; (3) merge per hop, keeping for each hop evidence that alone proves it, either the shortest
run or the run with the most required signers; (4) keep proofs verified in dispute audit outside
the stored proof, as dispute evidence only. "Longest" can mean the highest final point, the highest
claimed state, or the most kept hops. For a record above the active head: (5) the record never
rises above the active head, and such evidence stays outside the stored proof until the head
reaches it; (6) the record may rise above it, and a read below the record returns a projection that
ends at or below the requested head; (7) the record may rise above it, and every read returns the
record's proof. Requested engineer decision: the merge rule, the meaning of "longest", where audit
proofs go, and whether the record may lie above the active head, with what a read below it returns.
This blocks seeding a node that already holds a stored proof, not the first seed.

<a id="oq-spec-proofstore-5-w48zr6"></a>

## OQ-SPEC-PROOFSTORE-5-W48ZR6 — Old-fork data after a fork change

Raised 2026-10-17. On a fork change the node discards the old fork's stored proof
([`REQ-PROOFSTORE-7-T0EBMX` (Reset on fork change)](storage/proof-store.md#req-proofstore-7-t0ebmx)). Other old-fork data still has readers. The synchronization responder
walks the dispute windows from the on-chain snapshot's fork to the target fork, and a pinned
old-fork request is answered through a verified successor ([`REQ-SYNC-1-T2589H` (Minimum-target proving)](peer-communication/synchronization.md#req-sync-1-t2589h)). Reducers and
challengers read windows until their challenge period ends ([`REQ-DVP-2-RG8QR3` (Reducer reads event-synchronized windows)](disputes/dispute-processing.md#req-dvp-2-rg8qr3),
[`REQ-DVP-3-CFFAW1` (Incorrect reductions are challenged in time)](disputes/dispute-processing.md#req-dvp-3-cffaw1)). Dead-fork handling uses acknowledgment records ([`REQ-DACK-3-J4Z33Y` (Knowledge-gated consequences)](peer-communication/dispute-acknowledgment.md#req-dack-3-j4z33y)). Old-fork
blocks can also be audit evidence.

Owner: [state proof store](storage/proof-store.md). Affected:
[synchronization](peer-communication/synchronization.md),
[dispute acknowledgment](peer-communication/dispute-acknowledgment.md),
[dispute processing](disputes/dispute-processing.md), and the implementation question
[`OQ-IMPL-ACK-PRUNE-1-VT05KB` (Pruning dispute-acknowledgment records)](../implementation/open-questions.md#oq-impl-ack-prune-1-vt05kb). Alternatives: (1) keep all old-fork data until the chain adopts a
snapshot on a successor fork; (2) keep only lineage records (each window's committed disputes and
reduction) and the evidence for open windows, and prune old-fork blocks once the fork's windows
close; (3) keep old-fork data for a fixed number of later fork changes or a fixed time. Requested
engineer decision: which old-fork records stay and which event ends them. This blocks old-fork
pruning, not the reset of the stored proof.

<a id="oq-spec-proofstore-6-x70ewk"></a>

## OQ-SPEC-PROOFSTORE-6-X70EWK — Full-state retention

Raised 2026-10-17. A node can hold the full application state of every committed block. Readers
need full states at specific points: the latest proved final point, for synchronization and for
[`REQ-SP-10-JMVHTB`](disputes/state-proofs.md#req-sp-10-jmvhtb); the replay base of a dispute audit; the auditing data at the last milestone's
first block of the node's own dispute; reduction input; and the predecessor state of an
invalid-transition fraud proof. Every alternative except (1) below removes full states above the
on-chain snapshot, so it also needs the [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](storage/durability.md#req-stor-4-mf6ft6) change of
[`OQ-SPEC-PROOFSTORE-2-V4N7VH`](open-questions.md#oq-spec-proofstore-2-v4n7vh).

Owner: [state proof store](storage/proof-store.md) ([`REQ-PROOFSTORE-8-XWEMTJ` (Pruning below the on-chain snapshot)](storage/proof-store.md#req-proofstore-8-xwemtj)). Affected:
[snapshot and state stores](storage/snapshots-and-states.md), [durability](storage/durability.md),
[fraud proofs](disputes/fraud-proofs.md), and [dispute processing](disputes/dispute-processing.md).
Alternatives: (1) keep the full state of every block; (2) keep it only at the final point, in the
tail, and at the first blocks of kept milestones; (3) keep it only at the final point and in the
tail, and recompute others by replay forward from an earlier kept state; (4) as (2) or (3), plus
the states that an open window pins. Replay in (3) needs every block and every inbound message
block between the kept state and the target. A later kept state is no replay base for an earlier
one, and a milestone proves finality, not the transitions it skips. Synchronization does not carry
history between kept runs, and second-phase pruning removes it
([`REQ-PROOFSTORE-9-CZTA0N` (Pruning between proven parts of the stored proof)](storage/proof-store.md#req-proofstore-9-czta0n)), so (3) also chooses one of: keep contiguous history wherever a
state may be recomputed, which excludes gap pruning there; fetch the missing history from another
source; or accept that states in those ranges are unavailable, with the outcome of
[`OQ-SPEC-PROOFSTORE-11-J7D4H1`](open-questions.md#oq-spec-proofstore-11-j7d4h1) for the dispute-audit replay base, reduction input, and invalid-transition fraud
proofs. Requested engineer decision: which full states the node keeps, and for (3), its replay
source. This blocks full-state pruning, not block pruning below the anchor.

<a id="oq-spec-proofstore-7-tjw3h8"></a>

## OQ-SPEC-PROOFSTORE-7-TJW3H8 — Extending the stored proof on demand or by vote tracking

Raised 2026-10-17. The stored proof grows when a membership hop or a later point becomes final
([`REQ-PROOFSTORE-3-QDXNH9` (Extension keeps earlier evidence)](storage/proof-store.md#req-proofstore-3-qdxnh9)). Finality counts direct and indirect votes ([`REQ-FIN-3-9P9J4Q`](protocol-model/finality.md#req-fin-3-9p9j4q))
against the hop's union ([`REQ-SP-3-SP1JG4`](disputes/state-proofs.md#req-sp-3-sp1jg4)). An on-demand build adds search work at read time and
leaves the stored proof behind between reads. Incremental tracking moves that work to commit time;
it must count indirect votes and consumed joiners, so a direct-only signal that one block carries
every signer is not enough.

Owner: [state proof store](storage/proof-store.md). Affected: [finality](protocol-model/finality.md)
and [block processing](block-progression/block-processing.md). Alternatives: (1) on demand: a build
that searches above the stored prefix finds newly final hops and appends them; (2) incremental:
each committed block and each merged signature updates the vote count of every open hop, and a hop
is appended when its union is complete; (3) incremental tracking, with the on-demand build as a
fallback. Requested engineer decision: when the stored proof is extended. This blocks the
extension trigger, not what is appended.

<a id="oq-spec-proofstore-8-qr7wwq"></a>

## OQ-SPEC-PROOFSTORE-8-QR7WWQ — Re-rooting and base-layer finality of the adoption

Raised 2026-10-17. The stored proof re-roots when the mirrored chain anchor advances
([`REQ-PROOFSTORE-6-38G1KC` (Re-rooting on anchor advance)](storage/proof-store.md#req-proofstore-6-38g1kc)), and below-anchor pruning follows the same anchor
([`REQ-PROOFSTORE-8-XWEMTJ` (Pruning below the on-chain snapshot)](storage/proof-store.md#req-proofstore-8-xwemtj)). If a base-layer reorganization removes an adoption after the node
re-rooted on it, the dropped prefix is gone and the stored proof starts at an anchor the chain no
longer holds. The system assumes a live, final base chain
([system assumptions](README.md#system-assumptions-and-constraints)), but no rule says when an
observed adoption counts as final for this purpose.

Owner: [state proof store](storage/proof-store.md). Affected: [local mirror](enforcement/local-mirror.md),
[snapshot adoption](enforcement/snapshot-adoption.md), and [`OQ-SPEC-PROOFSTORE-1-SW4ZGT`](open-questions.md#oq-spec-proofstore-1-sw4zgt).
Alternatives: (1) re-root on observation; (2) re-root only after the adoption reaches a
confirmation depth or base-layer finality; (3) re-root on observation, but keep the dropped prefix
and below-anchor data until the adoption is final. Requested engineer decision: when an adoption
may re-root the stored proof and allow pruning. This blocks the re-root trigger, not the re-root
rule.

<a id="oq-spec-proofstore-9-53j8ge"></a>

## OQ-SPEC-PROOFSTORE-9-53J8GE — Restart durability of the stored proof

Raised 2026-10-17. No rule says whether the stored proof belongs to the durable set
([`REQ-STOR-1-D4XE73` (Complete durable set)](storage/durability.md#req-stor-1-d4xe73)); the restart and recovery procedure is the implementation question
[`OQ-23-SDBGYB` (SDK restart and recovery semantics)](../implementation/open-questions.md#oq-23-sdbgyb). The stored proof can be rebuilt from other stores only where all of its
evidence also exists outside it. That holds for a node that executed every block above the anchor
and holds no support from received proofs. It does not hold, even in the first phase, for support,
which exists only in the stored proof ([`INV-PROOFSTORE-1-5KG1NX` (Proof support stays evidence)](storage/proof-store.md#inv-proofstore-1-5kg1nx)), or for a node seeded by
synchronization, which can lack history between its kept runs
([`REQ-SP-10-JMVHTB.T4.P8`](disputes/state-proofs.md#req-sp-10-jmvhtb.t4.p8)). After second-phase pruning it holds for no node with gaps: the stored
proof is then the only copy of its kept runs and their support.

Owner: [state proof store](storage/proof-store.md). Affected: [durability](storage/durability.md).
Alternatives: (1) the stored proof is part of the durable set and commits with the operation that
changes it ([`REQ-STOR-2-TARP8S` (Commit-aligned durability)](storage/durability.md#req-stor-2-tarp8s)); (2) the stored proof is durable wherever it holds the only copy
of some evidence, and a rebuildable copy elsewhere; (3) a restarted node seeds the stored proof again
through synchronization from a peer. Requested engineer decision: whether the stored proof must
survive a restart, and which of its contents must. This blocks a restart guarantee for the stored
proof and the start of the second phase, not the first phase.

<a id="oq-spec-proofstore-10-etb3h1"></a>

## OQ-SPEC-PROOFSTORE-10-ETB3H1 — Snapshot updates that bound the stored proof

Raised 2026-10-17. Kept milestones accumulate between anchor advances, and only a same-fork
snapshot update re-roots the stored proof and lets its older parts go ([`REQ-PROOFSTORE-6-38G1KC` (Re-rooting on anchor advance)](storage/proof-store.md#req-proofstore-6-38g1kc)).
No size or count trigger for a snapshot update is specified. Any trigger also needs a rule for who
submits and pays, and a target that meets the snapshot rules: a newer threshold-final first block
([`REQ-SP-5-MTE4RV`](disputes/state-proofs.md#req-sp-5-mte4rv)), the inbound-consumption gate ([`REQ-ENFSNAP-3-VD9T8A` (Inbound-consumption gate)](enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a)), and an undisputed fork
([`REQ-ENFSNAP-4-ESP98F` (Disputed-fork advance rule)](enforcement/snapshot-adoption.md#req-enfsnap-4-esp98f)).

Owner: [state proof store](storage/proof-store.md). Affected:
[snapshot adoption](enforcement/snapshot-adoption.md), [lifecycle](settlement/lifecycle.md), and
the proof size bounds of [`OQ-32-5NDD24`](open-questions.md#oq-32-5ndd24). Alternatives: (1) no automatic policy; (2) post an update
once the stored proof exceeds a number of kept milestones or a byte size; (3) post an update after
each finalized membership change; (4) post an update at a time interval. Requested engineer
decision: the policy, its limit, and who submits. This blocks a bound on stored-proof size, not the
stored proof.

<a id="oq-spec-proofstore-11-j7d4h1"></a>

## OQ-SPEC-PROOFSTORE-11-J7D4H1 — Missing-evidence policy with pruned storage

Raised 2026-10-17. Missing signatures can lower the proved final point and leave a valid tail
([`REQ-SP-8-9ZCCEJ`](disputes/state-proofs.md#req-sp-8-9zccej)). Unavailable required evidence or state is fatal ([`REQ-SP-9-RNXP56`](disputes/state-proofs.md#req-sp-9-rnxp56),
[`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48), [`REQ-DA-1-NVV85Z`](security/data-availability.md#req-da-1-nvv85z)). Pruning makes more data absent.
[`INV-PROOFSTORE-2-NT5FD6` (Absence is never evidence)](storage/proof-store.md#inv-proofstore-2-nt5fd6) forbids reading absence as fraud evidence; it does not say what a reader
does instead. The audit finding [`FIND-SECURITY-3-REDPJW`](../audit/open-findings.md#find-security-3-redpjw) shows the cost of the opposite reading on
chain, where absent pruned inbound history is treated as forged. The question arises in the first
phase too, without pruning: a node seeded by synchronization can lack history between the anchor
and its first kept run, or between kept runs, so an exact-height read there finds nothing
([`REQ-PROOFSTORE-5-VNQGDG` (One proof source for every reader)](storage/proof-store.md#req-proofstore-5-vnqgdg)).

Owner: [state proof store](storage/proof-store.md). Affected: [state proofs](disputes/state-proofs.md),
[dispute processing](disputes/dispute-processing.md), and
[data availability](security/data-availability.md). Alternatives: (1) required evidence stays fatal
when absent, and optional checks are skipped; (2) fetch absent data from peers or from posted
calldata ([`REQ-DA-1-NVV85Z`](security/data-availability.md#req-da-1-nvv85z)) before failing; (3) give every reader of prunable data an explicit
outcome: fail, skip its check, or lower its result. Requested engineer decision: the outcome for
each reader that can meet pruned or never-held data. This blocks the second phase and any pruning
that can reach a reader's input, not the stored proof. It also sets the outcome of exact-height
reads over history that a synchronized node never held.

<a id="oq-spec-proofstore-12-bdfc1j"></a>

## OQ-SPEC-PROOFSTORE-12-BDFC1J — Ordering of stored-proof writers and readers

Raised 2026-10-17. Several operations change the stored proof or the data it names: seeding from a
verified proof ([`REQ-PROOFSTORE-2-99RRXK` (Seeding from a verified proof)](storage/proof-store.md#req-proofstore-2-99rrxk)), extension and late signature merges
([`REQ-PROOFSTORE-3-QDXNH9` (Extension keeps earlier evidence)](storage/proof-store.md#req-proofstore-3-qdxnh9)), re-rooting on anchor advance
([`REQ-PROOFSTORE-6-38G1KC` (Re-rooting on anchor advance)](storage/proof-store.md#req-proofstore-6-38g1kc)), reset on fork change ([`REQ-PROOFSTORE-7-T0EBMX` (Reset on fork change)](storage/proof-store.md#req-proofstore-7-t0ebmx)), and
pruning ([`REQ-PROOFSTORE-8-XWEMTJ` (Pruning below the on-chain snapshot)](storage/proof-store.md#req-proofstore-8-xwemtj), [`REQ-PROOFSTORE-9-CZTA0N` (Pruning between proven parts of the stored proof)](storage/proof-store.md#req-proofstore-9-czta0n)). Proof reads
([`REQ-PROOFSTORE-4-ZFCWNB` (Construction above the stored prefix)](storage/proof-store.md#req-proofstore-4-zfcwnb), [`REQ-PROOFSTORE-5-VNQGDG` (One proof source for every reader)](storage/proof-store.md#req-proofstore-5-vnqgdg)) and seed verification take
time and can run while any of these happens. A seed becomes visible with the atomic install of
synchronization, and an install that aborts late restores the prior state
([synchronization](peer-communication/synchronization.md#requester-algorithm-verification-before-effect),
step 12). Anchor advances reach the node on a separate path through the local mirror.

Fixed outcomes already bound the result: every proof the node yields verifies from its anchor
([`REQ-PROOFSTORE-1-G11DH7` (One stored proof per active fork)](storage/proof-store.md#req-proofstore-1-g11dh7)), nothing from an old fork's stored proof enters a new one
([`REQ-PROOFSTORE-7-T0EBMX` (Reset on fork change)](storage/proof-store.md#req-proofstore-7-t0ebmx)), and absent data is never evidence ([`INV-PROOFSTORE-2-NT5FD6` (Absence is never evidence)](storage/proof-store.md#inv-proofstore-2-nt5fd6)). What
is not specified is which operation publishes each change to the stored proof and the data it
names, how work computed against an older fork, anchor, or record is detected and what happens to
it, and what keeps a running read's inputs from being pruned.

Owner: [state proof store](storage/proof-store.md). Affected: [durability](storage/durability.md)
([`REQ-STOR-2-TARP8S` (Commit-aligned durability)](storage/durability.md#req-stor-2-tarp8s)), [synchronization](peer-communication/synchronization.md), and
[local mirror](enforcement/local-mirror.md). Alternatives, some of which combine: (1) one order per
channel: every writer and every proof read runs in sequence, so no work sees a later change;
(2) versioned publication: each change advances a version made of fork, anchor, and record, and
work computed against an older version is discarded and recomputed, or revalidated before it
publishes; (3) read pins: a running read pins the data it uses, and pruning skips pinned data until
the read ends; (4) deferred pruning: pruning runs only while no read or seed is in flight. Requested
engineer decision: the publishing operation for each writer, how stale work is detected and
handled, and how reads are protected from pruning. This blocks concurrent operation of the stored
proof, not its single-operation rules.
