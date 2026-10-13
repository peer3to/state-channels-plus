# Message-Block Stores

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The two instances (inbound and outbound) of the module holding cross-layer
> message-block chains ([cross-layer-messages.md](../settlement/cross-layer-messages.md)). Shared
> storage rules: [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

Each store holds one hash-linked message-block chain: blocks keyed by their canonical-encoding hash,
plus a latest-tip pointer (hash and height). One instance holds the inbound stream (base layer →
channel), one the outbound (channel → base layer); the module contract is identical for both.

## Requirements and invariants

**<a id="req-msgstore-1-6me9d7"></a>`REQ-MSGSTORE-1-6ME9D7` — Content-addressed store with tip tracking.** A block is stored under the hash of
its canonical encoding. The latest-tip pointer is the highest block delivered by a store that does
not opt out of tip advancement: such a store moves the tip when the block's height is at least the
tip height, so an equal-height block replaces the tip and a lower block leaves it. Height alone
moves the tip; linkage to the current tip is not required, so the tip MAY sit above a gap in held
history. Storing historical blocks (backfill) never moves the tip, and a store operation MAY
explicitly opt out of tip advancement. A store of a chain-verified run moves the tip only when the
run extends the current tip exactly — the run's predecessor hash equals the current tip's hash, or
the zero hash when no tip is held; otherwise its blocks are persisted and the tip stays. Because the
tip can sit above a gap, a read from it follows
[`REQ-MSGSTORE-2-8RDXPZ`](message-blocks.md#req-msgstore-2-8rdxpz): it verifies linkage and reports the first missing block instead of
crossing the gap. A consumer never treats a truncated range as complete: it recovers the missing
blocks before acting on the range, or acts without it.

**<a id="req-msgstore-2-8rdxpz"></a>`REQ-MSGSTORE-2-8RDXPZ` — Linked backward range reads.** A range read walks the chain backward by
`previousBlockHash` from an upper bound (inclusive) to a lower bound (exclusive), returning the
linked blocks in between. A break in linkage or an absent block ends the walk with exactly the
blocks proven linked so far and an explicit incomplete result. A requested range is complete only
when the walk reaches its lower bound. Reaching the zero hash first does not satisfy a nonzero
lower bound, and a zero upper bound is an empty complete range only when the lower bound is also
zero. The store never bridges gaps or substitutes blocks by height. An
implementation MAY additionally expose an all-or-nothing read that fails on any gap, for callers
whose precondition is a complete run; the truncating read remains the range-read contract.

## Assumptions and constraints

- Chain validity (height increments, cumulative totals) is verified by settlement and enforcement;
  the store keeps and returns what was committed.
- The inbound and outbound instances share no state; a block stored in one is invisible to the
  other.
- Inbound blocks reach a tip-moving store only from the base-layer event feed, which is trusted. A
  wrong block there is a base-layer reorg or a forged event; the store does not arbitrate it.
- The height tip is deliberate. A node that missed an inbound block still tracks the latest
  delivered inbound head, so it builds on and names that head while the missing run is recovered
  from the base layer.
- Shared durability/retention rules: [durability.md](./durability.md).

## Security considerations

Range reads feed settlement proofs and sync payloads; returning a gap-bridged or height-substituted
range would turn a storage convenience into a forged linkage claim, which is why
[`REQ-MSGSTORE-2-8RDXPZ`](message-blocks.md#req-msgstore-2-8rdxpz) forbids it. The tip is a height pointer, not a linkage claim: it can sit above a
gap and grants no validity to the chain itself. Only a range read proves linkage, and it reports the
first missing block. An equal-height replacement happens only when the feed delivers a second block
at the tip height (a reorg or a forged event); the tip takes the later one and the store does not judge
between them.

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                          | Setup and stimulus                                                                                                          | Expected result                                                                                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-msgstore-1-6me9d7.t1"></a>`REQ-MSGSTORE-1-6ME9D7.T1` | [`REQ-MSGSTORE-1-6ME9D7`](message-blocks.md#req-msgstore-1-6me9d7) | Store tip-extending, gap-skipping, equal-height, historical, duplicate, opt-out, and verified-run blocks in both instances. | Content addressing holds; a direct store moves the tip by height (equal height replaces it); opt-out and historical stores never move it; a verified run moves it only on exact extension; reads from a tip above a gap report the missing block; instances stay independent. | <a id="req-msgstore-1-6me9d7.t1.p1"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P1` — tip advance on extension; <a id="req-msgstore-1-6me9d7.t1.p2"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P2` — backfill leaves tip; <a id="req-msgstore-1-6me9d7.t1.p3"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P3` — inbound/outbound isolation; <a id="req-msgstore-1-6me9d7.t1.p4"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P4` — duplicate store idempotent; <a id="req-msgstore-1-6me9d7.t1.p5"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P5` — opt-out store leaves tip; <a id="req-msgstore-1-6me9d7.t1.p8"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P8` — a higher block above an unheld gap moves the tip, and a read from that tip reports the first missing block; <a id="req-msgstore-1-6me9d7.t1.p9"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P9` — an equal-height block replaces the tip; <a id="req-msgstore-1-6me9d7.t1.p10"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P10` — a verified run that extends the current tip moves the tip to its last block; <a id="req-msgstore-1-6me9d7.t1.p11"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P11` — a verified run that does not extend the current tip is persisted and leaves the tip. |
| <a id="req-msgstore-2-8rdxpz.t1"></a>`REQ-MSGSTORE-2-8RDXPZ.T1` | [`REQ-MSGSTORE-2-8RDXPZ`](message-blocks.md#req-msgstore-2-8rdxpz) | Read ranges over complete, gapped, and unlinked chains with varied bounds.                                                  | Exactly the linked `[upper, lower)` blocks return; incomplete walks are explicit; no substitution.                                                                                                                                                                            | <a id="req-msgstore-2-8rdxpz.t1.p1"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P1` — complete range; <a id="req-msgstore-2-8rdxpz.t1.p2"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P2` — missing middle block ends walk; <a id="req-msgstore-2-8rdxpz.t1.p3"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P3` — lower bound at genesis; <a id="req-msgstore-2-8rdxpz.t1.p4"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P4` — unknown upper bound returns nothing and reports the missing upper hash; <a id="req-msgstore-2-8rdxpz.t1.p5"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P5` — upper bound at tip; <a id="req-msgstore-2-8rdxpz.t1.p6"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P6` — equal upper and lower bounds; <a id="req-msgstore-2-8rdxpz.t1.p7"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P7` — the optional all-or-nothing read fails on any incomplete range; <a id="req-msgstore-2-8rdxpz.t1.p8"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P8` — zero upper with nonzero lower reports incomplete; <a id="req-msgstore-2-8rdxpz.t1.p9"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P9` — a linked walk reaching zero before a nonzero lower reports incomplete.                                                                 |

## Future Work

_Non-normative._ Range pagination hints for very long streams once pruning fixes the retained
window.
