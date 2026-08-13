# Block Store

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The module holding committed channel blocks. Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

The block store holds every committed block the node has accepted, addressable two ways that MUST
stay consistent: by block hash, and by coordinates (fork id, height). It tracks the highest stored
height per fork (the local tip) and each block's growing confirmation-signature set and optional
on-chain publication timestamp.

## Requirements and invariants

**[`INV-BLKSTORE-1-MK4W8D`](blocks.md#inv-blkstore-1-mk4w8d) — Index consistency.** The hash index and the coordinate index always refer to the
same block objects: a store, signature merge, timestamp update, or delete through either key is
observable through both, and a delete removes the entry from both.

**[`REQ-BLKSTORE-1-KYHTWT`](blocks.md#req-blkstore-1-kyhtwt) — Same-coordinate conflict is not resolved here.** Storing a block whose
coordinates are occupied by a _different_ block MUST be refused, not silently replaced; resolving
which block is canonical belongs to the validation and evidence rules of
[block-processing.md](../block-progression/block-processing.md) ([`REQ-BLOCK-PIPE-6-XQ0RTT`](../block-progression/block-processing.md#req-block-pipe-6-xq0rtt)). Storing the
_same_ block again merges its signature set and, when present, its earliest on-chain timestamp.

**[`REQ-BLKSTORE-2-VWXP2C`](blocks.md#req-blkstore-2-vwxp2c) — Monotone signature merge.** Signature insertion only grows the set, is
idempotent, and never alters block identity. The earliest observed on-chain timestamp wins; a later
one never overwrites it.

**[`REQ-BLKSTORE-3-S9V2KC`](blocks.md#req-blkstore-3-s9v2kc) — Tip tracking and bounded traversal.** The per-fork maximum height advances only
on stores that extend the fork (a persistence-only store MAY opt out of tip advancement, e.g. when
backfilling proof data). Range and latest-block reads MUST clamp any caller-supplied bound to the
fork's known tip so a remote-supplied absurd height cannot force iteration over an empty range.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant                                   | Statement                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| <a id="inv-blkstore-1-mk4w8d"></a>`INV-BLKSTORE-1-MK4W8D` | Index consistency between hash and coordinate keying, including deletes.       |
| <a id="req-blkstore-1-kyhtwt"></a>`REQ-BLKSTORE-1-KYHTWT` | Different block at occupied coordinates refused; same block merges signatures. |
| <a id="req-blkstore-2-vwxp2c"></a>`REQ-BLKSTORE-2-VWXP2C` | Signature merge is monotone/idempotent; earliest on-chain timestamp wins.      |
| <a id="req-blkstore-3-s9v2kc"></a>`REQ-BLKSTORE-3-S9V2KC` | Tip advances only on extending stores; traversal bounds clamp to the tip.      |

## Assumptions and constraints

- Callers store only blocks that passed their pipeline stage; the store checks keys and identity,
  not protocol validity.
- Deletion is a pipeline decision (e.g. fork replacement); the store only guarantees consistency.
- Shared durability, retention, and integrity rules: [durability.md](./durability.md).

## Security considerations

The store defends read-path availability, not validity: clamped traversal prevents a
remote-supplied height from stalling the node; refusal of same-coordinate substitution prevents a
late duplicate from silently replacing accepted history; monotone merge prevents signature loss.
Equivocation evidence handling lives with block processing, not here.

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                  | Setup and stimulus                                                                        | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-blkstore-1-mk4w8d.t1"></a>`INV-BLKSTORE-1-MK4W8D.T1` | [`INV-BLKSTORE-1-MK4W8D`](blocks.md#inv-blkstore-1-mk4w8d) | Store, merge, update, and delete blocks through both key forms.                           | Both indexes agree after every operation.                                                | <a id="inv-blkstore-1-mk4w8d.t1.p1"></a>`INV-BLKSTORE-1-MK4W8D.T1.P1` — store/read via both keys; <a id="inv-blkstore-1-mk4w8d.t1.p2"></a>`INV-BLKSTORE-1-MK4W8D.T1.P2` — delete via hash key removes both; <a id="inv-blkstore-1-mk4w8d.t1.p3"></a>`INV-BLKSTORE-1-MK4W8D.T1.P3` — update via one key visible via the other; <a id="inv-blkstore-1-mk4w8d.t1.p4"></a>`INV-BLKSTORE-1-MK4W8D.T1.P4` — delete via coordinate key removes both. |
| <a id="req-blkstore-1-kyhtwt.t1"></a>`REQ-BLKSTORE-1-KYHTWT.T1` | [`REQ-BLKSTORE-1-KYHTWT`](blocks.md#req-blkstore-1-kyhtwt) | Store a block, then a different block at the same coordinates, then the same block again. | The conflicting block is refused; the duplicate merges.                                  | <a id="req-blkstore-1-kyhtwt.t1.p1"></a>`REQ-BLKSTORE-1-KYHTWT.T1.P1` — conflicting store refused; <a id="req-blkstore-1-kyhtwt.t1.p2"></a>`REQ-BLKSTORE-1-KYHTWT.T1.P2` — duplicate merges signatures; <a id="req-blkstore-1-kyhtwt.t1.p3"></a>`REQ-BLKSTORE-1-KYHTWT.T1.P3` — refusal leaves original intact.                                                                                                                               |
| <a id="req-blkstore-2-vwxp2c.t1"></a>`REQ-BLKSTORE-2-VWXP2C.T1` | [`REQ-BLKSTORE-2-VWXP2C`](blocks.md#req-blkstore-2-vwxp2c) | Merge overlapping, duplicate, and new signature sets and competing on-chain timestamps.   | Sets only grow; duplicates are no-ops; the earliest timestamp is retained.               | <a id="req-blkstore-2-vwxp2c.t1.p1"></a>`REQ-BLKSTORE-2-VWXP2C.T1.P1` — growth/idempotence; <a id="req-blkstore-2-vwxp2c.t1.p2"></a>`REQ-BLKSTORE-2-VWXP2C.T1.P2` — earlier timestamp kept, later ignored; <a id="req-blkstore-2-vwxp2c.t1.p3"></a>`REQ-BLKSTORE-2-VWXP2C.T1.P3` — merge order permutations converge.                                                                                                                         |
| <a id="req-blkstore-3-s9v2kc.t1"></a>`REQ-BLKSTORE-3-S9V2KC.T1` | [`REQ-BLKSTORE-3-S9V2KC`](blocks.md#req-blkstore-3-s9v2kc) | Store extending, backfill, and out-of-order blocks; read ranges with absurd bounds.       | Tip advances only when extending; absurd bounds clamp; latest-block reads match the tip. | <a id="req-blkstore-3-s9v2kc.t1.p1"></a>`REQ-BLKSTORE-3-S9V2KC.T1.P1` — tip advancement; <a id="req-blkstore-3-s9v2kc.t1.p2"></a>`REQ-BLKSTORE-3-S9V2KC.T1.P2` — persistence-only store leaves tip; <a id="req-blkstore-3-s9v2kc.t1.p3"></a>`REQ-BLKSTORE-3-S9V2KC.T1.P3` — remote-supplied absurd bound clamped.                                                                                                                             |

## Future Work

_Non-normative._ Per-fork pruning hooks once obligation-bounded retention ([`REQ-STOR-4-MF6FT6`](durability.md#req-stor-4-mf6ft6)) gets a
concrete pruning policy.
