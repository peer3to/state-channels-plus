# State proofs and milestones

> **Status:** Maintained design; pending engineer verification.
> **Scope:** Finality evidence, trusted starts, construction, verification and reconstruction.

## Contents

- [Proof model](#proof-model)
- [Trusted start and genesis](#trusted-start-and-genesis)
- [Membership and finality](#membership-and-finality)
- [Construction](#construction)
- [Verification and replay](#verification-and-replay)
- [Reconstruction](#reconstruction)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future work](#future-work)

## Proof model

A state proof is an ordered list of milestones. Each milestone is a consecutive, hash-linked run
of block confirmations. There is no separate signed-block tail. Snapshots and full state are
supporting data, bound by the proof's commitments.

**<a id="req-sp-1-9yaby1"></a>`REQ-SP-1-9YABY1`.** A milestone normally proves its first block final,
directly or through signatures on its linked descendants. The last milestone carries both the
latest proved final point and any later evidence or unfinalized tail. At genesis, a run beginning
at block zero may remain unfinalized; it still supplies the authenticated path from genesis.

**<a id="req-sp-2-st4jj4"></a>`REQ-SP-2-ST4JJ4`.** Proofs connect the trusted start through required
final membership hops to the latest claimed state. The latest state need not be final. A later
final point may need its own milestone even when its evidence overlaps an earlier milestone.

**<a id="req-sp-5-mte4rv"></a>`REQ-SP-5-MTE4RV`.** The final block of the last milestone commits the
latest claimed state. The walk determines the latest trusted or proved final point. It can be a newly finalized milestone first block, the matching anchor inside a run, or an advanced anchor beyond every supplied block. The latest claim and final point need not be equal. A snapshot update still requires a newer threshold-proved target, not a stale first block.

**<a id="inv-sp-6-gnw74h"></a>`INV-SP-6-GNW74H`.** A non-final tail remains accountable through
non-equivocating signatures. Conflicting commitments expose double-sign evidence; dispute
reduction selects the longest valid proved history among the submitted views. This does not
prove every application transition correct; transition challenges remain necessary.

## Trusted start and genesis

**<a id="req-sp-4-ncsex4"></a>`REQ-SP-4-NCSEX4`.** An empty milestone list represents fork genesis
only. It does not represent a later chain anchor. Claiming a non-genesis anchor requires its block
in a milestone. Genesis has no synthetic mirror block. A genesis-starting run starts at block
zero and links its predecessor hash to the authenticated fork genesis. Linkage alone does not finalize it: missing union signatures leave replay starting at zero, while established threshold finality permits replay after zero. A different fork uses its own committed genesis and authoritative date. A finalized block-zero anchor protects that block even though genesis and block zero share
a numeric height.

The walk starts at the same-fork non-genesis chain anchor when one exists, otherwise at fork
genesis. A matching anchor is already final without fresh threshold signatures. It matches by its exact snapshot commitment, not height alone, and can occur at the first, middle or last position of a milestone. The
walk retains the suffix from that anchor and ignores the earlier prefix. A first hop strictly above the anchor may omit the anchor block only when the required union proves the hop final; an ordinary unfinalized extension must include the anchor block. Entire milestones below
the anchor are skipped without checking their old links, signatures or membership changes.
When the anchor is beyond every supplied block, the walk has nothing left to check and succeeds;
this does not authorize a dispute claiming a state below that anchor. A separate below-anchor
counter rejects that claim, including a genesis claim after block zero became final.

**<a id="req-sp-7-70emat"></a>`REQ-SP-7-70EMAT`.** In the retained region, verification checks
consecutive heights, hash links, channel and fork identity, authentic authors and confirmations,
required threshold coverage, snapshot commitments and the latest-state commitment. Supporting snapshot entries must match the milestone count exactly; missing or excess entries and an empty retained milestone are invalid. Malformed checked bytes are invalid. Inner bytes in a skipped prefix are not checked, but bytes needed to determine that cutoff must decode; an undecodable endpoint cannot establish that the run is wholly below the anchor.

## Membership and finality

**<a id="req-sp-3-sp1jg4"></a>`REQ-SP-3-SP1JG4`.** A membership hop requires signatures from the
union of the previous participants, resulting participants, and all joiners consumed in its
committed inbound interval. A joiner consumed and removed in the same transition still belongs
to that union. Once a hop finalizes, its resulting set starts the next hop. Unfinalized membership changes remain in the replay tail and cannot be treated as finalized hops without the union evidence. Later on-chain slashes never reduce this historical threshold. The required
inbound interval must be available to establish the union. Virtual votes count distinct required
signers on the consecutive run, including signatures supplied above its first block.

## Construction

**<a id="req-sp-8-9zccej"></a>`REQ-SP-8-9ZCCEJ`.** Construct proofs from the mirrored chain anchor,
which may lag the chain but must not lead it. Do not use a peer's newer private final point as the
construction anchor. Keep the required finalized membership changes after the anchor, with the
shortest forward evidence that establishes each hop. Search backward from the requested active
head for the latest point that can be proved final. Add that final point as a separate last
milestone when its start differs from the preceding hop, even if the runs overlap. Extend an
existing milestone only when its first block is the same. Append the linked tail inside the last
milestone. Missing signatures can lower the proved final point while leaving a valid unfinalized
tail; they do not necessarily mean data is unavailable. A snapshot update targets the first final
block of the last milestone, never its evidence tail. An anchor-only update makes no progress.

## Verification and replay

**<a id="req-sp-9-rnxp56"></a>`REQ-SP-9-RNXP56`.** Both synchronization and dispute audit try the
peer's latest finalized state, then the local mirror, then the canonical chain. An absent local
final state or a completed false result advances to the next tier. The chain determines the
verdict when earlier starts cannot establish the proof. An independent valid counter may end an
audit before these tiers: a conflict with a known final state is not a required fallback case.
For example, a proof built from chain anchor 25 through 50 can fail when attempted from local
anchor 5 and still succeed from the chain's correct start.

Replay follows the same tier order. Each attempt replays from that tier's verified start and
state, so a chain anchor can exclude a bad earlier transition. Internal errors, unavailable
required state and RPC failures are logged and propagated as fatal errors. A thrown error is not
a false proof result and must not trigger fallback. A malformed retained peer block is instead
invalid evidence. An older dispute does not require a peer to recover obsolete state merely to
replay backward from its newer final view; the peer can submit its own newer evidence.

## Reconstruction

**<a id="req-sp-10-jmvhtb"></a>`REQ-SP-10-JMVHTB`.** After successful synchronization, persist the
verified start and retained region, snapshots and membership changes needed to reconstruct the
proof, writing only changed data. Do not persist unchecked skipped history. Store the full state
at the latest proved final point and replay the tail through normal processing. If the anchor is
itself that final point, retain its block, snapshot and full state so its proof can be rebuilt.
If a later point is final, the older anchor's full state and a separate proof ending at it are
not required. For example, finality at 70 does not require retaining a separate state at 50.
Audit evidence persistence alone must not advance the peer's active view or cause it to sign.

## Assumptions and constraints

The guarantees require collision-resistant commitments, authentic domain-separated signatures,
available required snapshots/state/inbound evidence, and deterministic membership derivation.
The trusted start determines the checked region; peers starting at different final points need
not inspect or reject the same old history. Finality evidence is distinct from application-state
validity. No admission cap on milestone length or walk gas is selected here.

## Security considerations

Missing membership signatures, forged snapshots, wrong forks and broken retained links can
misrepresent finality and endanger channel funds. Skipped history must not become a new accusation
or be persisted as verified history. A successful walk with no retained blocks is not sufficient
to admit a below-anchor dispute. Block-specific challenges retain their own boundary rules;
extra threshold evidence does not remove challenge eligibility above those boundaries.

The per-step invalidity counter avoids re-walking earlier milestones, but binding supplied data
still costs more as the proof grows. Its total cost is not constant. The safety argument for
unfinalized tails depends on round-robin leadership; other election policies need explicit rules.

## Verification and test plan

### Requirement test matrix

Each entry is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the entry through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

#### <a id="req-sp-1-9yaby1.t1"></a>`REQ-SP-1-9YABY1.T1`

**Requirements / invariants:**

[`REQ-SP-1-9YABY1`](state-proofs.md#req-sp-1-9yaby1)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

A retained ordinary milestone proves its first block directly or through linked confirmations; genesis-zero and matching interior-anchor exceptions follow the trusted-start rules.

**Required permutations:**

<a id="req-sp-1-9yaby1.t1.p1"></a>`REQ-SP-1-9YABY1.T1.P1` — valid case

<a id="req-sp-1-9yaby1.t1.p2"></a>`REQ-SP-1-9YABY1.T1.P2` — matching commitment

<a id="req-sp-1-9yaby1.t1.p3"></a>`REQ-SP-1-9YABY1.T1.P3` — direct invalid/opposite case

<a id="req-sp-1-9yaby1.t1.p4"></a>`REQ-SP-1-9YABY1.T1.P4` — mismatched commitment

<a id="req-sp-1-9yaby1.t1.p5"></a>`REQ-SP-1-9YABY1.T1.P5` — predecessor case

<a id="req-sp-1-9yaby1.t1.p6"></a>`REQ-SP-1-9YABY1.T1.P6` — genesis case

<a id="req-sp-1-9yaby1.t1.p7"></a>`REQ-SP-1-9YABY1.T1.P7` — stale fork

<a id="req-sp-1-9yaby1.t1.p8"></a>`REQ-SP-1-9YABY1.T1.P8` — foreign fork

#### <a id="req-sp-2-st4jj4.t1"></a>`REQ-SP-2-ST4JJ4.T1`

**Requirements / invariants:**

[`REQ-SP-2-ST4JJ4`](state-proofs.md#req-sp-2-st4jj4)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

A retained tail follows its verified final point; an entirely skipped proof may end below a newer trusted anchor and is judged separately by the below-anchor rule.

**Required permutations:**

<a id="req-sp-2-st4jj4.t1.p1"></a>`REQ-SP-2-ST4JJ4.T1.P1` — valid case

<a id="req-sp-2-st4jj4.t1.p2"></a>`REQ-SP-2-ST4JJ4.T1.P2` — matching commitment

<a id="req-sp-2-st4jj4.t1.p3"></a>`REQ-SP-2-ST4JJ4.T1.P3` — direct invalid/opposite case

<a id="req-sp-2-st4jj4.t1.p4"></a>`REQ-SP-2-ST4JJ4.T1.P4` — mismatched commitment

<a id="req-sp-2-st4jj4.t1.p5"></a>`REQ-SP-2-ST4JJ4.T1.P5` — predecessor case

<a id="req-sp-2-st4jj4.t1.p6"></a>`REQ-SP-2-ST4JJ4.T1.P6` — genesis case

<a id="req-sp-2-st4jj4.t1.p7"></a>`REQ-SP-2-ST4JJ4.T1.P7` — stale fork

<a id="req-sp-2-st4jj4.t1.p8"></a>`REQ-SP-2-ST4JJ4.T1.P8` — foreign fork

#### <a id="req-sp-3-sp1jg4.t1"></a>`REQ-SP-3-SP1JG4.T1`

**Requirements / invariants:**

[`REQ-SP-3-SP1JG4`](state-proofs.md#req-sp-3-sp1jg4)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

Membership changes require milestone hops proven under the old∪new plus consumed JOINs union threshold.

**Required permutations:**

<a id="req-sp-3-sp1jg4.t1.p1"></a>`REQ-SP-3-SP1JG4.T1.P1` — valid case

<a id="req-sp-3-sp1jg4.t1.p2"></a>`REQ-SP-3-SP1JG4.T1.P2` — correct identity/signature

<a id="req-sp-3-sp1jg4.t1.p3"></a>`REQ-SP-3-SP1JG4.T1.P3` — new participant

<a id="req-sp-3-sp1jg4.t1.p4"></a>`REQ-SP-3-SP1JG4.T1.P4` — direct invalid/opposite case

<a id="req-sp-3-sp1jg4.t1.p5"></a>`REQ-SP-3-SP1JG4.T1.P5` — wrong identity/signature

<a id="req-sp-3-sp1jg4.t1.p6"></a>`REQ-SP-3-SP1JG4.T1.P6` — missing identity/signature

<a id="req-sp-3-sp1jg4.t1.p7"></a>`REQ-SP-3-SP1JG4.T1.P7` — duplicate identity/signature

<a id="req-sp-3-sp1jg4.t1.p8"></a>`REQ-SP-3-SP1JG4.T1.P8` — forged identity/signature

<a id="req-sp-3-sp1jg4.t1.p9"></a>`REQ-SP-3-SP1JG4.T1.P9` — membership boundary

<a id="req-sp-3-sp1jg4.t1.p10"></a>`REQ-SP-3-SP1JG4.T1.P10` — existing participant

<a id="req-sp-3-sp1jg4.t1.p11"></a>`REQ-SP-3-SP1JG4.T1.P11` — removed participant

<a id="req-sp-3-sp1jg4.t1.p12"></a>`REQ-SP-3-SP1JG4.T1.P12` — slashed participant

<a id="req-sp-3-sp1jg4.t1.p13"></a>`REQ-SP-3-SP1JG4.T1.P13` — concurrent membership change

#### <a id="req-sp-4-ncsex4.t1"></a>`REQ-SP-4-NCSEX4.T1`

**Requirements / invariants:**

[`REQ-SP-4-NCSEX4`](state-proofs.md#req-sp-4-ncsex4)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

Fork genesis is the implicit final anchor: empty proofs claim the genesis snapshot; a genesis-starting milestone begins at block zero and hash-links forward.

**Required permutations:**

<a id="req-sp-4-ncsex4.t1.p1"></a>`REQ-SP-4-NCSEX4.T1.P1` — valid case

<a id="req-sp-4-ncsex4.t1.p2"></a>`REQ-SP-4-NCSEX4.T1.P2` — matching commitment

<a id="req-sp-4-ncsex4.t1.p3"></a>`REQ-SP-4-NCSEX4.T1.P3` — correct identity/signature

<a id="req-sp-4-ncsex4.t1.p4"></a>`REQ-SP-4-NCSEX4.T1.P4` — direct invalid/opposite case

<a id="req-sp-4-ncsex4.t1.p5"></a>`REQ-SP-4-NCSEX4.T1.P5` — mismatched commitment

<a id="req-sp-4-ncsex4.t1.p6"></a>`REQ-SP-4-NCSEX4.T1.P6` — predecessor case

<a id="req-sp-4-ncsex4.t1.p7"></a>`REQ-SP-4-NCSEX4.T1.P7` — genesis case

<a id="req-sp-4-ncsex4.t1.p8"></a>`REQ-SP-4-NCSEX4.T1.P8` — stale fork

<a id="req-sp-4-ncsex4.t1.p9"></a>`REQ-SP-4-NCSEX4.T1.P9` — foreign fork

<a id="req-sp-4-ncsex4.t1.p10"></a>`REQ-SP-4-NCSEX4.T1.P10` — wrong identity/signature

<a id="req-sp-4-ncsex4.t1.p11"></a>`REQ-SP-4-NCSEX4.T1.P11` — missing identity/signature

<a id="req-sp-4-ncsex4.t1.p12"></a>`REQ-SP-4-NCSEX4.T1.P12` — duplicate identity/signature

<a id="req-sp-4-ncsex4.t1.p13"></a>`REQ-SP-4-NCSEX4.T1.P13` — forged identity/signature

<a id="req-sp-4-ncsex4.t1.p14"></a>`REQ-SP-4-NCSEX4.T1.P14` — membership boundary

#### <a id="req-sp-5-mte4rv.t1"></a>`REQ-SP-5-MTE4RV.T1`

**Requirements / invariants:**

[`REQ-SP-5-MTE4RV`](state-proofs.md#req-sp-5-mte4rv)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

The final block of the proved path supplies the state commitment the dispute game operates on.

**Required permutations:**

<a id="req-sp-5-mte4rv.t1.p1"></a>`REQ-SP-5-MTE4RV.T1.P1` — valid case

<a id="req-sp-5-mte4rv.t1.p2"></a>`REQ-SP-5-MTE4RV.T1.P2` — matching commitment

<a id="req-sp-5-mte4rv.t1.p3"></a>`REQ-SP-5-MTE4RV.T1.P3` — malformed input

<a id="req-sp-5-mte4rv.t1.p4"></a>`REQ-SP-5-MTE4RV.T1.P4` — direct invalid/opposite case

<a id="req-sp-5-mte4rv.t1.p5"></a>`REQ-SP-5-MTE4RV.T1.P5` — mismatched commitment

<a id="req-sp-5-mte4rv.t1.p6"></a>`REQ-SP-5-MTE4RV.T1.P6` — predecessor case

<a id="req-sp-5-mte4rv.t1.p7"></a>`REQ-SP-5-MTE4RV.T1.P7` — genesis case

<a id="req-sp-5-mte4rv.t1.p8"></a>`REQ-SP-5-MTE4RV.T1.P8` — stale fork

<a id="req-sp-5-mte4rv.t1.p9"></a>`REQ-SP-5-MTE4RV.T1.P9` — foreign fork

<a id="req-sp-5-mte4rv.t1.p10"></a>`REQ-SP-5-MTE4RV.T1.P10` — adversarial input

<a id="req-sp-5-mte4rv.t1.p11"></a>`REQ-SP-5-MTE4RV.T1.P11` — partial failure

<a id="req-sp-5-mte4rv.t1.p12"></a>`REQ-SP-5-MTE4RV.T1.P12` — retry and recovery

#### <a id="inv-sp-6-gnw74h.t1"></a>`INV-SP-6-GNW74H.T1`

**Requirements / invariants:**

[`INV-SP-6-GNW74H`](state-proofs.md#inv-sp-6-gnw74h)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

Non-final suffixes are safe: conflicting commitments expose slashable double-signs, and reduction selects the longest valid proved history.

**Required permutations:**

<a id="inv-sp-6-gnw74h.t1.p1"></a>`INV-SP-6-GNW74H.T1.P1` — valid case

<a id="inv-sp-6-gnw74h.t1.p2"></a>`INV-SP-6-GNW74H.T1.P2` — matching commitment

<a id="inv-sp-6-gnw74h.t1.p3"></a>`INV-SP-6-GNW74H.T1.P3` — correct identity/signature

<a id="inv-sp-6-gnw74h.t1.p4"></a>`INV-SP-6-GNW74H.T1.P4` — new participant

<a id="inv-sp-6-gnw74h.t1.p5"></a>`INV-SP-6-GNW74H.T1.P5` — direct invalid/opposite case

<a id="inv-sp-6-gnw74h.t1.p6"></a>`INV-SP-6-GNW74H.T1.P6` — mismatched commitment

<a id="inv-sp-6-gnw74h.t1.p7"></a>`INV-SP-6-GNW74H.T1.P7` — predecessor case

<a id="inv-sp-6-gnw74h.t1.p8"></a>`INV-SP-6-GNW74H.T1.P8` — genesis case

<a id="inv-sp-6-gnw74h.t1.p9"></a>`INV-SP-6-GNW74H.T1.P9` — stale fork

<a id="inv-sp-6-gnw74h.t1.p10"></a>`INV-SP-6-GNW74H.T1.P10` — foreign fork

<a id="inv-sp-6-gnw74h.t1.p11"></a>`INV-SP-6-GNW74H.T1.P11` — wrong identity/signature

<a id="inv-sp-6-gnw74h.t1.p12"></a>`INV-SP-6-GNW74H.T1.P12` — missing identity/signature

<a id="inv-sp-6-gnw74h.t1.p13"></a>`INV-SP-6-GNW74H.T1.P13` — duplicate identity/signature

<a id="inv-sp-6-gnw74h.t1.p14"></a>`INV-SP-6-GNW74H.T1.P14` — forged identity/signature

<a id="inv-sp-6-gnw74h.t1.p15"></a>`INV-SP-6-GNW74H.T1.P15` — membership boundary

<a id="inv-sp-6-gnw74h.t1.p16"></a>`INV-SP-6-GNW74H.T1.P16` — existing participant

<a id="inv-sp-6-gnw74h.t1.p17"></a>`INV-SP-6-GNW74H.T1.P17` — removed participant

<a id="inv-sp-6-gnw74h.t1.p18"></a>`INV-SP-6-GNW74H.T1.P18` — slashed participant

<a id="inv-sp-6-gnw74h.t1.p19"></a>`INV-SP-6-GNW74H.T1.P19` — concurrent membership change

#### <a id="req-sp-7-70emat.t1"></a>`REQ-SP-7-70EMAT.T1`

**Requirements / invariants:**

[`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat)

**Setup and stimulus:**

Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals.

**Expected result:**

Linkage checks: hash linkage, fork identity, authentic author signatures, threshold coverage, and latest-state commitment, in the retained checked region.

**Required permutations:**

<a id="req-sp-7-70emat.t1.p1"></a>`REQ-SP-7-70EMAT.T1.P1` — valid case

<a id="req-sp-7-70emat.t1.p2"></a>`REQ-SP-7-70EMAT.T1.P2` — matching commitment

<a id="req-sp-7-70emat.t1.p3"></a>`REQ-SP-7-70EMAT.T1.P3` — correct identity/signature

<a id="req-sp-7-70emat.t1.p4"></a>`REQ-SP-7-70EMAT.T1.P4` — direct invalid/opposite case

<a id="req-sp-7-70emat.t1.p5"></a>`REQ-SP-7-70EMAT.T1.P5` — mismatched commitment

<a id="req-sp-7-70emat.t1.p6"></a>`REQ-SP-7-70EMAT.T1.P6` — predecessor case

<a id="req-sp-7-70emat.t1.p7"></a>`REQ-SP-7-70EMAT.T1.P7` — genesis case

<a id="req-sp-7-70emat.t1.p8"></a>`REQ-SP-7-70EMAT.T1.P8` — stale fork

<a id="req-sp-7-70emat.t1.p9"></a>`REQ-SP-7-70EMAT.T1.P9` — foreign fork

<a id="req-sp-7-70emat.t1.p10"></a>`REQ-SP-7-70EMAT.T1.P10` — wrong identity/signature

<a id="req-sp-7-70emat.t1.p11"></a>`REQ-SP-7-70EMAT.T1.P11` — missing identity/signature

<a id="req-sp-7-70emat.t1.p12"></a>`REQ-SP-7-70EMAT.T1.P12` — duplicate identity/signature

<a id="req-sp-7-70emat.t1.p13"></a>`REQ-SP-7-70EMAT.T1.P13` — forged identity/signature

<a id="req-sp-7-70emat.t1.p14"></a>`REQ-SP-7-70EMAT.T1.P14` — membership boundary

#### <a id="req-sp-9-rnxp56.t1"></a>`REQ-SP-9-RNXP56.T1`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t1.p1"></a>`REQ-SP-9-RNXP56.T1.P1` — Audit with no local final state accepts the local mirror and performs no chain walk.

<a id="req-sp-9-rnxp56.t1.p2"></a>`REQ-SP-9-RNXP56.T1.P2` — Audit with missing mirrored consumed inbound evidence accepts the canonical chain proof without a counter.

<a id="req-sp-9-rnxp56.t1.p3"></a>`REQ-SP-9-RNXP56.T1.P3` — Audit from a genesis-only mirror falls through to a newer chain anchor and accepts.

<a id="req-sp-9-rnxp56.t1.p4"></a>`REQ-SP-9-RNXP56.T1.P4` — Local executor failure during audit propagates; no chain walk or counter is produced.

<a id="req-sp-9-rnxp56.t1.p5"></a>`REQ-SP-9-RNXP56.T1.P5` — Local contract revert during audit propagates; no chain walk or counter is produced.

<a id="req-sp-9-rnxp56.t1.p6"></a>`REQ-SP-9-RNXP56.T1.P6` — Malformed retained tail with posted auditing data produces an invalid-proof counter without crashing.

<a id="req-sp-9-rnxp56.t1.p7"></a>`REQ-SP-9-RNXP56.T1.P7` — Malformed retained tail with permitted omitted data produces an invalid-proof counter without crashing.

<a id="req-sp-9-rnxp56.t1.p8"></a>`REQ-SP-9-RNXP56.T1.P8` — Malformed inner block in a wholly skipped milestone is not checked and does not invalidate audit.

<a id="req-sp-9-rnxp56.t1.p9"></a>`REQ-SP-9-RNXP56.T1.P9` — Replay failing below the chain anchor restarts from the verified anchor state and accepts without accusation.

<a id="req-sp-9-rnxp56.t1.p10"></a>`REQ-SP-9-RNXP56.T1.P10` — A fault after the chain anchor is accused only by the canonical replay, at its actual position.

#### <a id="req-sp-10-jmvhtb.t1"></a>`REQ-SP-10-JMVHTB.T1`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t1.p1"></a>`REQ-SP-10-JMVHTB.T1.P1` — A participant retaining its anchor after pruning older history can rebuild both its latest proof and anchor proof and retain replay state.

<a id="req-sp-10-jmvhtb.t1.p2"></a>`REQ-SP-10-JMVHTB.T1.P2` — A spectator synced with the anchor as latest final stores its block, snapshot and exact full state and rebuilds a valid anchor proof.

<a id="req-sp-10-jmvhtb.t1.p3"></a>`REQ-SP-10-JMVHTB.T1.P3` — A compact spectator with later finality and overlapping join evidence rebuilds its latest proof and retains the latest final state without history below the join.

#### <a id="req-sp-8-9zccej.t1"></a>`REQ-SP-8-9ZCCEJ.T1`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t1.p2"></a>`REQ-SP-8-9ZCCEJ.T1.P2` — A newer local final state is used for verification but never advances the construction anchor.

#### <a id="req-sp-10-jmvhtb.t2"></a>`REQ-SP-10-JMVHTB.T2`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t2.p1"></a>`REQ-SP-10-JMVHTB.T2.P1` — A participant audit missing a valid tail accepts after replay, stores the tail head block and full latest application state, and stores no counter.

<a id="req-sp-10-jmvhtb.t2.p2"></a>`REQ-SP-10-JMVHTB.T2.P2` — A pending auditor missing a tail accepts after replay and stores its head block, committed snapshot and full latest application state with no counter.

<a id="req-sp-10-jmvhtb.t2.p3"></a>`REQ-SP-10-JMVHTB.T2.P3` — A successful dispute replay above the frozen view stores every replayed tail block without adding auditor signatures; active next height, status and force-join state stay unchanged.

<a id="req-sp-10-jmvhtb.t2.p4"></a>`REQ-SP-10-JMVHTB.T2.P4` — After persistence-only replay above the active view, the auditor constructs its own dispute ending at its frozen height and snapshot; the newer replayed head and full state remain stored without its signature.

<a id="req-sp-10-jmvhtb.t2.p5"></a>`REQ-SP-10-JMVHTB.T2.P5` — The same disconnected peer reconnects and progresses live; its own constructed dispute uses its latest active snapshot and the new head carries its author or confirmation signature.

<a id="req-sp-10-jmvhtb.t2.p6"></a>`REQ-SP-10-JMVHTB.T2.P6` — A pending auditor replays a tail whose resulting participant set seats it; replayed head is stored without its confirmation, but local status, active height and force-join fields stay unchanged.

<a id="req-sp-10-jmvhtb.t2.p7"></a>`REQ-SP-10-JMVHTB.T2.P7` — A pending auditor replays a tail that leaves its join unconsumed; latest full state becomes available while pending status, active height and force-join fields stay unchanged.

#### <a id="req-sp-9-rnxp56.t2"></a>`REQ-SP-9-RNXP56.T2`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t2.p1"></a>`REQ-SP-9-RNXP56.T2.P1` — A tail with forged resulting snapshot fails replay; the audit stores the wrapped transition counter at its last-milestone index, stores neither failed block nor snapshot, and a second audit rejects again with one counter.

<a id="req-sp-9-rnxp56.t2.p2"></a>`REQ-SP-9-RNXP56.T2.P2` — A failing tail block also appearing as earlier milestone support still fails actual tail replay at its last-milestone position; the wrapped counter is stored and the failed block is absent.

<a id="req-sp-9-rnxp56.t2.p3"></a>`REQ-SP-9-RNXP56.T2.P3` — An injected internal failure on the second dispute-replay tail block throws without a counter; the failed block is absent while the earlier successful block and its full state remain stored.

<a id="req-sp-9-rnxp56.t2.p4"></a>`REQ-SP-9-RNXP56.T2.P4` — An injected internal failure on the second sync-replay tail block throws, preserves the first replayed full state, stores no failed block, and does not blacklist the responder.

#### <a id="req-sp-1-9yaby1.t2"></a>`REQ-SP-1-9YABY1.T2`

**Requirements / invariants:**

[`REQ-SP-1-9YABY1`](state-proofs.md#req-sp-1-9yaby1)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-1-9yaby1.t2.p1"></a>`REQ-SP-1-9YABY1.T2.P1` — A milestone-only proof survives ABI round-trip, selects the last block of its last milestone as its latest state, and walks to its proven first-block final point.

<a id="req-sp-1-9yaby1.t2.p2"></a>`REQ-SP-1-9YABY1.T2.P2` — A nonempty anchor-only proof returns the exact anchor snapshot, has no replay tail, passes latest-state linkage and is not below the anchor.

<a id="req-sp-1-9yaby1.t2.p3"></a>`REQ-SP-1-9YABY1.T2.P3` — A matching anchor at the first run position verifies, remains final and sets replay index one.

<a id="req-sp-1-9yaby1.t2.p4"></a>`REQ-SP-1-9YABY1.T2.P4` — A matching anchor at the middle run position verifies, remains final and sets replay index two.

<a id="req-sp-1-9yaby1.t2.p5"></a>`REQ-SP-1-9YABY1.T2.P5` — A matching anchor at the final run position verifies, remains final and sets replay index to run length.

<a id="req-sp-1-9yaby1.t2.p6"></a>`REQ-SP-1-9YABY1.T2.P6` — A threshold-proven first hop above the anchor verifies without an anchor block and finalizes that hop.

<a id="req-sp-1-9yaby1.t2.p7"></a>`REQ-SP-1-9YABY1.T2.P7` — An above-anchor first hop without the required signatures returns invalid.

<a id="req-sp-1-9yaby1.t2.p8"></a>`REQ-SP-1-9YABY1.T2.P8` — Including the anchor block allows an author-only extension above it while keeping the anchor as final point.

<a id="req-sp-1-9yaby1.t2.p9"></a>`REQ-SP-1-9YABY1.T2.P9` — Linkage of an author-only tail does not advance finality beyond the matching anchor.

<a id="req-sp-1-9yaby1.t2.p10"></a>`REQ-SP-1-9YABY1.T2.P10` — A valid genesis-built proof remains valid after the chain start advances to block zero, preserving its later final point and replay index.

<a id="req-sp-1-9yaby1.t2.p11"></a>`REQ-SP-1-9YABY1.T2.P11` — Advancing the anchor into a proof makes that matching interior anchor its final point and adjusts replay index.

<a id="req-sp-1-9yaby1.t2.p12"></a>`REQ-SP-1-9YABY1.T2.P12` — Advancing the anchor to the proof endpoint leaves a valid walk with no replay tail.

<a id="req-sp-1-9yaby1.t2.p13"></a>`REQ-SP-1-9YABY1.T2.P13` — Advancing the anchor beyond the proof endpoint leaves a valid walk final at the anchor with no remaining tail.

<a id="req-sp-1-9yaby1.t2.p14"></a>`REQ-SP-1-9YABY1.T2.P14` — Direct signatures on one block establish a valid above-anchor threshold hop and its final point.

<a id="req-sp-1-9yaby1.t2.p15"></a>`REQ-SP-1-9YABY1.T2.P15` — Distinct author signatures across linked blocks establish virtual-voting finality of the first block.

<a id="req-sp-1-9yaby1.t2.p16"></a>`REQ-SP-1-9YABY1.T2.P16` — Direct first-block signatures plus a linked later author signature establish the same first-block final point.

<a id="req-sp-1-9yaby1.t2.p17"></a>`REQ-SP-1-9YABY1.T2.P17` — Overlapping anchor and later-final runs carrying different signature evidence for their shared block verify with the later first block finalized.

#### <a id="req-sp-4-ncsex4.t2"></a>`REQ-SP-4-NCSEX4.T2`

**Requirements / invariants:**

[`REQ-SP-4-NCSEX4`](state-proofs.md#req-sp-4-ncsex4)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-4-ncsex4.t2.p1"></a>`REQ-SP-4-NCSEX4.T2.P1` — An empty proof verifies with genesis as its final point and replay index zero, and its genesis latest-state claim passes.

<a id="req-sp-4-ncsex4.t2.p2"></a>`REQ-SP-4-NCSEX4.T2.P2` — With a non-genesis chain anchor, an empty proof still returns genesis as its final point and is separately below that anchor.

<a id="req-sp-4-ncsex4.t2.p3"></a>`REQ-SP-4-NCSEX4.T2.P3` — An author-only genesis block zero verifies with genesis still final and replay beginning at zero.

<a id="req-sp-4-ncsex4.t2.p4"></a>`REQ-SP-4-NCSEX4.T2.P4` — A linked author-only genesis-zero run verifies with genesis final and replay beginning at zero.

<a id="req-sp-4-ncsex4.t2.p5"></a>`REQ-SP-4-NCSEX4.T2.P5` — A threshold-signed genesis-zero run finalizes block zero and sets replay index one.

<a id="req-sp-4-ncsex4.t2.p6"></a>`REQ-SP-4-NCSEX4.T2.P6` — A block-zero resulting snapshot used as chain anchor finalizes zero without threshold signatures and starts replay at index one.

<a id="req-sp-4-ncsex4.t2.p7"></a>`REQ-SP-4-NCSEX4.T2.P7` — A threshold-signed block at height zero committing another snapshot does not match the block-zero chain anchor, with either supplied snapshot entry.

<a id="req-sp-4-ncsex4.t2.p8"></a>`REQ-SP-4-NCSEX4.T2.P8` — A threshold-signed block zero with the wrong genesis predecessor makes the walk invalid.

#### <a id="req-sp-7-70emat.t2"></a>`REQ-SP-7-70EMAT.T2`

**Requirements / invariants:**

[`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-7-70emat.t2.p1"></a>`REQ-SP-7-70EMAT.T2.P1` — A run block at anchor height committing another snapshot returns invalid without classifying the supplied evidence as snapshot mismatch.

<a id="req-sp-7-70emat.t2.p2"></a>`REQ-SP-7-70EMAT.T2.P2` — A broken retained link after the anchor makes the walk invalid.

<a id="req-sp-7-70emat.t2.p3"></a>`REQ-SP-7-70EMAT.T2.P3` — Wholly pre-anchor milestones and a crossing-run prefix are skipped despite junk, missing threshold and forged entries; retained anchor and replay index remain correct.

<a id="req-sp-7-70emat.t2.p4"></a>`REQ-SP-7-70EMAT.T2.P4` — A foreign-fork first block below the matching anchor in a crossing run is skipped and the retained walk succeeds.

<a id="req-sp-7-70emat.t2.p5"></a>`REQ-SP-7-70EMAT.T2.P5` — A supplied hop snapshot at another height returns invalid with snapshotMismatch true.

<a id="req-sp-7-70emat.t2.p6"></a>`REQ-SP-7-70EMAT.T2.P6` — A supplied snapshot with the correct height but wrong state hash returns invalid with snapshotMismatch true.

<a id="req-sp-7-70emat.t2.p7"></a>`REQ-SP-7-70EMAT.T2.P7` — An empty milestone returns invalid without snapshotMismatch.

<a id="req-sp-7-70emat.t2.p8"></a>`REQ-SP-7-70EMAT.T2.P8` — A missing milestone snapshot entry returns invalid with snapshotMismatch.

<a id="req-sp-7-70emat.t2.p9"></a>`REQ-SP-7-70EMAT.T2.P9` — An excess milestone snapshot entry returns invalid with snapshotMismatch.

<a id="req-sp-7-70emat.t2.p10"></a>`REQ-SP-7-70EMAT.T2.P10` — Exactly one correct snapshot entry for a single hop verifies and yields the correct final point and replay index.

<a id="req-sp-7-70emat.t2.p11"></a>`REQ-SP-7-70EMAT.T2.P11` — A changed shared block in the second overlapping run breaks the proof even when its supplied snapshot matches that changed block.

#### <a id="req-sp-3-sp1jg4.t2"></a>`REQ-SP-3-SP1JG4.T2`

**Requirements / invariants:**

[`REQ-SP-3-SP1JG4`](state-proofs.md#req-sp-3-sp1jg4)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-3-sp1jg4.t2.p1"></a>`REQ-SP-3-SP1JG4.T2.P1` — A participant-addition hop with old and new union signatures verifies and finalizes its authenticated snapshot.

<a id="req-sp-3-sp1jg4.t2.p2"></a>`REQ-SP-3-SP1JG4.T2.P2` — A participant-removal hop with the old and new union signatures verifies and finalizes its authenticated snapshot.

<a id="req-sp-3-sp1jg4.t2.p3"></a>`REQ-SP-3-SP1JG4.T2.P3` — A proven departure followed by a proven join uses each hop's own union, so the departed signer is not needed for the later join.

<a id="req-sp-3-sp1jg4.t2.p4"></a>`REQ-SP-3-SP1JG4.T2.P4` — Omitting the earlier departure hop leaves its signer required by the anchor-to-join union; missing that signature rejects the hop.

<a id="req-sp-3-sp1jg4.t2.p5"></a>`REQ-SP-3-SP1JG4.T2.P5` — Below-threshold signatures on an above-anchor hop return invalid.

<a id="req-sp-3-sp1jg4.t2.p6"></a>`REQ-SP-3-SP1JG4.T2.P6` — Exactly the required signer set finalizes an above-anchor hop.

<a id="req-sp-3-sp1jg4.t2.p7"></a>`REQ-SP-3-SP1JG4.T2.P7` — A complete required signer set plus an outside signer still finalizes the hop.

<a id="req-sp-3-sp1jg4.t2.p8"></a>`REQ-SP-3-SP1JG4.T2.P8` — A removal hop missing the departing old-set member signature is invalid.

<a id="req-sp-3-sp1jg4.t2.p9"></a>`REQ-SP-3-SP1JG4.T2.P9` — An addition hop missing the joining new-set member signature is invalid.

<a id="req-sp-3-sp1jg4.t2.p10"></a>`REQ-SP-3-SP1JG4.T2.P10` — Several unfinalized membership changes committed in one anchor run remain a valid replay tail without advancing the finalized point.

<a id="req-sp-3-sp1jg4.t2.p11"></a>`REQ-SP-3-SP1JG4.T2.P11` — Separating unsigned membership changes into claimed final hops returns invalid.

<a id="req-sp-3-sp1jg4.t2.p12"></a>`REQ-SP-3-SP1JG4.T2.P12` — Duplicate signatures from one required participant cannot replace the missing required signer.

<a id="req-sp-3-sp1jg4.t2.p13"></a>`REQ-SP-3-SP1JG4.T2.P13` — An outside signer cannot replace a missing required participant.

<a id="req-sp-3-sp1jg4.t2.p14"></a>`REQ-SP-3-SP1JG4.T2.P14` — A genesis-zero addition with the complete old/new/consumed-joiner union finalizes zero.

<a id="req-sp-3-sp1jg4.t2.p15"></a>`REQ-SP-3-SP1JG4.T2.P15` — A genesis-zero removal with the old/new union including the leaver finalizes zero.

<a id="req-sp-3-sp1jg4.t2.p16"></a>`REQ-SP-3-SP1JG4.T2.P16` — A genesis-zero removal missing the leaver signature remains a valid unfinalized run replayed from genesis.

<a id="req-sp-3-sp1jg4.t2.p17"></a>`REQ-SP-3-SP1JG4.T2.P17` — A genesis-zero addition missing the joiner signature remains a valid unfinalized run replayed from genesis.

<a id="req-sp-3-sp1jg4.t2.p18"></a>`REQ-SP-3-SP1JG4.T2.P18` — A later on-chain slash preserves validity of a complete historical proof and does not remove the slashed signer from its required threshold.

<a id="req-sp-3-sp1jg4.t2.p19"></a>`REQ-SP-3-SP1JG4.T2.P19` — A hop consuming a JOIN while the joiner is absent from both endpoint sets fails without that joiner signature, with authenticated snapshot evidence.

<a id="req-sp-3-sp1jg4.t2.p20"></a>`REQ-SP-3-SP1JG4.T2.P20` — A hop consuming a JOIN while the joiner is absent from both endpoint sets verifies with that joiner signature and finalizes its snapshot.

#### <a id="req-sp-8-9zccej.t2"></a>`REQ-SP-8-9ZCCEJ.T2`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t2.p1"></a>`REQ-SP-8-9ZCCEJ.T2.P1` — An audit-stored final block above the active view supports an explicit-height chain-valid final proof; default construction remains bounded by the active view.

<a id="req-sp-8-9zccej.t2.p2"></a>`REQ-SP-8-9ZCCEJ.T2.P2` — Backward search finds the latest final point and retains its unfinalized tail inside one chain-valid milestone.

<a id="req-sp-8-9zccej.t2.p3"></a>`REQ-SP-8-9ZCCEJ.T2.P3` — A join hop whose supporting run overlaps a later final point keeps that point as a separate last milestone and the chain verifies both.

<a id="req-sp-8-9zccej.t2.p4"></a>`REQ-SP-8-9ZCCEJ.T2.P4` — Two membership changes each retain minimum forward signer coverage; the latest fully signed head becomes a separate final milestone found backward.

<a id="req-sp-8-9zccej.t2.p5"></a>`REQ-SP-8-9ZCCEJ.T2.P5` — When backward search finds no later final start than the preceding join milestone, construction extends that milestone through the latest block without duplicating its start.

<a id="req-sp-8-9zccej.t2.p6"></a>`REQ-SP-8-9ZCCEJ.T2.P6` — When block n+1 supplies finality evidence for n, both full and finalized-only proofs keep n+1; snapshot preparation targets n and has update calldata.

<a id="req-sp-8-9zccej.t2.p7"></a>`REQ-SP-8-9ZCCEJ.T2.P7` — Construction with a current mirrored anchor starts at that same anchor, retains only later final hops and verifies from the chain anchor.

<a id="req-sp-8-9zccej.t2.p8"></a>`REQ-SP-8-9ZCCEJ.T2.P8` — Construction with a mirror lagging the chain starts at the older genesis and still verifies from the newer canonical anchor.

<a id="req-sp-8-9zccej.t2.p9"></a>`REQ-SP-8-9ZCCEJ.T2.P9` — A private finalized point above genesis supplies the verification start while construction remains rooted at mirrored genesis.

<a id="req-sp-8-9zccej.t2.p10"></a>`REQ-SP-8-9ZCCEJ.T2.P10` — Missing required anchor-run blocks make construction throw; restoring the genuine blocks permits an explicit new attempt yielding the expected chain-valid run.

<a id="req-sp-8-9zccej.t2.p11"></a>`REQ-SP-8-9ZCCEJ.T2.P11` — A missing participant-change block above the anchor makes construction throw instead of skipping its hop.

<a id="req-sp-8-9zccej.t2.p12"></a>`REQ-SP-8-9ZCCEJ.T2.P12` — Loss of a required join confirmation lowers the proved final point to the preceding block and retains the join in a chain-valid unfinalized tail.

<a id="req-sp-8-9zccej.t2.p13"></a>`REQ-SP-8-9ZCCEJ.T2.P13` — A missing stored snapshot for a required participant-change block makes construction throw instead of skipping the hop.

<a id="req-sp-8-9zccej.t2.p14"></a>`REQ-SP-8-9ZCCEJ.T2.P14` — Required proof-block absence makes dispute construction throw and leaves the chain dispute window without commitments.

<a id="req-sp-8-9zccej.t2.p15"></a>`REQ-SP-8-9ZCCEJ.T2.P15` — Required proof-block absence makes sync payload generation throw and return no replacement payload.

<a id="req-sp-8-9zccej.t2.p16"></a>`REQ-SP-8-9ZCCEJ.T2.P16` — Missing required participant-change block makes snapshot posting throw before any recorded multicall; the chain anchor stays unchanged.

<a id="req-sp-8-9zccej.t2.p17"></a>`REQ-SP-8-9ZCCEJ.T2.P17` — With required proof material present, snapshot posting sends updateStateSnapshotSameFork and the chain adopts the newer last-milestone final point.

<a id="req-sp-8-9zccej.t2.p18"></a>`REQ-SP-8-9ZCCEJ.T2.P18` — A canonical chain walk connection failure during snapshot posting propagates and leaves the chain snapshot unchanged.

#### <a id="req-sp-3-sp1jg4.t3"></a>`REQ-SP-3-SP1JG4.T3`

**Requirements / invariants:**

[`REQ-SP-3-SP1JG4`](state-proofs.md#req-sp-3-sp1jg4)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-3-sp1jg4.t3.p1"></a>`REQ-SP-3-SP1JG4.T3.P1` — A hop consuming then removing a joiner, absent from both endpoint participant sets, is not final without that joiner; adding its signature makes SDK construction retain it and the local canonical walk verify.

<a id="req-sp-3-sp1jg4.t3.p2"></a>`REQ-SP-3-SP1JG4.T3.P2` — An ordinary join hop retains exactly the previous/resulting participant union signatures and produces chain-valid finalized-only and tailed proofs.

#### <a id="req-sp-4-ncsex4.t3"></a>`REQ-SP-4-NCSEX4.T3`

**Requirements / invariants:**

[`REQ-SP-4-NCSEX4`](state-proofs.md#req-sp-4-ncsex4)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-4-ncsex4.t3.p1"></a>`REQ-SP-4-NCSEX4.T3.P1` — Before successor anchor adoption, an empty successor proof uses its authenticated genesis at both mirror and chain tiers, never the ancestor anchor.

<a id="req-sp-4-ncsex4.t3.p2"></a>`REQ-SP-4-NCSEX4.T3.P2` — Before successor anchor adoption, an unfinalized genesis-linked block-zero run uses successor genesis at both tiers and replays from index zero.

<a id="req-sp-4-ncsex4.t3.p3"></a>`REQ-SP-4-NCSEX4.T3.P3` — Ancestor genesis evidence supplied for a successor fork fails both mirror and chain verification.

<a id="req-sp-4-ncsex4.t3.p4"></a>`REQ-SP-4-NCSEX4.T3.P4` — Genuine successor genesis verifies, but substituting its origin fork causes both mirror and chain verification to fail.

<a id="req-sp-4-ncsex4.t3.p5"></a>`REQ-SP-4-NCSEX4.T3.P5` — Undecodable material inside a wholly skipped pre-anchor milestone does not prevent sync; planted historical block and snapshot are not stored.

<a id="req-sp-4-ncsex4.t3.p6"></a>`REQ-SP-4-NCSEX4.T3.P6` — An empty genesis proof with zero snapshot entries syncs successfully and installs the genesis state with head remaining -1.

#### <a id="req-sp-9-rnxp56.t3"></a>`REQ-SP-9-RNXP56.T3`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t3.p1"></a>`REQ-SP-9-RNXP56.T3.P1` — Shared proof verification accepts its latest private final start without invoking mirror-anchor or chain walks.

<a id="req-sp-9-rnxp56.t3.p2"></a>`REQ-SP-9-RNXP56.T3.P2` — With no private final state above the anchor, shared verification accepts the mirror walk and never invokes the chain walk.

<a id="req-sp-9-rnxp56.t3.p3"></a>`REQ-SP-9-RNXP56.T3.P3` — A proof conflicting at private final height returns false there but is accepted from the mirrored anchor.

<a id="req-sp-9-rnxp56.t3.p4"></a>`REQ-SP-9-RNXP56.T3.P4` — A genesis-only lagging mirror fails to verify while the newer chain anchor establishes the same proof.

<a id="req-sp-9-rnxp56.t3.p5"></a>`REQ-SP-9-RNXP56.T3.P5` — A mirror missing consumed inbound evidence returns false; canonical chain verification accepts.

<a id="req-sp-9-rnxp56.t3.p6"></a>`REQ-SP-9-RNXP56.T3.P6` — An unlinked block causes all three tiers to return false; shared verification returns the chain invalid verdict without throwing.

<a id="req-sp-9-rnxp56.t3.p7"></a>`REQ-SP-9-RNXP56.T3.P7` — Missing required participant-change storage while obtaining the local final start throws and no later proof tier runs.

<a id="req-sp-9-rnxp56.t3.p8"></a>`REQ-SP-9-RNXP56.T3.P8` — A local EVM connection failure during mirror walk throws with no chain fallback.

<a id="req-sp-9-rnxp56.t3.p9"></a>`REQ-SP-9-RNXP56.T3.P9` — A node RPC failure after the mirror cannot verify throws without an invalid-proof verdict.

<a id="req-sp-9-rnxp56.t3.p10"></a>`REQ-SP-9-RNXP56.T3.P10` — A participant sync accepts its local finalized tier without mirror or chain walks or responder penalty.

<a id="req-sp-9-rnxp56.t3.p11"></a>`REQ-SP-9-RNXP56.T3.P11` — After local-final proof verification succeeds, a forged latest-fork outbound block still fails the independent sync check.

<a id="req-sp-9-rnxp56.t3.p12"></a>`REQ-SP-9-RNXP56.T3.P12` — A fresh requester skips absent private finality, accepts the mirror proof walk and does not query the chain.

<a id="req-sp-9-rnxp56.t3.p13"></a>`REQ-SP-9-RNXP56.T3.P13` — A fresh requester missing a consumed top-up accepts canonical proof verification after the mirror returns false, with no penalty.

<a id="req-sp-9-rnxp56.t3.p14"></a>`REQ-SP-9-RNXP56.T3.P14` — A conflicting proof fails the private-final walk but passes the mirror walk without chain query; subsequent block replay rejects sync and blacklists the responder.

<a id="req-sp-9-rnxp56.t3.p15"></a>`REQ-SP-9-RNXP56.T3.P15` — A requester whose mirror lacks the newer anchor accepts sync through chain-anchor fallback after genesis-start verification fails.

<a id="req-sp-9-rnxp56.t3.p16"></a>`REQ-SP-9-RNXP56.T3.P16` — A requester whose mirror has the anchor but lacks later consumed inbound evidence accepts chain fallback without penalty.

<a id="req-sp-9-rnxp56.t3.p17"></a>`REQ-SP-9-RNXP56.T3.P17` — Undecodable retained last-block bytes return false at all three proof tiers; sync rejects as invalid milestones and blacklists the responder without throwing.

<a id="req-sp-9-rnxp56.t3.p18"></a>`REQ-SP-9-RNXP56.T3.P18` — Local-final executor failure during sync throws with no later walk, proof-rejection reason or blacklist.

<a id="req-sp-9-rnxp56.t3.p19"></a>`REQ-SP-9-RNXP56.T3.P19` — Mirror executor failure during fresh sync throws with no chain walk, installed head, proof rejection or blacklist.

<a id="req-sp-9-rnxp56.t3.p20"></a>`REQ-SP-9-RNXP56.T3.P20` — Node RPC failure after mirror false during fresh sync throws without installing a head or penalizing the responder.

#### <a id="req-sp-7-70emat.t3"></a>`REQ-SP-7-70EMAT.T3`

**Requirements / invariants:**

[`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-7-70emat.t3.p1"></a>`REQ-SP-7-70EMAT.T3.P1` — A checked block signed by a real participant other than its author makes sync reject/blacklist without storing proof blocks.

<a id="req-sp-7-70emat.t3.p2"></a>`REQ-SP-7-70EMAT.T3.P2` — An unrecoverable required confirmation makes sync reject/blacklist as invalid proof, without throwing or storing proof blocks.

<a id="req-sp-7-70emat.t3.p3"></a>`REQ-SP-7-70EMAT.T3.P3` — Excess milestone snapshots make sync reject/blacklist and store neither proof blocks nor excess snapshots/states/change points.

<a id="req-sp-7-70emat.t3.p4"></a>`REQ-SP-7-70EMAT.T3.P4` — Missing milestone snapshot makes sync reject/blacklist without storing proof blocks or change points.

<a id="req-sp-7-70emat.t3.p5"></a>`REQ-SP-7-70EMAT.T3.P5` — Exact one-snapshot-per-milestone payload syncs successfully, stores the checked head, and reconstructs a chain-valid proof.

#### <a id="req-sp-10-jmvhtb.t3"></a>`REQ-SP-10-JMVHTB.T3`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t3.p1"></a>`REQ-SP-10-JMVHTB.T3.P1` — Compact sync installs above an already queued gossip block while omitting its history; release drops that block without closing the spectator or blacklisting honest sources, and the spectator then follows a new live head.

#### <a id="req-sp-10-jmvhtb.t4"></a>`REQ-SP-10-JMVHTB.T4`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t4.p1"></a>`REQ-SP-10-JMVHTB.T4.P1` — A participant missing unfinalized genesis-linked block zero syncs and replays it from genesis, reaches the same block and state, then authors onward; the progressed proof verifies on chain.

<a id="req-sp-10-jmvhtb.t4.p2"></a>`REQ-SP-10-JMVHTB.T4.P2` — A later joiner synced past a finalized join retains its participant-change hop, rebuilds a genesis-start proof after joining and progress, and constructs a dispute whose proof verifies on chain.

<a id="req-sp-10-jmvhtb.t4.p3"></a>`REQ-SP-10-JMVHTB.T4.P3` — After a departure and later join, a synced peer retains both change hops, serves a rebuilt proof that synchronizes a fresh spectator to the same state, and posts a chain snapshot with the departed member absent and the joiner present.

<a id="req-sp-10-jmvhtb.t4.p4"></a>`REQ-SP-10-JMVHTB.T4.P4` — Two unfinalized participant changes remain inside the final milestone tail rather than starting milestones; a sync-only observer replays them, obtains the same state and participants, and reconstructs a verified proof.

<a id="req-sp-10-jmvhtb.t4.p5"></a>`REQ-SP-10-JMVHTB.T4.P5` — When the chain anchor advances into an in-flight proof range, sync succeeds without blacklisting, persists the anchor block and newer state while omitting below-anchor history, and rebuilds an anchor-start proof that synchronizes a fresh spectator.

<a id="req-sp-10-jmvhtb.t4.p6"></a>`REQ-SP-10-JMVHTB.T4.P6` — A spectator synced across an unposted departure retains the departure hop and verifies reconstructed proofs before and after progress; after adopting the exit snapshot it rebuilds from that anchor without older proof blocks.

<a id="req-sp-10-jmvhtb.t4.p7"></a>`REQ-SP-10-JMVHTB.T4.P7` — After exit-anchor adoption and explicit deletion of older blocks and snapshots, a synced spectator rebuilds and serves a verified proof, constructs a chain-verified dispute proof, then posts a newer snapshot.

<a id="req-sp-10-jmvhtb.t4.p8"></a>`REQ-SP-10-JMVHTB.T4.P8` — A sync-only observer persists separated milestone runs supported by several-block virtual voting, leaves every gap block absent, reconstructs the same runs and constructs a chain-verified dispute proof.

<a id="req-sp-10-jmvhtb.t4.p9"></a>`REQ-SP-10-JMVHTB.T4.P9` — A sync-only observer accepts overlapping compact milestones, retains matching shared-block hashes and signer sets with no gap history, and rebuilds the same chain-verified runs and a chain-verified dispute proof.

<a id="req-sp-10-jmvhtb.t4.p10"></a>`REQ-SP-10-JMVHTB.T4.P10` — A tail block also used as earlier-change support is replayed during real observer sync; every tail block hash and latest application-state hash match the responder.

<a id="req-sp-10-jmvhtb.t4.p11"></a>`REQ-SP-10-JMVHTB.T4.P11` — A forged transition in a repeated tail block passes proof persistence but is executed during tail replay; a fresh spectator reaches SYNCED then returns to OPENED and closes, while the honest responder proof remains valid.

<a id="req-sp-10-jmvhtb.t4.p12"></a>`REQ-SP-10-JMVHTB.T4.P12` — A peer reconstructs chain-valid proofs while synced, pending, participating and after progress, retains the finalized join hop, then rebuilds from a moved anchor and constructs a chain-verified dispute proof.

<a id="req-sp-10-jmvhtb.t4.p13"></a>`REQ-SP-10-JMVHTB.T4.P13` — A former spectator now participating deletes older blocks and snapshots after anchor movement yet rebuilds and serves a verified proof, constructs a chain-verified dispute proof and posts a newer snapshot.

<a id="req-sp-10-jmvhtb.t4.p14"></a>`REQ-SP-10-JMVHTB.T4.P14` — A peer frozen by its own dispute audits and stores a higher replay chain with its snapshots and full states, adds no own confirmation or active-view advance, keeps its own constructed dispute at the frozen commitment, and resolves using the higher state.

#### <a id="req-sp-8-9zccej.t3"></a>`REQ-SP-8-9ZCCEJ.T3`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t3.p1"></a>`REQ-SP-8-9ZCCEJ.T3.P1` — With its mirror held behind the chain anchor, a builder produces a larger genesis-start proof accepted by chain verification and real spectator sync; after mirror release it rebuilds from the current anchor.

<a id="req-sp-8-9zccej.t3.p2"></a>`REQ-SP-8-9ZCCEJ.T3.P2` — Before successor adoption a participant and a fresh synced spectator build chain-valid proofs from successor genesis while the chain snapshot stays on the source fork; after adoption and progress the spectator rebuilds from the successor anchor.

#### <a id="req-sp-9-rnxp56.t4"></a>`REQ-SP-9-RNXP56.T4`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t4.p1"></a>`REQ-SP-9-RNXP56.T4.P1` — A spectator with its own later finalized point accepts an earlier-start proof containing a newer unfinalized tail, preserves its finalized block, reaches the same latest state, and does not blacklist the responder.

<a id="req-sp-9-rnxp56.t4.p2"></a>`REQ-SP-9-RNXP56.T4.P2` — A spectator rejects and blacklists a responder serving a valid historical proof ending below its finalized point, preserving its current height and application-state hash.

<a id="req-sp-9-rnxp56.t4.p3"></a>`REQ-SP-9-RNXP56.T4.P3` — A spectator rejects and blacklists an honest isolated spectator whose own proof ends below the requester final point; requester head remains unchanged.

<a id="req-sp-9-rnxp56.t4.p4"></a>`REQ-SP-9-RNXP56.T4.P4` — A spectator rejects and blacklists an honest same-key restarted responder whose resynced but later isolated proof is older; the requester preserves its final block and application-state hash.

<a id="req-sp-9-rnxp56.t4.p5"></a>`REQ-SP-9-RNXP56.T4.P5` — A pending auditor with no conflicting final block and no required anchor state throws on an otherwise real anchored history without storing any counter.

#### <a id="req-sp-10-jmvhtb.t5"></a>`REQ-SP-10-JMVHTB.T5`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t5.p1"></a>`REQ-SP-10-JMVHTB.T5.P1` — Applying the same anchor-rooted proof twice while its head is locally final accepts both, performs no second state install or replay, and preserves exact stored block hashes/signers and state hash.

<a id="req-sp-10-jmvhtb.t5.p2"></a>`REQ-SP-10-JMVHTB.T5.P2` — Applying an older proof then a newer final proof accepts both and installs the new state while preserving older-only block hashes/signers and storing newer proof block hashes.

<a id="req-sp-10-jmvhtb.t5.p3"></a>`REQ-SP-10-JMVHTB.T5.P3` — After installing the anchor state, receiving a valid run with earlier genuine supplied state still accepts and replays using held state to reach the responder tip without blacklist.

<a id="req-sp-10-jmvhtb.t5.p4"></a>`REQ-SP-10-JMVHTB.T5.P4` — Receiving a proof rooted before a newly adopted anchor retains the observed anchor and suffix, and reconstructs a chain-valid proof whose material starts no earlier than that anchor.

<a id="req-sp-10-jmvhtb.t5.p5"></a>`REQ-SP-10-JMVHTB.T5.P5` — Syncing past an unposted finalized departure stores its participant-change point and reconstructs a valid multi-milestone proof including the departure hop.

<a id="req-sp-10-jmvhtb.t5.p6"></a>`REQ-SP-10-JMVHTB.T5.P6` — After a first sync, a newer proof verifies from private finality without another mirror-anchor or chain walk, while reconstruction still starts at the original mirrored anchor.

<a id="req-sp-10-jmvhtb.t5.p7"></a>`REQ-SP-10-JMVHTB.T5.P7` — Applying known proof data twice then new data produces state-install counts 1/0/1, zero replay on repetition, preserves earlier block hashes, and yields the new state and a chain-valid reconstruction.

<a id="req-sp-10-jmvhtb.t5.p8"></a>`REQ-SP-10-JMVHTB.T5.P8` — A synced unfinalized tail persists both replayed blocks, their snapshots and full states and advances the active head through the tail.

<a id="req-sp-10-jmvhtb.t5.p9"></a>`REQ-SP-10-JMVHTB.T5.P9` — A wholly pre-anchor milestone with forged participant snapshot is skipped without storing its block/snapshot/change point; retained proof syncs and reconstructs from the anchor.

<a id="req-sp-10-jmvhtb.t5.p10"></a>`REQ-SP-10-JMVHTB.T5.P10` — A forged participant-change prefix inside an anchor-containing run is clipped; its block/snapshot/change point is absent while retained suffix syncs and reconstructs from the anchor.

<a id="req-sp-10-jmvhtb.t5.p11"></a>`REQ-SP-10-JMVHTB.T5.P11` — A later support block retains the signature needed for virtual finality, gap history is absent, and reconstruction ending at that support block uses the two-block run and verifies.

<a id="req-sp-10-jmvhtb.t5.p12"></a>`REQ-SP-10-JMVHTB.T5.P12` — Verified support evidence outside replay is stored as a block with its signatures but does not cause its resulting snapshot or full state to be stored.

<a id="req-sp-10-jmvhtb.t5.p13"></a>`REQ-SP-10-JMVHTB.T5.P13` — Repeated occurrences of the same block contribute distinct signatures that merge in storage; the tail applies and reconstruction ending at the merged block proves it final as a one-block milestone.

<a id="req-sp-10-jmvhtb.t5.p14"></a>`REQ-SP-10-JMVHTB.T5.P14` — A threshold hop above the anchor syncs without contiguous gap history; those gap heights remain absent and reconstruction verifies from the anchor.

<a id="req-sp-10-jmvhtb.t5.p15"></a>`REQ-SP-10-JMVHTB.T5.P15` — After compact sync, two later final blocks advance the spectator reconstruction to the new head while stored original support evidence remains unchanged.

<a id="req-sp-10-jmvhtb.t5.p16"></a>`REQ-SP-10-JMVHTB.T5.P16` — After compact sync and progress, a new chain anchor becomes the reconstruction start; rebuilt proof needs no earlier evidence although previously stored support blocks remain.

<a id="req-sp-10-jmvhtb.t5.p17"></a>`REQ-SP-10-JMVHTB.T5.P17` — When requester latest height equals the served finalized replay base, sync reuses its state without unsafeSetLatestState, reaches the tip and matches responder state without blacklist.

<a id="req-sp-10-jmvhtb.t5.p18"></a>`REQ-SP-10-JMVHTB.T5.P18` — When requester latest height is one below the served finalized replay base, sync installs the base, reaches the tip and matches responder state without blacklist.

#### <a id="req-sp-7-70emat.t4"></a>`REQ-SP-7-70EMAT.T4`

**Requirements / invariants:**

[`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-7-70emat.t4.p1"></a>`REQ-SP-7-70EMAT.T4.P1` — An overlapping occurrence with different authenticated contents at the same height/author is rejected as invalid milestones, blacklists its responder and stores none of the inspected proof blocks.

#### <a id="req-sp-8-9zccej.t4"></a>`REQ-SP-8-9ZCCEJ.T4`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t4.p1"></a>`REQ-SP-8-9ZCCEJ.T4.P1` — A final first block with later unfinalized tail yields update calldata only for that finalized snapshot; posting sends updateStateSnapshotSameFork and chain adopts it.

<a id="req-sp-8-9zccej.t4.p2"></a>`REQ-SP-8-9ZCCEJ.T4.P2` — Sufficient direct finality at the last milestone first block yields update calldata and chain adoption of that snapshot.

<a id="req-sp-8-9zccej.t4.p3"></a>`REQ-SP-8-9ZCCEJ.T4.P3` — With no finalized block, finalized-only evidence is empty genesis, snapshot preparation has no calldata/target, and posting resolves without a send or anchor change.

<a id="req-sp-8-9zccej.t4.p4"></a>`REQ-SP-8-9ZCCEJ.T4.P4` — A threshold-final block zero yields one-block update evidence and replaces genesis with its resulting snapshot even though both have numeric height zero.

<a id="req-sp-8-9zccej.t4.p5"></a>`REQ-SP-8-9ZCCEJ.T4.P5` — An unfinalized block zero yields no update target/calldata; posting resolves with zero sends and unchanged genesis anchor.

<a id="req-sp-8-9zccej.t4.p6"></a>`REQ-SP-8-9ZCCEJ.T4.P6` — When the only final point is the current anchor and all later blocks are unfinalized, snapshot preparation has no target/calldata and posting sends nothing or changes no anchor.

<a id="req-sp-8-9zccej.t4.p7"></a>`REQ-SP-8-9ZCCEJ.T4.P7` — Overlapping join support and a later finalized point remain separate milestones in finalized-only update evidence; the submitted update adopts the later point, not the join block.

#### <a id="req-sp-9-rnxp56.t5"></a>`REQ-SP-9-RNXP56.T5`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t5.p1"></a>`REQ-SP-9-RNXP56.T5.P1` — A compact-synced auditor missing older application state accepts a current dispute and stores no counter.

<a id="req-sp-9-rnxp56.t5.p2"></a>`REQ-SP-9-RNXP56.T5.P2` — A late pending auditor without the departure application state accepts an eligible leaver's last-signed dispute, stores no counter, leaves old state absent and constructs its own proof above the departure height.

<a id="req-sp-9-rnxp56.t5.p3"></a>`REQ-SP-9-RNXP56.T5.P3` — A late pending auditor accepts an older pending-participant dispute using a trusted start, performs no local or chain balance check, leaves old application state absent and submits exactly one newer dispute committed on-chain.

<a id="req-sp-9-rnxp56.t5.p4"></a>`REQ-SP-9-RNXP56.T5.P4` — The late auditor responds to an older pending-participant dispute with a newer on-chain commitment in posted-auditing-data form when the last run lacks that pending participant signature and chain omission permission is false.

<a id="req-sp-9-rnxp56.t5.p5"></a>`REQ-SP-9-RNXP56.T5.P5` — A late pending auditor accepts an eligible departed submitter's older dispute using a trusted start without local or chain balance checks or recovery of departure state, then submits exactly one newer committed dispute.

<a id="req-sp-9-rnxp56.t5.p6"></a>`REQ-SP-9-RNXP56.T5.P6` — An honest consumed join in an unfinalized last-milestone tail with posted auditing data is accepted without any stored fraud proof.

<a id="req-sp-9-rnxp56.t5.p7"></a>`REQ-SP-9-RNXP56.T5.P7` — A transport exception from the local verification read during a committed dispute audit propagates as a fatal error, performs no canonical verification read, stores no fraud proof, submits no kill or dispute, and leaves the original commitment present.

<a id="req-sp-9-rnxp56.t5.p8"></a>`REQ-SP-9-RNXP56.T5.P8` — When an auditor lacks the full state at its finalized replay base and the higher dispute posts no auditing data, audit fails fatally without a fraud proof, kill or dispute upload and keeps its active next height.

<a id="req-sp-9-rnxp56.t5.p9"></a>`REQ-SP-9-RNXP56.T5.P9` — When an auditor behind a newly finalized block lacks its required milestone snapshot and the dispute posts no auditing data, evidence construction fails fatally without an unsupported fraud proof, kill or dispute upload.

#### <a id="req-sp-8-9zccej.t5"></a>`REQ-SP-8-9ZCCEJ.T5`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t5.p1"></a>`REQ-SP-8-9ZCCEJ.T5.P1` — A poster whose head lacks finality posts only its preceding final snapshot; the canonical anchor adopts that snapshot and later live progress continues.

<a id="req-sp-8-9zccej.t5.p2"></a>`REQ-SP-8-9ZCCEJ.T5.P2` — With only unfinalized progress beyond the chain anchor, snapshot posting sends no transaction (unchanged sender nonce) and leaves anchor unchanged; after new finality, posting advances to the new head.

<a id="req-sp-8-9zccej.t5.p3"></a>`REQ-SP-8-9ZCCEJ.T5.P3` — A final point later than the membership-change hop is posted despite overlapping support, and chain snapshot matches that later block rather than the change snapshot.

#### <a id="req-sp-10-jmvhtb.t6"></a>`REQ-SP-10-JMVHTB.T6`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t6.p1"></a>`REQ-SP-10-JMVHTB.T6.P1` — A sync-only observer accepts overlapping compact proof, stores shared block hashes matching responder and reconstructs the same canonically valid milestone runs.

#### <a id="req-sp-9-rnxp56.t6"></a>`REQ-SP-9-RNXP56.T6`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t6.p1"></a>`REQ-SP-9-RNXP56.T6.P1` — For an inserted above-anchor hop lacking required confirmations, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters.

<a id="req-sp-9-rnxp56.t6.p2"></a>`REQ-SP-9-RNXP56.T6.P2` — For an inserted earlier retained run skipping an intermediate height, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters.

<a id="req-sp-9-rnxp56.t6.p3"></a>`REQ-SP-9-RNXP56.T6.P3` — For a posted earlier-milestone snapshot row substituted with the final head snapshot, the earlier-start auditor kills with exactly InvalidStateProof and is not slashed, while newer-start auditors confirm the same dispute and store no counters.

<a id="req-sp-9-rnxp56.t6.p4"></a>`REQ-SP-9-RNXP56.T6.P4` — A malformed milestone wholly below the chain anchor is skipped: auditors confirm the dispute, retain their original below-anchor block, never store the forged block and do not slash the submitter.

<a id="req-sp-9-rnxp56.t6.p5"></a>`REQ-SP-9-RNXP56.T6.P5` — An omitted-data last run containing undecodable bytes before its interior chain anchor is confirmed by every listed auditor with no stored counter and no submitter slash; the channel resolves.

<a id="req-sp-9-rnxp56.t6.p6"></a>`REQ-SP-9-RNXP56.T6.P6` — A blind pending auditor confirms the real final head and correct tail using required posted data before gossip restoration; all listed auditors then confirm, store no counter and do not slash the self-removing submitter.

<a id="req-sp-9-rnxp56.t6.p7"></a>`REQ-SP-9-RNXP56.T6.P7` — A participant initially holding only the anchor height accepts an omitted-data dispute spanning the anchor and unfinalized tail, obtains latest snapshot and application state, and stores no counter despite a pending signer absent from the first block.

<a id="req-sp-9-rnxp56.t6.p8"></a>`REQ-SP-9-RNXP56.T6.P8` — A pending participant initially holding only anchor height accepts an omitted-data anchored tail, persists latest snapshot and application state, stores no counter and remains pending.

<a id="req-sp-9-rnxp56.t6.p9"></a>`REQ-SP-9-RNXP56.T6.P9` — With last-run head above the chain anchor and signatures from every required peer including pending joiner, chain omission permission is true; blind participant and pending auditor accept and recover the latest tail state from their own final head.

<a id="req-sp-9-rnxp56.t6.p10"></a>`REQ-SP-9-RNXP56.T6.P10` — When a pending signer makes omission impermissible, auditors accept the posted-data dispute; a direct copy marked unposted instead returns the availability counter, while normal resolution slashes the original block offender.

<a id="req-sp-9-rnxp56.t6.p11"></a>`REQ-SP-9-RNXP56.T6.P11` — A lagging-mirror auditor reaches local and chain proof tiers, stores the same after-anchor transition-counter index one as a current auditor, and the dispute is killed with only submitter slashed.

<a id="req-sp-9-rnxp56.t6.p12"></a>`REQ-SP-9-RNXP56.T6.P12` — With chain anchor at index two inside the last run, lagging and current auditors both store the tail transition counter at original index three; a kill lands and only submitter is slashed.

<a id="req-sp-9-rnxp56.t6.p13"></a>`REQ-SP-9-RNXP56.T6.P13` — For a nonauthentic block immediately after an interior anchor, the lagging auditor stores the structure counter at original index three, the dispute is killed and only submitter is slashed.

<a id="req-sp-9-rnxp56.t6.p14"></a>`REQ-SP-9-RNXP56.T6.P14` — A forged below-chain-anchor block followed by an honest retained tail reaches both local and chain tiers; through kill expiry auditors store no counters, observe no kill and nobody is slashed.

<a id="req-sp-9-rnxp56.t6.p15"></a>`REQ-SP-9-RNXP56.T6.P15` — A forged below-anchor prefix does not hide an invalid transition two blocks after the anchor: lagging auditor stores the tail transition counter at original index four, a kill lands and only submitter is slashed.

<a id="req-sp-9-rnxp56.t6.p16"></a>`REQ-SP-9-RNXP56.T6.P16` — A proof ending at the chain anchor with a forged block below it reaches both local and chain tiers but remains without counters, kills or slashes through kill expiry.

<a id="req-sp-9-rnxp56.t6.p17"></a>`REQ-SP-9-RNXP56.T6.P17` — After the same forged below-anchor history, a genuine invalid transition immediately after the chain cutoff produces original index-three transition evidence; a kill lands and only submitter is slashed.

#### <a id="req-sp-9-rnxp56.t7"></a>`REQ-SP-9-RNXP56.T7`

**Requirements / invariants:**

[`REQ-SP-9-RNXP56`](state-proofs.md#req-sp-9-rnxp56)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-9-rnxp56.t7.p1"></a>`REQ-SP-9-RNXP56.T7.P1` — Audit accepts from its known local final point, produces no counter, and calls neither mirror-anchor nor chain walk.

<a id="req-sp-9-rnxp56.t7.p2"></a>`REQ-SP-9-RNXP56.T7.P2` — Substituting block-one snapshot for the posted block-zero milestone snapshot makes audit reject with InvalidStateProof after one mirror walk and one chain walk.

<a id="req-sp-9-rnxp56.t7.p3"></a>`REQ-SP-9-RNXP56.T7.P3` — A missing participant-change block required to establish the local final point makes audit throw before any mirror-anchor or chain walk and produce no counter.

<a id="req-sp-9-rnxp56.t7.p4"></a>`REQ-SP-9-RNXP56.T7.P4` — After the local mirror cannot establish a consumed-inbound hop, a chain transport failure makes audit throw with no counter.

<a id="req-sp-9-rnxp56.t7.p5"></a>`REQ-SP-9-RNXP56.T7.P5` — An unproven prefix below the local final point is skipped: trusted-start walk accepts without mirror-anchor or chain walk and without counter.

<a id="req-sp-9-rnxp56.t7.p6"></a>`REQ-SP-9-RNXP56.T7.P6` — An unproven prefix above the genesis trusted start produces InvalidStateProof pointing inside that prefix without a block index; canonical step verification accepts it, and the auditor kills the dispute and slashes submitter.

<a id="req-sp-9-rnxp56.t7.p7"></a>`REQ-SP-9-RNXP56.T7.P7` — When no tier can supply a forged hop snapshot, the auditor holds no block at that height and auditing data is omitted, audit throws for missing milestone snapshots without a counter.

<a id="req-sp-9-rnxp56.t7.p8"></a>`REQ-SP-9-RNXP56.T7.P8` — A pending auditor lacking the proved final state accepts verified posted state bytes, produces no counter, and holds full state by the expected hashes at both replay base and hop after audit.

<a id="req-sp-9-rnxp56.t7.p9"></a>`REQ-SP-9-RNXP56.T7.P9` — Posted finalized-state bytes with the wrong hash are not installed; when the required real replay state is absent, audit throws without a counter and the base state remains absent.

<a id="req-sp-9-rnxp56.t7.p10"></a>`REQ-SP-9-RNXP56.T7.P10` — A missed tail with another participant’s real signature substituted for its author signature returns InvalidBlockStructure and stores none of the tail blocks.

<a id="req-sp-9-rnxp56.t7.p11"></a>`REQ-SP-9-RNXP56.T7.P11` — An unrecoverable confirmation signature in the last milestone’s first block returns InvalidStateProof and stores none of the missed tail blocks.

<a id="req-sp-9-rnxp56.t7.p12"></a>`REQ-SP-9-RNXP56.T7.P12` — With preanchor blocks pruned, current-anchor and genesis-start mirrors both counter the postanchor fault at last-milestone index one; chain eligibility excludes anchor and past-run indices.

<a id="req-sp-9-rnxp56.t7.p13"></a>`REQ-SP-9-RNXP56.T7.P13` — A genesis-linked last milestone containing an invalid preanchor block is accepted by current and lagging auditors without counters; only the lagging auditor needs the canonical chain tier, and every supplied block is challenge-ineligible.

<a id="req-sp-9-rnxp56.t7.p14"></a>`REQ-SP-9-RNXP56.T7.P14` — With the anchor inside a milestone containing both a preanchor invalid block and postanchor fault, both current and lagging auditors counter only the postanchor fault at its actual index; anchor and past-run indices are ineligible.

#### <a id="req-sp-7-70emat.t5"></a>`REQ-SP-7-70EMAT.T5`

**Requirements / invariants:**

[`REQ-SP-7-70EMAT`](state-proofs.md#req-sp-7-70emat)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-7-70emat.t5.p1"></a>`REQ-SP-7-70EMAT.T5.P1` — A step challenge whose supplied auditing data differs from the committed hash returns false.

<a id="req-sp-7-70emat.t5.p2"></a>`REQ-SP-7-70EMAT.T5.P2` — A step challenge identifies undecodable retained milestone bytes as invalid without reverting.

<a id="req-sp-7-70emat.t5.p3"></a>`REQ-SP-7-70EMAT.T5.P3` — Latest-state verification returns false for an undecodable latest block without reverting.

<a id="req-sp-7-70emat.t5.p4"></a>`REQ-SP-7-70EMAT.T5.P4` — A milestone walk over undecodable retained bytes returns invalid with snapshotMismatch false.

<a id="req-sp-7-70emat.t5.p5"></a>`REQ-SP-7-70EMAT.T5.P5` — Standalone milestone finality returns false and a zero final hash for undecodable block bytes.

<a id="req-sp-7-70emat.t5.p6"></a>`REQ-SP-7-70EMAT.T5.P6` — A step challenge against a decodable authentic genesis-linked block-zero control finds no fault.

<a id="req-sp-7-70emat.t5.p7"></a>`REQ-SP-7-70EMAT.T5.P7` — Latest-state verification accepts a decodable authentic block committing the claimed latest snapshot.

<a id="req-sp-7-70emat.t5.p8"></a>`REQ-SP-7-70EMAT.T5.P8` — A milestone walk accepts the decodable genesis-linked block-zero control with snapshotMismatch false.

<a id="req-sp-7-70emat.t5.p9"></a>`REQ-SP-7-70EMAT.T5.P9` — Standalone milestone finality accepts the authentic block-zero control when its author is the entire supplied threshold set, returning the latest snapshot hash.

#### <a id="req-sp-10-jmvhtb.t7"></a>`REQ-SP-10-JMVHTB.T7`

**Requirements / invariants:**

[`REQ-SP-10-JMVHTB`](state-proofs.md#req-sp-10-jmvhtb)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-10-jmvhtb.t7.p1"></a>`REQ-SP-10-JMVHTB.T7.P1` — After a peer suppresses its next block and commits a self-removal dispute carrying that higher block, honest peers observe the commitment without advancing their original-fork active height, then resolve the dispute.

#### <a id="req-sp-8-9zccej.t6"></a>`REQ-SP-8-9ZCCEJ.T6`

**Requirements / invariants:**

[`REQ-SP-8-9ZCCEJ`](state-proofs.md#req-sp-8-9zccej)

**Setup and stimulus:**

Exercise each stated input through the public verification, construction or audit boundary.

**Expected result:**

The explicit result in each permutation holds; rejected evidence has no unauthorized state effect.

**Required permutations:**

<a id="req-sp-8-9zccej.t6.p1"></a>`REQ-SP-8-9ZCCEJ.T6.P1` — With block zero and one available but a required signer absent, construction returns one genesis-linked run [0,1]; the canonical walk accepts, replay begins at index zero, and the finalized snapshot remains genesis.

## Future work

_Non-normative._ Admission limits for milestone length and walk gas remain open. So does the
cost of hashing/copying large proof data for a per-step challenge. Signature aggregation may
reduce size but is not part of this model.
