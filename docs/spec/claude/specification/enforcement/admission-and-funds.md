# Admission and Funds Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module owning channel opening, post-open admission and top-up, deposit
> custody through the consumer adapter, and the inbound message-block append. Composition rules:
> [contracts.md](./contracts.md). Semantics owners: [lifecycle.md](../settlement/lifecycle.md),
> [cross-layer-messages.md](../settlement/cross-layer-messages.md).

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Entry points and validation obligations](#entry-points-and-validation-obligations)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

This module is the only path by which value and membership _enter_ a channel. Owned storage domain,
per channel: the inbound stream head (hash and height), persisted inbound message blocks,
cumulative `totalDeposits`, and — behind the integrator's consumer adapter — the escrowed assets
themselves. It appends to the inbound stream; it never processes the outbound stream (that is
[snapshot adoption](./snapshot-adoption.md)).

## Entry points and validation obligations

| Entry point                                   | Caller authorization                                  | Validation obligations (semantics owner)                                                                                                                                                                                                                                                                                        | Effect                                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open                                          | Any submitter carrying the unanimously signed terms   | Unique nonzero channel id, no duplicate participants, unanimous threshold signature over the canonical terms, ≥ 2 successful deposits, atomic/non-atomic composition per the terms ([lifecycle.md](../settlement/lifecycle.md))                                                                                                 | Stores the genesis snapshot (fork id = hash of genesis data), appends the genesis inbound `JOIN` block, escrows deposits, emits the opened event with genesis state. |
| Join                                          | The joining participant itself                        | Join not expired; submitter's expected fork and snapshot match current state (pinned-state rule of [join-authorization.md](../peer-communication/join-authorization.md)); participant not already in snapshot ∪ pending; fork not under dispute; participant's own signature plus the unanimous threshold of snapshot ∪ pending | Deposit via the adapter; appended inbound `JOIN` block advancing head and `totalDeposits`.                                                                           |
| Top-up                                        | The existing participant itself                       | Same expiry/pin checks; participant **is** in snapshot ∪ pending                                                                                                                                                                                                                                                                | Deposit; appended inbound `JOIN` block (balance semantics per the state machine's join-or-top-up rule, [state-machines.md](../protocol-model/state-machines.md)).    |
| Composable deposit / withdraw (internal-only) | The manager's own composition (`REQ-CONTRACT-ARCH-3`) | Delegation to the consumer adapter; atomic mode reverts the whole batch on any failure, non-atomic filters failures but requires ≥ 1 success                                                                                                                                                                                    | Escrow movement; inbound block construction.                                                                                                                         |

## Requirements and invariants

<a id="inv-enfadm-1"></a>
**INV-ENFADM-1 — Inbound append is the only membership/value entry.** Every deposit, join, and
top-up reaches the channel exclusively as an appended inbound message block, hash-linked to the
prior head with height +1 and cumulative totals advanced; no path mutates membership or
`totalDeposits` without the corresponding inbound block.

<a id="req-enfadm-1"></a>
**REQ-ENFADM-1 — Self-submission with pinned state.** Join and top-up MUST be submitted by the
affected participant itself, MUST carry the submitter's expected fork and snapshot, and MUST be
rejected when the current state has moved — the participant authorizes entry against exactly the
state it inspected.

<a id="req-enfadm-2"></a>
**REQ-ENFADM-2 — Membership-split correctness.** Join requires the participant absent from
snapshot ∪ pending and the fork undisputed; top-up requires it present. The two cases MUST NOT be
interchangeable through either entry point.

<a id="req-enfadm-3"></a>
**REQ-ENFADM-3 — Custody through the adapter only.** Asset custody is delegated to the integrator's
consumer adapter through the internal composition path exclusively; a failing adapter call MUST
fail the affected join per the composition mode with no partial escrow or unbacked inbound block.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                   |
| ----------------------- | ----------------------------------------------------------- |
| `INV-ENFADM-1`          | All membership/value entry is a hash-linked inbound append. |
| `REQ-ENFADM-1`          | Self-submitted, pinned-state joins and top-ups.             |
| `REQ-ENFADM-2`          | Join/top-up membership split enforced both ways.            |
| `REQ-ENFADM-3`          | Custody only via the adapter; no partial escrow.            |

## Assumptions and constraints

- The unanimity threshold and signature form come from [identity.md](../protocol-model/identity.md)
  and the shared validation rule (`REQ-CONTRACT-ARCH-2`).
- The consumer adapter is integrator code inside the trust boundary of escrowed funds; its
  obligations are part of the integration contract
  ([state-machines.md](../protocol-model/state-machines.md)).
- Off-chain application of appended blocks is settlement's inbound-inclusion obligation
  ([`REQ-IX-3`](../interactions.md#req-ix-3)); this module only guarantees the on-chain record.

## Security considerations

This module guards the channel's front door: forged admission (defeated by unanimity + self-
submission + identity binding), race-condition admission against a moved state (pinned-state rule),
double-entry (membership split), and unbacked balances (`INV-ENFADM-1` ties every claimed deposit
to an inbound block whose totals the balance invariant later audits). The adapter is the riskiest
dependency: it executes integrator code during deposit composition; atomicity rules bound the blast
radius to the submitted batch.

## Verification and test plan

### Requirement test matrix

| Plan item                                     | Requirements / invariants | Setup and stimulus                                                                                     | Expected result                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="inv-enfadm-1-t1"></a>`INV-ENFADM-1.T1` | `INV-ENFADM-1`            | Drive every entry path (open, join, top-up) and inspect the inbound chain and totals.                  | Each entry appends exactly one linked block with height +1 and exact cumulative totals; no other mutation path exists.                  | <a id="inv-enfadm-1-t1-p1"></a>`INV-ENFADM-1.T1.P1` — each entry path appends; <a id="inv-enfadm-1-t1-p2"></a>`INV-ENFADM-1.T1.P2` — linkage/height/totals exact; <a id="inv-enfadm-1-t1-p3"></a>`INV-ENFADM-1.T1.P3` — failed entry appends nothing.                                                                                                                    |
| <a id="req-enfadm-1-t1"></a>`REQ-ENFADM-1.T1` | `REQ-ENFADM-1`            | Submit joins/top-ups from wrong senders, with stale pins, expired deadlines, and correct submissions.  | Only self-submitted, currently pinned, unexpired submissions succeed.                                                                   | <a id="req-enfadm-1-t1-p1"></a>`REQ-ENFADM-1.T1.P1` — wrong submitter; <a id="req-enfadm-1-t1-p2"></a>`REQ-ENFADM-1.T1.P2` — moved snapshot/fork between pin and submission; <a id="req-enfadm-1-t1-p3"></a>`REQ-ENFADM-1.T1.P3` — deadline boundary; <a id="req-enfadm-1-t1-p4"></a>`REQ-ENFADM-1.T1.P4` — valid submission.                                            |
| <a id="req-enfadm-2-t1"></a>`REQ-ENFADM-2.T1` | `REQ-ENFADM-2`            | Join as an existing member; top-up as a non-member; join on a disputed fork; correct cases.            | The membership split and dispute gate hold in both directions.                                                                          | <a id="req-enfadm-2-t1-p1"></a>`REQ-ENFADM-2.T1.P1` — join with existing member rejected; <a id="req-enfadm-2-t1-p2"></a>`REQ-ENFADM-2.T1.P2` — top-up for non-member rejected; <a id="req-enfadm-2-t1-p3"></a>`REQ-ENFADM-2.T1.P3` — disputed-fork join rejected; <a id="req-enfadm-2-t1-p4"></a>`REQ-ENFADM-2.T1.P4` — pending participant handled per the union rule. |
| <a id="req-enfadm-3-t1"></a>`REQ-ENFADM-3.T1` | `REQ-ENFADM-3`            | Compose deposits with succeeding, failing, and reverting adapter calls in atomic and non-atomic modes. | Atomic mode all-or-nothing; non-atomic filters failures with ≥ 1 success required; no unbacked block or stranded escrow in any outcome. | <a id="req-enfadm-3-t1-p1"></a>`REQ-ENFADM-3.T1.P1` — atomic failure reverts whole batch; <a id="req-enfadm-3-t1-p2"></a>`REQ-ENFADM-3.T1.P2` — non-atomic partial success; <a id="req-enfadm-3-t1-p3"></a>`REQ-ENFADM-3.T1.P3` — all-fail rejected; <a id="req-enfadm-3-t1-p4"></a>`REQ-ENFADM-3.T1.P4` — adapter unreachable from external callers.                    |

## Future Work

_Non-normative._ Treasury destination for residual funds when a channel closes at zero
participants (open design note in the current snapshot-housekeeping path); admission-policy hooks
once the off-chain admission filter is decided ([OQ-10](../open-questions.md)).
