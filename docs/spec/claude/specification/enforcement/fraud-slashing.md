# Fraud-Slashing Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module owning fraud-proof application — block-level and dispute-level —
> and the on-chain slash set. Composition rules: [contracts.md](./contracts.md). Semantics owner:
> [fraud-proofs.md](../disputes/fraud-proofs.md).

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Entry points and validation obligations](#entry-points-and-validation-obligations)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

Owned storage domain, per channel: the on-chain slash set (participant, timestamp entries) — the
compact objective record that dispute reduction consumes ([`REQ-DIS-1`](../disputes/disputes.md)
input 2) and dispute eligibility checks read. This module is the slash set's only writer.

## Entry points and validation obligations

| Entry point                 | Caller authorization | Validation obligations (semantics owner)                                                                                                                                                                                                                                                                       | Effect                                                                                                                                           |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apply block fraud proofs    | Any submitter        | Per proof: skip already-slashed targets; dispatch on the proof type ([fraud-proofs.md](../disputes/fraud-proofs.md) — double-sign, invalid transition via full replay, wrong genesis, invalid timestamp with calldata/forfeit rules, forged inbound block); the proven offender must equal the declared target | Successful proof: target enters the slash set, event emitted. Failed or mismatched proof: the **submitter** is slashed instead, if eligible.     |
| Apply dispute fraud proofs  | Any submitter        | Skip already-killed disputes; kill period open; dispatch across the dispute-content and timeout proof families                                                                                                                                                                                                 | Valid: the dispute is killed and its disputer slashed (via the [dispute-window module](./dispute-window.md)). Invalid: the submitter is slashed. |
| Timeout-evidence predicates | Any caller (views)   | The falsifiability checks for timeout claims ([disputes.md §6.3](../disputes/disputes.md))                                                                                                                                                                                                                     | Verdicts only; consumed by upload race checks and off-chain preflight.                                                                           |

## Requirements and invariants

<a id="inv-enffp-1"></a>
**INV-ENFFP-1 — Slash set integrity.** Only successful proofs append to the slash set; entries
carry the chain time of the slash; an already-slashed participant is not re-proven (later proofs
against them are skipped, not replayed); and no entry is ever removed — the set is append-only
objective history.

<a id="req-enffp-1"></a>
**REQ-ENFFP-1 — Symmetric stake on submission.** Submitting a proof stakes the submitter: a proof
that fails, or whose proven offender differs from its declared target, slashes the eligible
submitter. Honest submitters protect themselves by preflighting proofs through the same predicates
locally ([local-mirror.md](./local-mirror.md)).

<a id="req-enffp-2"></a>
**REQ-ENFFP-2 — Proof-type completeness at the boundary.** Every proof type the owner defines is
dispatchable through this module, and an undefined type MUST reject without slashing anyone; the
completeness of the type set itself is the owner's standing security review
([`REQ-SEC-1`](../security/README.md)).

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                              |
| ----------------------- | ---------------------------------------------------------------------- |
| `INV-ENFFP-1`           | Append-only, timestamped, deduplicated slash set; sole writer here.    |
| `REQ-ENFFP-1`           | Failed/mismatched proofs slash the eligible submitter.                 |
| `REQ-ENFFP-2`           | Exactly the defined proof types dispatch; unknown types reject safely. |

## Assumptions and constraints

- Replay-based proofs execute the state machine through the
  [execution module](./execution-and-consumer.md) under the injected-context rules
  ([state-machines.md](../protocol-model/state-machines.md)); gas bounds proof size.
- Whether an _ineligible_ submitter of an invalid proof bears any consequence is the owner's open
  question ([disputes.md](../disputes/disputes.md) §25 penalty question); this module implements
  whatever rule is decided.
- Slash-set consumption rules (subset listing, window-expiry filtering) belong to reduction
  ([disputes.md §5](../disputes/disputes.md)).

## Security considerations

The slash set converts violations into reusable, compact evidence — its integrity substitutes for
re-executing violations in every later dispute. Threats: forged proofs against honest participants
(defeated by on-chain recomputation of the violation), submitter griefing via cheap invalid proofs
(the self-slash stake), proof-type confusion (strict dispatch + safe rejection of unknown types),
and double-jeopardy gas waste (skip-if-slashed). The self-slash rule cuts both ways: an honest
submitter racing a state change can lose stake to a technicality — the preflight-through-the-mirror
pattern is the operational mitigation and the reason mirror equivalence
(`REQ-MIRROR-1`) matters here.

## Verification and test plan

### Requirement test matrix

| Plan item                                   | Requirements / invariants | Setup and stimulus                                                                                              | Expected result                                                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-enffp-1-t1"></a>`INV-ENFFP-1.T1` | `INV-ENFFP-1`             | Apply valid proofs, repeat them, target already-slashed participants, and attempt any removal path.             | Append-only set with correct timestamps; repeats and already-slashed targets skip; no removal exists.                              | <a id="inv-enffp-1-t1-p1"></a>`INV-ENFFP-1.T1.P1` — each proof type appends once; <a id="inv-enffp-1-t1-p2"></a>`INV-ENFFP-1.T1.P2` — repeat/already-slashed skip; <a id="inv-enffp-1-t1-p3"></a>`INV-ENFFP-1.T1.P3` — timestamps reflect chain time; <a id="inv-enffp-1-t1-p4"></a>`INV-ENFFP-1.T1.P4` — no removal path.                                  |
| <a id="req-enffp-1-t1"></a>`REQ-ENFFP-1.T1` | `REQ-ENFFP-1`             | Submit failing proofs, offender-mismatch proofs, and valid proofs from eligible and ineligible submitters.      | Failed/mismatched proofs slash eligible submitters; valid proofs never do; ineligible-submitter handling matches the decided rule. | <a id="req-enffp-1-t1-p1"></a>`REQ-ENFFP-1.T1.P1` — failing proof self-slash; <a id="req-enffp-1-t1-p2"></a>`REQ-ENFFP-1.T1.P2` — declared-vs-proven mismatch; <a id="req-enffp-1-t1-p3"></a>`REQ-ENFFP-1.T1.P3` — valid proof, no submitter effect; <a id="req-enffp-1-t1-p4"></a>`REQ-ENFFP-1.T1.P4` — mirror preflight agrees with the on-chain outcome. |
| <a id="req-enffp-2-t1"></a>`REQ-ENFFP-2.T1` | `REQ-ENFFP-2`             | Dispatch every defined block and dispute proof type, plus unknown types, against open and expired kill periods. | Every defined type reaches its check; unknown types reject with no slash; kill-period gating holds for dispute proofs.             | <a id="req-enffp-2-t1-p1"></a>`REQ-ENFFP-2.T1.P1` — each defined type dispatches; <a id="req-enffp-2-t1-p2"></a>`REQ-ENFFP-2.T1.P2` — unknown type safe-rejects; <a id="req-enffp-2-t1-p3"></a>`REQ-ENFFP-2.T1.P3` — expired kill period rejects; killed dispute skipped.                                                                                   |

## Future Work

_Non-normative._ The ineligible-invalid-submitter penalty rule (owner's open question); proof
batching cost analysis; the fraud-proof completeness review feeding new types through this
boundary (REQ-SEC-1).
