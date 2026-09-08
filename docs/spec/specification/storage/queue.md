# Pre-Execution Queue Store

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The module realizing the pre-execution merge layer of
> [`REQ-BLOCK-PIPE-5-WJ31RG`](../block-progression/block-processing.md#req-block-pipe-5-wj31rg): not-yet-eligible block
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

**[`REQ-QSTORE-1-PS769J`](../peer-communication/block-gossip.md#req-qstore-1-ps769j) — Attributed monotone merge.** Queueing a copy of a known block merges only that
copy's signatures into the entry, attributes exactly those signatures to that copy's sender (never
signatures pooled from earlier copies), and never discards a known on-chain posting timestamp — no
preference rule between conflicting values is needed, because such values cannot legitimately
coexist: the on-chain calldata commitment is author-bound, first-post-wins, and non-overwritable
([data-availability.md](../security/data-availability.md)), and the annotation is populated only
from chain observation, never from gossiped payloads. Merge is idempotent and arrival-order
independent.

**<a id="req-qstore-2-vywjaq"></a>`REQ-QSTORE-2-VYWJAQ` — Structural caps as markers, not rejections.** Per-entry retention is capped in
two dimensions: the sources attributed to an entry, and the confirmation signatures the entry
retains. Ingress authenticates the block a copy carries, not each confirmation signature attached to
it, so both must be bounded or one authenticated sender can grow a single entry without limit.
_Exceeding_ a cap sets an overflow marker and stops that dimension growing; it never rejects a later
copy, never evicts what is already retained, and never influences any validity decision — the marker
is an attribution/rate-limiting hint only.

The two dimensions differ in what they promise, deliberately. Source attribution is never displaced:
a junk-first flood cannot crowd out an already-tracked honest source or block a later valid copy.
Signature retention is **first-come**: once the signature cap is exceeded, later signatures are not
retained whether they are honest or junk, until validation strips the unexpected ones and frees
room. A junk-first signature flood therefore delays finality for that block until honest signatures
are offered again — bounded, because validation disconnects the attributed junk suppliers and
removes their signatures, but real. Attribution follows retention: a sender is credited only with
the signatures the entry kept, so the attribution map is never spent on signatures the block no
longer holds.

The signature cap is set far above any plausible participant union, because dropping a signature a
block needs costs liveness. Nothing currently enforces a maximum union size, so that headroom is an
assumption rather than a guarantee; closing it is future work.

**<a id="req-qstore-3-dekyg6"></a>`REQ-QSTORE-3-DEKYG6` — Coordinate dequeue rules.** Dequeue-at removes and returns every entry at exactly
(fork, height). Priority dequeue selects the _lowest_ queued height on the fork not exceeding the
caller's bound. Clearing a fork removes all of its entries and reports what was removed. A dequeued
entry leaves both the entry map and the coordinate index.

## Assumptions and constraints

- The queue holds _unvalidated_ knowledge by design; everything read from it re-enters pipeline
  validation. Attribution must therefore be preserved exactly — it is future evidence.
- Entries may never become eligible; retention is bounded per entry ([`REQ-BLOCK-PIPE-5-WJ31RG`](../block-progression/block-processing.md#req-block-pipe-5-wj31rg)) and by the
  shared retention rules ([durability.md](./durability.md), [`REQ-STOR-4-MF6FT6`](durability.md#req-stor-4-mf6ft6)).
- Frequency-bounding of intake is the communication layer's duty ([`REQ-RPC-5-CV1R1Y`](../peer-communication/rpc.md#req-rpc-5-cv1r1y)); the queue bounds
  per-entry structure only.

## Security considerations

This module is the direct target of flooding adversaries: unique junk signatures or sources for one
hash (bounded by the caps), never-eligible blocks (bounded by retention rules), and attribution
laundering (prevented by copy-scoped attribution — a sender is credited only with what its own copy
carried). The queue must keep merge work cheap enough that intake never needs the execution
boundary.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                                          | Setup and stimulus                                                                                                                                 | Expected result                                                                                                                                                                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-qstore-1-ps769j.t1"></a>`REQ-QSTORE-1-PS769J.T1` | [`REQ-QSTORE-1-PS769J`](../peer-communication/block-gossip.md#req-qstore-1-ps769j) | Deliver copies of one block from several senders with overlapping signature sets in varied orders.                                                 | Attribution is copy-scoped; merged set and attribution converge for every order.                                                                                                                                                                               | <a id="req-qstore-1-ps769j.t1.p1"></a>`REQ-QSTORE-1-PS769J.T1.P1` — disjoint copies; <a id="req-qstore-1-ps769j.t1.p2"></a>`REQ-QSTORE-1-PS769J.T1.P2` — order permutations converge; <a id="req-qstore-1-ps769j.t1.p3"></a>`REQ-QSTORE-1-PS769J.T1.P3` — sender credited only with its own copy's signatures; <a id="req-qstore-1-ps769j.t1.p4"></a>`REQ-QSTORE-1-PS769J.T1.P4` — overlapping copies; <a id="req-qstore-1-ps769j.t1.p5"></a>`REQ-QSTORE-1-PS769J.T1.P5` — duplicate copies; <a id="req-qstore-1-ps769j.t1.p6"></a>`REQ-QSTORE-1-PS769J.T1.P6` — merge of an unannotated copy preserves the known on-chain posting timestamp.                                                                                                                                                                                                                                                                             |
| <a id="req-qstore-2-vywjaq.t1"></a>`REQ-QSTORE-2-VYWJAQ.T1` | [`REQ-QSTORE-2-VYWJAQ`](queue.md#req-qstore-2-vywjaq)                              | Flood one entry with unique junk sources past the cap, and separately with unique junk signatures past the cap, then deliver an honest valid copy. | Marker set once a cap is exceeded; no eviction of tracked sources; the entry retains exactly the cap in each dimension rather than discarding what it held; later signatures are not retained while overflowed; the later valid copy still processes normally. | <a id="req-qstore-2-vywjaq.t1.p1"></a>`REQ-QSTORE-2-VYWJAQ.T1.P1` — cap reached, marker set; <a id="req-qstore-2-vywjaq.t1.p2"></a>`REQ-QSTORE-2-VYWJAQ.T1.P2` — honest source tracked before flood survives; <a id="req-qstore-2-vywjaq.t1.p3"></a>`REQ-QSTORE-2-VYWJAQ.T1.P3` — valid copy after overflow accepted; <a id="req-qstore-2-vywjaq.t1.p4"></a>`REQ-QSTORE-2-VYWJAQ.T1.P4` — unique junk signatures past the cap: marker set, entry bounded at exactly the cap, block still dequeueable; <a id="req-qstore-2-vywjaq.t1.p5"></a>`REQ-QSTORE-2-VYWJAQ.T1.P5` — signatures merged back through the restore path stay bounded; <a id="req-qstore-2-vywjaq.t1.p6"></a>`REQ-QSTORE-2-VYWJAQ.T1.P6` — an honest signature arriving after overflow is not retained (first-come residual); <a id="req-qstore-2-vywjaq.t1.p7"></a>`REQ-QSTORE-2-VYWJAQ.T1.P7` — attribution covers only signatures the entry retained. |
| <a id="req-qstore-3-dekyg6.t1"></a>`REQ-QSTORE-3-DEKYG6.T1` | [`REQ-QSTORE-3-DEKYG6`](queue.md#req-qstore-3-dekyg6)                              | Queue entries across forks and heights; dequeue-at, priority-dequeue, and clear forks.                                                             | Exact-coordinate and lowest-height selection; cleared forks empty both maps.                                                                                                                                                                                   | <a id="req-qstore-3-dekyg6.t1.p1"></a>`REQ-QSTORE-3-DEKYG6.T1.P1` — dequeue-at exact height; <a id="req-qstore-3-dekyg6.t1.p2"></a>`REQ-QSTORE-3-DEKYG6.T1.P2` — priority picks lowest ≤ bound, other forks untouched; <a id="req-qstore-3-dekyg6.t1.p3"></a>`REQ-QSTORE-3-DEKYG6.T1.P3` — clear-fork completeness; <a id="req-qstore-3-dekyg6.t1.p4"></a>`REQ-QSTORE-3-DEKYG6.T1.P4` — empty coordinate returns nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Future Work

_Non-normative._ Age-based eviction for never-eligible entries once the shared pruning policy
exists; queue-depth metrics for the communication layer's admission control. Enforce a maximum
participant-union size so the signature cap can be derived from it rather than assumed to exceed it,
which would also remove the first-come residual for any legitimate signer.
