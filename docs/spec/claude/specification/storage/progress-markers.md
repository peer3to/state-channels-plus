# Progress and Intent Markers

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The small marker modules: chain-observation progress, the force-exit intent flag, and
> the force-join submission marker. Shared storage rules: [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

Three markers that carry a node's position or intent across protocol phases:

- **Event-sync progress.** Per channel, the latest base-layer block number whose events the node has
  processed — where chain observation resumes after a gap or restart.
- **Force-exit intent.** A local flag that the node intends to exit through the dispute path.
- **Force-join marker.** The base-layer block height at which the node submitted its join, kept so
  the node can detect non-inclusion and escalate to forced inclusion
  ([cross-layer-messages.md](../settlement/cross-layer-messages.md)).

## Requirements and invariants

<a id="req-rmstore-1"></a>
**REQ-RMSTORE-1 — Monotone observation progress.** Event-sync progress per channel only advances: a
store of a lower block number than the retained one leaves the retained value. Progress reflects
_processed_, not merely observed, events — the producer stores it only after handling.

<a id="req-rmstore-2"></a>
**REQ-RMSTORE-2 — Explicit intent lifecycle.** The force-exit flag and force-join marker are set,
read, and cleared explicitly; clearing returns them to their absent state. Absent means "no intent /
no pending submission", and consumers MUST NOT infer intent from any other module.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                         |
| ----------------------- | ----------------------------------------------------------------- |
| `REQ-RMSTORE-1`         | Per-channel observation progress is monotone and means processed. |
| `REQ-RMSTORE-2`         | Intent markers have explicit set/read/clear lifecycles.           |

## Assumptions and constraints

- A regressed progress marker would make the node re-process events (safe but wasteful); a
  _forward-jumped_ one would skip events (unsafe) — producers must store only truly processed
  positions.
- Under the current in-memory medium these markers reset with the process; the recovery consequences
  are bounded by [durability.md](./durability.md) `REQ-STOR-3` (re-derive from chain observation).

## Security considerations

The markers are local knowledge with protocol consequences: lost force-join markers delay
non-inclusion detection; skipped observation progress misses events that other defenses assume were
seen. Neither is remotely writable; the risk is loss and mis-advancement, addressed by monotonicity
and the processed-only rule.

## Verification and test plan

### Requirement test matrix

| Plan item                                       | Requirements / invariants | Setup and stimulus                                                          | Expected result                                                  | Required permutations                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-rmstore-1-t1"></a>`REQ-RMSTORE-1.T1` | `REQ-RMSTORE-1`           | Store progress values increasing, repeated, and regressing across channels. | Monotone per channel; regressions ignored; channels independent. | <a id="req-rmstore-1-t1-p1"></a>`REQ-RMSTORE-1.T1.P1` — advance; <a id="req-rmstore-1-t1-p2"></a>`REQ-RMSTORE-1.T1.P2` — regression ignored; <a id="req-rmstore-1-t1-p3"></a>`REQ-RMSTORE-1.T1.P3` — per-channel isolation.                     |
| <a id="req-rmstore-2-t1"></a>`REQ-RMSTORE-2.T1` | `REQ-RMSTORE-2`           | Set, read, and clear each intent marker, including reads before any set.    | Explicit lifecycle honored; absent state distinct and default.   | <a id="req-rmstore-2-t1-p1"></a>`REQ-RMSTORE-2.T1.P1` — set/read/clear each marker; <a id="req-rmstore-2-t1-p2"></a>`REQ-RMSTORE-2.T1.P2` — read before set; <a id="req-rmstore-2-t1-p3"></a>`REQ-RMSTORE-2.T1.P3` — repeated clear idempotent. |

## Future Work

_Non-normative._ None currently.
