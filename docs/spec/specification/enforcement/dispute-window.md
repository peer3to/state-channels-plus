# Dispute-Window Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module owning dispute windows on-chain: upload and commitment
> bookkeeping, throttling, reduction and finalization, reduction challenge, and kill. Composition
> rules: [contracts.md](./contracts.md). Semantics owner: [disputes.md](../disputes/disputes.md)
> and [dispute-processing.md](../disputes/dispute-processing.md); this module states the
> enforcement-side responsibility, not the game's rules.

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Entry points and validation obligations](#entry-points-and-validation-obligations)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

Owned storage domain, per channel: the per-fork dispute-window map (creation and last-evidence
timestamps, dispute commitments, who has posted, reduced result), the disputed-fork list, and the
per-address upload throttle. The slash set is _read_ here as reduction input but _owned_ by the
[fraud-slashing module](./fraud-slashing.md).

## Entry points and validation obligations

| Entry point                                | Caller authorization                                                                                   | Validation obligations (semantics owner)                                                                                                                                                                                             | Effect                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload (with or without auditing calldata) | The disputer itself, dispute-eligible ([`REQ-DIS-2-PKVZ7E`](../disputes/disputes.md#req-dis-2-pkvz7e)) | Auditing-data hash binding when posted; timeout race checks; throttle (one window-opening upload per evidence period per address) and one post per participant per window; evidence-period admission (or fully-killed-window reopen) | Window created on first upload; commitment recorded immediately; kill period refreshed; events with or without auditing data.                                                                                |
| Full-threshold shortcut (within upload)    | —                                                                                                      | Unanimous confirmation over the on-chain threshold set                                                                                                                                                                               | Window force-expired, prior commitments dropped, the dispute's claimed output committed as the reduced result ([`REQ-DIS-*` §4.3](../disputes/disputes.md)).                                                 |
| Kill                                       | Any submitter carrying a valid dispute fraud proof (via [fraud-slashing](./fraud-slashing.md))         | Kill period open; dispute still committed                                                                                                                                                                                            | Commitment removed; disputer slashed.                                                                                                                                                                        |
| Reduce and finalize                        | Any submitter with the expected result                                                                 | Kill period expired; supplied set matches the committed set exactly; recomputed reduction matches the caller's expectation; idempotent on an existing matching result                                                                | Reduced result (successor fork id) committed; event emitted.                                                                                                                                                 |
| Challenge reduction                        | Any eligible submitter                                                                                 | Challenge period not expired; recomputation decides: wrong stored result → replace and slash the reducer; correct stored result → slash the challenger                                                                               | Result replaced or challenger slashed. Currently unreachable from the immediate-finalization commit paths — dormant pending the optimistic-reduction decision ([disputes.md §4.3](../disputes/disputes.md)). |

## Requirements and invariants

**<a id="inv-enfdis-1-1k65dt"></a>`INV-ENFDIS-1-1K65DT` — Commitment-exact reduction.** Reduction consumes exactly the currently committed
dispute set — no more, no fewer, no substitutes — and recomputes the result on-chain; a stored
result is replaced only through the specified challenge path.

**<a id="req-enfdis-1-8csa6b"></a>`REQ-ENFDIS-1-8CSA6B` — Window bookkeeping integrity.** Timestamps, commitments, and posting records
follow the owner's lifecycle exactly: immediate commitment on upload, kill-period refresh per
accepted upload, evidence-period admission, fully-killed-window reopen, and the full-threshold
force-expiry — with no other transition mutating a window.

**<a id="req-enfdis-2-vv9fpr"></a>`REQ-ENFDIS-2-VV9FPR` — Bounded participation.** The per-address throttle and the one-post-per-window
rule bound upload volume per identity; throttling MUST NOT block the first upload that opens a
fork's window when the address is otherwise eligible and unthrottled.

## Assumptions and constraints

- All period arithmetic uses chain time under the configured windows
  ([time.md](../protocol-model/time.md), [configuration.md](../runtime/configuration.md)).
- Reduction gas grows with the committed set and proof sizes; the immediate-finalization design
  trades that gas for latency — the optimistic alternative is future work owned by
  [disputes.md](../disputes/disputes.md).
- Eligibility, input validity, precedence, and convergence rules are the owner's; this module
  guarantees they are evaluated against exactly the recorded window state.

## Security considerations

The window store is the dispute game's memory: corrupting it rewrites who claimed what and when.
Threats: commitment substitution between upload and reduction ([`INV-ENFDIS-1-1K65DT`](dispute-window.md#inv-enfdis-1-1k65dt)), kill-order
manipulation perturbing the reduced set (the order-dependence concern tracked under
[`INV-DIS-5-J1QZ92`](../disputes/disputes.md#inv-dis-5-j1qz92)/[`OQ-4-JGDCNX`](../../verification/open-questions.md#oq-4-jgdcnx) — this module records; the
owner must resolve canonical ordering), spam via many identities (throttle is per-address only —
Sybil bounds come from dispute eligibility), and timestamp manipulation at period edges (chain
time is authoritative; boundary behavior per the owner's rules).

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                      | Setup and stimulus                                                                                                                           | Expected result                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="inv-enfdis-1-1k65dt.t1"></a>`INV-ENFDIS-1-1K65DT.T1` | [`INV-ENFDIS-1-1K65DT`](dispute-window.md#inv-enfdis-1-1k65dt) | Reduce with the exact set, supersets, subsets, substituted disputes, and after kills; attempt result replacement outside the challenge path. | Only the exact committed set reduces; results replace only via challenge; idempotent matching re-commits succeed. | <a id="inv-enfdis-1-1k65dt.t1.p1"></a>`INV-ENFDIS-1-1K65DT.T1.P1` — exact set; <a id="inv-enfdis-1-1k65dt.t1.p2"></a>`INV-ENFDIS-1-1K65DT.T1.P2` — superset rejected; <a id="inv-enfdis-1-1k65dt.t1.p3"></a>`INV-ENFDIS-1-1K65DT.T1.P3` — post-kill set; <a id="inv-enfdis-1-1k65dt.t1.p4"></a>`INV-ENFDIS-1-1K65DT.T1.P4` — idempotent re-finalize; <a id="inv-enfdis-1-1k65dt.t1.p5"></a>`INV-ENFDIS-1-1K65DT.T1.P5` — subset rejected; <a id="inv-enfdis-1-1k65dt.t1.p6"></a>`INV-ENFDIS-1-1K65DT.T1.P6` — substitute rejected; <a id="inv-enfdis-1-1k65dt.t1.p7"></a>`INV-ENFDIS-1-1K65DT.T1.P7` — mismatched expectation rejected.                                                                                                                                                                                                                |
| <a id="req-enfdis-1-8csa6b.t1"></a>`REQ-ENFDIS-1-8CSA6B.T1` | [`REQ-ENFDIS-1-8CSA6B`](dispute-window.md#req-enfdis-1-8csa6b) | Drive windows through every lifecycle transition, including reopen-after-full-kill and the threshold shortcut, probing each period boundary. | Exactly the specified transitions occur, each with correct timestamp effects at boundaries.                       | <a id="req-enfdis-1-8csa6b.t1.p1"></a>`REQ-ENFDIS-1-8CSA6B.T1.P1` — creation with immediate commitment; <a id="req-enfdis-1-8csa6b.t1.p2"></a>`REQ-ENFDIS-1-8CSA6B.T1.P2` — admission inside the evidence period; <a id="req-enfdis-1-8csa6b.t1.p3"></a>`REQ-ENFDIS-1-8CSA6B.T1.P3` — fully-killed reopen; <a id="req-enfdis-1-8csa6b.t1.p4"></a>`REQ-ENFDIS-1-8CSA6B.T1.P4` — threshold force-expiry; <a id="req-enfdis-1-8csa6b.t1.p5"></a>`REQ-ENFDIS-1-8CSA6B.T1.P5` — kill inside the kill period; <a id="req-enfdis-1-8csa6b.t1.p6"></a>`REQ-ENFDIS-1-8CSA6B.T1.P6` — kill-period refresh on a later accepted upload; <a id="req-enfdis-1-8csa6b.t1.p7"></a>`REQ-ENFDIS-1-8CSA6B.T1.P7` — admission after the evidence period rejected; <a id="req-enfdis-1-8csa6b.t1.p8"></a>`REQ-ENFDIS-1-8CSA6B.T1.P8` — kill after the kill period rejected. |
| <a id="req-enfdis-2-vv9fpr.t1"></a>`REQ-ENFDIS-2-VV9FPR.T1` | [`REQ-ENFDIS-2-VV9FPR`](dispute-window.md#req-enfdis-2-vv9fpr) | Upload from one address repeatedly, from many addresses, and as the first opener while throttled/unthrottled.                                | Bounds hold per identity; eligible unthrottled escalation is never blocked.                                       | <a id="req-enfdis-2-vv9fpr.t1.p1"></a>`REQ-ENFDIS-2-VV9FPR.T1.P1` — throttle window enforced; <a id="req-enfdis-2-vv9fpr.t1.p2"></a>`REQ-ENFDIS-2-VV9FPR.T1.P2` — one post per window; <a id="req-enfdis-2-vv9fpr.t1.p3"></a>`REQ-ENFDIS-2-VV9FPR.T1.P3` — first-open never wrongly throttled; <a id="req-enfdis-2-vv9fpr.t1.p4"></a>`REQ-ENFDIS-2-VV9FPR.T1.P4` — ineligible uploader rejected; <a id="req-enfdis-2-vv9fpr.t1.p5"></a>`REQ-ENFDIS-2-VV9FPR.T1.P5` — slashed uploader rejected.                                                                                                                                                                                                                                                                                                                                                        |

## Future Work

_Non-normative._ The optimistic-reduction path that would activate the dormant challenge flow
(owner's future work); canonical commitment ordering to close the kill-order perturbation concern
([`OQ-4-JGDCNX`](../../verification/open-questions.md#oq-4-jgdcnx)).
