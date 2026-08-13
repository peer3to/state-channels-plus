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

**[`REQ-CDSTORE-1-ECWBNY`](calldata-and-timeouts.md#req-cdstore-1-ecwbny) — Coordinate-keyed calldata with exact matching.** A calldata record is stored and
retrieved by (fork, height, author). A match query for a specific block succeeds only when the
stored record's block hash equals the queried block's hash — same coordinates with different content
is not a match, it is evidence of a divergence for the consumer to judge.

**[`REQ-TOSTORE-1-JQPXBC`](calldata-and-timeouts.md#req-tostore-1-jqpxbc) — Lowest-height timeout candidate.** The store keeps at most one candidate per
fork and ignores a stored update whose height is above the retained candidate's — mirroring the
protocol's lowest-timed-out-height precedence ([`INV-DIS-8-1GY6Q5`](../disputes/disputes.md#inv-dis-8-1gy6q5)) so the node never escalates a
later slot while an earlier one is missed.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant                                 | Statement                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| <a id="req-cdstore-1-ecwbny"></a>`REQ-CDSTORE-1-ECWBNY` | Calldata keyed by (fork, height, author); match requires hash equality. |
| <a id="req-tostore-1-jqpxbc"></a>`REQ-TOSTORE-1-JQPXBC` | One timeout candidate per fork; lowest height retained.                 |

## Assumptions and constraints

- Calldata records come from chain observation and carry the chain's posting timestamp; their
  protocol meaning (timing windows, slashability) is judged by the disputes system.
- The timeout store holds a _candidate_, not a claim: submission decisions and validity checks live
  with dispute processing.

## Security considerations

Calldata hash-matching prevents a same-coordinate different-content record from silently
satisfying an availability check — exactly the divergence the slashing rules exist for. The
lowest-height rule in the timeout store keeps the node's own escalation aligned with timeout
precedence even when observations arrive out of order.

## Verification and test plan

### Requirement test matrix

| Plan item                                                     | Requirements / invariants                                               | Setup and stimulus                                                                                | Expected result                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-cdstore-1-ecwbny.t1"></a>`REQ-CDSTORE-1-ECWBNY.T1` | [`REQ-CDSTORE-1-ECWBNY`](calldata-and-timeouts.md#req-cdstore-1-ecwbny) | Store calldata records; query by coordinates and by matching block with equal and unequal hashes. | Coordinate reads return the record; match succeeds only on hash equality.         | <a id="req-cdstore-1-ecwbny.t1.p1"></a>`REQ-CDSTORE-1-ECWBNY.T1.P1` — store/read by coordinates; <a id="req-cdstore-1-ecwbny.t1.p2"></a>`REQ-CDSTORE-1-ECWBNY.T1.P2` — match equal hash; <a id="req-cdstore-1-ecwbny.t1.p3"></a>`REQ-CDSTORE-1-ECWBNY.T1.P3` — same coordinates, different hash → no match; <a id="req-cdstore-1-ecwbny.t1.p4"></a>`REQ-CDSTORE-1-ECWBNY.T1.P4` — absent coordinates. |
| <a id="req-tostore-1-jqpxbc.t1"></a>`REQ-TOSTORE-1-JQPXBC.T1` | [`REQ-TOSTORE-1-JQPXBC`](calldata-and-timeouts.md#req-tostore-1-jqpxbc) | Store timeout candidates at varied heights per fork in varied orders.                             | The lowest height is retained regardless of arrival order; forks are independent. | <a id="req-tostore-1-jqpxbc.t1.p1"></a>`REQ-TOSTORE-1-JQPXBC.T1.P1` — lower replaces higher; <a id="req-tostore-1-jqpxbc.t1.p2"></a>`REQ-TOSTORE-1-JQPXBC.T1.P2` — higher ignored; <a id="req-tostore-1-jqpxbc.t1.p3"></a>`REQ-TOSTORE-1-JQPXBC.T1.P3` — order permutations converge; <a id="req-tostore-1-jqpxbc.t1.p4"></a>`REQ-TOSTORE-1-JQPXBC.T1.P4` — per-fork isolation.                       |

## Future Work

_Non-normative._ None currently.
