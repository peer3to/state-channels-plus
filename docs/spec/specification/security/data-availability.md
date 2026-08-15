# Data Availability

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral data availability behavior, assumptions, constraints, security properties, and black-box test plan.

## Contents

- [Purpose & observable contract](#1-purpose--observable-contract)
- [Block-calldata publication](#2-block-calldata-publication)
- [Timing windows and the extra on-chain time grant](#3-timing-windows-and-the-extra-on-chain-time-grant)
- [Costs: fees, latency, and user experience](#4-costs-fees-latency-and-user-experience)
- [Calldata-commitment griefing](#5-calldata-commitment-griefing)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose & observable contract

Every recovery path — disputes, timeouts, state proofs, late synchronization — depends on the
relevant block data being obtainable. The protocol's answer in version one is **chain-backed data
availability**: when p2p delivery cannot be relied on, block data is anchored on the chain itself,
so the chain is the guarantor that the required data can be obtained.

This avoids adding a separate data-availability trust assumption: the only DA dependency is the
same live, honest, final chain the protocol already assumes (A1 in
[trust-model.md](./trust-model.md)). The observable contract is:

- Any participant can commit a signed block on-chain via calldata posting (§2).
- Any participant can, when required, obtain the data behind any commitment relevant to a dispute,
  because posting the commitment publishes the full signed block as calldata in the posting
  transaction.
- No third-party DA network, committee, or storage provider is trusted.

**The trade-off is material, and this is one of the WEAKEST parts of the protocol design** — not an
incidental detail. Posting costs fees, slows recovery, and extends on-chain waiting time in the
uncooperative case (§3–§5). The design intentionally pays these costs to avoid a new trust
assumption; alternatives that reduce them introduce new assumptions and are Future Work.

## 2. Block-calldata publication

**<a id="inv-da-1-ts7hx2"></a>`INV-DA-1-TS7HX2`.** A posted block-calldata commitment MUST be immutable for its key and binding: the
commitment either matches the calldata-published signed block and posting timestamp, or it is
objective evidence against the poster.

**<a id="req-da-1-nvv85z"></a>`REQ-DA-1-NVV85Z`.** Block data referenced by any dispute-relevant commitment MUST be obtainable from the
chain alone (calldata of the posting transaction). No separate DA trust assumption is permitted in
version one.

## 3. Timing windows and the extra on-chain time grant

- **`p2pTime`** — the window for ordinary p2p delivery and production of the next block.
- **`agreementTime`** — the additional window for collecting unanimous agreement (signatures)
  off-chain.
- **`chainFallbackTime`** — the additional window granted to fall back to the chain: post block
  calldata (or otherwise act on-chain) when p2p plus agreement time expired without detecting
  unanimous agreement.
- **`evidenceTime`** — the dispute-window evidence/kill period; also serves as the first-block
  grace term in timeout deadlines ([../protocol/disputes.md](../disputes/disputes.md)).

Where the extra time is granted:

- **Timeouts.** A participant may be timed out only after
  `previousTimestamp + [evidenceTime if first block] + p2pTime + agreementTime + chainFallbackTime`
  The author therefore always has the on-chain fallback window before silence becomes a timeout.
- **Block timestamps.** The `InvalidTimestamp` fraud proof measures a block's timestamp against
  `p2pTime` from its parent — but if the parent was posted as block calldata, the **on-chain
  posting timestamp replaces the parent's claimed timestamp** as the reference point
  Posting on-chain thus objectively re-anchors "when the data became available" and grants the
  next author fresh time from that anchor. A participant who already signed the parent forfeits
  this extra time (the forfeit-of-extra-time rule: its signature proves earlier possession).

**<a id="req-da-2-kyz70m"></a>`REQ-DA-2-KYZ70M`.** The specification of any timing-sensitive rule MUST state which of these windows it
consumes and when the on-chain re-anchoring applies. Why extra time exists: without it, a
participant who never received data p2p could be timed out or fraud-proven using data it provably
never had; the calldata post makes availability objective and restarts the clock from an
observable chain event.

## 4. Costs: fees, latency, and user experience

The costs of chain-backed DA are structural, not incidental:

- **Fees.** Every calldata post is an on-chain transaction. Persisting one hash is cheap in
  storage, but the calldata itself and base transaction costs are paid per post, per participant
  who needs to retain progress.
- **Latency.** Recovery through the chain waits for `chainFallbackTime`-scale windows and chain
  inclusion instead of p2p round trips. When peers do not cooperate, the granted extra on-chain
  time directly worsens user-visible responsiveness.
- **UX is a first-class design constraint.** The target is fast, cheap, and ideally free
  operation. Any proposed optimization of this subsystem MUST be evaluated against: user-visible
  latency (ordinary and worst case), ordinary-case cost, worst-case griefing cost, and any new
  trust assumptions it introduces ([`REQ-DA-4-1B0MF4`](data-availability.md#req-da-4-1b0mf4)).

## 5. Calldata-commitment griefing

The kill period and self-slashing deter **objectively invalid** behavior: a participant who posts
junk data, submits an invalid dispute, or files a bogus fraud proof loses stake
([../protocol/fraud-proofs.md](../disputes/fraud-proofs.md),
[../protocol/disputes.md](../disputes/disputes.md)).

Calldata commitments have a different, unsolved problem: **protocol-valid non-cooperation is not
punishable but still imposes costs on everyone else.**

**A non-cooperating participant can force every other participant to post block calldata to retain
progress and data availability.** By simply not signing, not delivering p2p, or delaying to the
window edges — none of which is objectively provable misbehavior — it pushes peers onto the chain
fallback. Virtual voting and the rest of the protocol preserve eventual progress, but:

- the channel becomes slower (chain-scale latency replaces p2p latency);
- every participant bears posting costs, including the instigator;
- the cost is potentially **asymmetric**: in a six-party channel, one instigator incurs one
  posting cost while causing five peers to incur their own posting costs each.

**<a id="req-da-3-g6tj90"></a>`REQ-DA-3-G6TJ90`.** This griefing exposure is a deliberate version-one limitation and MUST be stated
plainly wherever chain-backed DA is described. It MUST NOT be presented as a solved anti-spam
mechanism: kill period and self-slashing deter objectively invalid submissions; they do not remove
the cost of protocol-valid non-cooperation.

**<a id="req-da-4-1b0mf4"></a>`REQ-DA-4-1B0MF4`.** Any change to the DA design MUST be evaluated against: user-visible latency,
ordinary-case cost, worst-case griefing cost, and new trust assumptions, and MUST preserve the
safety and recovery model.

## Assumptions and constraints

Availability guarantees assume the base chain remains readable and live, posted calldata is retained under
the chain's rules, commitments use canonical encodings, honest actors can observe posts and submit dependent
transactions within configured windows, and the required data fits chain transaction/gas limits. The mechanism
guarantees availability only after publication; it does not guarantee cheap, immediate, or censorship-free
inclusion before the chain's own liveness assumptions take effect.

## Security considerations

Unavailable data can prevent honest validation, recovery, or dispute participation and may threaten funds.
Threats include withholding until a deadline, commitment/pre-image mismatch, posting irrelevant or oversized
data, duplicate posts, censorship, chain reorganization, fee griefing, and timing a post so dependent actions
cannot complete. Verification must cover publication, observation, exact commitment recovery, retries,
reorganizations where supported, deadline boundaries, malformed data, and cost/size maxima. Hash-only dispute
availability and griefing bounds remain explicit unresolved risks.

## Requirements and invariants

**[`INV-DA-1-TS7HX2`](data-availability.md#inv-da-1-ts7hx2).** Calldata commitments are immutable per key and binding on the poster.

**[`REQ-DA-1-NVV85Z`](data-availability.md#req-da-1-nvv85z).** Dispute-relevant block data obtainable from the chain alone; no separate DA trust assumption.

**[`REQ-DA-2-KYZ70M`](data-availability.md#req-da-2-kyz70m).** Timing rules state which windows they consume; on-chain posting re-anchors timing objectively.

**[`REQ-DA-3-G6TJ90`](data-availability.md#req-da-3-g6tj90).** Calldata griefing exposure stated plainly as a version-one limitation.

**[`REQ-DA-4-1B0MF4`](data-availability.md#req-da-4-1b0mf4).** DA changes evaluated against latency, cost, griefing cost, and new trust assumptions.

## Verification and test plan

- **Publication behavior:** black-box tests for non-overwritability, author-only publication,
  timestamp bounds, commitment binding, invalid-publication consequences, and observable events.
- **Window semantics:** tests that the timeout deadline sums the specified windows and that the
  `InvalidTimestamp` proof switches its reference to the on-chain posting timestamp when a
  commitment exists, including the forfeit-of-extra-time case.
- **Griefing scenarios:** system scenarios in which one participant withholds cooperation and peers
  recover through calldata posting; measure and assert eventual progress and fee asymmetry.
- **Recovery from chain data alone:** a test that a client reconstructs required blocks purely
  from posted calldata/events with p2p unavailable.

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item                                           | Requirements / invariants                                 | Setup and stimulus                                                                                                                                    | Expected result                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-da-1-ts7hx2.t1"></a>`INV-DA-1-TS7HX2.T1` | [`INV-DA-1-TS7HX2`](data-availability.md#inv-da-1-ts7hx2) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Calldata commitments are immutable per key and binding on the poster.                          | <a id="inv-da-1-ts7hx2.t1.p1"></a>`INV-DA-1-TS7HX2.T1.P1` — valid case<br><a id="inv-da-1-ts7hx2.t1.p3"></a>`INV-DA-1-TS7HX2.T1.P3` — direct invalid/opposite case<br><a id="inv-da-1-ts7hx2.t1.p2"></a>`INV-DA-1-TS7HX2.T1.P2` — matching commitment<br><a id="inv-da-1-ts7hx2.t1.p4"></a>`INV-DA-1-TS7HX2.T1.P4` — mismatched commitment<br><a id="inv-da-1-ts7hx2.t1.p5"></a>`INV-DA-1-TS7HX2.T1.P5` — predecessor snapshot<br><a id="inv-da-1-ts7hx2.t1.p6"></a>`INV-DA-1-TS7HX2.T1.P6` — genesis snapshot<br><a id="inv-da-1-ts7hx2.t1.p7"></a>`INV-DA-1-TS7HX2.T1.P7` — stale fork<br><a id="inv-da-1-ts7hx2.t1.p8"></a>`INV-DA-1-TS7HX2.T1.P8` — foreign fork |
| <a id="req-da-1-nvv85z.t1"></a>`REQ-DA-1-NVV85Z.T1` | [`REQ-DA-1-NVV85Z`](data-availability.md#req-da-1-nvv85z) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Dispute-relevant block data obtainable from the chain alone; no separate DA trust assumption.  | <a id="req-da-1-nvv85z.t1.p1"></a>`REQ-DA-1-NVV85Z.T1.P1` — valid case<br><a id="req-da-1-nvv85z.t1.p3"></a>`REQ-DA-1-NVV85Z.T1.P3` — direct invalid/opposite case<br><a id="req-da-1-nvv85z.t1.p2"></a>`REQ-DA-1-NVV85Z.T1.P2` — malformed input<br><a id="req-da-1-nvv85z.t1.p4"></a>`REQ-DA-1-NVV85Z.T1.P4` — adversarial input<br><a id="req-da-1-nvv85z.t1.p5"></a>`REQ-DA-1-NVV85Z.T1.P5` — partial failure<br><a id="req-da-1-nvv85z.t1.p6"></a>`REQ-DA-1-NVV85Z.T1.P6` — retry and recovery                                                                                                                                                                  |
| <a id="req-da-2-kyz70m.t1"></a>`REQ-DA-2-KYZ70M.T1` | [`REQ-DA-2-KYZ70M`](data-availability.md#req-da-2-kyz70m) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Timing rules state which windows they consume; on-chain posting re-anchors timing objectively. | <a id="req-da-2-kyz70m.t1.p1"></a>`REQ-DA-2-KYZ70M.T1.P1` — valid case<br><a id="req-da-2-kyz70m.t1.p3"></a>`REQ-DA-2-KYZ70M.T1.P3` — direct invalid/opposite case<br><a id="req-da-2-kyz70m.t1.p2"></a>`REQ-DA-2-KYZ70M.T1.P2` — before deadline<br><a id="req-da-2-kyz70m.t1.p4"></a>`REQ-DA-2-KYZ70M.T1.P4` — at deadline<br><a id="req-da-2-kyz70m.t1.p5"></a>`REQ-DA-2-KYZ70M.T1.P5` — after deadline<br><a id="req-da-2-kyz70m.t1.p6"></a>`REQ-DA-2-KYZ70M.T1.P6` — maximum honest skew                                                                                                                                                                        |
| <a id="req-da-3-g6tj90.t1"></a>`REQ-DA-3-G6TJ90.T1` | [`REQ-DA-3-G6TJ90`](data-availability.md#req-da-3-g6tj90) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Calldata griefing exposure stated plainly as a version-one limitation.                         | <a id="req-da-3-g6tj90.t1.p1"></a>`REQ-DA-3-G6TJ90.T1.P1` — valid case<br><a id="req-da-3-g6tj90.t1.p3"></a>`REQ-DA-3-G6TJ90.T1.P3` — direct invalid/opposite case<br><a id="req-da-3-g6tj90.t1.p2"></a>`REQ-DA-3-G6TJ90.T1.P2` — static review of named alternatives<br><a id="req-da-3-g6tj90.t1.p4"></a>`REQ-DA-3-G6TJ90.T1.P4` — omitted category<br><a id="req-da-3-g6tj90.t1.p5"></a>`REQ-DA-3-G6TJ90.T1.P5` — changed assumption                                                                                                                                                                                                                              |
| <a id="req-da-4-1b0mf4.t1"></a>`REQ-DA-4-1B0MF4.T1` | [`REQ-DA-4-1B0MF4`](data-availability.md#req-da-4-1b0mf4) | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | DA changes evaluated against latency, cost, griefing cost, and new trust assumptions.          | <a id="req-da-4-1b0mf4.t1.p1"></a>`REQ-DA-4-1B0MF4.T1.P1` — valid case<br><a id="req-da-4-1b0mf4.t1.p3"></a>`REQ-DA-4-1B0MF4.T1.P3` — direct invalid/opposite case<br><a id="req-da-4-1b0mf4.t1.p2"></a>`REQ-DA-4-1B0MF4.T1.P2` — static review of named alternatives<br><a id="req-da-4-1b0mf4.t1.p4"></a>`REQ-DA-4-1B0MF4.T1.P4` — omitted category<br><a id="req-da-4-1b0mf4.t1.p5"></a>`REQ-DA-4-1B0MF4.T1.P5` — changed assumption                                                                                                                                                                                                                              |

## Future Work

_Non-normative._

- **Better DA approaches** that reduce calldata cost and recovery latency. Candidates: the
  web-of-trust model planned for a later version; alternative DA layers; running channels on
  smaller/cheaper L2 or L3 partitions so posting is cheap. Each proposal MUST state its new trust,
  security, availability, privacy, and fee assumptions explicitly and preserve a clear safety and
  recovery model ([`REQ-DA-4-1B0MF4`](data-availability.md#req-da-4-1b0mf4)).
- **Optimistic reduction / commitment-only paths** that keep full data off-chain unless a
  challenge forces publication (see the wider optimistic-commitment direction in
  [../protocol/disputes.md](../disputes/disputes.md) Future Work).
- **Griefing-cost rebalancing**: mechanisms that shift fallback costs toward the party that caused
  the fallback, if attribution can be made objective without punishing honest unavailability.
