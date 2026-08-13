# State Proofs & Milestones

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral state proofs & milestones behavior, assumptions, constraints, security properties, and black-box test plan.

## Contents

- [Purpose & observable contract](#1-purpose--observable-contract)
- [A milestone is a finality anchor](#2-a-milestone-is-a-finality-anchor)
- [Anchors chain to the latest state](#3-anchors-chain-to-the-latest-state)
- [Membership hops are required at participant-set changes](#4-membership-hops-are-required-at-participant-set-changes)
- [Genesis anchoring](#5-genesis-anchoring)
- [Why the non-final suffix is safe](#6-why-the-non-final-suffix-is-safe)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose & observable contract

A **state proof** convinces the chain — which stores only the current snapshot — that a claimed
state belongs to a fork's canonical history. It is the evidence a dispute submits with its claim
and the core of a same-fork snapshot update.

Data model:

```solidity
struct MilestoneProof { BlockConfirmation[] blockConfirmations; }
struct StateProof {
    MilestoneProof[] milestones;   // proves the last finalized block in the fork
    SignedBlock[] signedBlocks;    // links the last milestone to the claimed latest block
}
```

The heavy backing data (genesis and latest snapshots, per-milestone snapshots, message blocks) is
carried in `DisputeAuditingData` and referenced
from the dispute by hash.

**What the proof guarantees:** a path of finality anchors from the fork's genesis to the last
provable anchor, and a cryptographic link from that anchor to the claimed latest state. **What it
does not guarantee:** that the latest state is final, or that its transitions were semantically
valid — invalid transitions inside a proof are handled by the dispute fraud proofs
([fraud-proofs.md](./fraud-proofs.md)), and non-finality is resolved by reduction (§6).

## 2. A milestone is a finality anchor

**[`REQ-SP-1-9YABY1`](state-proofs.md#req-sp-1-9yaby1).** A milestone is not merely a list of independently threshold-signed blocks. It is a
**finality anchor**: a consecutive, hash-linked run of block confirmations whose accumulated
signatures finalize the run's **first** block. That first block's confirmation is final either
directly — it carries the required threshold signatures itself — or **virtually**, because later,
cryptographically linked confirmations inside the milestone carry their signatures back through
the ancestry ([finality.md §4](../protocol-model/finality.md)).

## 3. Anchors chain to the latest state

**[`REQ-SP-2-ST4JJ4`](state-proofs.md#req-sp-2-st4jj4).** A state proof establishes a path from one final anchor to the next, and finally to
the **latest state** the dispute transition operates on. The latest state itself need **not** be
final; it MUST be a cryptographically linked descendant of the last proved final anchor. That
linkage is what places it on the canonical chain before the dispute game applies its transition.

**[`REQ-SP-5-MTE4RV`](state-proofs.md#req-sp-5-mte4rv).** The final block of the proved path supplies the state commitment
(`stateSnapshotHash` → `latestStateSnapshotHash`) that the dispute game and the reduction operate
on (`the corresponding state-proof verification operation`).

```mermaid
flowchart LR
    G(("fork genesis<br/>(implicit anchor)")) --> M1["Milestone 1<br/>anchors block a<br/>(set: 4 participants)"]
    M1 --> M2["Milestone 2<br/>membership hop 4→5<br/>(union set signs)"]
    M2 --> S["trailing signed blocks<br/>(non-final suffix)"]
    S --> L["latest state<br/>= dispute input commitment"]
    style S stroke-dasharray: 5 5
    style L stroke-dasharray: 5 5
```

_(The dashed suffix is the intended shape; the protocol definition restricts it — see §8.)_

## 4. Membership hops are required at participant-set changes

**[`REQ-SP-3-SP1JG4`](state-proofs.md#req-sp-3-sp1jg4).** A join or removal changes the threshold set, so a proof crossing a membership change
MUST establish the old-set → new-set transition at the relevant block with a milestone hop; it
cannot simply assert the new membership. The hop's threshold is the **union** of the sets involved:
a 4→5 join is final only when the four original participants _and_ the joiner have (directly or
virtually) signed — proof that both the original set and the joiner authorized the change. A
removal requires the corresponding proof in the other direction (the pre-removal set covers the
leaving member).

Milestones entirely below the chain's current snapshot height are skipped by the verifier (they
are already settled); the last skipped milestone is still checked to link through the current
on-chain snapshot.

## 5. Genesis anchoring

**[`REQ-SP-4-NCSEX4`](state-proofs.md#req-sp-4-ncsex4).** When a proof starts at fork genesis, genesis is the **implicit final anchor** for
that fork; no milestone is needed for it. Concretely:

- An **empty** proof (no milestones, no signed blocks) claims the fork's genesis snapshot itself
  as the latest state: `isCorrectLatestState` reconstructs the genesis `StateSnapshot` — fork id
  must equal `keccak256(abi.encode(genesisSnapshotData))` (`_isGenesisSnapshotDataLinkedToFork`),
  with the genesis timestamp derived on-chain (`getGenesisTimestamp`: the origin fork's dispute
  window kill-period end, or the stored snapshot's timestamp for the root fork) — and compares its
  hash to the claim.
- A **signed-blocks** proof provides the linked path from genesis: the first block MUST have
  `transactionCnt == 0` and each subsequent block MUST link by `previousBlockHash`
  (`_areSignedBlocksLinkedAndVerified`).
- Where milestones exist, their anchors provide the base; trailing signed blocks extend from the
  last proved milestone to the latest non-final state _(intended — restricted in the current
  code, §8)_.

## 6. Why the non-final suffix is safe

**[`INV-SP-6-GNW74H`](state-proofs.md#inv-sp-6-gnw74h).** Extending the proved anchor with unfinalized blocks is safe because signing is a
non-equivocating commitment ([finality.md §3](../protocol-model/finality.md)): a participant cannot commit to
conflicting histories without exposing a slashable double-sign. Different participants MAY still
present different valid latest states during a dispute (they saw different suffix lengths). The
reduction MUST consider all validly proved views and choose the **longest valid proved history**
as canonical — this is how the latest non-final state joins canonical reality instead of being
discarded.

**Open question (shared with [finality.md §5](../protocol-model/finality.md)):** this safety argument currently
depends on round-robin leader election. Other policies may allow a valid suffix to be reverted and
need explicit attribution and penalty rules; long-lived channels and long-range milestone chains
need bounded proofs. Mirrored in [open-questions.md](../open-questions.md).

## Assumptions and constraints

State proofs assume authentic domain-separated signatures, collision-resistant canonical commitments,
available snapshots and auditing data, deterministic membership derivation, and bounded proof length/gas. A
proof establishes linkage and finality anchors, not semantic validity of every transition; fraud-proof and
dispute mechanisms own those checks. Membership changes require explicit hops, genesis has one canonical
anchor, and a non-final suffix is accepted only under the carry-forward rules defined here.

## Security considerations

An unsound proof can advance or dispute the wrong state and therefore endanger all channel funds. Threats
include missing/reordered milestones, skipped membership changes, wrong-genesis linkage, duplicate signatures,
threshold off-by-one errors, malformed suffixes, hash-only unavailable data, proof-size exhaustion, and
predicate drift between validation paths. Verification needs positive and negative cases at every structural
boundary plus adversarial combinations; a proof rejection must leave canonical state unchanged.

## Requirements and invariants

This table is the normative requirement index. Detailed rules and rationale are defined in the sections above.

| Requirement / invariant                       | Statement                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="req-sp-1-9yaby1"></a>`REQ-SP-1-9YABY1` | A milestone is a finality anchor: its first block is final directly or via virtual votes from later linked confirmations within the milestone.                     |
| <a id="req-sp-2-st4jj4"></a>`REQ-SP-2-ST4JJ4` | Proofs chain anchor→anchor→latest state; the latest state need not be final but must be a cryptographically linked descendant of the last proved anchor.           |
| <a id="req-sp-3-sp1jg4"></a>`REQ-SP-3-SP1JG4` | Membership changes require milestone hops proven under the old∪new (plus pending joiners) union threshold.                                                         |
| <a id="req-sp-4-ncsex4"></a>`REQ-SP-4-NCSEX4` | Fork genesis is the implicit final anchor: empty proofs claim the genesis snapshot; signed-block proofs must start at `transactionCnt == 0` and hash-link forward. |
| <a id="req-sp-5-mte4rv"></a>`REQ-SP-5-MTE4RV` | The final block of the proved path supplies the state commitment the dispute game operates on.                                                                     |
| <a id="inv-sp-6-gnw74h"></a>`INV-SP-6-GNW74H` | Non-final suffixes are safe: conflicting commitments expose slashable double-signs, and reduction selects the longest valid proved history.                        |
| <a id="req-sp-7-70emat"></a>`REQ-SP-7-70EMAT` | Linkage checks: hash linkage, fork identity, authentic author signatures, threshold coverage, and latest-state commitment, exactly as listed in §7.                |

## Verification and test plan

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item                                           | Requirements / invariants                            | Setup and stimulus                                                                                                                                    | Expected result                                                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-sp-1-9yaby1.t1"></a>`REQ-SP-1-9YABY1.T1` | [`REQ-SP-1-9YABY1`](state-proofs.md#req-sp-1-9yaby1) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | A milestone is a finality anchor: its first block is final directly or via virtual votes from later linked confirmations within the milestone.                     | <a id="req-sp-1-9yaby1.t1.p1"></a>`REQ-SP-1-9YABY1.T1.P1` — valid case<br><a id="req-sp-1-9yaby1.t1.p2"></a>`REQ-SP-1-9YABY1.T1.P2` — matching commitment<br><a id="req-sp-1-9yaby1.t1.p3"></a>`REQ-SP-1-9YABY1.T1.P3` — direct invalid/opposite case<br><a id="req-sp-1-9yaby1.t1.p4"></a>`REQ-SP-1-9YABY1.T1.P4` — mismatched commitment<br><a id="req-sp-1-9yaby1.t1.p5"></a>`REQ-SP-1-9YABY1.T1.P5` — predecessor case<br><a id="req-sp-1-9yaby1.t1.p6"></a>`REQ-SP-1-9YABY1.T1.P6` — genesis case<br><a id="req-sp-1-9yaby1.t1.p7"></a>`REQ-SP-1-9YABY1.T1.P7` — stale fork<br><a id="req-sp-1-9yaby1.t1.p8"></a>`REQ-SP-1-9YABY1.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-sp-2-st4jj4.t1"></a>`REQ-SP-2-ST4JJ4.T1` | [`REQ-SP-2-ST4JJ4`](state-proofs.md#req-sp-2-st4jj4) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Proofs chain anchor→anchor→latest state; the latest state need not be final but must be a cryptographically linked descendant of the last proved anchor.           | <a id="req-sp-2-st4jj4.t1.p1"></a>`REQ-SP-2-ST4JJ4.T1.P1` — valid case<br><a id="req-sp-2-st4jj4.t1.p2"></a>`REQ-SP-2-ST4JJ4.T1.P2` — matching commitment<br><a id="req-sp-2-st4jj4.t1.p3"></a>`REQ-SP-2-ST4JJ4.T1.P3` — direct invalid/opposite case<br><a id="req-sp-2-st4jj4.t1.p4"></a>`REQ-SP-2-ST4JJ4.T1.P4` — mismatched commitment<br><a id="req-sp-2-st4jj4.t1.p5"></a>`REQ-SP-2-ST4JJ4.T1.P5` — predecessor case<br><a id="req-sp-2-st4jj4.t1.p6"></a>`REQ-SP-2-ST4JJ4.T1.P6` — genesis case<br><a id="req-sp-2-st4jj4.t1.p7"></a>`REQ-SP-2-ST4JJ4.T1.P7` — stale fork<br><a id="req-sp-2-st4jj4.t1.p8"></a>`REQ-SP-2-ST4JJ4.T1.P8` — foreign fork                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-sp-3-sp1jg4.t1"></a>`REQ-SP-3-SP1JG4.T1` | [`REQ-SP-3-SP1JG4`](state-proofs.md#req-sp-3-sp1jg4) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Membership changes require milestone hops proven under the old∪new (plus pending joiners) union threshold.                                                         | <a id="req-sp-3-sp1jg4.t1.p1"></a>`REQ-SP-3-SP1JG4.T1.P1` — valid case<br><a id="req-sp-3-sp1jg4.t1.p2"></a>`REQ-SP-3-SP1JG4.T1.P2` — correct identity/signature<br><a id="req-sp-3-sp1jg4.t1.p3"></a>`REQ-SP-3-SP1JG4.T1.P3` — new participant<br><a id="req-sp-3-sp1jg4.t1.p4"></a>`REQ-SP-3-SP1JG4.T1.P4` — direct invalid/opposite case<br><a id="req-sp-3-sp1jg4.t1.p5"></a>`REQ-SP-3-SP1JG4.T1.P5` — wrong identity/signature<br><a id="req-sp-3-sp1jg4.t1.p6"></a>`REQ-SP-3-SP1JG4.T1.P6` — missing identity/signature<br><a id="req-sp-3-sp1jg4.t1.p7"></a>`REQ-SP-3-SP1JG4.T1.P7` — duplicate identity/signature<br><a id="req-sp-3-sp1jg4.t1.p8"></a>`REQ-SP-3-SP1JG4.T1.P8` — forged identity/signature<br><a id="req-sp-3-sp1jg4.t1.p9"></a>`REQ-SP-3-SP1JG4.T1.P9` — membership boundary<br><a id="req-sp-3-sp1jg4.t1.p10"></a>`REQ-SP-3-SP1JG4.T1.P10` — existing participant<br><a id="req-sp-3-sp1jg4.t1.p11"></a>`REQ-SP-3-SP1JG4.T1.P11` — removed participant<br><a id="req-sp-3-sp1jg4.t1.p12"></a>`REQ-SP-3-SP1JG4.T1.P12` — slashed participant<br><a id="req-sp-3-sp1jg4.t1.p13"></a>`REQ-SP-3-SP1JG4.T1.P13` — concurrent membership change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-sp-4-ncsex4.t1"></a>`REQ-SP-4-NCSEX4.T1` | [`REQ-SP-4-NCSEX4`](state-proofs.md#req-sp-4-ncsex4) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Fork genesis is the implicit final anchor: empty proofs claim the genesis snapshot; signed-block proofs must start at `transactionCnt == 0` and hash-link forward. | <a id="req-sp-4-ncsex4.t1.p1"></a>`REQ-SP-4-NCSEX4.T1.P1` — valid case<br><a id="req-sp-4-ncsex4.t1.p2"></a>`REQ-SP-4-NCSEX4.T1.P2` — matching commitment<br><a id="req-sp-4-ncsex4.t1.p3"></a>`REQ-SP-4-NCSEX4.T1.P3` — correct identity/signature<br><a id="req-sp-4-ncsex4.t1.p4"></a>`REQ-SP-4-NCSEX4.T1.P4` — direct invalid/opposite case<br><a id="req-sp-4-ncsex4.t1.p5"></a>`REQ-SP-4-NCSEX4.T1.P5` — mismatched commitment<br><a id="req-sp-4-ncsex4.t1.p6"></a>`REQ-SP-4-NCSEX4.T1.P6` — predecessor case<br><a id="req-sp-4-ncsex4.t1.p7"></a>`REQ-SP-4-NCSEX4.T1.P7` — genesis case<br><a id="req-sp-4-ncsex4.t1.p8"></a>`REQ-SP-4-NCSEX4.T1.P8` — stale fork<br><a id="req-sp-4-ncsex4.t1.p9"></a>`REQ-SP-4-NCSEX4.T1.P9` — foreign fork<br><a id="req-sp-4-ncsex4.t1.p10"></a>`REQ-SP-4-NCSEX4.T1.P10` — wrong identity/signature<br><a id="req-sp-4-ncsex4.t1.p11"></a>`REQ-SP-4-NCSEX4.T1.P11` — missing identity/signature<br><a id="req-sp-4-ncsex4.t1.p12"></a>`REQ-SP-4-NCSEX4.T1.P12` — duplicate identity/signature<br><a id="req-sp-4-ncsex4.t1.p13"></a>`REQ-SP-4-NCSEX4.T1.P13` — forged identity/signature<br><a id="req-sp-4-ncsex4.t1.p14"></a>`REQ-SP-4-NCSEX4.T1.P14` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-sp-5-mte4rv.t1"></a>`REQ-SP-5-MTE4RV.T1` | [`REQ-SP-5-MTE4RV`](state-proofs.md#req-sp-5-mte4rv) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | The final block of the proved path supplies the state commitment the dispute game operates on.                                                                     | <a id="req-sp-5-mte4rv.t1.p1"></a>`REQ-SP-5-MTE4RV.T1.P1` — valid case<br><a id="req-sp-5-mte4rv.t1.p2"></a>`REQ-SP-5-MTE4RV.T1.P2` — matching commitment<br><a id="req-sp-5-mte4rv.t1.p3"></a>`REQ-SP-5-MTE4RV.T1.P3` — malformed input<br><a id="req-sp-5-mte4rv.t1.p4"></a>`REQ-SP-5-MTE4RV.T1.P4` — direct invalid/opposite case<br><a id="req-sp-5-mte4rv.t1.p5"></a>`REQ-SP-5-MTE4RV.T1.P5` — mismatched commitment<br><a id="req-sp-5-mte4rv.t1.p6"></a>`REQ-SP-5-MTE4RV.T1.P6` — predecessor case<br><a id="req-sp-5-mte4rv.t1.p7"></a>`REQ-SP-5-MTE4RV.T1.P7` — genesis case<br><a id="req-sp-5-mte4rv.t1.p8"></a>`REQ-SP-5-MTE4RV.T1.P8` — stale fork<br><a id="req-sp-5-mte4rv.t1.p9"></a>`REQ-SP-5-MTE4RV.T1.P9` — foreign fork<br><a id="req-sp-5-mte4rv.t1.p10"></a>`REQ-SP-5-MTE4RV.T1.P10` — adversarial input<br><a id="req-sp-5-mte4rv.t1.p11"></a>`REQ-SP-5-MTE4RV.T1.P11` — partial failure<br><a id="req-sp-5-mte4rv.t1.p12"></a>`REQ-SP-5-MTE4RV.T1.P12` — retry and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="inv-sp-6-gnw74h.t1"></a>`INV-SP-6-GNW74H.T1` | [`INV-SP-6-GNW74H`](state-proofs.md#inv-sp-6-gnw74h) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Non-final suffixes are safe: conflicting commitments expose slashable double-signs, and reduction selects the longest valid proved history.                        | <a id="inv-sp-6-gnw74h.t1.p1"></a>`INV-SP-6-GNW74H.T1.P1` — valid case<br><a id="inv-sp-6-gnw74h.t1.p2"></a>`INV-SP-6-GNW74H.T1.P2` — matching commitment<br><a id="inv-sp-6-gnw74h.t1.p3"></a>`INV-SP-6-GNW74H.T1.P3` — correct identity/signature<br><a id="inv-sp-6-gnw74h.t1.p4"></a>`INV-SP-6-GNW74H.T1.P4` — new participant<br><a id="inv-sp-6-gnw74h.t1.p5"></a>`INV-SP-6-GNW74H.T1.P5` — direct invalid/opposite case<br><a id="inv-sp-6-gnw74h.t1.p6"></a>`INV-SP-6-GNW74H.T1.P6` — mismatched commitment<br><a id="inv-sp-6-gnw74h.t1.p7"></a>`INV-SP-6-GNW74H.T1.P7` — predecessor case<br><a id="inv-sp-6-gnw74h.t1.p8"></a>`INV-SP-6-GNW74H.T1.P8` — genesis case<br><a id="inv-sp-6-gnw74h.t1.p9"></a>`INV-SP-6-GNW74H.T1.P9` — stale fork<br><a id="inv-sp-6-gnw74h.t1.p10"></a>`INV-SP-6-GNW74H.T1.P10` — foreign fork<br><a id="inv-sp-6-gnw74h.t1.p11"></a>`INV-SP-6-GNW74H.T1.P11` — wrong identity/signature<br><a id="inv-sp-6-gnw74h.t1.p12"></a>`INV-SP-6-GNW74H.T1.P12` — missing identity/signature<br><a id="inv-sp-6-gnw74h.t1.p13"></a>`INV-SP-6-GNW74H.T1.P13` — duplicate identity/signature<br><a id="inv-sp-6-gnw74h.t1.p14"></a>`INV-SP-6-GNW74H.T1.P14` — forged identity/signature<br><a id="inv-sp-6-gnw74h.t1.p15"></a>`INV-SP-6-GNW74H.T1.P15` — membership boundary<br><a id="inv-sp-6-gnw74h.t1.p16"></a>`INV-SP-6-GNW74H.T1.P16` — existing participant<br><a id="inv-sp-6-gnw74h.t1.p17"></a>`INV-SP-6-GNW74H.T1.P17` — removed participant<br><a id="inv-sp-6-gnw74h.t1.p18"></a>`INV-SP-6-GNW74H.T1.P18` — slashed participant<br><a id="inv-sp-6-gnw74h.t1.p19"></a>`INV-SP-6-GNW74H.T1.P19` — concurrent membership change |
| <a id="req-sp-7-70emat.t1"></a>`REQ-SP-7-70EMAT.T1` | [`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Linkage checks: hash linkage, fork identity, authentic author signatures, threshold coverage, and latest-state commitment, exactly as listed in §7.                | <a id="req-sp-7-70emat.t1.p1"></a>`REQ-SP-7-70EMAT.T1.P1` — valid case<br><a id="req-sp-7-70emat.t1.p2"></a>`REQ-SP-7-70EMAT.T1.P2` — matching commitment<br><a id="req-sp-7-70emat.t1.p3"></a>`REQ-SP-7-70EMAT.T1.P3` — correct identity/signature<br><a id="req-sp-7-70emat.t1.p4"></a>`REQ-SP-7-70EMAT.T1.P4` — direct invalid/opposite case<br><a id="req-sp-7-70emat.t1.p5"></a>`REQ-SP-7-70EMAT.T1.P5` — mismatched commitment<br><a id="req-sp-7-70emat.t1.p6"></a>`REQ-SP-7-70EMAT.T1.P6` — predecessor case<br><a id="req-sp-7-70emat.t1.p7"></a>`REQ-SP-7-70EMAT.T1.P7` — genesis case<br><a id="req-sp-7-70emat.t1.p8"></a>`REQ-SP-7-70EMAT.T1.P8` — stale fork<br><a id="req-sp-7-70emat.t1.p9"></a>`REQ-SP-7-70EMAT.T1.P9` — foreign fork<br><a id="req-sp-7-70emat.t1.p10"></a>`REQ-SP-7-70EMAT.T1.P10` — wrong identity/signature<br><a id="req-sp-7-70emat.t1.p11"></a>`REQ-SP-7-70EMAT.T1.P11` — missing identity/signature<br><a id="req-sp-7-70emat.t1.p12"></a>`REQ-SP-7-70EMAT.T1.P12` — duplicate identity/signature<br><a id="req-sp-7-70emat.t1.p13"></a>`REQ-SP-7-70EMAT.T1.P13` — forged identity/signature<br><a id="req-sp-7-70emat.t1.p14"></a>`REQ-SP-7-70EMAT.T1.P14` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Future Work

_Non-normative._

- Bound proof size and verification gas: per-call gas ceilings, proof-size limits as a function
  of participant count, or incremental verification across transactions.
- Long-range proofs for long-lived channels: checkpointing the last settled anchor on-chain so
  proofs only ever span since-last-settlement history (interacts with `verifyMilestones`'s
  skip-below-snapshot logic, which already prunes settled prefixes).
- Signature aggregation inside `MilestoneProof` to compress hops in large channels.
