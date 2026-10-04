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

## 2026-10-03 — Milestone-only state proofs, join wait, force-join bounds, founders, and sync refusals

Current assessment of the specification changes for the autonomous poker client, all from engineer decisions.

- **Milestone-only state proofs.** A state proof is milestones only; the empty proof is the fork genesis.
  [`REQ-SP-8-9PK9TS`](../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts) defines one walk from one start: the same-fork on-chain snapshot when it is not the
  fork genesis (recognized by its data), else the fork genesis. Milestones wholly below the start are dropped; the
  run holding the start commits it at its height with no threshold; every other kept milestone is proven by the
  union threshold of the last verified set; first heights do not decrease and runs may overlap.
  [`REQ-SP-4-NCSEX4`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4) links genesis block 0 by its previous-block hash and allows an unfinal block 0 only as the
  sole milestone. A claim below the same-fork on-chain snapshot (and an empty proof after such a snapshot) is
  killed by the dedicated below-anchor dispute fraud proof (engineer decision). The Assumptions record why a
  later snapshot equal to the genesis data is not a practical case (review finding OO5 closed).
- **Verification and liability.** [`REQ-SP-9-7MWKY8`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8) makes a node verify from its latest local threshold-final
  point, then its local copy's start, then the chain's start; a local success is final, only the chain answers
  invalid, and every verification error propagates with no verdict (engineer decisions: stale local success is accepted under
  the honest-participant and everyone-signing premise; internal failures are fatal, 2026-10-04). [`REQ-SP-10-AM67R2`](../specification/disputes/state-proofs.md#req-sp-10-am67r2) limits submitter
  liability to the unfinal tail of the last milestone, addressed by its index in that milestone and decided
  without a walk (a threshold-final block 0 of a sole genesis milestone is challengeable: engineer decision, review
  HR-5), and judges the balance on the dispute's latest state (review HR-4). [`REQ-SP-4-NCSEX4`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4) needs supplied
  genesis data only when the fork genesis is not on chain (review HR-1, HR-3). [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) drops the structure
  refresh rule: the structure check is input-only. [`REQ-DISPUTE-PIPE-13-W73B2F` (Proof construction from the local start)](../specification/disputes/dispute-processing.md#req-dispute-pipe-13-w73b2f) builds a compact
  proof from the local start with no chain pre-check and no rebuild; a height below the start or missing
  required history is a construction error, not an abstention. [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) no longer has a
  structure-specific chain-confirmation exception. [`REQ-MIRROR-5-YSFRKG` (Mirror snapshot never goes back)](../specification/enforcement/local-mirror.md#req-mirror-5-ysfrkg) forbids the mirror's snapshot from going back.
- **Open point.** [`INV-SYNC-3-A7A2ED.T1`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1) still says a participant "cuts the peer only"; this conflicts with the
  no-penalty rule for a proof below the start and is left for an engineer decision. Its
  [`INV-SYNC-3-A7A2ED.T1.P13`](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed.t1.p13) text still names the old stale short-circuit step.
- **Genesis dependency.** [`OQ-SPEC-GENESIS-1-TKNMPM` (Fork genesis dependency after a peer moves ahead)](../specification/open-questions.md#oq-spec-genesis-1-tknmpm) lists every remaining reader of the fork genesis, now
  including the wrong-genesis fraud proof, the dormant outbound-range check, the sync responder, and the empty-proof
  and reduce-to-genesis prover reads.
- **Membership.** [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) starts both force-join bounds when the joiner observes its own
  join, counts the blocks it commits once its own clock is past an `agreementTime` grace (block timestamps play no part), ends both bounds with no retry when
  the chain refuses the start for an expired evidence period, and keeps an unlisted pending joiner pending while its
  join authorization is open. Recovery after a refused start is the next observed dispute, whose reduction consumes
  the whole inbound queue. [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) makes a leave wait for an unobserved join until the chain is past the
  join authorization deadline. [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) states the dispute-settlement exception that skips the chain read.
  [`REQ-RMSTORE-2-Y2T1PG` (Explicit intent lifecycle)](../specification/storage/progress-markers.md#req-rmstore-2-y2t1pg) adds the authorization deadline to the force-join marker. The runtime status definitions
  carry the pending-joiner exception, and the configuration documents the join authorization lifetime.
- **Negotiation and sync.** [`REQ-NEG-2-ED48TZ` (Chain-observed completion)](../specification/peer-communication/channel-negotiation.md#req-neg-2-ed48tz) and [`REQ-NEG-5-4TTTBV` (Opened-channel announcement)](../specification/peer-communication/channel-negotiation.md#req-neg-5-4tttbv) make every founder, ordinary or targeted,
  complete and announce only after its own genesis is installed; a founder never runs the observer initial sync.
  [`REQ-SYNC-1-T2589H` (Minimum-target proving)](../specification/peer-communication/synchronization.md#req-sync-1-t2589h) makes a responder refuse with an error reply, never a blacklist, while a walked dispute
  window's kill period runs or its window or reduce data is missing. [`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag), [`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed), and
  [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6) keep one initial sync request: any failure, an explicit refusal included, aborts the uncommitted
  observer (engineer decision on human review 2, HR-8, which reverted the refusal retry).
  [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0) settles a cancel requested during a commit that the advertiser rejects.

Permutations whose meaning changed were deleted and replaced with new numbers. Residual risks are stated in the
owning Security considerations: the mirror's older-snapshot guard limits, the ~1 s clock skew on kill-period
expiry between responder and requester, and the stale-proof defense, which needs an honest participant with the
newer state to act within the window.

## 2026-10-04 — Review fixes HR-1 to HR-6, stale sync proofs, and fatal internal failures

- [`REQ-SP-10-AM67R2`](../specification/disputes/state-proofs.md#req-sp-10-am67r2) now decides block-challenge eligibility without a walk, from the last
  milestone and the on-chain anchor; a threshold-final block 0 of a sole genesis milestone is challengeable (engineer
  decision, review HR-5). The balance check judges the dispute's latest state (HR-4). Deleted permutations: the
  threshold-final genesis block 0 exclusion, the earlier-milestone and dropped-milestone cases, and the
  walk-selected balance cases.
- [`REQ-SP-4-NCSEX4`](../specification/disputes/state-proofs.md#req-sp-4-ncsex4) and [`REQ-SP-8-9PK9TS`](../specification/disputes/dispute-processing.md#req-sp-8-9pk9ts) need supplied genesis data only when the fork genesis
  is not on chain (HR-1, HR-3); the walk result no longer reports whether the last point is threshold-proven (HR-6).
- Synchronization (engineer decision): a stale proof, a served state below the walk's start, or a served state that
  does not reach the walk's finalized point, is a verification failure again: a fresh spectator stops and a recovering participant cuts the responder.
  The plan-34 "not complete, no penalty" outcome and its permutations were removed.
- Internal failures are fatal (engineer decision): [`REQ-SP-9-7MWKY8`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8) has no "unavailable" result; a tier
  falls through only on an invalid answer, and every error propagates. [`REQ-MIRROR-4-H9C4YS` (Local-first evaluation, adverse answer confirmed)](../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys) lets the chain
  confirm only an adverse local answer; a local revert, out-of-gas, or executor or worker failure is an error with no
  chain fallback and no retry. The revert-falls-back and unavailable permutations were deleted and replaced.
- The other three engineer decisions of 2026-10-04 (the omitted-data storage check, since deleted by the
  no-abstention decision below, the fraud-block snapshot reuses the loaded state, and the proof-type comments) are
  implementation-only; no requirement changed. They are recorded in [implementation.md](implementation.md).

## 2026-10-04 — Decisions 8-13: no abstention, posted finalized state, stale sync proofs, initial-sync abort

- Honest auditors never abstain (decisions 10, 11): [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) and
  [dispute-processing.md](../specification/disputes/dispute-processing.md) now require a full audit of every dispute: the tail is
  replayed on the dispute's own chain from its first challenge-eligible index, missing chain events are recovered,
  the verified material the auditor lacked is persisted so it can reduce, and data still missing after recovery is an
  internal failure, never a verdict. An expired-kill-period dispute is audited in full, kills nothing, and is then
  persisted and scheduled. The abstain permutations were deleted; new ones were appended.
  [`REQ-SM-6-BJZVQ5`](../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5) now says dispute replay sets the machine to the predecessor state on the dispute's chain.
- Posted finalized state (D1): [`REQ-SP-10-AM67R2`](../specification/disputes/state-proofs.md#req-sp-10-am67r2), fraud-proofs and proof-verification require the
  posted finalized state to be the state of the walk's finalized snapshot, else the state proof is invalid. The
  honest-posting race is the deferred [`OQ-SPEC-POSTED-STATE-RACE-1-1ZM6XN`](../specification/open-questions.md#oq-spec-posted-state-race-1-1zm6xn) (decision 12).
  The cross-layer balance text now says the dispute's latest state (decision 1).
- Synchronization (decisions 8, 9): a served state below the walk's start is a stale proof
  ([synchronization.md](../specification/peer-communication/synchronization.md) step 9); [`INV-SYNC-3-A7A2ED` (Fail-closed with caller-owned consequence)](../specification/peer-communication/synchronization.md#inv-sync-3-a7a2ed) says the initial-load
  owner aborts also on an internal error, with no second initial request.
- Alternate histories (decision 13): [`REQ-SP-10-AM67R2`](../specification/disputes/state-proofs.md#req-sp-10-am67r2) §10 states that a double sign alone does not make a dispute
  invalid; the threshold-final rule is unchanged. [`INV-SP-6-GNW74H`](../specification/disputes/state-proofs.md#inv-sp-6-gnw74h) gained the longest-valid-chain and
  final-dispute permutations.
- Open: the auditor verifies posted data on chain only, a deviation from the local-first order of
  [`REQ-SP-9-7MWKY8`](../specification/disputes/state-proofs.md#req-sp-9-7mwky8) ([`OQ-IMPL-POSTED-VERIFY-1-N00BC3`](../implementation/open-questions.md#oq-impl-posted-verify-1-n00bc3)).
