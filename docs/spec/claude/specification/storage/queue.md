# Pre-Execution Queue Store

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The module realizing the pre-execution merge layer of
> [`REQ-BLOCK-PIPE-5`](../block-progression/block-processing.md): not-yet-eligible block
> confirmations with their merged signatures and source attribution. Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

A queued entry is keyed by block hash and carries: the block with its merged signature set, the time
it was first seen, the set of peers that supplied any copy, and per-signature source attribution —
which peer contributed which signatures. A coordinate index (fork id, height → hashes) serves
eligibility queries. The queue is where unordered network knowledge waits, merged and attributed,
until the pipeline dequeues it for ordered execution.

## Requirements and invariants

<a id="req-qstore-1"></a>
**REQ-QSTORE-1 — Attributed monotone merge.** Queueing a copy of a known block merges only that
copy's signatures into the entry, attributes exactly those signatures to that copy's sender (never
signatures pooled from earlier copies), and merges the earliest on-chain timestamp. Merge is
idempotent and arrival-order independent.

<a id="req-qstore-2"></a>
**REQ-QSTORE-2 — Structural caps as markers, not rejections.** Per-entry attribution retention is
capped. Reaching the cap sets an overflow marker and stops _retention growth_; it never rejects a
later copy, never evicts already-tracked sources, and never influences any validity decision — the
marker is an attribution/rate-limiting hint only. A junk-first flood therefore cannot crowd out an
honest source or block a later valid copy.

<a id="req-qstore-3"></a>
**REQ-QSTORE-3 — Coordinate dequeue rules.** Dequeue-at removes and returns every entry at exactly
(fork, height). Priority dequeue selects the _lowest_ queued height on the fork not exceeding the
caller's bound. Clearing a fork removes all of its entries and reports what was removed. A dequeued
entry leaves both the entry map and the coordinate index.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                      |
| ----------------------- | ------------------------------------------------------------------------------ |
| `REQ-QSTORE-1`          | Copy-scoped attributed merge; monotone, idempotent, order-independent.         |
| `REQ-QSTORE-2`          | Retention caps set markers; they never reject, evict, or decide validity.      |
| `REQ-QSTORE-3`          | Dequeue by exact coordinates, lowest-height priority, and complete fork clear. |

## Assumptions and constraints

- The queue holds _unvalidated_ knowledge by design; everything read from it re-enters pipeline
  validation. Attribution must therefore be preserved exactly — it is future evidence.
- Entries may never become eligible; retention is bounded per entry (`REQ-BLOCK-PIPE-5`) and by the
  shared retention rules ([durability.md](./durability.md), `REQ-STOR-4`).
- Frequency-bounding of intake is the communication layer's duty (`REQ-RPC-5`); the queue bounds
  per-entry structure only.

## Security considerations

This module is the direct target of flooding adversaries: unique junk signatures or sources for one
hash (bounded by the caps), never-eligible blocks (bounded by retention rules), and attribution
laundering (prevented by copy-scoped attribution — a sender is credited only with what its own copy
carried). The queue must keep merge work cheap enough that intake never needs the execution
boundary.

## Verification and test plan

### Requirement test matrix

| Plan item                                     | Requirements / invariants | Setup and stimulus                                                                                   | Expected result                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-qstore-1-t1"></a>`REQ-QSTORE-1.T1` | `REQ-QSTORE-1`            | Deliver copies of one block from several senders with overlapping signature sets in varied orders.   | Attribution is copy-scoped; merged set and attribution converge for every order.                | <a id="req-qstore-1-t1-p1"></a>`REQ-QSTORE-1.T1.P1` — disjoint copies; <a id="req-qstore-1-t1-p2"></a>`REQ-QSTORE-1.T1.P2` — order permutations converge; <a id="req-qstore-1-t1-p3"></a>`REQ-QSTORE-1.T1.P3` — sender credited only with its own copy's signatures; <a id="req-qstore-1-t1-p4"></a>`REQ-QSTORE-1.T1.P4` — overlapping copies; <a id="req-qstore-1-t1-p5"></a>`REQ-QSTORE-1.T1.P5` — duplicate copies. |
| <a id="req-qstore-2-t1"></a>`REQ-QSTORE-2.T1` | `REQ-QSTORE-2`            | Flood one entry with unique junk sources/signatures past the cap, then deliver an honest valid copy. | Marker set at the cap; no eviction of tracked sources; the later valid copy processes normally. | <a id="req-qstore-2-t1-p1"></a>`REQ-QSTORE-2.T1.P1` — cap reached, marker set; <a id="req-qstore-2-t1-p2"></a>`REQ-QSTORE-2.T1.P2` — honest source tracked before flood survives; <a id="req-qstore-2-t1-p3"></a>`REQ-QSTORE-2.T1.P3` — valid copy after overflow accepted.                                                                                                                                            |
| <a id="req-qstore-3-t1"></a>`REQ-QSTORE-3.T1` | `REQ-QSTORE-3`            | Queue entries across forks and heights; dequeue-at, priority-dequeue, and clear forks.               | Exact-coordinate and lowest-height selection; cleared forks empty both maps.                    | <a id="req-qstore-3-t1-p1"></a>`REQ-QSTORE-3.T1.P1` — dequeue-at exact height; <a id="req-qstore-3-t1-p2"></a>`REQ-QSTORE-3.T1.P2` — priority picks lowest ≤ bound, other forks untouched; <a id="req-qstore-3-t1-p3"></a>`REQ-QSTORE-3.T1.P3` — clear-fork completeness; <a id="req-qstore-3-t1-p4"></a>`REQ-QSTORE-3.T1.P4` — empty coordinate returns nothing.                                                      |

## Future Work

_Non-normative._ Age-based eviction for never-eligible entries once the shared pruning policy
exists; queue-depth metrics for the communication layer's admission control.
