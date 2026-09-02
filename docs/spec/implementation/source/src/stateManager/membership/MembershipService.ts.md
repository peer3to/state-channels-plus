# MembershipService.ts — Source Report

> **Source:** [src/stateManager/membership/MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [join channel](../../../../views/architecture/sdk/rpc/join-channel.md)

## Responsibility and observable boundary

Owns local membership lifecycle operations and authoritative on-chain participant/threshold reads.
It does not announce membership to peers or control connection admission.

## Key design decisions

1. **Chain observations are authoritative.** A successful join updates local status through the
   existing event/state flow; it sends no peer-supplied admission hint.
2. **Submitted joins require local protection.** The signer moves to `PENDING_PARTICIPANT` synchronously
   before the contract method is invoked. A proven failed receipt or decoded pre-submission rejection restores
   `SYNCED`; an uncertain submission keeps pending protection and reconciles against the on-chain union.
3. **Force join requires authoritative eligibility.** The height marker is retained until the signer appears
   in the on-chain participant union and the ordinary dispute window is usable. Later block triggers retry the
   check, while a stored started flag prevents duplicate dispute submission.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| Inputs       | Channel IDs, join confirmations, expected snapshot and fork commitments. |
| Outputs      | Participant/threshold sets and join completion or typed failure.         |
| Owned state  | No independent membership cache.                                         |
| Side effects | Join transaction, local status, and force-join bookkeeping.              |

## Linked requirements

| Source file                                                                                   | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts) | [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75), [`INV-TJOIN-2-H7JSQM`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm), [`REQ-TJOIN-3-DCZKS6`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6), [`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7) |

## Assumptions, dependencies, trust boundaries, and limits

- Contract reads and confirmed events define membership. Remote claims are not an authority.

## Specification adherence

- No membership-announcement path can bypass local-status handshake admission.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                                                                                                                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-AUTH-5-BQG9AG`](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag)                                                                                                                                                      | Covered               | **Here:** join completion has no peer announcement. **Other files:** [P2PManager](../../P2PManager.ts.md) owns local-status admission.                                                                                                                                                                                                               | None.            |
| [`INV-MEMBERSHIP-PENDING-1-2H1T75`](../../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75) / [`INV-TJOIN-2-H7JSQM`](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm) | Covered               | **Here:** status changes before contract invocation; only proven no-commitment failures restore `SYNCED`; uncertainty stays pending; force join checks authoritative membership and window eligibility and records its one start. **Other files:** [ForceJoinStorage](../../../storage/ForceJoinStorage.ts.md) retains the height and started state. | None.            |

## Component test obligations

| Unit test ID                                                                              | Obligation                                       | Public entry and setup                                                                                        | Oracle and forbidden effects                                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-membership-service-1-edfkzf"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF` | Submitted-pending membership and committed reuse | Drive first join, force-join eligibility, pending/participating reuse, and top-up through public signer paths | Pending starts before contract invocation; only proven no-commitment failure restores `SYNCED`; force join waits for authoritative eligibility and submits once at the exact trigger height; committed reuse sends zero or one transaction | <a id="unit-test-membership-service-1-edfkzf.p1"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P1` — failed receipt restores `SYNCED`; <a id="unit-test-membership-service-1-edfkzf.p2"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P2` — pending no-balance reuse; <a id="unit-test-membership-service-1-edfkzf.p3"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P3` — pending full-balance top-up; <a id="unit-test-membership-service-1-edfkzf.p4"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P4` — participating no-balance reuse; <a id="unit-test-membership-service-1-edfkzf.p5"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P5` — participating full-balance top-up; <a id="unit-test-membership-service-1-edfkzf.p6"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P6` — failure after pending preserves attachment; <a id="unit-test-membership-service-1-edfkzf.p7"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P7` — failure after participating preserves attachment; <a id="unit-test-membership-service-1-edfkzf.p8"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P8` — pending fault then failed receipt restores `SYNCED` without abort; <a id="unit-test-membership-service-1-edfkzf.p9"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P9` — pending fault then successful receipt produces on-chain pending membership and an inbound join message; <a id="unit-test-membership-service-1-edfkzf.p10"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P10` — local pending is observable before contract invocation; <a id="unit-test-membership-service-1-edfkzf.p11"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P11` — uncertain submission preserves pending status and force-join marker; <a id="unit-test-membership-service-1-edfkzf.p12"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P12` — force join defers while membership is absent and while the window is expired, then submits exactly once after later eligibility; <a id="unit-test-membership-service-1-edfkzf.p13"></a>`UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P13` — force join does not submit one block early and submits exactly once at `joinSubmissionHeight + current participant count + 1` |

## Related source reports

- [StateManager](../StateManager.ts.md), [P2PManager](../../P2PManager.ts.md).

## Targeted connect contribution

`joinChannel` remains the sole first-join transaction owner. It sets `PENDING_PARTICIPANT` before invoking
transaction submission. It restores `SYNCED` only when a decoded rejection or failed receipt proves no
commitment exists. An uncertain outcome keeps pending status and the force-join marker; an authoritative
on-chain membership read can reconcile it as success. A duplicate result proving the participant already
exists returns success while preserving pending state.
`topUpBalance` is the one receipt-gated update
for a supplied balance on pending or participating state; failure preserves that committed runtime. Omitted
balance reuse sends no transaction in the signer wrapper. This service never receives matcher `timeoutMs`.
# Terminal leave contribution

The fully signed exit path now waits for snapshot submission. If it fails, it preserves self-removal and starts the existing dispute path. This contributes to [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9).
