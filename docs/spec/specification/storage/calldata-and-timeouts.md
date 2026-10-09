# Block-Calldata and Timeout-Candidate Stores

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The module holding observed on-chain block-calldata records, and the module holding
> the node's current timeout candidate per fork. Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

- **Calldata store.** Signed blocks observed as on-chain calldata, with their on-chain posting
  timestamp, keyed by (fork id, height, author) — the same coordinates the enforcement commitment
  uses ([data-availability.md](../security/data-availability.md)).
- **Timeout store.** At most one timeout candidate per fork: the participant/height pair the node
  would submit if it escalates ([disputes.md](../disputes/disputes.md) §6).

## Requirements and invariants

**<a id="req-cdstore-1-ecwbny"></a>`REQ-CDSTORE-1-ECWBNY` — Coordinate-keyed calldata with exact matching.** A calldata record is stored and
retrieved by (fork, height, author). A match query for a specific block succeeds only when the
stored record's block hash equals the queried block's hash — same coordinates with different content
is not a match, it is evidence of a divergence for the consumer to judge. A store at coordinates
already held adopts the incoming record; no preference rule is needed, because conflicting records
cannot legitimately coexist — the on-chain commitment at those coordinates is author-bound,
first-post-wins, and non-overwritable ([data-availability.md](../security/data-availability.md)),
and records are populated only from chain observation.

