# Fraud Proofs & the On-Chain Slash Set

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral fraud proofs & the on-chain slash set behavior, assumptions, constraints, security properties, and black-box test plan.

---

## Contents

- [Purpose & observable contract](#1-purpose--observable-contract)
- [Block fraud proofs](#2-block-fraud-proofs)
- [Dispute fraud proofs](#3-dispute-fraud-proofs)
- [The on-chain slash set](#4-the-on-chain-slash-set)
- [Submission paths and the invalid-submission penalty](#5-submission-paths-and-the-invalid-submission-penalty)
- [Completeness is an open review item](#6-completeness-is-an-open-review-item)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose & observable contract

A fraud proof converts an observed objective violation into an on-chain slash. Only
deterministic, mathematically checkable violations qualify; subjective judgments (reputation,
perceived cooperation) are never slashable (see
[trust-model.md](../security/trust-model.md)).

The observable contract (`REQ-FP-1`):

- **Input.** A self-contained proof envelope: `FraudProof { proofType, participant, encodedProof }`
  for block proofs, `DisputeFraudProof { proofType, participant, dispute, encodedProof }` for
  dispute proofs. `participant` is the claimed offender; the encoded payload must make the
  violation checkable from chain state plus the payload alone.
- **Outcome (binary).** The attempt either proves the violation — the handler returns the
  offender's address and the offender is slashed — or it does not, in which case no slash of the
  target occurs. There is no partial outcome and no retry state.
- **Timing.** The attempt is **immediate**: any objective failure discovered by the off-chain
  confirmation/validation pipeline can be proven on-chain at once, at any point in the channel
  lifecycle. It does not wait for, open, or depend on a dispute window (block proofs) — dispute
  proofs alone are additionally bounded by the target dispute's kill period
  ([disputes.md §4.2](./disputes.md)).
- **Effect.** A successful slash is recorded in the per-channel on-chain slash set (§4). Nothing
  else changes at proof time: no fork is created, no state is rolled back, no participant is
  removed from the state machine. Removal and balance effects happen later, when a dispute
  reduction consumes the slash ([disputes.md §5](./disputes.md)).

### Separation from the dispute game

Fraud-proof enforcement is deliberately not a dispute input mechanism. A dispute does not carry
and re-execute the fraud proofs observed during block confirmation; it merely _references_
recorded slashes (`DisputeInput.onChainSlashes`). Invalid state transitions are only one of
several proof categories (§2). The separation prevents redundant on-chain computation: once a
participant is slashed, later evidence of further violations by the same participant does not
need to be replayed to reach the same reduction outcome — `applyFraudProofs` skips proofs whose
target is already slashed (`INV-FP-8`).

**Assumptions, constraints & dependencies.** Deterministic, replayable state machines
([../concepts/state-machines.md](../protocol-model/state-machines.md)) — on-chain re-execution is the
ground truth for transition proofs; canonical serialization of blocks and snapshots
([../concepts/history-and-commitments.md](../protocol-model/history-and-commitments.md)); the
[chain-time model](../protocol-model/time.md) for every timestamp rule; chain and RPC availability per
[trust-model.md](../security/trust-model.md) so an honest observer can submit within the relevant
windows.

## 2. Block fraud proofs

Each proof type is evaluated by its corresponding verification rule, which returns the participant
to slash or an empty result when the claim does not hold. `FraudProofType` has five members:

| `FraudProofType`              | Proves                                                                                                                                                                                                                                                                                                                                                                                                       | Slashed party                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `BlockDoubleSign`             | One signer produced valid signatures over two _distinct_ blocks with the same `forkId` and `transactionCnt` in this channel. Signing is a non-equivocating commitment; this is the equivocation proof.                                                                                                                                                                                                       | The equivocating signer (any signer, not only the author). |
| `BlockInvalidStateTransition` | Re-executing the block's transaction on-chain from the proven previous state (previous block/genesis snapshot + pre-state, all hash-linked) does not reproduce the claimed `stateSnapshotHash` — including failed execution, wrong outbound-message accounting, and broken inbound message-block linkage inside the block.                                                                                   | The block's signer.                                        |
| `WrongGenesis`                | A height-0 block does not link to the correct genesis snapshot of its fork — checked against the on-chain snapshot directly, or, for a dispute-created fork, against the origin window's recorded genesis timestamp once its kill period expired.                                                                                                                                                            | The block author.                                          |
| `InvalidTimestamp`            | The block's timestamp violates the ordering rules: earlier than its predecessor, or beyond the allowed window (`previous + p2pTime`; genesis blocks get `evidenceTime + p2pTime` grace). If the author signed the previous block it forfeits extra time; if the previous block was posted as calldata, the on-chain posting timestamp substitutes for the p2p one. See [time.md](../protocol-model/time.md). | The block author.                                          |
| `ForgedInboundMessageBlock`   | The block includes an inbound message block that was never persisted on-chain (absent from `inboundMessageBlockMap` and not the current snapshot's inbound head). See [cross-layer-messages.md](../settlement/cross-layer-messages.md).                                                                                                                                                                      | The block author.                                          |

`REQ-FP-2`: each handler MUST be sound (a passing proof implies a real violation by the returned
address) — an unsound handler lets an attacker slash honest participants. Completeness across
violation classes is explicitly _not_ claimed; see §6.

## 3. Dispute fraud proofs

The second family proves that a _dispute itself_ is objectively invalid, and is the enforcement
half of the kill period ([disputes.md §4.2](./disputes.md)). Dispatched by
`DisputeFraudProofFacet.applyDisputeFraudProofs`;
every current handler slashes the dispute's disputer when the proof holds.
`DisputeFraudProofType` (verified against the enum — seventeen members):

| `DisputeFraudProofType`                          | Proves the dispute …                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DisputeNotLatestState`                          | claimed a latest state older than a block the _disputer itself_ signed on the same fork (the submitted newer signed block is the evidence).                                                                                                                                                                                                                                                      |
| `DisputeInvalidOutputState`                      | committed an `outputSnapshotDataHash` that does not match the on-chain recomputation of the dispute's output snapshot from its own inputs.                                                                                                                                                                                                                                                       |
| `DisputeInvalidStateProof`                       | carried a state proof that fails verification — broken signed-block linkage, wrong latest-state derivation, or (with posted auditing data) full `verifyStateProof` failure.                                                                                                                                                                                                                      |
| `DisputeInvalidBalanceInvariant`                 | referenced a latest finalized state that violates the channel-balance invariant (`verifyBalanceInvariantCheckSnapshot`; see [../concepts/state-machines.md](../protocol-model/state-machines.md) and [cross-layer-messages.md](../settlement/cross-layer-messages.md)).                                                                                                                          |
| `DisputeOnChainSlashesNotSubset`                 | listed an on-chain slash that is not in the channel's recorded slash set (§4). If the listed set _is_ a subset, the call reverts (`RaceConditionOnChainSlashes`) instead of slashing the submitter — slash-set contents are time-dependent.                                                                                                                                                      |
| `TimeoutThreshold`                               | asserted a timeout for a block that actually carries full-threshold signatures.                                                                                                                                                                                                                                                                                                                  |
| `TimeoutCalldataPosted`                          | asserted a timeout although the target posted the block as valid, timely on-chain calldata (full state-transition re-execution included).                                                                                                                                                                                                                                                        |
| `TimeoutNotLinkedToLatestState`                  | asserted a timeout whose height is not latest-proved-height + 1.                                                                                                                                                                                                                                                                                                                                 |
| `TimeoutParticipantNotNext`                      | asserted a timeout against a participant who is not `getNextToWrite` of the latest proved state.                                                                                                                                                                                                                                                                                                 |
| `TimeoutTooEarly`                                | opened the timeout window before the deterministic deadline (`previous + firstBlockGrace + p2pTime + agreementTime + chainFallbackTime`; see [disputes.md §6.3](./disputes.md)).                                                                                                                                                                                                                 |
| `DisputeInvalidBlockInStateProofApplyFraudProof` | included an unfinalized state-proof block that is provably fraudulent via an embedded block fraud proof (`BlockInvalidStateTransition`, `WrongGenesis`, `InvalidTimestamp`, or `ForgedInboundMessageBlock`; the proof must target that exact block). `BlockDoubleSign` is deliberately excluded — equivocation elsewhere does not invalidate this proof chain; it is slashed on the normal path. |
| `DisputeLastMilestoneNotFinalAndNoAuditingData`  | omitted auditing calldata although its last milestone is not provably final by the required set.                                                                                                                                                                                                                                                                                                 |
| `InvalidDisputeReason`                           | stated none of the four valid dispute inputs ([disputes.md §2](./disputes.md)).                                                                                                                                                                                                                                                                                                                  |
| `DisputeStateProofHeaderMismatch`                | carried state-proof blocks whose header `channelId`/`forkId` do not match the dispute input.                                                                                                                                                                                                                                                                                                     |
| `DisputeInboundHashNotInChain`                   | claimed an inbound tip hash/height that does not lie on the channel's on-chain inbound message chain.                                                                                                                                                                                                                                                                                            |
| `DisputeInvalidBlockStructure`                   | carried a structurally invalid block (undecodable, bad signature linkage, broken hash chain, skipped height) in the unfinalized part of its state proof.                                                                                                                                                                                                                                         |
| `DisputeBlockAuthorNotParticipant`               | carried an unfinalized state-proof block authored by an address outside the participant set of the linked snapshots.                                                                                                                                                                                                                                                                             |

`REQ-FP-7`: a valid dispute fraud proof, applied while the target dispute is committed and its
window's kill period is running, MUST remove the dispute's commitment and add the disputer to the
slash set; the same call against an uncommitted dispute is a no-op and against an expired kill
period reverts (semantics and open questions in [disputes.md §4.2](./disputes.md)).

## 4. The on-chain slash set

The protocol maintains an append-only, per-channel set of
`OnChainSlash { participant, timestamp }` records.

- **Ownership & update rule (`REQ-FP-3`).** Only objective adjudication outcomes append a record.
  Entries are deduplicated, stamped with chain time, and emit an observable slash event. Successful
  block proofs, self-slashing, failed dispute-proof submissions, killed disputes, and invalid
  reduction challenges follow this same rule.
- **Disqualification (`REQ-FP-4`).** A slashed participant is excluded from
  `canParticipateInDisputes` (so it can no longer upload disputes or be penalized as a dispute
  fraud-proof submitter) and from the on-chain threshold set (`getOnChainThresholdSet`), so it
  cannot contribute to threshold finalization of disputes.
- **Reduction input.** `reduce` independently injects the recorded slashes with
  `timestamp ≤` the dispute window's expiry, filtered to the snapshot ∪ pending membership union
  ([disputes.md §5](./disputes.md)). The timestamp cut-off makes the reduction input set
  deterministic for a given window regardless of later slashes.
- **Why a dispute may list a subset (`REQ-FP-5`).** `DisputeInput.onChainSlashes` is a
  convenience copy of what the disputer has observed. It is validated only _downward_ — every
  listed entry must exist on-chain (`DisputeOnChainSlashesNotSubset`), but completeness is not
  required, because the reduction reads the authoritative set itself. Requiring the full set would
  make honest disputes race every concurrent slash transaction; the subset rule keeps disputes
  valid under interleaving while the reduction still consumes all timely slashes.
- **State-machine effect.** Slashes take effect on balances and membership only when a reduction
  applies them (`slashParticipant` on the state machine, producing `ExitChannel`s on the outbound
  stream), with the disposition of slashed stake defined by the integrator's state machine
  through the state-machine boundary.
- **Lifetime.** `For this protocol version:` the set is deleted in `_clearDisputeData` when channel storage is
  cleared after a snapshot advance to an undisputed fork or channel close
  (`StateSnapshotFacet`);
  the code carries a `TODO! Check should we clear this since things happen in 'parallel' now`.
  **Open question:** whether clearing the slash set on storage-clear can drop a slash that a
  concurrent (parallel-fork) flow still needs; engineer decision required.

## 5. Submission paths and the invalid-submission penalty

`For this protocol version:` submission behavior as specified:

- `applyFraudProofs(fraudProofs[], context)` is a public entry point on the proxy with **no
  sender-eligibility requirement** — anyone (participant, watchtower, third party) may submit
  block fraud proofs at any time. Per proof: targets already in the slash set are skipped
  (`INV-FP-8`); otherwise the proof is run and, on success, the offender is added to the slash set
  (only if the offender is dispute-eligible — i.e. a current or pending, not-yet-slashed
  participant).
- **Self-slashing guard (`For this protocol version:`).** In `applyFraudProofs`, if a submitted proof does not
  validly slash the claimed participant — the handler returns `address(0)` or a different address
  — the _submitter_ (`msg.sender`) is selected for slashing instead, and is actually added to the
  slash set only when the submitter is dispute-eligible. An ineligible outsider submitting an
  invalid proof is a harmless no-op. `applyDisputeFraudProofs` mirrors this: failed proof →
  eligible submitter slashed.
- **off-chain participant path.** The confirmation pipeline stores discovered proofs
  (`FraudProofService` →
  `storage.fraudProofs`) keyed by offender. `For this protocol version:` the off-chain participant submits them on-chain bundled with
  its next dispute upload in a single `multicall` (`applyFraudProofs` + `uploadDispute*` in
  `the corresponding dispute-coordination operation`) rather than as a
  standalone immediate transaction; the contract path itself is dispute-independent, so an
  immediate standalone submission is valid whenever a client chooses it. Dispute fraud proofs are
  preflighted via `staticCall` before submission so an honest auditor never triggers the
  self-slash guard (`DisputeValidationService`).

**Open question (`REQ-FP-6`):** whether and how a sender SHOULD be penalized for submitting an
invalid fraud proof is unresolved design. The self-slashing guard above is what the required behavior provides; it
deters bogus-proof spam from channel members but leaves outsiders unpenalized, punishes honest
mistakes and races (mitigated but not eliminated by preflighting — e.g. calldata posted between
preflight and inclusion), and its interaction with batch atomicity (`applyDisputeFraudProofs`
reverts a whole batch on one expired item) is untested. Do not treat self-slashing as settled
intent; engineer confirmation required before implementation work relies on it.

## 6. Completeness is an open review item

The taxonomies in §2–§3 MUST NOT be treated as a complete enumeration of objectively provable
violations (`REQ-FP-9`). A dedicated security review has to ask which provable violations are not
yet covered by any proof, and which attack paths are neither prevented, detected, nor
recoverable — across block production, signatures and equivocation, virtual voting, state proofs
and milestone hops, membership changes, message streams, snapshot updates, proof submission
itself, slash-set handling, reduction, timing, and data availability. That review, its threat
analysis, and the gap register live in
../security/open-security-review.md; until it closes, this
document's lists describe the implemented set only.

## Assumptions and constraints

Fraud-proof soundness assumes the proof contains or references available canonical data, validators agree on
the same contract runtime-owned predicates, signatures and commitments are authentic, and replay is deterministic.
Each proof type has bounded encoding and gas cost and identifies exactly one objective violation and offender.
Subjective behavior is outside this mechanism. Calldata and non-calldata submission paths must enforce the same
predicate, and an unsupported or malformed proof must not produce a slash.

## Security considerations

Fraud proofs directly authorize punitive state changes, so false positives are fund-safety failures. Threats
include forged attribution, validator drift between off-chain runtime and contract runtime, proof-type confusion, malformed
payload decoding, duplicate or stale slash entries, invalid-submission griefing, and omission of a violation
family. Every proof requires positive, negative, boundary, wrong-offender, wrong-domain, malformed, replayed,
and both-submission-path cases. Completeness and invalid-proof penalties remain explicit security review items.

## Requirements and invariants

This table is the normative requirement index. Detailed rules and rationale are defined in the sections above.

| Requirement / invariant         | Statement                                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-fp-1"></a>`REQ-FP-1` | Fraud-proof enforcement is separate from the dispute game: an observed objective violation can be proven immediately, with a binary prove-and-slash / no-slash outcome; disputes consume recorded slashes instead of re-executing proofs. |
| <a id="req-fp-2"></a>`REQ-FP-2` | Every block fraud-proof handler is sound: a passing proof implies a real violation by the returned address (types: `BlockDoubleSign`, `BlockInvalidStateTransition`, `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock`).    |
| <a id="req-fp-3"></a>`REQ-FP-3` | Slashes are recorded only via `addOnChainSlashedParticipant`: per-channel, append-only, deduplicated, timestamped, evented.                                                                                                               |
| <a id="req-fp-4"></a>`REQ-FP-4` | A recorded slash disqualifies the participant from dispute participation and from the on-chain threshold set.                                                                                                                             |
| <a id="req-fp-5"></a>`REQ-FP-5` | A dispute may list any subset of recorded slashes; listing an unrecorded slash is disprovable (`DisputeOnChainSlashesNotSubset`), and the reduction independently consumes all slashes recorded up to window expiry.                      |
| <a id="req-fp-6"></a>`REQ-FP-6` | `For this protocol version:` an invalid fraud proof slashes its dispute-eligible submitter (self-slashing guard); the intended penalty rule for invalid submissions is an **open question** awaiting engineer decision.                   |
| <a id="req-fp-7"></a>`REQ-FP-7` | A valid dispute fraud proof applied within the kill period kills the committed dispute and slashes its disputer; uncommitted targets are no-ops; expired kill periods revert.                                                             |
| <a id="inv-fp-8"></a>`INV-FP-8` | Proof application is idempotent per offender: proofs targeting an already-slashed participant are skipped, and duplicate slashes are never recorded.                                                                                      |
| <a id="req-fp-9"></a>`REQ-FP-9` | The fraud-proof taxonomy MUST NOT be treated as complete; completeness is gated on the dedicated security review.                                                                                                                         |

## Verification and test plan

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item     | Requirements / invariants | Setup and stimulus                                                                                                                                    | Expected result                                                                                                                                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-FP-1.T1` | `REQ-FP-1`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Fraud-proof enforcement is separate from the dispute game: an observed objective violation can be proven immediately, with a binary prove-and-slash / no-slash outcome; disputes consume recorded slashes instead of re-executing proofs. | <a id="req-fp-1.t1.p1"></a>`REQ-FP-1.T1.P1` — valid case<br><a id="req-fp-1.t1.p2"></a>`REQ-FP-1.T1.P2` — new participant<br><a id="req-fp-1.t1.p3"></a>`REQ-FP-1.T1.P3` — malformed input<br><a id="req-fp-1.t1.p4"></a>`REQ-FP-1.T1.P4` — direct invalid/opposite case<br><a id="req-fp-1.t1.p5"></a>`REQ-FP-1.T1.P5` — existing participant<br><a id="req-fp-1.t1.p6"></a>`REQ-FP-1.T1.P6` — removed participant<br><a id="req-fp-1.t1.p7"></a>`REQ-FP-1.T1.P7` — slashed participant<br><a id="req-fp-1.t1.p8"></a>`REQ-FP-1.T1.P8` — concurrent membership change<br><a id="req-fp-1.t1.p9"></a>`REQ-FP-1.T1.P9` — adversarial input<br><a id="req-fp-1.t1.p10"></a>`REQ-FP-1.T1.P10` — partial failure<br><a id="req-fp-1.t1.p11"></a>`REQ-FP-1.T1.P11` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `REQ-FP-2.T1` | `REQ-FP-2`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Every block fraud-proof handler is sound: a passing proof implies a real violation by the returned address (types: `BlockDoubleSign`, `BlockInvalidStateTransition`, `WrongGenesis`, `InvalidTimestamp`, `ForgedInboundMessageBlock`).    | <a id="req-fp-2.t1.p1"></a>`REQ-FP-2.T1.P1` — valid case<br><a id="req-fp-2.t1.p2"></a>`REQ-FP-2.T1.P2` — matching commitment<br><a id="req-fp-2.t1.p3"></a>`REQ-FP-2.T1.P3` — correct identity/signature<br><a id="req-fp-2.t1.p4"></a>`REQ-FP-2.T1.P4` — before deadline<br><a id="req-fp-2.t1.p5"></a>`REQ-FP-2.T1.P5` — malformed input<br><a id="req-fp-2.t1.p6"></a>`REQ-FP-2.T1.P6` — direct invalid/opposite case<br><a id="req-fp-2.t1.p7"></a>`REQ-FP-2.T1.P7` — mismatched commitment<br><a id="req-fp-2.t1.p8"></a>`REQ-FP-2.T1.P8` — predecessor case<br><a id="req-fp-2.t1.p9"></a>`REQ-FP-2.T1.P9` — genesis case<br><a id="req-fp-2.t1.p10"></a>`REQ-FP-2.T1.P10` — stale fork<br><a id="req-fp-2.t1.p11"></a>`REQ-FP-2.T1.P11` — foreign fork<br><a id="req-fp-2.t1.p12"></a>`REQ-FP-2.T1.P12` — wrong identity/signature<br><a id="req-fp-2.t1.p13"></a>`REQ-FP-2.T1.P13` — missing identity/signature<br><a id="req-fp-2.t1.p14"></a>`REQ-FP-2.T1.P14` — duplicate identity/signature<br><a id="req-fp-2.t1.p15"></a>`REQ-FP-2.T1.P15` — forged identity/signature<br><a id="req-fp-2.t1.p16"></a>`REQ-FP-2.T1.P16` — membership boundary<br><a id="req-fp-2.t1.p17"></a>`REQ-FP-2.T1.P17` — at deadline<br><a id="req-fp-2.t1.p18"></a>`REQ-FP-2.T1.P18` — after deadline<br><a id="req-fp-2.t1.p19"></a>`REQ-FP-2.T1.P19` — maximum honest skew<br><a id="req-fp-2.t1.p20"></a>`REQ-FP-2.T1.P20` — adversarial input<br><a id="req-fp-2.t1.p21"></a>`REQ-FP-2.T1.P21` — partial failure<br><a id="req-fp-2.t1.p22"></a>`REQ-FP-2.T1.P22` — retry and recovery |
| `REQ-FP-3.T1` | `REQ-FP-3`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Slashes are recorded only via `addOnChainSlashedParticipant`: per-channel, append-only, deduplicated, timestamped, evented.                                                                                                               | <a id="req-fp-3.t1.p1"></a>`REQ-FP-3.T1.P1` — valid case<br><a id="req-fp-3.t1.p2"></a>`REQ-FP-3.T1.P2` — correct identity/signature<br><a id="req-fp-3.t1.p3"></a>`REQ-FP-3.T1.P3` — before deadline<br><a id="req-fp-3.t1.p4"></a>`REQ-FP-3.T1.P4` — new participant<br><a id="req-fp-3.t1.p5"></a>`REQ-FP-3.T1.P5` — duplicate delivery<br><a id="req-fp-3.t1.p6"></a>`REQ-FP-3.T1.P6` — direct invalid/opposite case<br><a id="req-fp-3.t1.p7"></a>`REQ-FP-3.T1.P7` — wrong identity/signature<br><a id="req-fp-3.t1.p8"></a>`REQ-FP-3.T1.P8` — missing identity/signature<br><a id="req-fp-3.t1.p9"></a>`REQ-FP-3.T1.P9` — duplicate identity/signature<br><a id="req-fp-3.t1.p10"></a>`REQ-FP-3.T1.P10` — forged identity/signature<br><a id="req-fp-3.t1.p11"></a>`REQ-FP-3.T1.P11` — membership boundary<br><a id="req-fp-3.t1.p12"></a>`REQ-FP-3.T1.P12` — at deadline<br><a id="req-fp-3.t1.p13"></a>`REQ-FP-3.T1.P13` — after deadline<br><a id="req-fp-3.t1.p14"></a>`REQ-FP-3.T1.P14` — maximum honest skew<br><a id="req-fp-3.t1.p15"></a>`REQ-FP-3.T1.P15` — existing participant<br><a id="req-fp-3.t1.p16"></a>`REQ-FP-3.T1.P16` — removed participant<br><a id="req-fp-3.t1.p17"></a>`REQ-FP-3.T1.P17` — slashed participant<br><a id="req-fp-3.t1.p18"></a>`REQ-FP-3.T1.P18` — concurrent membership change<br><a id="req-fp-3.t1.p19"></a>`REQ-FP-3.T1.P19` — replayed delivery<br><a id="req-fp-3.t1.p20"></a>`REQ-FP-3.T1.P20` — permuted delivery order<br><a id="req-fp-3.t1.p21"></a>`REQ-FP-3.T1.P21` — concurrent delivery                              |
| `REQ-FP-4.T1` | `REQ-FP-4`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A recorded slash disqualifies the participant from dispute participation and from the on-chain threshold set.                                                                                                                             | <a id="req-fp-4.t1.p1"></a>`REQ-FP-4.T1.P1` — valid case<br><a id="req-fp-4.t1.p2"></a>`REQ-FP-4.T1.P2` — correct identity/signature<br><a id="req-fp-4.t1.p3"></a>`REQ-FP-4.T1.P3` — new participant<br><a id="req-fp-4.t1.p4"></a>`REQ-FP-4.T1.P4` — malformed input<br><a id="req-fp-4.t1.p5"></a>`REQ-FP-4.T1.P5` — direct invalid/opposite case<br><a id="req-fp-4.t1.p6"></a>`REQ-FP-4.T1.P6` — wrong identity/signature<br><a id="req-fp-4.t1.p7"></a>`REQ-FP-4.T1.P7` — missing identity/signature<br><a id="req-fp-4.t1.p8"></a>`REQ-FP-4.T1.P8` — duplicate identity/signature<br><a id="req-fp-4.t1.p9"></a>`REQ-FP-4.T1.P9` — forged identity/signature<br><a id="req-fp-4.t1.p10"></a>`REQ-FP-4.T1.P10` — membership boundary<br><a id="req-fp-4.t1.p11"></a>`REQ-FP-4.T1.P11` — existing participant<br><a id="req-fp-4.t1.p12"></a>`REQ-FP-4.T1.P12` — removed participant<br><a id="req-fp-4.t1.p13"></a>`REQ-FP-4.T1.P13` — slashed participant<br><a id="req-fp-4.t1.p14"></a>`REQ-FP-4.T1.P14` — concurrent membership change<br><a id="req-fp-4.t1.p15"></a>`REQ-FP-4.T1.P15` — adversarial input<br><a id="req-fp-4.t1.p16"></a>`REQ-FP-4.T1.P16` — partial failure<br><a id="req-fp-4.t1.p17"></a>`REQ-FP-4.T1.P17` — retry and recovery                                                                                                                                                                                                                                                                                                                     |
| `REQ-FP-5.T1` | `REQ-FP-5`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A dispute may list any subset of recorded slashes; listing an unrecorded slash is disprovable (`DisputeOnChainSlashesNotSubset`), and the reduction independently consumes all slashes recorded up to window expiry.                      | <a id="req-fp-5.t1.p1"></a>`REQ-FP-5.T1.P1` — valid case<br><a id="req-fp-5.t1.p2"></a>`REQ-FP-5.T1.P2` — before deadline<br><a id="req-fp-5.t1.p3"></a>`REQ-FP-5.T1.P3` — new participant<br><a id="req-fp-5.t1.p4"></a>`REQ-FP-5.T1.P4` — malformed input<br><a id="req-fp-5.t1.p5"></a>`REQ-FP-5.T1.P5` — direct invalid/opposite case<br><a id="req-fp-5.t1.p6"></a>`REQ-FP-5.T1.P6` — at deadline<br><a id="req-fp-5.t1.p7"></a>`REQ-FP-5.T1.P7` — after deadline<br><a id="req-fp-5.t1.p8"></a>`REQ-FP-5.T1.P8` — maximum honest skew<br><a id="req-fp-5.t1.p9"></a>`REQ-FP-5.T1.P9` — existing participant<br><a id="req-fp-5.t1.p10"></a>`REQ-FP-5.T1.P10` — removed participant<br><a id="req-fp-5.t1.p11"></a>`REQ-FP-5.T1.P11` — slashed participant<br><a id="req-fp-5.t1.p12"></a>`REQ-FP-5.T1.P12` — concurrent membership change<br><a id="req-fp-5.t1.p13"></a>`REQ-FP-5.T1.P13` — adversarial input<br><a id="req-fp-5.t1.p14"></a>`REQ-FP-5.T1.P14` — partial failure<br><a id="req-fp-5.t1.p15"></a>`REQ-FP-5.T1.P15` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `REQ-FP-6.T1` | `REQ-FP-6`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | `For this protocol version:` an invalid fraud proof slashes its dispute-eligible submitter (self-slashing guard); the intended penalty rule for invalid submissions is an **open question** awaiting engineer decision.                   | <a id="req-fp-6.t1.p1"></a>`REQ-FP-6.T1.P1` — valid case<br><a id="req-fp-6.t1.p2"></a>`REQ-FP-6.T1.P2` — new participant<br><a id="req-fp-6.t1.p3"></a>`REQ-FP-6.T1.P3` — malformed input<br><a id="req-fp-6.t1.p4"></a>`REQ-FP-6.T1.P4` — direct invalid/opposite case<br><a id="req-fp-6.t1.p5"></a>`REQ-FP-6.T1.P5` — existing participant<br><a id="req-fp-6.t1.p6"></a>`REQ-FP-6.T1.P6` — removed participant<br><a id="req-fp-6.t1.p7"></a>`REQ-FP-6.T1.P7` — slashed participant<br><a id="req-fp-6.t1.p8"></a>`REQ-FP-6.T1.P8` — concurrent membership change<br><a id="req-fp-6.t1.p9"></a>`REQ-FP-6.T1.P9` — adversarial input<br><a id="req-fp-6.t1.p10"></a>`REQ-FP-6.T1.P10` — partial failure<br><a id="req-fp-6.t1.p11"></a>`REQ-FP-6.T1.P11` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `REQ-FP-7.T1` | `REQ-FP-7`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A valid dispute fraud proof applied within the kill period kills the committed dispute and slashes its disputer; uncommitted targets are no-ops; expired kill periods revert.                                                             | <a id="req-fp-7.t1.p1"></a>`REQ-FP-7.T1.P1` — valid case<br><a id="req-fp-7.t1.p2"></a>`REQ-FP-7.T1.P2` — matching commitment<br><a id="req-fp-7.t1.p3"></a>`REQ-FP-7.T1.P3` — before deadline<br><a id="req-fp-7.t1.p4"></a>`REQ-FP-7.T1.P4` — new participant<br><a id="req-fp-7.t1.p5"></a>`REQ-FP-7.T1.P5` — malformed input<br><a id="req-fp-7.t1.p6"></a>`REQ-FP-7.T1.P6` — direct invalid/opposite case<br><a id="req-fp-7.t1.p7"></a>`REQ-FP-7.T1.P7` — mismatched commitment<br><a id="req-fp-7.t1.p8"></a>`REQ-FP-7.T1.P8` — predecessor case<br><a id="req-fp-7.t1.p9"></a>`REQ-FP-7.T1.P9` — genesis case<br><a id="req-fp-7.t1.p10"></a>`REQ-FP-7.T1.P10` — stale fork<br><a id="req-fp-7.t1.p11"></a>`REQ-FP-7.T1.P11` — foreign fork<br><a id="req-fp-7.t1.p12"></a>`REQ-FP-7.T1.P12` — at deadline<br><a id="req-fp-7.t1.p13"></a>`REQ-FP-7.T1.P13` — after deadline<br><a id="req-fp-7.t1.p14"></a>`REQ-FP-7.T1.P14` — maximum honest skew<br><a id="req-fp-7.t1.p15"></a>`REQ-FP-7.T1.P15` — existing participant<br><a id="req-fp-7.t1.p16"></a>`REQ-FP-7.T1.P16` — removed participant<br><a id="req-fp-7.t1.p17"></a>`REQ-FP-7.T1.P17` — slashed participant<br><a id="req-fp-7.t1.p18"></a>`REQ-FP-7.T1.P18` — concurrent membership change<br><a id="req-fp-7.t1.p19"></a>`REQ-FP-7.T1.P19` — adversarial input<br><a id="req-fp-7.t1.p20"></a>`REQ-FP-7.T1.P20` — partial failure<br><a id="req-fp-7.t1.p21"></a>`REQ-FP-7.T1.P21` — retry and recovery                                                                                                    |
| `INV-FP-8.T1` | `INV-FP-8`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Proof application is idempotent per offender: proofs targeting an already-slashed participant are skipped, and duplicate slashes are never recorded.                                                                                      | <a id="inv-fp-8.t1.p1"></a>`INV-FP-8.T1.P1` — valid case<br><a id="inv-fp-8.t1.p2"></a>`INV-FP-8.T1.P2` — correct identity/signature<br><a id="inv-fp-8.t1.p3"></a>`INV-FP-8.T1.P3` — new participant<br><a id="inv-fp-8.t1.p4"></a>`INV-FP-8.T1.P4` — duplicate delivery<br><a id="inv-fp-8.t1.p5"></a>`INV-FP-8.T1.P5` — direct invalid/opposite case<br><a id="inv-fp-8.t1.p6"></a>`INV-FP-8.T1.P6` — wrong identity/signature<br><a id="inv-fp-8.t1.p7"></a>`INV-FP-8.T1.P7` — missing identity/signature<br><a id="inv-fp-8.t1.p8"></a>`INV-FP-8.T1.P8` — duplicate identity/signature<br><a id="inv-fp-8.t1.p9"></a>`INV-FP-8.T1.P9` — forged identity/signature<br><a id="inv-fp-8.t1.p10"></a>`INV-FP-8.T1.P10` — membership boundary<br><a id="inv-fp-8.t1.p11"></a>`INV-FP-8.T1.P11` — existing participant<br><a id="inv-fp-8.t1.p12"></a>`INV-FP-8.T1.P12` — removed participant<br><a id="inv-fp-8.t1.p13"></a>`INV-FP-8.T1.P13` — slashed participant<br><a id="inv-fp-8.t1.p14"></a>`INV-FP-8.T1.P14` — concurrent membership change<br><a id="inv-fp-8.t1.p15"></a>`INV-FP-8.T1.P15` — replayed delivery<br><a id="inv-fp-8.t1.p16"></a>`INV-FP-8.T1.P16` — permuted delivery order<br><a id="inv-fp-8.t1.p17"></a>`INV-FP-8.T1.P17` — concurrent delivery                                                                                                                                                                                                                                                                                                         |
| `REQ-FP-9.T1` | `REQ-FP-9`                | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | The fraud-proof taxonomy MUST NOT be treated as complete; completeness is gated on the dedicated security review.                                                                                                                         | <a id="req-fp-9.t1.p1"></a>`REQ-FP-9.T1.P1` — valid case<br><a id="req-fp-9.t1.p2"></a>`REQ-FP-9.T1.P2` — malformed input<br><a id="req-fp-9.t1.p3"></a>`REQ-FP-9.T1.P3` — static review of named alternatives<br><a id="req-fp-9.t1.p4"></a>`REQ-FP-9.T1.P4` — direct invalid/opposite case<br><a id="req-fp-9.t1.p5"></a>`REQ-FP-9.T1.P5` — adversarial input<br><a id="req-fp-9.t1.p6"></a>`REQ-FP-9.T1.P6` — partial failure<br><a id="req-fp-9.t1.p7"></a>`REQ-FP-9.T1.P7` — retry and recovery<br><a id="req-fp-9.t1.p8"></a>`REQ-FP-9.T1.P8` — static review of omitted categories<br><a id="req-fp-9.t1.p9"></a>`REQ-FP-9.T1.P9` — static review of changed assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Future Work

_Non-normative._

- Resolve the invalid-submission penalty design (§5): candidate rules include bonded submission,
  no-penalty-with-rate-limit, or the current self-slash restricted to provably malicious
  submissions; each changes watchtower economics and must be analyzed with the griefing model in
  [../security/data-availability.md](../security/data-availability.md).
- Batch/aggregate proof submission and gas accounting for multi-violation offenders, once the
  security review (§6) fixes the target taxonomy.
- Consider surfacing the slash set to integrator state machines (e.g. richer
  `slashParticipant` context) so applications can implement custom slashed-stake disposition.
