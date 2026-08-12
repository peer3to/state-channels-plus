# Dispute Intake, Verification, and Reduction Pipeline

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A dispute pipeline converts a stalled or contested off-chain fork into an objectively auditable base-layer
decision. It binds intake to a channel and fork, reconstructs the claimed history, verifies authorization and
proofs in protocol order, classifies fraud or unavailability, reduces to the canonical survivor set, creates
the successor fork, and returns participants to normal execution without losing evidence.

## Requirements and invariants

<a id="inv-dispute-pipe-1"></a>
**INV-DISPUTE-PIPE-1 — Equivalent audit.** Every auditor given the same chain state and complete evidence
MUST reach the same validity, offender, reduction, and successor-fork result.

<a id="req-dispute-pipe-1"></a>
**REQ-DISPUTE-PIPE-1 — Bound intake.** Local escalation and chain-observed intake MUST bind the dispute,
proofs, acknowledgements, and evidence to the exact manager, channel, fork, and dispute instance.

<a id="req-dispute-pipe-2"></a>
**REQ-DISPUTE-PIPE-2 — Ordered complete verification.** Audit MUST verify authenticity, authorization,
commitment linkage, final/unfinalized boundaries, replayed transitions, messages, time, and claimed outcome
before accepting or reducing a dispute.

<a id="req-dispute-pipe-3"></a>
**REQ-DISPUTE-PIPE-3 — Deterministic reduction.** Proven fraud, unavailable peers, and valid survivors MUST
be treated according to distinct specified rules; removal order or evidence arrival order MUST NOT alter the
canonical successor state.

<a id="req-dispute-pipe-4"></a>
**REQ-DISPUTE-PIPE-4 — Atomic recovery.** Evidence persistence, chain action, local fork replacement, queue
reset, and resumed execution MUST either converge on the accepted successor or remain safely retryable.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `INV-DISPUTE-PIPE-1`    | Equivalent audit. Every auditor given the same chain state and complete evidence   |
| `REQ-DISPUTE-PIPE-1`    | Bound intake. Local escalation and chain-observed intake MUST bind the dispute,    |
| `REQ-DISPUTE-PIPE-2`    | Ordered complete verification. Audit MUST verify authenticity, authorization,      |
| `REQ-DISPUTE-PIPE-3`    | Deterministic reduction. Proven fraud, unavailable peers, and valid survivors MUST |
| `REQ-DISPUTE-PIPE-4`    | Atomic recovery. Evidence persistence, chain action, local fork replacement, queue |

## Assumptions and constraints

- Base-layer ordering and finality are authoritative for dispute state.
- Required calldata, signed history, messages, and state encodings remain available during the evidence window.
- Replay uses the same deterministic application semantics as ordinary validation.
- Multiple observers and participants may process the same dispute concurrently or after restart.

## Security considerations

Threats include false dispute claims, cross-channel/fork evidence, truncated proof suffixes, forged
acknowledgements, inconsistent off-chain/on-chain validators, evidence withholding, replay divergence,
order-dependent reduction, duplicate chain actions, and restart races. Audit must fail closed without
destroying evidence required for another honest participant to complete recovery.

## Verification and test plan

### Requirement test matrix

