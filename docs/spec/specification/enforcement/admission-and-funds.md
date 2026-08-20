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

| Entry point                                   | Caller authorization                                                                                    | Validation obligations (semantics owner)                                                                                                                                                                                                                                                                                                                               | Effect                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open                                          | Any submitter carrying the unanimously signed terms                                                     | Unique nonzero channel id, no duplicate participants, unanimous threshold signature over the canonical terms, ≥ 2 successful deposits, atomic/non-atomic composition per the terms ([lifecycle.md](../settlement/lifecycle.md))                                                                                                                                        | Stores the genesis snapshot (fork id = hash of genesis data), appends the genesis inbound `JOIN` block, escrows deposits, emits the opened event with genesis state. |
| Join                                          | The joining participant itself                                                                          | Join not expired; submitter's expected fork and snapshot match current state (pinned-state rule of [join-authorization.md](../peer-communication/join-authorization.md)); participant not already in snapshot ∪ pending; fork not under dispute; participant's own signature plus the unanimous current eligibility threshold: (snapshot ∪ pending) − on-chain-slashed | Deposit via the adapter; appended inbound `JOIN` block advancing head and `totalDeposits`.                                                                           |
| Top-up                                        | The existing, unslashed participant itself                                                              | Same expiry/pin checks; participant **is** in snapshot ∪ pending and is not on-chain-slashed; countersignatures cover the same current eligibility threshold                                                                                                                                                                                                           | Deposit; appended inbound `JOIN` block (balance semantics per the state machine's join-or-top-up rule, [state-machines.md](../protocol-model/state-machines.md)).    |
| Composable deposit / withdraw (internal-only) | The manager's own composition ([`REQ-CONTRACT-ARCH-3-GEGD78`](contracts.md#req-contract-arch-3-gegd78)) | Delegation to the consumer adapter; atomic mode reverts the whole batch on any failure, non-atomic filters failures but requires ≥ 1 success                                                                                                                                                                                                                           | Escrow movement; inbound block construction.                                                                                                                         |

## Requirements and invariants

**<a id="inv-enfadm-1-h53aqy"></a>`INV-ENFADM-1-H53AQY` — Inbound append is the only membership/value entry.** Every deposit, join, and
top-up reaches the channel exclusively as an appended inbound message block, hash-linked to the
prior head with height +1 and cumulative totals advanced; no path mutates membership or
`totalDeposits` without the corresponding inbound block.

**<a id="req-enfadm-1-v926ca"></a>`REQ-ENFADM-1-V926CA` — Self-submission with pinned state.** Join and top-up MUST be submitted by the
affected participant itself, MUST carry the submitter's expected fork and snapshot, and MUST be
rejected when the current state has moved — the participant authorizes entry against exactly the
state it inspected. The countersignature set MUST be the current eligibility set: snapshot
participants ∪ pending participants, minus on-chain-slashed participants. A slashed participant
MUST NOT be able to veto a later admission.

**<a id="req-enfadm-2-k6k9sp"></a>`REQ-ENFADM-2-K6K9SP` — Membership-split correctness.** Join requires the participant absent from
snapshot ∪ pending and the fork undisputed; top-up requires it present and not on-chain-slashed. A
slashed participant remains recorded as a member but MUST NOT top up. The two cases MUST NOT be
interchangeable through either entry point.

**<a id="req-enfadm-3-6a3beb"></a>`REQ-ENFADM-3-6A3BEB` — Custody through the adapter only.** Asset custody is delegated to the integrator's
consumer adapter through the internal composition path exclusively; a failing adapter call MUST
fail the affected join per the composition mode with no partial escrow or unbacked inbound block.

## Assumptions and constraints

- The unanimity threshold and signature form come from [identity.md](../protocol-model/identity.md)
  and the shared validation rule ([`REQ-CONTRACT-ARCH-2-BE651C`](contracts.md#req-contract-arch-2-be651c)).
- The consumer adapter is integrator code inside the trust boundary of escrowed funds; its
  obligations are part of the integration contract
  ([state-machines.md](../protocol-model/state-machines.md)).
- Off-chain application of appended blocks is settlement's inbound-inclusion obligation
  ([`REQ-IX-3-H8WCVY`](../interactions.md#req-ix-3-h8wcvy)); this module only guarantees the on-chain record.

## Security considerations

This module guards the channel's front door: forged admission (defeated by unanimity + self-
submission + identity binding), race-condition admission against a moved state (pinned-state rule),
veto by an already-slashed participant (slash-excluding eligibility), deposits by slashed
participants, double-entry (membership split), and unbacked balances ([`INV-ENFADM-1-H53AQY`](admission-and-funds.md#inv-enfadm-1-h53aqy) ties every claimed deposit
to an inbound block whose totals the balance invariant later audits). The adapter is the riskiest
dependency: it executes integrator code during deposit composition; atomicity rules bound the blast
radius to the submitted batch.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                           | Setup and stimulus                                                                                                                   | Expected result                                                                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="inv-enfadm-1-h53aqy.t1"></a>`INV-ENFADM-1-H53AQY.T1` | [`INV-ENFADM-1-H53AQY`](admission-and-funds.md#inv-enfadm-1-h53aqy) | Drive every entry path (open, join, top-up) and inspect the inbound chain and totals.                                                | Each entry appends exactly one linked block with height +1 and exact cumulative totals; no other mutation path exists.                  | <a id="inv-enfadm-1-h53aqy.t1.p1"></a>`INV-ENFADM-1-H53AQY.T1.P1` — open appends; <a id="inv-enfadm-1-h53aqy.t1.p2"></a>`INV-ENFADM-1-H53AQY.T1.P2` — linkage/height/totals exact; <a id="inv-enfadm-1-h53aqy.t1.p3"></a>`INV-ENFADM-1-H53AQY.T1.P3` — failed entry appends nothing; <a id="inv-enfadm-1-h53aqy.t1.p4"></a>`INV-ENFADM-1-H53AQY.T1.P4` — join appends; <a id="inv-enfadm-1-h53aqy.t1.p5"></a>`INV-ENFADM-1-H53AQY.T1.P5` — top-up appends.                                                                                                                                                                                                                                                                                                                                       |
| <a id="req-enfadm-1-v926ca.t1"></a>`REQ-ENFADM-1-V926CA.T1` | [`REQ-ENFADM-1-V926CA`](admission-and-funds.md#req-enfadm-1-v926ca) | Submit joins/top-ups from wrong senders, with stale pins, expired deadlines, a slashed current participant, and correct submissions. | Only self-submitted, currently pinned, unexpired submissions with countersignatures from every currently eligible participant succeed.  | <a id="req-enfadm-1-v926ca.t1.p1"></a>`REQ-ENFADM-1-V926CA.T1.P1` — wrong submitter; <a id="req-enfadm-1-v926ca.t1.p2"></a>`REQ-ENFADM-1-V926CA.T1.P2` — moved snapshot between pin and submission; <a id="req-enfadm-1-v926ca.t1.p3"></a>`REQ-ENFADM-1-V926CA.T1.P3` — submission at the exact deadline succeeds; <a id="req-enfadm-1-v926ca.t1.p4"></a>`REQ-ENFADM-1-V926CA.T1.P4` — valid submission; <a id="req-enfadm-1-v926ca.t1.p5"></a>`REQ-ENFADM-1-V926CA.T1.P5` — join after an on-chain slash succeeds without the slashed participant's countersignature; <a id="req-enfadm-1-v926ca.t1.p6"></a>`REQ-ENFADM-1-V926CA.T1.P6` — moved fork between pin and submission; <a id="req-enfadm-1-v926ca.t1.p7"></a>`REQ-ENFADM-1-V926CA.T1.P7` — submission after the deadline is rejected. |
| <a id="req-enfadm-2-k6k9sp.t1"></a>`REQ-ENFADM-2-K6K9SP.T1` | [`REQ-ENFADM-2-K6K9SP`](admission-and-funds.md#req-enfadm-2-k6k9sp) | Join as an existing member; top-up as a non-member or slashed member; join on a disputed fork; correct cases.                        | The membership, top-up eligibility, and dispute gates hold in both directions.                                                          | <a id="req-enfadm-2-k6k9sp.t1.p1"></a>`REQ-ENFADM-2-K6K9SP.T1.P1` — join with existing member rejected; <a id="req-enfadm-2-k6k9sp.t1.p2"></a>`REQ-ENFADM-2-K6K9SP.T1.P2` — top-up for non-member rejected; <a id="req-enfadm-2-k6k9sp.t1.p3"></a>`REQ-ENFADM-2-K6K9SP.T1.P3` — disputed-fork join rejected; <a id="req-enfadm-2-k6k9sp.t1.p4"></a>`REQ-ENFADM-2-K6K9SP.T1.P4` — pending participant's join rejected per the union rule; <a id="req-enfadm-2-k6k9sp.t1.p5"></a>`REQ-ENFADM-2-K6K9SP.T1.P5` — pending participant's top-up accepted per the union rule; <a id="req-enfadm-2-k6k9sp.t1.p6"></a>`REQ-ENFADM-2-K6K9SP.T1.P6` — on-chain-slashed participant's top-up rejected before deposit.                                                                                        |
| <a id="req-enfadm-3-6a3beb.t1"></a>`REQ-ENFADM-3-6A3BEB.T1` | [`REQ-ENFADM-3-6A3BEB`](admission-and-funds.md#req-enfadm-3-6a3beb) | Compose deposits with succeeding, failing, and reverting adapter calls in atomic and non-atomic modes.                               | Atomic mode all-or-nothing; non-atomic filters failures with ≥ 1 success required; no unbacked block or stranded escrow in any outcome. | <a id="req-enfadm-3-6a3beb.t1.p1"></a>`REQ-ENFADM-3-6A3BEB.T1.P1` — atomic failure reverts whole batch; <a id="req-enfadm-3-6a3beb.t1.p2"></a>`REQ-ENFADM-3-6A3BEB.T1.P2` — non-atomic partial success; <a id="req-enfadm-3-6a3beb.t1.p3"></a>`REQ-ENFADM-3-6A3BEB.T1.P3` — all-fail rejected; <a id="req-enfadm-3-6a3beb.t1.p4"></a>`REQ-ENFADM-3-6A3BEB.T1.P4` — adapter unreachable from external callers.                                                                                                                                                                                                                                                                                                                                                                                    |

## Future Work

_Non-normative._ Treasury destination for residual funds when a channel closes at zero
participants (open design note in the current snapshot-housekeeping path); admission-policy hooks
once the off-chain admission filter is decided ([`OQ-10-04YNC4`](../open-questions.md#oq-10-04ync4)).