**<a id="req-tostore-3-h0mh84"></a>`REQ-TOSTORE-3-H0MH84` — Newest timeout candidate.** The store keeps at most one candidate per
fork, and a store always adopts the incoming candidate. The node stores a candidate only for the
next unfilled height of its latest local state
([`REQ-DISPUTE-PIPE-13-R2QJZN` (Time out only the next height)](../disputes/dispute-processing.md#req-dispute-pipe-13-r2qjzn)), so a
retained candidate at a lower height names a height the node already passed: a block or an installed
later state filled it. An honest node never times out a height it passed; it can only time out its
next height. So the new store replaces the passed candidate, and a passed candidate never blocks the
live one. An equal-height store refreshes the retained candidate: the accountable participant at a
height is deterministic, so this is the same slot re-observed, and the detection inputs only accrue
(on-chain commitments are non-overwritable; signature knowledge is monotone) — a refresh never
weakens the retained dispute evidence. Forks are independent.

The store needs no lowest-height retention for the protocol's lowest-timed-out-height precedence
([`INV-DIS-8-1GY6Q5`](../disputes/disputes.md#inv-dis-8-1gy6q5)). The chain applies that precedence
across all committed disputes on the fork. The node's own claim is always at the lowest height its
local state has not filled, and dispute construction attaches a stored claim only at the state
proof's latest height + 1. Every lower height is filled in the node's view, so its claim never skips
an earlier missed slot.

**<a id="req-tostore-2-wx7vmh"></a>`REQ-TOSTORE-2-WX7VMH` — Drop a refused candidate by identity.** A consumer whose escalation was
refused because the base layer proved the candidate moot MUST be able to drop it, and the drop MUST
match the refused candidate's identity: same height, same participant, and not a forced candidate.
A candidate the store holds for another height or participant, or a forced candidate stored since,
survives the drop. Without the drop the refused candidate stays retained until a later store
replaces it ([`REQ-TOSTORE-3-H0MH84`](calldata-and-timeouts.md#req-tostore-3-h0mh84)), and a later
escalation at the same next height would carry it again.

## Assumptions and constraints

- Calldata records come from chain observation and carry the chain's posting timestamp; their
  protocol meaning (timing windows, slashability) is judged by the disputes system.
- The timeout store holds a _candidate_, not a claim: submission decisions and validity checks live
  with dispute processing.

## Security considerations

Calldata hash-matching prevents a same-coordinate different-content record from silently
satisfying an availability check — exactly the divergence the slashing rules exist for. The
timeout store adopts the newest candidate: a retained candidate for a passed height must not block
the claim at the node's next height, or a silent writer at that height is never disputed.

## Verification and test plan

### Requirement test matrix

| Plan item                                                     | Requirements / invariants                                               | Setup and stimulus                                                                                                                                                                    | Expected result                                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="req-cdstore-1-ecwbny.t1"></a>`REQ-CDSTORE-1-ECWBNY.T1` | [`REQ-CDSTORE-1-ECWBNY`](calldata-and-timeouts.md#req-cdstore-1-ecwbny) | Store calldata records; query by coordinates and by matching block with equal and unequal hashes.                                                                                     | Coordinate reads return the record; match succeeds only on hash equality.                                       | <a id="req-cdstore-1-ecwbny.t1.p1"></a>`REQ-CDSTORE-1-ECWBNY.T1.P1` — store/read by coordinates; <a id="req-cdstore-1-ecwbny.t1.p2"></a>`REQ-CDSTORE-1-ECWBNY.T1.P2` — match equal hash; <a id="req-cdstore-1-ecwbny.t1.p3"></a>`REQ-CDSTORE-1-ECWBNY.T1.P3` — same coordinates, different hash → no match; <a id="req-cdstore-1-ecwbny.t1.p4"></a>`REQ-CDSTORE-1-ECWBNY.T1.P4` — absent coordinates; <a id="req-cdstore-1-ecwbny.t1.p5"></a>`REQ-CDSTORE-1-ECWBNY.T1.P5` — re-store at held coordinates adopts the incoming record.                   |
| <a id="req-tostore-3-h0mh84.t1"></a>`REQ-TOSTORE-3-H0MH84.T1` | [`REQ-TOSTORE-3-H0MH84`](calldata-and-timeouts.md#req-tostore-3-h0mh84) | Store a lower candidate then a higher one, the same height twice, and candidates on two forks; end to end, leave a candidate for a passed height stored and time out the next height. | The latest store is retained; forks are independent; the passed candidate does not block the next-height claim. | <a id="req-tostore-3-h0mh84.t1.p1"></a>`REQ-TOSTORE-3-H0MH84.T1.P1` — a later store at a higher height replaces a stale lower one; <a id="req-tostore-3-h0mh84.t1.p2"></a>`REQ-TOSTORE-3-H0MH84.T1.P2` — equal-height store refreshes the retained candidate; <a id="req-tostore-3-h0mh84.t1.p3"></a>`REQ-TOSTORE-3-H0MH84.T1.P3` — per-fork isolation; <a id="req-tostore-3-h0mh84.t1.p4"></a>`REQ-TOSTORE-3-H0MH84.T1.P4` — a stale candidate for a passed height does not block the next-height timeout: the dispute carries the next-height claim. |
| <a id="req-tostore-2-wx7vmh.t1"></a>`REQ-TOSTORE-2-WX7VMH.T1` | [`REQ-TOSTORE-2-WX7VMH`](calldata-and-timeouts.md#req-tostore-2-wx7vmh) | Drop candidates by identity against stored candidates that match and that differ in height, participant, or forced flag.                                                              | Only the identical non-forced candidate is removed; every other stored candidate survives.                      | <a id="req-tostore-2-wx7vmh.t1.p1"></a>`REQ-TOSTORE-2-WX7VMH.T1.P1` — the matching non-forced candidate is removed; <a id="req-tostore-2-wx7vmh.t1.p2"></a>`REQ-TOSTORE-2-WX7VMH.T1.P2` — a forced candidate at the same slot survives; <a id="req-tostore-2-wx7vmh.t1.p3"></a>`REQ-TOSTORE-2-WX7VMH.T1.P3` — a candidate at another height survives; <a id="req-tostore-2-wx7vmh.t1.p4"></a>`REQ-TOSTORE-2-WX7VMH.T1.P4` — a candidate for another participant at the same height survives                                                            |

## Future Work

_Non-normative._ None currently.