| Plan item                                                 | Requirements / invariants | Setup and stimulus                                                                                     | Expected result                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-dispute-pipe-1-t1"></a>`INV-DISPUTE-PIPE-1.T1` | `INV-DISPUTE-PIPE-1`      | Give independent auditors identical valid and invalid disputes in different delivery orders.           | Classification, offenders, survivor set, and successor commitments are identical.                 | <a id="inv-dispute-pipe-1-t1-p1"></a>`INV-DISPUTE-PIPE-1.T1.P1` — valid/invalid; <a id="inv-dispute-pipe-1-t1-p2"></a>`INV-DISPUTE-PIPE-1.T1.P2` — calldata/non-calldata; <a id="inv-dispute-pipe-1-t1-p3"></a>`INV-DISPUTE-PIPE-1.T1.P3` — delivery order; <a id="inv-dispute-pipe-1-t1-p4"></a>`INV-DISPUTE-PIPE-1.T1.P4` — restart.                           |
| <a id="req-dispute-pipe-1-t1"></a>`REQ-DISPUTE-PIPE-1.T1` | `REQ-DISPUTE-PIPE-1`      | Submit correct and substituted manager/channel/fork/dispute identities through local and chain intake. | Only exactly bound evidence enters audit; rejection leaves no partial dispute state.              | <a id="req-dispute-pipe-1-t1-p1"></a>`REQ-DISPUTE-PIPE-1.T1.P1` — local/chain; <a id="req-dispute-pipe-1-t1-p2"></a>`REQ-DISPUTE-PIPE-1.T1.P2` — each wrong identity; <a id="req-dispute-pipe-1-t1-p3"></a>`REQ-DISPUTE-PIPE-1.T1.P3` — duplicate/concurrent intake.                                                                                             |
| <a id="req-dispute-pipe-2-t1"></a>`REQ-DISPUTE-PIPE-2.T1` | `REQ-DISPUTE-PIPE-2`      | Corrupt or omit each audit layer independently and in representative combinations.                     | The first relevant invalid predicate is classified consistently and no later step legitimizes it. | <a id="req-dispute-pipe-2-t1-p1"></a>`REQ-DISPUTE-PIPE-2.T1.P1` — signatures/authorization; <a id="req-dispute-pipe-2-t1-p2"></a>`REQ-DISPUTE-PIPE-2.T1.P2` — linkage/boundaries; <a id="req-dispute-pipe-2-t1-p3"></a>`REQ-DISPUTE-PIPE-2.T1.P3` — replay/messages/time; <a id="req-dispute-pipe-2-t1-p4"></a>`REQ-DISPUTE-PIPE-2.T1.P4` — incomplete evidence. |
| <a id="req-dispute-pipe-3-t1"></a>`REQ-DISPUTE-PIPE-3.T1` | `REQ-DISPUTE-PIPE-3`      | Vary fraudulent, unavailable, honest, removed, and already-slashed participants and evidence order.    | The same survivor set, balances, messages, and successor fork result.                             | <a id="req-dispute-pipe-3-t1-p1"></a>`REQ-DISPUTE-PIPE-3.T1.P1` — each classification; <a id="req-dispute-pipe-3-t1-p2"></a>`REQ-DISPUTE-PIPE-3.T1.P2` — one/many offenders; <a id="req-dispute-pipe-3-t1-p3"></a>`REQ-DISPUTE-PIPE-3.T1.P3` — order permutations; <a id="req-dispute-pipe-3-t1-p4"></a>`REQ-DISPUTE-PIPE-3.T1.P4` — empty/minimum survivor set. |
| <a id="req-dispute-pipe-4-t1"></a>`REQ-DISPUTE-PIPE-4.T1` | `REQ-DISPUTE-PIPE-4`      | Fail and retry at persistence, chain submission, adoption, queue reset, and resumption boundaries.     | No split-brain fork or duplicate action occurs; recovery converges or remains safely retryable.   | <a id="req-dispute-pipe-4-t1-p1"></a>`REQ-DISPUTE-PIPE-4.T1.P1` — each failure boundary; <a id="req-dispute-pipe-4-t1-p2"></a>`REQ-DISPUTE-PIPE-4.T1.P2` — duplicate/retry; <a id="req-dispute-pipe-4-t1-p3"></a>`REQ-DISPUTE-PIPE-4.T1.P3` — restart; <a id="req-dispute-pipe-4-t1-p4"></a>`REQ-DISPUTE-PIPE-4.T1.P4` — concurrent observers.                   |

## Future Work

_Non-normative._ Define compact, interoperable audit transcripts for comparing independent implementations.
