# Finality

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral finality behavior, assumptions, constraints, security properties, and black-box test plan.

## Contents

- [Purpose & observable contract](#1-purpose--observable-contract)
- [Continuous execution](#2-continuous-execution)
- [Signing is a non-equivocating vote](#3-signing-is-a-non-equivocating-vote)
- [Virtual voting](#4-virtual-voting)
- [Leader election](#5-leader-election)
- [The three finality routes and the exact threshold](#6-the-three-finality-routes-and-the-exact-threshold)
- [Non-final transitions are carried forward](#7-non-final-transitions-are-carried-forward)
- [On-chain fallback when threshold finality is not reached](#8-on-chain-fallback-when-threshold-finality-is-not-reached)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose & observable contract

A block is **final** when the protocol can prove to the chain that no competing history over that
block can win. Finality is what a snapshot update needs ([lifecycle.md §5](../settlement/lifecycle.md)); it is
deliberately **decoupled from progress** — execution never stops to wait for it.

## 2. Continuous execution

**<a id="req-fin-1-sp669g"></a>`REQ-FIN-1-SP669G`.** Participants MUST NOT be required to wait for explicit threshold finality before
building the next block. The scheduled author builds on the latest valid state immediately, even
when that state's block has not yet collected all signatures. Requiring agreement before progress
contradicts the liveness model: one slow or absent signer would stall the channel even though the
dispute path can already prove and carry the unagreed suffix forward.

This corrects the old specification's §5.4, which required an instance not to build on unagreed
blocks. The correction is the intended design, and it is also what the required behavior provides.

## 3. Signing is a non-equivocating vote

**<a id="inv-fin-2-mk27j6"></a>`INV-FIN-2-MK27J6`.** Signing a block is a binding, non-equivocating vote for that block **and the
history it links to**. A participant MUST NOT sign two different blocks at the same
`(forkId, height)` or otherwise commit to conflicting histories. Provable equivocation is fraud:
the `BlockDoubleSign` fraud proof slashes the signer
([fraud-proofs.md](../disputes/fraud-proofs.md), `fraud-proof verifier`). A frozen selected
tower's block confirmation supplies participant credits
([`REQ-FIN-7-RTZWQZ`](finality.md#req-fin-7-rtzwqz)) and carries the same non-equivocation
premise: a tower MUST NOT confirm two distinct blocks at the same channel, fork, and height —
that pair is objective tower equivocation burning its permanent bond
([`INV-WT-1-ST9SHX`](../runtime/watchtowers.md#inv-wt-1-st9shx)) while the authoring
participants' own double-sign stays slashable on the ordinary path. Neither punishment resolves the
conflicting same-fork histories, and none is needed as a settlement gate: under the protocol's safety premise — at least one
threshold-required peer whose full chosen authority path is honest — the peer alone when
towerless, or the peer and its selected tower when it delegates (a self-run tower carries the
same peer trust assumption) —
two conflicting same-fork histories cannot both reach finality. In the
fully malicious exception where they do, ordinary on-chain settlement order governs: among
competing updates at the same height, the first valid same-fork snapshot update settles the
winning history and a later same-height conflicting update is rejected as not newer, while a
later **higher** valid same-fork snapshot may replace the settled snapshot without ancestry when
it passes the existing threshold, finality, objective state-validity, balance, accounting, and
collective-deposit conservation checks
([`REQ-LIF-2-Z3Z9Y3`](../settlement/lifecycle.md#req-lif-2-z3z9y3)); settlement and withdrawal
effects stay deposit-bounded and occur at most once; and double-sign proofs, tower contradiction
proofs, and dispute transactions may be ordered before or after a snapshot update and trigger
their own slashing independently — no proof or dispute is a prerequisite for, or can itself
replace, a settled snapshot.

This invariant is what makes the rest of this document safe: votes can be counted across blocks
(§4) because no participant can validly vote for two competing histories, and a non-final suffix
can be carried forward (§7, [state-proofs.md §6](../disputes/state-proofs.md)) because extending it never
requires trusting an unbacked claim.

## 4. Virtual voting

**<a id="req-fin-3-9p9j4q"></a>`REQ-FIN-3-9P9J4Q`.** A signature on block _B_ is also an indirect vote for every ancestor of _B_ on the
same hash-linked chain. Votes are therefore **cumulative across ancestry in effective participant
credits**: each carrying confirmation's signatures derive credits — a direct participant
signature credits its signer, a frozen selected-tower signature credits every eligible assigned
participant under the assignment at that confirmation
([`REQ-FIN-7-RTZWQZ`](finality.md#req-fin-7-rtzwqz)) — and the votes for a block are the union of
the credits derived on it and on its linked descendants, each participant deduplicated to one
credit while every signature artifact stays retained.

**<a id="req-fin-4-zfdds6"></a>`REQ-FIN-4-ZFDDS6`.** Consequently, in a channel with _N_ participants, _N_ consecutive blocks authored
by the complete participant set finalize the **first** block of the sequence, even if no
participant other than its author ever signed that first block directly: each author's signature
on their own block is a vote for all its ancestors, and the _N_ authors together cover the
threshold set.

```mermaid
flowchart LR
    B1["Block 1<br/>author A (sig A)"] --> B2["Block 2<br/>author B (sig B)"] --> B3["Block 3<br/>author C (sig C)"]
    B3 -. "sig C votes for 3, 2, 1" .-> B1
    B2 -. "sig B votes for 2, 1" .-> B1
    B1 -. "sigs {A,B,C} ⊇ threshold set ⇒ Block 1 final" .-> F(("final anchor"))
```

## 5. Leader election

**<a id="req-fin-5-dh29vz"></a>`REQ-FIN-5-DH29VZ`.** Block authoring is deterministic: `getNextToWrite()` — a pure function of the

**[`REQ-FIN-6-YZWJX2`](finality.md#req-fin-6-yzwjx2) (SHOULD).** The recommended policy is **round-robin** over the participant set, as a
function of channel state (e.g.
`the illustrative round-robin rule`:
`participants[currentTurnIndex % participants.length]`). The safety argument for carrying
non-final suffixes forward (§7) **depends on** round-robin; see the open question below.

Authoring is time-slotted: the author has `p2pTime` from the previous relevant timestamp to
produce the block ([lifecycle.md §8](../settlement/lifecycle.md), [time.md](./time.md)). A missed slot is
objectively disputable: peers schedule a timeout check for
`p2pTime + agreementTime + chainFallbackTime` (+ first-block grace)
(`the corresponding participant-state operation`) and
then open a timeout dispute against the scheduled author
([disputes.md](../disputes/disputes.md)).

**Open question (leader election beyond round-robin):** under a different leader-election policy a
valid non-final suffix may become revertible, changing the safety, liveness, and accountability
analysis. Any objectively provable violation that a revert implies should have a clearly
attributable, slashable party, but the attribution and penalty rules are unresolved. Long-lived
channels and long-range milestone chains also need an argument that proofs stay bounded and that
long-range conflicting histories are prevented or recoverable. Before another policy is supported,
its schedule, its interaction with virtual voting and longest-valid-chain reduction, the exact
revert conditions, and the accountable party for each violation must be specified. Mirrored in
[open-questions.md](../open-questions.md) and cross-referenced from
[state-proofs.md](../disputes/state-proofs.md).

## 6. The three finality routes and the exact threshold

Finality arrives by exactly one of three routes:

1. **Explicit threshold finality.** Every required participant supplied its credit — a direct
   signature, or a valid confirmation from its frozen selected tower crediting it
   ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)) — so the `BlockConfirmation`
   carries a full effective-credit set.
2. **Virtual finality.** Later cryptographically linked blocks supply the missing votes (§4).
3. **Dispute resolution.** No threshold was reached in time; a participant submits the latest
   available (possibly non-final) proved state to the dispute game, and after reduction and the
   challenge period the result is canonical ([disputes.md](../disputes/disputes.md)).

**<a id="req-fin-7-rtzwqz"></a>`REQ-FIN-7-RTZWQZ`.** The threshold is **unanimous** over the _relevant participant set_:

- Off-chain: `the corresponding agreement-tracking operation`
  requires signatures from the union of the block's previous and resulting participant sets, so a
  membership-changing block needs both the old set and the joiner/leaver where applicable
  ([state-proofs.md §5](../disputes/state-proofs.md)).
- On-chain (milestones): `_isMilestoneFinalWithExpectedParticipants` requires
  `thresholdCount == expectedParticipants.length`, where the expected set is the union of the
  previous snapshot's participants, the resulting snapshot's participants, and joiners derived
  from the inbound-message interval committed between the two snapshots' inbound hashes — not the
  chain's live pending set
  (`the corresponding state-proof verification operation`).
- On-chain (disputes): a threshold-final dispute confirmation requires signatures from
  `getOnChainThresholdSet` = (snapshot participants ∪ pending participants) − on-chain-slashed
  (`common adjudication logic`),
  and finalizes the dispute window immediately
  (`DisputeManagerFacet._isDisputeThresholdFinal`).
- Credits, not raw signatures — **block-confirmation thresholds only, milestones included**: a
  required participant's vote on a block confirmation is supplied by its own signature or by a
  valid confirmation from its frozen selected tower crediting it
  ([`REQ-WT-4-PNMYMP`](../runtime/watchtowers.md#req-wt-4-pnmymp)); the two deduplicate to one
  effective credit at threshold calculation while both artifacts stay retained, and one
  shared-tower signature may credit several assigned participants — up to the whole threshold
  ([`REQ-DIS-12-1ZN453`](../disputes/disputes.md#req-dis-12-1zn453)). Dispute-confirmation
  thresholds are exempt: substitution there remains limited to the exact signed-dispute
  `WatchtowerDisputeApproval` of [`REQ-DIS-14-032T4M`](../disputes/disputes.md#req-dis-14-032t4m) —
  an ordinary tower block confirmation never supplies a dispute-confirmation vote.

Sub-unanimous thresholds are not supported anywhere in the protocol definition.

**One agreement threshold; the chain verifies views of it.** The three formulas above are not
three independent threshold designs. The protocol has exactly one agreement threshold: the
peer-to-peer union of a block's previous and resulting participant sets. Every honest transition
is authorized by that union — the existing set admits a joiner and the joiner consents to enter;
the remaining set agrees to a removal and the leaving participant consents to leave. In an honest
execution, verifying that one threshold across every transition is sufficient; pending joiners
become part of the resulting set when their inbound messages are consumed.

The chain is a third-party verifier over a different memory space: it holds a stale snapshot plus
the inbound messages, slashes, and other facts it has recorded — never the live peer-to-peer
state. It does not replay the off-chain history or re-establish that every transition followed
the protocol; it checks the invariants it can verify from a submitted proof and its own records.
The two on-chain formulas are its acceptance rules for such proofs, not additional agreement
thresholds:

- **Pending joiners in the milestone set are evidence, not a second threshold.** If the chain has
  recorded an inbound join that its snapshot does not yet include, a proof advancing the snapshot
  must show that the joiner was part of the agreement. The verifier therefore derives joiners
  from the inbound interval committed between the proof's two snapshots; in an honest transition
  those joiners already appear in the resulting set, and the milestone set reduces to the plain
  previous∪resulting union. The explicit derivation exists so the chain can reject a proof that
  consumes a recorded join while omitting the joiner. The same goal drives the same-fork
  inbound-consumption rule ([cross-layer-messages.md §2](../settlement/cross-layer-messages.md)):
  a snapshot update must consume the chain's complete inbound head, so a proof cannot advance the
  chain while leaving a recorded join or deposit behind.
- **Slash subtraction is a current-eligibility rule, never a historical one.** Subtracting the
  on-chain slash set is an explicit adjudication decision: after a fraud proof, the chain has
  decided the slashed participant forfeited the right to block threshold resolution, so the
  remaining participants may finalize without that signature. The rule applies only to
  point-in-time chain decisions — dispute participation and threshold-final dispute confirmation
  — that ask who is eligible _now_ and do not replay a linked history. Historical, replayable
  evidence (milestones, state proofs) always requires the complete normal threshold: a proof MUST
  have the same validity before and after any later slash, so later adjudication can never relax
  or invalidate the signatures a past transition required
  ([state-proofs.md §4](../disputes/state-proofs.md)). Join admission is likewise a
  point-in-time chain decision and uses the same slash-excluding eligibility set — a slashed
  participant cannot veto later admissions
  ([cross-layer-messages.md §4](../settlement/cross-layer-messages.md)).

**Implicit attestation — exact conditions.** A signature counts as an implicit vote for an earlier
block if and only if: both blocks are on the same `forkId`; the chain between them is hash-linked
(`previousBlockHash == keccak256(previous encodedBlock)` at every step); the author signature on
each carrying block is authentic and matches the block's declared author; and each derived
participant credit counts at most once per threshold set — a direct signature and a frozen
selected-tower confirmation crediting the same participant deduplicate, while one shared-tower
signature may credit several participants. These are exactly the checks the milestone verifier applies
([state-proofs.md §7](../disputes/state-proofs.md)).

## 7. Non-final transitions are carried forward

**<a id="inv-fin-8-g6v1m1"></a>`INV-FIN-8-G6V1M1`.** Valid transitions that lacked finality when a dispute began are **not reverted**.
The dispute reduction selects the _longest valid proved history_ among the presented views —
`the corresponding dispute-verification operation`
keeps the candidate latest block with the highest `transactionCnt` (ties broken deterministically
by lower block hash) — and the successor fork's genesis state is derived from that latest state.
The carried suffix is safe because of [`INV-FIN-2-MK27J6`](finality.md#inv-fin-2-mk27j6): presenting a conflicting suffix requires a
slashable double-sign. (With the round-robin caveat of §5's open question.)

## 8. On-chain fallback when threshold finality is not reached

When the author does not see the full threshold within `agreementTime`, it posts the signed block
as calldata on-chain
(`the corresponding participant-state operation` →
`StateChannelManagerProxy.postBlockCalldata`):

- **Data availability.** The chain itself becomes the guarantor that the block data is available:
  peers ingest `BlockCalldataPosted` events, so an uncooperative peer cannot claim it never saw
  the block. No separate data-availability trust assumption is added. Costs and griefing exposure:
  [security/data-availability.md](../security/data-availability.md).
- **Cheap commitment, slashable junk.** The contract stores a single hash
  `keccak256(signedBlock, block.timestamp)`, never overwritable, and requires
  `msg.sender == block author`. It does **not** validate the block; posting junk is provable
  against the commitment and slashable against the poster.
- **Race-condition guard.** The post carries `maxTimestamp` = previous relevant timestamp +
  `p2pTime + agreementTime + chainFallbackTime` (+ grace); the chain rejects later posts, which
  bounds how late a block can be forced into the record.
- **Extra time granted.** A posted commitment changes the timing rules: the acceptable
  block-timestamp window extends by `evidenceTime` for calldata-committed blocks
  (`block-validation service`,
  `CalldataCommittedStrategy`),
  and a timeout dispute against an author who posted calldata for the claimed height is rejected
  on-chain (`RaceConditionDisputeTimeoutCalldataPosted`,
  `DisputeManagerFacet._disputeRaceConditionCheck`).
  When peers do not cooperate, this extra on-chain time is a deliberate UX and fee cost of the
  protocol design.

If the threshold still never arrives, route 3 applies: any eligible participant disputes with the
latest proved state ([state-proofs.md](../disputes/state-proofs.md)), and the reduction carries the valid
suffix forward (§7).

## Assumptions and constraints

Finality assumes unforgeable, domain-separated signatures; a known participant set at each membership point;
deterministic block and snapshot commitments; at least one path to the base chain; and a leader schedule whose
safety properties match the dispute carry-forward argument. Progress may continue without threshold finality,
but settlement cannot claim a finality route whose exact signer/virtual-vote conditions are unmet. Participant,
signature, proof-size, and timing bounds must remain compatible with on-chain verification.

## Security considerations

The protected property is that two conflicting histories cannot both become final or settle the same funds.
Threats include equivocation, signature replay across domains, incorrect thresholds, stale membership,
double-counted virtual votes, wrong-leader blocks, non-final suffix truncation, and unavailable calldata during
fallback. Verification must test both sides of every threshold and membership transition, competing forks,
duplicate/reordered signatures, delayed votes, and recovery through the chain. Leader-election and signature
domain-separation questions are security blockers, not optimization details.

## Requirements and invariants

**[`REQ-FIN-1-SP669G`](finality.md#req-fin-1-sp669g).** Participants build on the latest valid state immediately; explicit threshold finality is never a precondition for producing the next block.

**[`INV-FIN-2-MK27J6`](finality.md#inv-fin-2-mk27j6).** Signing is a non-equivocating vote; provable equivocation is slashable.

**[`REQ-FIN-3-9P9J4Q`](finality.md#req-fin-3-9p9j4q).** Signatures accumulate across hash-linked ancestry (virtual voting).

**[`REQ-FIN-4-ZFDDS6`](finality.md#req-fin-4-zfdds6).** N consecutive blocks authored by the complete participant set finalize the sequence's first block.

**[`REQ-FIN-5-DH29VZ`](finality.md#req-fin-5-dh29vz).** Deterministic block-level authoring via `getNextToWrite`; a missed slot is timeout-disputable.

**<a id="req-fin-6-yzwjx2"></a>`REQ-FIN-6-YZWJX2`.** Recommended leader-election policy is round-robin as a function of channel state.

**[`REQ-FIN-7-RTZWQZ`](finality.md#req-fin-7-rtzwqz).** The finality threshold is unanimous over the relevant union participant set (minus on-chain-slashed, for disputes).

**[`INV-FIN-8-G6V1M1`](finality.md#inv-fin-8-g6v1m1).** Valid non-final transitions are carried into the canonical successor fork, not reverted (longest valid proved history wins).

## Verification and test plan

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item                                             | Requirements / invariants                          | Setup and stimulus                                                                                                                                    | Expected result                                                                                                                             | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-fin-1-sp669g.t1"></a>`REQ-FIN-1-SP669G.T1` | [`REQ-FIN-1-SP669G`](finality.md#req-fin-1-sp669g) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Participants build on the latest valid state immediately; explicit threshold finality is never a precondition for producing the next block. | <a id="req-fin-1-sp669g.t1.p1"></a>`REQ-FIN-1-SP669G.T1.P1` — valid case<br><a id="req-fin-1-sp669g.t1.p2"></a>`REQ-FIN-1-SP669G.T1.P2` — correct identity and signature<br><a id="req-fin-1-sp669g.t1.p3"></a>`REQ-FIN-1-SP669G.T1.P3` — direct invalid/opposite case<br><a id="req-fin-1-sp669g.t1.p4"></a>`REQ-FIN-1-SP669G.T1.P4` — wrong-identity signature<br><a id="req-fin-1-sp669g.t1.p5"></a>`REQ-FIN-1-SP669G.T1.P5` — missing signature<br><a id="req-fin-1-sp669g.t1.p6"></a>`REQ-FIN-1-SP669G.T1.P6` — duplicate signature<br><a id="req-fin-1-sp669g.t1.p7"></a>`REQ-FIN-1-SP669G.T1.P7` — forged signature<br><a id="req-fin-1-sp669g.t1.p8"></a>`REQ-FIN-1-SP669G.T1.P8` — membership-boundary signer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="inv-fin-2-mk27j6.t1"></a>`INV-FIN-2-MK27J6.T1` | [`INV-FIN-2-MK27J6`](finality.md#inv-fin-2-mk27j6) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Signing is a non-equivocating vote; provable equivocation is slashable.                                                                     | <a id="inv-fin-2-mk27j6.t1.p1"></a>`INV-FIN-2-MK27J6.T1.P1` — valid case<br><a id="inv-fin-2-mk27j6.t1.p2"></a>`INV-FIN-2-MK27J6.T1.P2` — correct identity and signature<br><a id="inv-fin-2-mk27j6.t1.p3"></a>`INV-FIN-2-MK27J6.T1.P3` — new participant<br><a id="inv-fin-2-mk27j6.t1.p4"></a>`INV-FIN-2-MK27J6.T1.P4` — direct invalid/opposite case<br><a id="inv-fin-2-mk27j6.t1.p5"></a>`INV-FIN-2-MK27J6.T1.P5` — wrong-identity signature<br><a id="inv-fin-2-mk27j6.t1.p6"></a>`INV-FIN-2-MK27J6.T1.P6` — missing signature<br><a id="inv-fin-2-mk27j6.t1.p7"></a>`INV-FIN-2-MK27J6.T1.P7` — duplicate signature<br><a id="inv-fin-2-mk27j6.t1.p8"></a>`INV-FIN-2-MK27J6.T1.P8` — forged signature<br><a id="inv-fin-2-mk27j6.t1.p9"></a>`INV-FIN-2-MK27J6.T1.P9` — membership-boundary signer<br><a id="inv-fin-2-mk27j6.t1.p10"></a>`INV-FIN-2-MK27J6.T1.P10` — existing participant<br><a id="inv-fin-2-mk27j6.t1.p11"></a>`INV-FIN-2-MK27J6.T1.P11` — removed participant<br><a id="inv-fin-2-mk27j6.t1.p12"></a>`INV-FIN-2-MK27J6.T1.P12` — slashed participant<br><a id="inv-fin-2-mk27j6.t1.p13"></a>`INV-FIN-2-MK27J6.T1.P13` — concurrent membership change<br><a id="inv-fin-2-mk27j6.t1.p14"></a>`INV-FIN-2-MK27J6.T1.P14` — tower double-sign, both delivery orders: one frozen tower confirms two distinct blocks at the same channel, fork, and height — objective tower equivocation in either order<br><a id="inv-fin-2-mk27j6.t1.p15"></a>`INV-FIN-2-MK27J6.T1.P15` — shared-tower double threshold: one shared tower completes both competing effective thresholds; both signatures are punishable, and the settled history follows ordinary settlement order — at the same height the first valid same-fork update wins and punishment never reopens it, while only a later higher valid same-fork update may replace the settled snapshot<br><a id="inv-fin-2-mk27j6.t1.p16"></a>`INV-FIN-2-MK27J6.T1.P16` — non-contradictions: tower confirmations at different heights or different forks contradict nothing<br><a id="inv-fin-2-mk27j6.t1.p17"></a>`INV-FIN-2-MK27J6.T1.P17` — duplicate delivery of the same block's tower confirmation: no contradiction, no penalty                                                                                                                                                                       |
| <a id="req-fin-3-9p9j4q.t1"></a>`REQ-FIN-3-9P9J4Q.T1` | [`REQ-FIN-3-9P9J4Q`](finality.md#req-fin-3-9p9j4q) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Signatures accumulate across hash-linked ancestry (virtual voting).                                                                         | <a id="req-fin-3-9p9j4q.t1.p1"></a>`REQ-FIN-3-9P9J4Q.T1.P1` — valid case<br><a id="req-fin-3-9p9j4q.t1.p2"></a>`REQ-FIN-3-9P9J4Q.T1.P2` — matching commitment<br><a id="req-fin-3-9p9j4q.t1.p3"></a>`REQ-FIN-3-9P9J4Q.T1.P3` — correct identity and signature<br><a id="req-fin-3-9p9j4q.t1.p4"></a>`REQ-FIN-3-9P9J4Q.T1.P4` — direct invalid/opposite case<br><a id="req-fin-3-9p9j4q.t1.p5"></a>`REQ-FIN-3-9P9J4Q.T1.P5` — mismatched commitment<br><a id="req-fin-3-9p9j4q.t1.p6"></a>`REQ-FIN-3-9P9J4Q.T1.P6` — predecessor link<br><a id="req-fin-3-9p9j4q.t1.p7"></a>`REQ-FIN-3-9P9J4Q.T1.P7` — genesis link<br><a id="req-fin-3-9p9j4q.t1.p8"></a>`REQ-FIN-3-9P9J4Q.T1.P8` — stale fork<br><a id="req-fin-3-9p9j4q.t1.p9"></a>`REQ-FIN-3-9P9J4Q.T1.P9` — foreign fork<br><a id="req-fin-3-9p9j4q.t1.p10"></a>`REQ-FIN-3-9P9J4Q.T1.P10` — wrong-identity signature<br><a id="req-fin-3-9p9j4q.t1.p11"></a>`REQ-FIN-3-9P9J4Q.T1.P11` — missing signature<br><a id="req-fin-3-9p9j4q.t1.p12"></a>`REQ-FIN-3-9P9J4Q.T1.P12` — duplicate signature<br><a id="req-fin-3-9p9j4q.t1.p13"></a>`REQ-FIN-3-9P9J4Q.T1.P13` — forged signature<br><a id="req-fin-3-9p9j4q.t1.p14"></a>`REQ-FIN-3-9P9J4Q.T1.P14` — membership-boundary signer<br><a id="req-fin-3-9p9j4q.t1.p15"></a>`REQ-FIN-3-9P9J4Q.T1.P15` — virtual tower credit: the frozen tower confirms a linked descendant, the assigned participant has no direct signature on the ancestor, and the derived credit completes the ancestor's virtual threshold<br><a id="req-fin-3-9p9j4q.t1.p16"></a>`REQ-FIN-3-9P9J4Q.T1.P16` — direct-plus-tower across different blocks: the participant's direct signature and its tower's confirmation on different linked blocks accumulate to the same ancestor as one credit<br><a id="req-fin-3-9p9j4q.t1.p17"></a>`REQ-FIN-3-9P9J4Q.T1.P17` — wrong assignment: a descendant confirmation from a tower not frozen for the participant derives no virtual credit                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-fin-4-zfdds6.t1"></a>`REQ-FIN-4-ZFDDS6.T1` | [`REQ-FIN-4-ZFDDS6`](finality.md#req-fin-4-zfdds6) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | N consecutive blocks authored by the complete participant set finalize the sequence's first block.                                          | <a id="req-fin-4-zfdds6.t1.p1"></a>`REQ-FIN-4-ZFDDS6.T1.P1` — valid case<br><a id="req-fin-4-zfdds6.t1.p2"></a>`REQ-FIN-4-ZFDDS6.T1.P2` — correct identity and signature<br><a id="req-fin-4-zfdds6.t1.p3"></a>`REQ-FIN-4-ZFDDS6.T1.P3` — direct invalid/opposite case<br><a id="req-fin-4-zfdds6.t1.p4"></a>`REQ-FIN-4-ZFDDS6.T1.P4` — wrong-identity signature<br><a id="req-fin-4-zfdds6.t1.p5"></a>`REQ-FIN-4-ZFDDS6.T1.P5` — missing signature<br><a id="req-fin-4-zfdds6.t1.p6"></a>`REQ-FIN-4-ZFDDS6.T1.P6` — duplicate signature<br><a id="req-fin-4-zfdds6.t1.p7"></a>`REQ-FIN-4-ZFDDS6.T1.P7` — forged signature<br><a id="req-fin-4-zfdds6.t1.p8"></a>`REQ-FIN-4-ZFDDS6.T1.P8` — membership-boundary signer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-fin-5-dh29vz.t1"></a>`REQ-FIN-5-DH29VZ.T1` | [`REQ-FIN-5-DH29VZ`](finality.md#req-fin-5-dh29vz) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Deterministic block-level authoring via `getNextToWrite`; a missed slot is timeout-disputable.                                              | <a id="req-fin-5-dh29vz.t1.p1"></a>`REQ-FIN-5-DH29VZ.T1.P1` — valid case<br><a id="req-fin-5-dh29vz.t1.p2"></a>`REQ-FIN-5-DH29VZ.T1.P2` — correct identity and signature<br><a id="req-fin-5-dh29vz.t1.p3"></a>`REQ-FIN-5-DH29VZ.T1.P3` — before deadline<br><a id="req-fin-5-dh29vz.t1.p4"></a>`REQ-FIN-5-DH29VZ.T1.P4` — direct invalid/opposite case<br><a id="req-fin-5-dh29vz.t1.p5"></a>`REQ-FIN-5-DH29VZ.T1.P5` — wrong-identity signature<br><a id="req-fin-5-dh29vz.t1.p6"></a>`REQ-FIN-5-DH29VZ.T1.P6` — missing signature<br><a id="req-fin-5-dh29vz.t1.p7"></a>`REQ-FIN-5-DH29VZ.T1.P7` — duplicate signature<br><a id="req-fin-5-dh29vz.t1.p8"></a>`REQ-FIN-5-DH29VZ.T1.P8` — forged signature<br><a id="req-fin-5-dh29vz.t1.p9"></a>`REQ-FIN-5-DH29VZ.T1.P9` — membership-boundary signer<br><a id="req-fin-5-dh29vz.t1.p10"></a>`REQ-FIN-5-DH29VZ.T1.P10` — at deadline<br><a id="req-fin-5-dh29vz.t1.p11"></a>`REQ-FIN-5-DH29VZ.T1.P11` — after deadline<br><a id="req-fin-5-dh29vz.t1.p12"></a>`REQ-FIN-5-DH29VZ.T1.P12` — maximum honest skew                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| <a id="req-fin-6-yzwjx2.t1"></a>`REQ-FIN-6-YZWJX2.T1` | [`REQ-FIN-6-YZWJX2`](finality.md#req-fin-6-yzwjx2) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Recommended leader-election policy is round-robin as a function of channel state.                                                           | <a id="req-fin-6-yzwjx2.t1.p1"></a>`REQ-FIN-6-YZWJX2.T1.P1` — valid case<br><a id="req-fin-6-yzwjx2.t1.p2"></a>`REQ-FIN-6-YZWJX2.T1.P2` — zero case where meaningful<br><a id="req-fin-6-yzwjx2.t1.p3"></a>`REQ-FIN-6-YZWJX2.T1.P3` — direct invalid/opposite case<br><a id="req-fin-6-yzwjx2.t1.p4"></a>`REQ-FIN-6-YZWJX2.T1.P4` — empty case where meaningful<br><a id="req-fin-6-yzwjx2.t1.p5"></a>`REQ-FIN-6-YZWJX2.T1.P5` — no-op case where meaningful<br><a id="req-fin-6-yzwjx2.t1.p6"></a>`REQ-FIN-6-YZWJX2.T1.P6` — exact boundary<br><a id="req-fin-6-yzwjx2.t1.p7"></a>`REQ-FIN-6-YZWJX2.T1.P7` — failure and recovery<br><a id="req-fin-6-yzwjx2.t1.p8"></a>`REQ-FIN-6-YZWJX2.T1.P8` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-fin-7-rtzwqz.t1"></a>`REQ-FIN-7-RTZWQZ.T1` | [`REQ-FIN-7-RTZWQZ`](finality.md#req-fin-7-rtzwqz) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | The finality threshold is unanimous over the relevant union participant set (minus on-chain-slashed, for disputes).                         | <a id="req-fin-7-rtzwqz.t1.p1"></a>`REQ-FIN-7-RTZWQZ.T1.P1` — valid case<br><a id="req-fin-7-rtzwqz.t1.p2"></a>`REQ-FIN-7-RTZWQZ.T1.P2` — correct identity and signature<br><a id="req-fin-7-rtzwqz.t1.p3"></a>`REQ-FIN-7-RTZWQZ.T1.P3` — new participant<br><a id="req-fin-7-rtzwqz.t1.p4"></a>`REQ-FIN-7-RTZWQZ.T1.P4` — malformed input<br><a id="req-fin-7-rtzwqz.t1.p5"></a>`REQ-FIN-7-RTZWQZ.T1.P5` — direct invalid/opposite case<br><a id="req-fin-7-rtzwqz.t1.p6"></a>`REQ-FIN-7-RTZWQZ.T1.P6` — wrong-identity signature<br><a id="req-fin-7-rtzwqz.t1.p7"></a>`REQ-FIN-7-RTZWQZ.T1.P7` — missing signature<br><a id="req-fin-7-rtzwqz.t1.p8"></a>`REQ-FIN-7-RTZWQZ.T1.P8` — duplicate signature<br><a id="req-fin-7-rtzwqz.t1.p9"></a>`REQ-FIN-7-RTZWQZ.T1.P9` — forged signature<br><a id="req-fin-7-rtzwqz.t1.p10"></a>`REQ-FIN-7-RTZWQZ.T1.P10` — membership-boundary signer<br><a id="req-fin-7-rtzwqz.t1.p11"></a>`REQ-FIN-7-RTZWQZ.T1.P11` — existing participant<br><a id="req-fin-7-rtzwqz.t1.p12"></a>`REQ-FIN-7-RTZWQZ.T1.P12` — removed participant<br><a id="req-fin-7-rtzwqz.t1.p13"></a>`REQ-FIN-7-RTZWQZ.T1.P13` — slashed participant<br><a id="req-fin-7-rtzwqz.t1.p14"></a>`REQ-FIN-7-RTZWQZ.T1.P14` — concurrent membership change<br><a id="req-fin-7-rtzwqz.t1.p15"></a>`REQ-FIN-7-RTZWQZ.T1.P15` — adversarial input<br><a id="req-fin-7-rtzwqz.t1.p16"></a>`REQ-FIN-7-RTZWQZ.T1.P16` — partial failure<br><a id="req-fin-7-rtzwqz.t1.p17"></a>`REQ-FIN-7-RTZWQZ.T1.P17` — retry and recovery<br><a id="req-fin-7-rtzwqz.t1.p18"></a>`REQ-FIN-7-RTZWQZ.T1.P18` — tower-only credit: a participant's vote supplied solely by its frozen selected tower's confirmation<br><a id="req-fin-7-rtzwqz.t1.p19"></a>`REQ-FIN-7-RTZWQZ.T1.P19` — shared-tower full threshold: one tower signature credits every assigned participant and completes the threshold alone<br><a id="req-fin-7-rtzwqz.t1.p20"></a>`REQ-FIN-7-RTZWQZ.T1.P20` — direct-plus-tower deduplication: both artifacts retained, one effective credit<br><a id="req-fin-7-rtzwqz.t1.p21"></a>`REQ-FIN-7-RTZWQZ.T1.P21` — wrong or unassigned tower: no credit derived, threshold unmet<br><a id="req-fin-7-rtzwqz.t1.p22"></a>`REQ-FIN-7-RTZWQZ.T1.P22` — block-versus-dispute separation: an ordinary tower block confirmation offered as a dispute-confirmation vote is rejected |
| <a id="inv-fin-8-g6v1m1.t1"></a>`INV-FIN-8-G6V1M1.T1` | [`INV-FIN-8-G6V1M1`](finality.md#inv-fin-8-g6v1m1) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Valid non-final transitions are carried into the canonical successor fork, not reverted (longest valid proved history wins).                | <a id="inv-fin-8-g6v1m1.t1.p1"></a>`INV-FIN-8-G6V1M1.T1.P1` — valid case<br><a id="inv-fin-8-g6v1m1.t1.p2"></a>`INV-FIN-8-G6V1M1.T1.P2` — matching commitment<br><a id="inv-fin-8-g6v1m1.t1.p3"></a>`INV-FIN-8-G6V1M1.T1.P3` — direct invalid/opposite case<br><a id="inv-fin-8-g6v1m1.t1.p4"></a>`INV-FIN-8-G6V1M1.T1.P4` — mismatched commitment<br><a id="inv-fin-8-g6v1m1.t1.p5"></a>`INV-FIN-8-G6V1M1.T1.P5` — predecessor link<br><a id="inv-fin-8-g6v1m1.t1.p6"></a>`INV-FIN-8-G6V1M1.T1.P6` — genesis link<br><a id="inv-fin-8-g6v1m1.t1.p7"></a>`INV-FIN-8-G6V1M1.T1.P7` — stale fork<br><a id="inv-fin-8-g6v1m1.t1.p8"></a>`INV-FIN-8-G6V1M1.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Future Work

_Non-normative._

- Sub-unanimous or weighted thresholds: would change every union-set computation, the milestone
  verifier, and the dispute threshold; requires a fresh safety analysis against [`INV-FIN-2-MK27J6`](finality.md#inv-fin-2-mk27j6).
- Alternative leader-election policies (see the open question in §5) — including
  availability-aware schedules that skip repeatedly absent authors without a dispute.
- Signature aggregation (e.g. BLS) to shrink `BlockConfirmation`s and milestone proofs.
- Explicit finality gadgets/checkpointing for very long-lived channels so proofs stay bounded
  without trusting the whole suffix chain.
