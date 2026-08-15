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
its canonical encoding. The latest-tip pointer advances only when a stored block's height exceeds
the current tip; storing historical blocks (backfill) never moves the tip, and a store operation MAY
explicitly opt out of tip advancement.

**<a id="req-msgstore-2-8rdxpz"></a>`REQ-MSGSTORE-2-8RDXPZ` — Linked backward range reads.** A range read walks the chain backward by
`previousBlockHash` from an upper bound (inclusive) to a lower bound (exclusive), returning the
linked blocks in between. A break in linkage or an absent block ends the walk with exactly the
blocks proven linked so far — the store never bridges gaps or substitutes blocks by height.

## Assumptions and constraints

- Chain validity (height increments, cumulative totals) is verified by settlement and enforcement;
  the store keeps and returns what was committed.
- The inbound and outbound instances share no state; a block stored in one is invisible to the
  other.
- Shared durability/retention rules: [durability.md](./durability.md).

## Security considerations

Range reads feed settlement proofs and sync payloads; returning a gap-bridged or height-substituted
range would turn a storage convenience into a forged linkage claim, which is why
[`REQ-MSGSTORE-2-8RDXPZ`](message-blocks.md#req-msgstore-2-8rdxpz) forbids it. Tip integrity matters for building the _next_ block; it grants no
validity to the chain itself.

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                          | Setup and stimulus                                                                | Expected result                                                                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-msgstore-1-6me9d7.t1"></a>`REQ-MSGSTORE-1-6ME9D7.T1` | [`REQ-MSGSTORE-1-6ME9D7`](message-blocks.md#req-msgstore-1-6me9d7) | Store tip-extending, historical, duplicate, and opt-out blocks in both instances. | Content addressing holds; the tip moves only for higher heights; instances stay independent. | <a id="req-msgstore-1-6me9d7.t1.p1"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P1` — tip advance on extension; <a id="req-msgstore-1-6me9d7.t1.p2"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P2` — backfill leaves tip; <a id="req-msgstore-1-6me9d7.t1.p3"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P3` — inbound/outbound isolation; <a id="req-msgstore-1-6me9d7.t1.p4"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P4` — duplicate store idempotent; <a id="req-msgstore-1-6me9d7.t1.p5"></a>`REQ-MSGSTORE-1-6ME9D7.T1.P5` — opt-out store leaves tip.                                                                                                       |
| <a id="req-msgstore-2-8rdxpz.t1"></a>`REQ-MSGSTORE-2-8RDXPZ.T1` | [`REQ-MSGSTORE-2-8RDXPZ`](message-blocks.md#req-msgstore-2-8rdxpz) | Read ranges over complete, gapped, and unlinked chains with varied bounds.        | Exactly the linked `[upper, lower)` blocks return; gaps end the walk; no substitution.       | <a id="req-msgstore-2-8rdxpz.t1.p1"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P1` — complete range; <a id="req-msgstore-2-8rdxpz.t1.p2"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P2` — missing middle block ends walk; <a id="req-msgstore-2-8rdxpz.t1.p3"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P3` — lower bound at genesis; <a id="req-msgstore-2-8rdxpz.t1.p4"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P4` — unknown upper bound returns nothing; <a id="req-msgstore-2-8rdxpz.t1.p5"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P5` — upper bound at tip; <a id="req-msgstore-2-8rdxpz.t1.p6"></a>`REQ-MSGSTORE-2-8RDXPZ.T1.P6` — equal upper and lower bounds. |

## Future Work

_Non-normative._ Range pagination hints for very long streams once pruning fixes the retained
window.
