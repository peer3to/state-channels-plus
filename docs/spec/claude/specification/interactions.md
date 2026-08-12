# Cross-System Interaction Contracts

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The normative contracts for every producer/consumer edge between the eight protocol
> systems. Each edge defines its data, validity rules, timing and ordering assumptions, trust
> boundary, and failure behavior. The mechanisms themselves stay in the owning system's documents;
> this document owns only what must be true _at the boundary_.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Edge index](#edge-index)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

The system-dependency map in [README.md](./README.md) shows the eight systems and their edges. An
edge is a contract: the producer promises a data shape, validity conditions, and ordering; the
consumer promises validation, a defined failure response, and that it will not silently strengthen or
weaken the promise. An implementation may place both sides in one process or split them arbitrarily —
the observable boundary behavior is what conformance is judged against.

## Edge index

| Edge                                      | Producer → Consumer                                  | Contract                |
| ----------------------------------------- | ---------------------------------------------------- | ----------------------- |
| Peer block ingress                        | Peer communication → Block progression               | [`REQ-IX-1`](#req-ix-1) |
| Deterministic execution and commitment    | Block progression → Protocol model                   | [`REQ-IX-2`](#req-ix-2) |
| Inbound inclusion and join flow           | Settlement ↔ Block progression / Peer communication | [`REQ-IX-3`](#req-ix-3) |
| Proof material                            | Block progression → Disputes                         | [`REQ-IX-4`](#req-ix-4) |
| On-chain adjudication                     | Disputes → Enforcement                               | [`REQ-IX-5`](#req-ix-5) |
| Snapshot adoption and outbound processing | Settlement → Enforcement                             | [`REQ-IX-6`](#req-ix-6) |
| Chain observation                         | Enforcement → Runtime → all systems                  | [`REQ-IX-7`](#req-ix-7) |
| Execution equivalence                     | Runtime → all systems                                | [`REQ-IX-8`](#req-ix-8) |
| Storage fidelity                          | All systems ↔ Storage                               | [`REQ-IX-9`](#req-ix-9) |

## Requirements and invariants

<a id="req-ix-1"></a>
**REQ-IX-1 — Peer block ingress.** Block confirmations reaching block progression from a peer MUST
have passed, in order: session authentication ([`INV-RPC-1`](./peer-communication/rpc.md)), envelope
and frame validation (`REQ-RPC-1`), and canonical struct decoding — and MUST then receive the full
pipeline validation of [`REQ-BLOCK-PIPE-2`](./block-progression/block-processing.md) as if the
transport had proven nothing. Data: an encoded signed block plus its confirmation signature set, with
source attribution retained (`REQ-BLOCK-PIPE-1`). Ordering: none promised — duplicated, unordered,
partial delivery is in-contract. Trust boundary: untrusted peer ingress. Failure: every deviation is
classified by `REQ-BLOCK-PIPE-3` with its context consequence; transport-level failure consequences
(disconnect/blacklist) are owned by `REQ-RPC-6` and never substitute for pipeline validation.

<a id="req-ix-2"></a>
**REQ-IX-2 — Deterministic execution and commitment.** Block progression executes state transitions
only through the protocol model's injected execution context
([`REQ-SM-1`](./protocol-model/state-machines.md) family) and commits results only through the
commitment hierarchy ([`INV-HIST-1`](./protocol-model/history-and-commitments.md)). Data: the
canonical pre-state, the transaction, and the claimed post-state commitment. Validity: replaying the
same transition from the same pre-state MUST reproduce the claimed commitment on every conforming
implementation, off-chain and on-chain. Timing: transition timestamps validate against chain-time
rules ([time.md](./protocol-model/time.md)). Trust boundary: internal, but the _claim_ is
adversarial — a mismatch is objective fraud evidence
([fraud-proofs.md](./disputes/fraud-proofs.md)), never a retry.

<a id="req-ix-3"></a>
**REQ-IX-3 — Inbound inclusion and join flow.** Settlement produces the ordered inbound stream; block
authors MUST include due inbound messages promptly (liveness expectation of
[cross-layer-messages.md](./settlement/cross-layer-messages.md)); peer communication carries the
unanimous join-authorization collection. Data: hash-linked inbound message blocks; signed join
authorizations. Validity: inclusion advances the applied inbound tip exactly along the chain
committed on the base layer; a join binds channel, fork, snapshot, deadline, and every required
signature. Ordering: strictly by stream linkage; no skipping. Trust boundary: base-layer events are
authoritative; peer-collected signatures are untrusted until verified. Failure: stalled inclusion is
recoverable through the forced-inclusion dispute input
([`REQ-DIS-1`](./disputes/disputes.md), input 4); a failed join leaves the depositor with the
dispute-forced path and refund/exit behavior defined by settlement.

<a id="req-ix-4"></a>
**REQ-IX-4 — Proof material.** Block progression produces the material disputes consume: milestones,
threshold-signed blocks, the signed non-final suffix, and posted calldata commitments. Validity: the
material MUST satisfy the state-proof rules ([state-proofs.md](./disputes/state-proofs.md)) —
finality anchors, membership hops, linkage — without dispute-side reinterpretation. Timing: material
is admissible relative to the dispute window's chain-time bounds. Trust boundary: proof material is
adversarial input to on-chain verification even when produced honestly. Failure: insufficient or
invalid material yields a rejected or killed claim; it MUST NOT corrupt the audit of other claims
(`REQ-DISPUTE-PIPE-2`).

<a id="req-ix-5"></a>
**REQ-IX-5 — On-chain adjudication.** Disputes drive enforcement through the adjudication operations
(upload, kill, reduce/finalize, challenge). Data: signed dispute claims, auditing data committed by
hash and posted as calldata when required, fraud proofs, and the exact committed dispute set at
reduction. Validity: enforcement recomputes every protocol predicate itself
([`REQ-CONTRACT-ARCH-2`](./enforcement/contracts.md)); the off-chain auditor's conclusion is advice,
never authority — both MUST reach the same result from the same inputs (`INV-DISPUTE-PIPE-1`).
Ordering: the chain serializes submissions, but the reduced result MUST be order-independent
(`INV-DIS-5`). Trust boundary: every submission is adversarial. Failure: invalid submissions revert
atomically or are killed with the submitter slashed; duplicate chain actions MUST be idempotent or
rejected (`REQ-DISPUTE-PIPE-4`).

<a id="req-ix-6"></a>
**REQ-IX-6 — Snapshot adoption and outbound processing.** Settlement advances the on-chain snapshot
by same-fork finality proof or along expired reduced-result links
([`REQ-LIF-2`](./settlement/lifecycle.md), [`REQ-DIS-9`](./disputes/disputes.md)). Data: the new
snapshot, its finality or successor-fork proof, and the linked outbound message-block range from the
processed tip to the new committed tip. Validity: enforcement verifies the range's linkage, discards
already-processed blocks, releases each withdrawal at most once, and keeps `totalWithdrawals ≤
totalDeposits` ([`INV-MSG-3`/`INV-MSG-4`](./settlement/cross-layer-messages.md)). Ordering: strictly
by outbound linkage; any batch split of the same range MUST give the same final state. Trust
boundary: adversarial submission against escrowed funds. Failure: a rejected advance leaves the prior
snapshot and tip authoritative with no partial release.

<a id="req-ix-7"></a>
**REQ-IX-7 — Chain observation.** Runtime observes enforcement's events and calldata through RPC
providers and feeds every system. Data: contract events, posted calldata, and chain timestamps.
Validity: observed intake re-enters the owning system's validation (`REQ-BLOCK-PIPE-4` for recovered
blocks, `REQ-DISPUTE-PIPE-1` for observed disputes) — observation grants no trust. Timing: freshness
is bounded by the trust model's honest-RPC assumption
([trust-model.md](./security/trust-model.md)); protocol windows MUST tolerate the stated observation
lag. Trust boundary: RPC providers may be unavailable, lagging, or dishonest; redundancy reduces but
does not remove the assumption. Failure: a node that cannot observe honestly cannot promise timely
protocol reactions; its recovery path after reconnection is bounded sync, not silent trust.

<a id="req-ix-8"></a>
**REQ-IX-8 — Execution equivalence.** Runtime hosts every system inline or across isolated contexts;
given the same inputs and state, results, committed effects, events, and failure classification MUST
be identical ([`INV-RUNTIME-1`](./runtime/execution.md)). Data: every cross-context protocol value
crosses in the canonical transfer-safe encoding (`REQ-RUNTIME-1`). Ordering: ownership and causal
order per `REQ-RUNTIME-2`. Trust boundary: isolation contains faults but never launders untrusted
protocol data into trusted state. Failure: context failure settles or rejects owned work exactly
once (`REQ-RUNTIME-3`); it MUST NOT surface as a protocol-level disagreement between two honest
deployments of the same node.

<a id="req-ix-9"></a>
**REQ-IX-9 — Storage fidelity.** Every system persists and reads its local protocol knowledge
through the storage system ([storage/README.md](./storage/README.md)). Data: each module's defined
records and keys. Validity: storage returns exactly what its producer committed — no fabrication,
substitution, reinterpretation, or gap-bridging — and grants no validity: read-back data re-enters
the owning system's validation (`REQ-STOR-3`). Ordering: single operations are atomic; merge
operations are monotone, idempotent, and arrival-order independent; multi-module consistency at an
operation boundary is the calling system's commit obligation (`REQ-STOR-2`). Trust boundary:
storage is inside the node, but what flows into it originates from untrusted sources — attribution
and evidence MUST survive storage exactly so they remain usable as evidence. Failure: an absent
record reads as nothing rather than a default that masquerades as protocol state; a failed
multi-module write leaves the operation retryable per `REQ-STOR-2`.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `REQ-IX-1`              | Peer block ingress: authenticated, envelope-validated frames still get full pipeline validation.                  |
| `REQ-IX-2`              | Deterministic execution and commitment: same transition, same commitment, everywhere; mismatch is fraud evidence. |
| `REQ-IX-3`              | Inbound inclusion and join flow: prompt linked inclusion; forced-inclusion recovery when stalled.                 |
| `REQ-IX-4`              | Proof material: state-proof rules bind producer and consumer without reinterpretation.                            |
| `REQ-IX-5`              | On-chain adjudication: enforcement recomputes every predicate; off-chain audit is advice.                         |
| `REQ-IX-6`              | Snapshot adoption: linked-range verification, at-most-once release, batch-split invariance.                       |
| `REQ-IX-7`              | Chain observation: observed intake re-enters validation; freshness bounded by the RPC trust assumption.           |
| `REQ-IX-8`              | Execution equivalence: inline and isolated hosting are observationally identical.                                 |
| `REQ-IX-9`              | Storage fidelity: exact preservation, no granted validity, monotone merges, explicit absence.                     |

## Assumptions and constraints

- Every edge presumes both endpoint systems honor their own owned requirements; an interaction
  contract never weakens an endpoint obligation.
- The trust boundary named on each edge is authoritative for what may be assumed about the data
  crossing it; an implementation MUST NOT collapse an untrusted boundary because both sides happen to
  run in one process.
- Edges are stated between systems, not between source files; splitting or merging components does
  not change the contract.

## Security considerations

The edges are where trust changes hands, so they are where laundering bugs live: transport
authentication mistaken for payload validity (edge 1), off-chain audit conclusions trusted on-chain
(edge 5), observation mistaken for verification (edge 7), and isolation mistaken for sanitization
(edge 8). Every edge's failure mode must be exercised from the adversarial side of its trust
boundary. Residual risks stay with the endpoint systems' security sections; this document adds none.

## Verification and test plan

### Requirement test matrix

Each row is a planned black-box obligation exercised across the _real_ boundary — both endpoint
mechanisms live, with the stimulus injected on the producer side and the oracle read on the consumer
side.

| Plan item                             | Requirements / invariants | Setup and stimulus                                                                                                                         | Expected result                                                                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-ix-1-t1"></a>`REQ-IX-1.T1` | `REQ-IX-1`                | Deliver valid, duplicate, malformed, and forged confirmations from authenticated and unauthenticated peers.                                | Only authenticated, envelope-valid frames reach the pipeline; every one still receives full validation.                                          | <a id="req-ix-1-t1-p1"></a>`REQ-IX-1.T1.P1` — valid path end to end; <a id="req-ix-1-t1-p2"></a>`REQ-IX-1.T1.P2` — pre-auth and forged-identity delivery; <a id="req-ix-1-t1-p3"></a>`REQ-IX-1.T1.P3` — valid envelope, protocol-invalid block; <a id="req-ix-1-t1-p4"></a>`REQ-IX-1.T1.P4` — duplicate/out-of-order delivery.                                                                                               |
| <a id="req-ix-2-t1"></a>`REQ-IX-2.T1` | `REQ-IX-2`                | Execute the same transitions through every conforming execution path (off-chain, replay, on-chain).                                        | Identical post-state commitments; an induced mismatch surfaces as fraud evidence, not a retry.                                                   | <a id="req-ix-2-t1-p1"></a>`REQ-IX-2.T1.P1` — equivalence across paths; <a id="req-ix-2-t1-p2"></a>`REQ-IX-2.T1.P2` — injected nondeterminism detected; <a id="req-ix-2-t1-p3"></a>`REQ-IX-2.T1.P3` — timestamp boundary cases.                                                                                                                                                                                              |
| <a id="req-ix-3-t1"></a>`REQ-IX-3.T1` | `REQ-IX-3`                | Drive deposits/joins through acknowledgement, inclusion, and stalled-inclusion scenarios.                                                  | Inclusion follows stream linkage exactly; stalling is recoverable by forced inclusion; failed joins leave no partial membership.                 | <a id="req-ix-3-t1-p1"></a>`REQ-IX-3.T1.P1` — prompt honest inclusion; <a id="req-ix-3-t1-p2"></a>`REQ-IX-3.T1.P2` — non-responsive authors, forced inclusion; <a id="req-ix-3-t1-p3"></a>`REQ-IX-3.T1.P3` — invalid/incomplete join signatures; <a id="req-ix-3-t1-p4"></a>`REQ-IX-3.T1.P4` — skipped or reordered inbound blocks rejected.                                                                                 |
| <a id="req-ix-4-t1"></a>`REQ-IX-4.T1` | `REQ-IX-4`                | Build proof material from honest and manipulated histories and submit it to dispute audit.                                                 | Valid material verifies under the state-proof rules; manipulated material is rejected without corrupting other claims.                           | <a id="req-ix-4-t1-p1"></a>`REQ-IX-4.T1.P1` — anchors, hops, suffix accepted; <a id="req-ix-4-t1-p2"></a>`REQ-IX-4.T1.P2` — truncated/reordered material; <a id="req-ix-4-t1-p3"></a>`REQ-IX-4.T1.P3` — stale-window material.                                                                                                                                                                                               |
| <a id="req-ix-5-t1"></a>`REQ-IX-5.T1` | `REQ-IX-5`                | Submit disputes whose off-chain audit verdict and on-chain recomputation are forced to agree and to disagree.                              | Enforcement's own recomputation decides; order permutations of the same committed set reduce identically.                                        | <a id="req-ix-5-t1-p1"></a>`REQ-IX-5.T1.P1` — agreement path; <a id="req-ix-5-t1-p2"></a>`REQ-IX-5.T1.P2` — dishonest off-chain advice ignored; <a id="req-ix-5-t1-p3"></a>`REQ-IX-5.T1.P3` — submission-order permutations; <a id="req-ix-5-t1-p4"></a>`REQ-IX-5.T1.P4` — duplicate/replayed chain actions.                                                                                                                 |
| <a id="req-ix-6-t1"></a>`REQ-IX-6.T1` | `REQ-IX-6`                | Advance snapshots with complete, split, overlapping, and invalid outbound ranges on both proof paths.                                      | Linked ranges verify; releases happen at most once; every batch split converges to the same state; rejects leave prior state.                    | <a id="req-ix-6-t1-p1"></a>`REQ-IX-6.T1.P1` — same-fork and successor-fork advance; <a id="req-ix-6-t1-p2"></a>`REQ-IX-6.T1.P2` — batch-split permutations; <a id="req-ix-6-t1-p3"></a>`REQ-IX-6.T1.P3` — already-processed and non-descendant ranges; <a id="req-ix-6-t1-p4"></a>`REQ-IX-6.T1.P4` — failing consumer withdrawal.                                                                                            |
| <a id="req-ix-7-t1"></a>`REQ-IX-7.T1` | `REQ-IX-7`                | Observe events/calldata through fresh, lagging, and dishonest RPC views and feed the owning systems.                                       | Observed intake re-enters validation; lag within bounds is tolerated; dishonest views cannot inject unvalidated state.                           | <a id="req-ix-7-t1-p1"></a>`REQ-IX-7.T1.P1` — honest fresh view; <a id="req-ix-7-t1-p2"></a>`REQ-IX-7.T1.P2` — bounded lag near window edges; <a id="req-ix-7-t1-p3"></a>`REQ-IX-7.T1.P3` — fabricated events rejected by re-validation; <a id="req-ix-7-t1-p4"></a>`REQ-IX-7.T1.P4` — reconnection recovery.                                                                                                                |
| <a id="req-ix-8-t1"></a>`REQ-IX-8.T1` | `REQ-IX-8`                | Run identical protocol workflows inline and isolated, including failures and races.                                                        | Observable results, events, ordering, and failure classes are identical; context crashes settle owned work exactly once.                         | <a id="req-ix-8-t1-p1"></a>`REQ-IX-8.T1.P1` — success equivalence; <a id="req-ix-8-t1-p2"></a>`REQ-IX-8.T1.P2` — failure/crash equivalence; <a id="req-ix-8-t1-p3"></a>`REQ-IX-8.T1.P3` — boundary-encoding round trips under load.                                                                                                                                                                                          |
| <a id="req-ix-9-t1"></a>`REQ-IX-9.T1` | `REQ-IX-9`                | Drive each producing system's store/merge/read cycle through storage, including duplicates, absences, and interrupted multi-module writes. | Round trips are exact; merges converge for every order; absence is explicit; interrupted writes stay repairable; read-back re-enters validation. | <a id="req-ix-9-t1-p1"></a>`REQ-IX-9.T1.P1` — exact round trip per module; <a id="req-ix-9-t1-p2"></a>`REQ-IX-9.T1.P2` — duplicate/out-of-order merge convergence; <a id="req-ix-9-t1-p3"></a>`REQ-IX-9.T1.P3` — absence vs default distinction; <a id="req-ix-9-t1-p4"></a>`REQ-IX-9.T1.P4` — interrupted commit repairable; <a id="req-ix-9-t1-p5"></a>`REQ-IX-9.T1.P5` — tampered read-back rejected by owner validation. |

## Future Work

_Non-normative._ Candidate additional edges as the systems deepen: an explicit watchtower-delegation
contract (runtime → disputes) once the delegation data set is specified, and a harness-control
contract (runtime → all) once test control surfaces stabilize.
