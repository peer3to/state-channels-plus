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

| ID                                               | Question                                                                                                             | Source                 | Affected documents                                                                                                                         | Status                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| [`OQ-1-NTJBA1`](open-questions.md#oq-1-ntjba1)   | Exact kill-period and dispute-fraud-proof slashing semantics                                                         | Specification analysis | [protocol/disputes.md](./disputes/disputes.md), [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                     | Open                              |
| [`OQ-2-7WTV16`](open-questions.md#oq-2-7wtv16)   | Penalty for submitting an invalid fraud proof                                                                        | Specification analysis | [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                                                                     | Resolved                          |
| [`OQ-3-1AHKGW`](open-questions.md#oq-3-1ahkgw)   | Leader election beyond round-robin: revert attribution, long-range proofs                                            | Specification analysis | [protocol/finality.md](./protocol-model/finality.md), [protocol/state-proofs.md](./disputes/state-proofs.md)                               | Open                              |
| [`OQ-6-4JPNE5`](open-questions.md#oq-6-4jpne5)   | P2P gossip rate-limiting policy                                                                                      | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                       | Open                              |
| [`OQ-7-M5G9M3`](open-questions.md#oq-7-m5g9m3)   | Whether adjudication requires a self-call-only authorization boundary                                                | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                       | Open                              |
| [`OQ-8-PEYAAQ`](open-questions.md#oq-8-peyaaq)   | Clock-skew and bias values to be validated empirically                                                               | Specification analysis | [protocol/time.md](./protocol-model/time.md)                                                                                               | Open                              |
| [`OQ-9-XR1MFS`](open-questions.md#oq-9-xr1mfs)   | Timeout precedence edge rules: same-fork definition, height comparison, evidence timing                              | Specification analysis | [protocol/disputes.md](./disputes/disputes.md)                                                                                             | Open                              |
| [`OQ-10-04YNC4`](open-questions.md#oq-10-04ync4) | Spectate/join failure-point details: deadlines, refunds, forced-inclusion proof                                      | Specification analysis | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md)                                                                   | Open                              |
| [`OQ-11-38S3SE`](open-questions.md#oq-11-38s3se) | Channel-balance invariant: definition per balance model and check points                                             | Specification analysis | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md), [concepts/state-machines.md](./protocol-model/state-machines.md) | Open                              |
| [`OQ-12-B45Q7N`](open-questions.md#oq-12-b45q7n) | Book-like overview vs. tree as the authoritative reference                                                           | Specification analysis | [README.md](../README.md), [governance.md](../governance.md)                                                                               | Provisionally resolved            |
| [`OQ-16-6AVF5B`](open-questions.md#oq-16-6avf5b) | Slash-set lifetime: cleared on channel-storage clear, questioned in code                                             | Code                   | [protocol/fraud-proofs.md](./disputes/fraud-proofs.md)                                                                                     | Open                              |
| [`OQ-18-2NK97T`](open-questions.md#oq-18-2nk97t) | Whether removal and slashing use the same canonical exit-recording behavior                                          | Specification analysis | [concepts/state-machines.md](./protocol-model/state-machines.md)                                                                           | Resolved (implementation pending) |
| [`OQ-20-Z9361V`](open-questions.md#oq-20-z9361v) | Outbound stream is not yet general-purpose; withdraw failure wedges snapshot advance; residual funds on close        | Code                   | [protocol/cross-layer-messages.md](./settlement/cross-layer-messages.md)                                                                   | Open                              |
| [`OQ-26-XH59SP`](open-questions.md#oq-26-xh59sp) | Whether every adjudication path generically enforces next-author authorization                                       | Specification analysis | [concepts/state-machines.md](./protocol-model/state-machines.md)                                                                           | Open                              |
| [`OQ-27-GT4W09`](open-questions.md#oq-27-gt4w09) | Reducer eligibility check is disabled in `reduceAndFinalize` — anyone can reduce                                     | Code                   | [protocol/disputes.md](./disputes/disputes.md)                                                                                             | Open                              |
| [`OQ-28-RP46PW`](open-questions.md#oq-28-rp46pw) | Equal-height reduction tie-break by smaller block hash — unapproved rule, hash-grinding surface                      | Code                   | [protocol/disputes.md](./disputes/disputes.md)                                                                                             | Open                              |
| [`OQ-29-EFY4NF`](open-questions.md#oq-29-efy4nf) | No signature domain separation: signatures replayable across deployments/chains                                      | Code                   | security/open-security-review.md                                                                                                           | Open                              |
| [`OQ-31-EB892Q`](open-questions.md#oq-31-eb892q) | Hash-only dispute with unavailable/undecodable data: availability rule undecided                                     | Code                   | sdk/dispute-pipeline.md, [protocol/disputes.md](./disputes/disputes.md)                                                                    | Open                              |
| [`OQ-32-5NDD24`](open-questions.md#oq-32-5ndd24) | Proof and audit size bounds (milestones, suffix blocks, signatures, auditing bytes, replay gas)                      | Specification analysis | [protocol/state-proofs.md](./disputes/state-proofs.md), [security/data-availability.md](./security/data-availability.md)                   | Open                              |
| [`OQ-33-1N5BY1`](open-questions.md#oq-33-1n5by1) | Maximum participant count and required enforcement boundary                                                          | Specification analysis | [security/trust-model.md](./security/trust-model.md)                                                                                       | Open                              |
| [`OQ-34-FY08V2`](open-questions.md#oq-34-fy08v2) | RPC boundary decisions: guard retry semantics, protocol versioning, ban persistence, failure-outcome policy          | Code and specification | sdk/rpc/README.md                                                                                                                          | Open                              |
| [`OQ-38-EY27T5`](open-questions.md#oq-38-ey27t5) | Runtime budgets and targets under the mid-range-phone envelope; multi-peer test scheduling determinism and isolation | Code and specification | sdk/runtime-and-concurrency.md §6, §11.5                                                                                                   | Open                              |
| [`OQ-39-C3EAMN`](open-questions.md#oq-39-c3eamn) | Reduce: stateful (reads on-chain slashes / inbound tip) vs stateless fold over the committed dispute inputs          | Engineer question      | [protocol/disputes.md](./disputes/disputes.md)                                                                                             | Open                              |

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

## OQ-1-NTJBA1 — Kill-period and dispute-fraud-proof slashing semantics

The dispute-window "kill" flow needs an exact, engineer-confirmed rule. An uploaded dispute
records the opener's commitment immediately, so the earlier "no commitments before kill → spammer
slashed" description is wrong; implementation evidence suggests the kill period is the interval in
which an invalid committed dispute can be challenged with a dispute fraud proof and killed. The
open decision: the precise kill semantics, and **who is slashed when a dispute fraud proof is
valid, and when it is invalid**. The reconstructed window lifecycle in
[protocol/disputes.md](./disputes/disputes.md) depends on this rule.

Code-derived edges folded into this decision: a window whose commitments are all killed stays
open and never reduces until new evidence arrives; whether kill and the follow-up counter-dispute
should be one atomic multicall (the SDK deliberately sequences them so the slash lands first);
the `postedAuditingData` rule under early finalization; and the calldata-posted-after-kill-decision
race. See [protocol/disputes.md](./disputes/disputes.md) §4 and
sdk/dispute-pipeline.md.

Additional implementation evidence: **an expired evidence window reopens when
its commitments were all killed** — `DisputeManagerFacet` bypasses the expiry check when the
commitment list is empty, so new evidence is accepted arbitrarily late and each acceptance
restarts the kill period (safety/griefing exposure, not only the liveness gap above; candidate
rule: reject all evidence once the window close rule is met). The economics half should also
settle: whether disputing requires a bond, whether the penalty attaches to the disputer or to a
signer whose data the disputer relayed, the malformed-vs-objectively-false distinction, where
slash value goes, and an explicit sign-off on the threshold-signed fast path (it backdates both
windows, deletes prior commitments, and trusts the dispute's own output hash — sound only under
N-of-N signatures).

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
gives a bounded queue, so the queue needs no cap of its own (see
sdk/block-confirmation-pipeline.md §3.1). Still open:
the thresholds, burst/backpressure behavior, prioritization, and whether an additional fixed
per-peer limit is wanted. Implementation is required before production.

<a id="oq-7-m5g9m3"></a>

## OQ-7-M5G9M3 — `onlySelf` guard under the improved Diamond architecture

The planned Diamond refactor (selector-based routing, focused facets, versioned diamond storage)
changes the call topology the `onlySelf` self-call guard was designed for. Whether the guard
remains necessary must be re-evaluated from first principles before it is preserved or removed.

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
[protocol/time.md](./protocol-model/time.md) §2–3.

<a id="oq-9-xr1mfs"></a>

## OQ-9-XR1MFS — Timeout precedence edge rules

The timeout reduction rules (slashes suppress timeouts in a fork; at most one timeout per fork,
targeting the lowest timed-out height) have unresolved edges: what exactly counts as _the same
fork_, how block heights are compared across different proven histories, when submitted evidence
becomes available to the timeout target, and how a fraud proof revealed by that evidence changes
an already proposed timeout.

Code-derived edges: the empty-timeout cancellation of the `reduce()` fold
(see [`OQ-14-5C8KV7`](../implementation/open-questions.md#oq-14-5c8kv7) for the fold mechanics); the exact inclusive/exclusive boundary comparisons of the
`Timeout*` dispute-fraud-proof rules; and unquantified underlying-chain timestamp-manipulation
bounds relative to the protocol windows. See [protocol/disputes.md](./disputes/disputes.md) §6 and
[protocol/time.md](./protocol-model/time.md) §5.3.

**Partially resolved (2026-08-14, engineer decision):** a slash cancels a proposed timeout — a
reduction that slashes someone applies no timeout (normatively
[`INV-DIS-7-9GGZSD`](disputes/disputes.md#inv-dis-7-9ggzsd)), so a slash-carrying dispute
suppressing the timeout candidate is intended. **Still open:** whether a dispute with no slashes
and no timeout claim (self-removal-only, or the accused's own counter-dispute) also cancels the
proposed timeout; [protocol/disputes.md](./disputes/disputes.md) §5 and §6.1 record the decision
and this residual.

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
canonical event, roll back on reorg); and the spectate path **blacklists a peer for any request
failure**, including plain timeouts and transport errors — conflating unavailability with
Byzantine behavior, contrary to the fault taxonomy in
[security/trust-model.md](./security/trust-model.md).

<a id="oq-11-38s3se"></a>

## OQ-11-38S3SE — Channel-balance invariant definition

The aggregate channel-balance invariant (claimed in-channel value is backed by deposits minus
withdrawals under the application's balance algebra) protects late joiners syncing from a
snapshot against undercollateralized colluding states. Unresolved: the precise invariant per
supported balance model (integer, composite, non-fungible), its snapshot proof inputs, exactly
when it is checked, and how it treats joins, deposits, withdrawals, and exits.
Where it is enforced today is itself a gap — see [`OQ-19-Y8FDQX`](../implementation/open-questions.md#oq-19-y8fdqx).

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

The external `slashParticipant` wrapper appends the resulting `ExitChannel` to the machine's
outbound buffer; `removeParticipant` returns it without appending (the dispute pipeline
compensates by using return values). Inert today, but which layer owns recording the exit message
should be decided deliberately. See [concepts/state-machines.md](./protocol-model/state-machines.md)
§6.4.

**Resolved (2026-08-10):** the wrappers MUST be symmetric — both record the exit through
`_addExitChannel`. The only intended difference between removal and slashing lives in the hooks'
balance semantics: `_removeParticipant` is the less aggressive path and may return the
participant's full held balance; `_slashParticipant` applies the application-defined penalty.
Recorded normatively as [`REQ-SM-8-8CHSQ8`](protocol-model/state-machines.md#req-sm-8-8chsq8) in
[concepts/state-machines.md](./protocol-model/state-machines.md). The implementation change
(`removeParticipant` also calling `_addExitChannel` on success) is pending; until it lands the
Current: notes in the affected documents stand.

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
([`REQ-SM-6-BJZVQ5`](protocol-model/state-machines.md#req-sm-6-bjzvq5) / [`REQ-CON-7-DXVW98`](../implementation/views/architecture/contracts/state-machine-base.md#req-con-7-dxvw98) corrected accordingly).

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
completeness review ([`OQ-5-4Q38M5`](../audit/open-questions.md#oq-5-4q38m5)). See
security/open-security-review.md.

<a id="oq-31-eb892q"></a>

## OQ-31-EB892Q — Hash-only dispute availability rule

Disputes commit on-chain by hash; when a verifier cannot obtain or decode the backing data (bad
ABI, missing local anchor, withholding peers), the SDK audit currently stops without a fireable
proof — the unauditable dispute escapes any consequence. Silent acceptance is not an acceptable
end state. Options: mandatory calldata for disputes, a bounded data-request phase, an
availability proof, or exclusion of unauditable candidates. See
sdk/dispute-pipeline.md (audit-skip paths).

<a id="oq-32-5ndd24"></a>

## OQ-32-5NDD24 — Proof and audit size bounds

Nothing bounds proof sizes: milestones per proof, block confirmations, signed-suffix length,
signatures per object, message blocks and messages per block, disputes per window, fraud proofs
per call, auditing bytes, or on-chain replay gas (the state-proof facet has a live TODO on
missing gas limits). The transport's global frame cap is not a proof bound. Bounds must come
from target-chain calldata/gas measurements and client CPU/memory tests. Distinct from [`OQ-6-4JPNE5`](open-questions.md#oq-6-4jpne5)
(gossip rate limiting). See [protocol/state-proofs.md](./disputes/state-proofs.md) and
[security/data-availability.md](./security/data-availability.md).

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
(sdk/rpc/README.md); each is marked in place in that document:

- **Guard retry vs. request/response.** The handshake guard queues rejected calls for retry, but
  a queued _request_ has already been answered with a guard error — its later retried response
  arrives as an unknown `requestId` and is dropped, so retry only benefits fire-and-forget
  sends. Also, guard `onFailure` disconnects before the error response is sent. Decide the
  intended queue/retry semantics per delivery mode.
- **Protocol versioning.** No version negotiation or compatibility scheme exists anywhere in the
  RPC layer (only the `peer3:init-handshake:v1` domain tag). Couples to [`OQ-29-EFY4NF`](open-questions.md#oq-29-efy4nf) (signature
  domains): one versioning decision should cover both.
- **Ban persistence before a profile exists.** A "blacklist" verdict against a peer with no
  established profile is disconnect-only (`profile?.blacklist()` no-ops), so a pre-handshake
  abuser can reconnect freely. Decide whether bans persist by transport-level address.
- **Failure-outcome policy consistency.** Endpoint outcomes are currently per-service accidents:
  join-signature validation failures are penalty-free request errors (free probing), while
  spectate failures blacklist permanently ([`DEF-5-E8TP9N`](../audit/open-findings.md#def-5-e8tp9n)); WebRTC signaling failures are silently
  ignored. Decide one policy table — which failure classes disconnect, blacklist, error, or are
  ignored — and make endpoints conform.

<a id="oq-38-ey27t5"></a>

## OQ-38-EY27T5 — Runtime budgets, scheduling determinism, and test isolation

Follow-ons to the 2026-08-10 runtime decisions ([`REQ-RUN-13-27YE2T`](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-13-27ye2t)/14/15):

- **Memory budget under the phone envelope (blocks [`REQ-RUN-13-27YE2T`](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-13-27ye2t)).** Default-on workers put three
  execution contexts per peer on a device with a few hundred MB of usable heap. _Resolved
  2026-08-10:_ placement does not vary by device — no profile branching; the envelope is a hard
  budget the implementation must meet. _Still open:_ the concrete per-context budget, the
  aggregate per-peer ceiling, the reduced per-worker cap (1024 MB is CI containment and too high),
  and the measurement showing three contexts fit. Until these exist the default-flip is blocked.
- **Worker capability detection.** Flipping the defaults requires detecting runtimes that deny
  workers and falling back inline; the mechanism and its failure behavior are undesigned. This is
  a fallback path, not a device profile.
- **Throughput/latency targets.** None exist, so [`REQ-RUN-14-YAHYR4`](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-14-yahyr4) is a memory envelope only and the
  measurement §44 requires cannot be defined. Decide block-confirmation round-trip, dispute-path
  latency, and sustained rate at six participants.
- **Default-flip prerequisites.** Whether flipping the worker defaults requires runtime
  feature-detection with automatic inline fallback (browsers that deny workers).
- **Equivalence oracle scope.** Whether event _ordering_ must match exactly or only the emitted
  multiset ([`REQ-RUN-15-8CBVKB`](../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-15-8cbvkb) currently says same set/payloads).
- **Test scheduling and isolation.** No cross-peer deterministic scheduler exists — coordination is
  polling plus event barriers and cooperative hold/release stubs; and the default is one shared
  chain and discovery registry per machine, with concurrent tests separated only by account-range
  slots and a stamped channel id. Decide whether to commit to a determinism mechanism and whether
  the isolation guarantee should be one chain per test process.

See sdk/runtime-and-concurrency.md §6 and §11.5.

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
  `challengeDisputeReduction` question in [disputes.md §4.3](./disputes/disputes.md#43-reduction-and-finalization)). But both stateful
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
