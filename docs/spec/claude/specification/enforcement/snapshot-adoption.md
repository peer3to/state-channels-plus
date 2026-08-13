# Snapshot-Adoption Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module owning the canonical on-chain snapshot and its advancement,
> including incremental outbound processing and withdrawal release. Composition rules:
> [contracts.md](./contracts.md). Semantics owners:
> [cross-layer-messages.md](../settlement/cross-layer-messages.md),
> [disputes.md](../disputes/disputes.md), [lifecycle.md](../settlement/lifecycle.md).

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Entry points and validation obligations](#entry-points-and-validation-obligations)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

Owned storage domain, per channel: the canonical snapshot, the processed outbound-stream position,
and cumulative `totalWithdrawals`. This module is the only path by which value _leaves_ the
channel and the only writer of the canonical snapshot after opening.

## Entry points and validation obligations

| Entry point                             | Caller authorization             | Validation obligations (semantics owner)                                                                                                                                                                                                                                                                                                                                                                                                       | Effect                                                                                                       |
| --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Same-fork advance                       | Any submitter carrying the proof | Same fork; strictly newer snapshot; milestone finality proof verifies ([state-proofs.md](../disputes/state-proofs.md) via the [proof-verification module](./proof-verification.md)); all pending inbound blocks consumed by the new snapshot                                                                                                                                                                                                   | Snapshot replaced; outbound range processed; housekeeping may clear consumed inbound and stale dispute data. |
| Successor-fork advance                  | Any submitter                    | New snapshot is its fork's genesis with the derived genesis timestamp; reachable from the current fork by following reduced-result links whose challenge periods expired ([`REQ-DIS-9-64WHCD`](../disputes/disputes.md#req-dis-9-64whcd)); idempotent no-op when already adopted                                                                                                                                                               | Snapshot replaced across one or more dispute generations; outbound range processed.                          |
| Outbound processing (within both paths) | —                                | Prune already-processed blocks; verify the linked range old-tip → new committed tip; process each message through its consumer semantics (exit → adapter withdrawal; unsupported types reject); enforce `totalWithdrawals ≤ totalDeposits` ([`INV-MSG-3-PCR3KT`](../settlement/cross-layer-messages.md#inv-msg-3-pcr3kt)/[`INV-MSG-4-6E5G7V`](../settlement/cross-layer-messages.md#inv-msg-4-6e5g7v)](../settlement/cross-layer-messages.md)) | Withdrawals released at most once; processed position and totals advanced; events emitted.                   |

## Requirements and invariants

**[`INV-ENFSNAP-1-9VZ2HE`](snapshot-adoption.md#inv-enfsnap-1-9vz2he) — Single monotone snapshot.** Each channel has exactly one canonical snapshot,
replaced only by the two proof paths, never regressing: same-fork advances require a strictly newer
snapshot, successor-fork advances only along uncontestable reduced-result links.

**[`REQ-ENFSNAP-1-FYN3BW`](snapshot-adoption.md#req-enfsnap-1-fyn3bw) — Coupled adoption and outbound processing.** A snapshot advance and its outbound
range processing are one atomic operation: the range MUST verify against both tips, already
processed blocks MUST be discarded not reprocessed, each withdrawal releases at most once, and a
failure anywhere (including a failing consumer withdrawal) reverts the entire advance.

**[`REQ-ENFSNAP-2-MGRCY8`](snapshot-adoption.md#req-enfsnap-2-mgrcy8) — Batch-split invariance.** Advancing in several smaller proof/range batches MUST
produce the same final snapshot, processed position, and totals as one combined advance.

**[`REQ-ENFSNAP-3-VD9T8A`](snapshot-adoption.md#req-enfsnap-3-vd9t8a) — Inbound-consumption gate.** A same-fork advance MUST demonstrate that the new
snapshot has consumed all inbound blocks pending at adoption, so admission cannot be silently
erased by advancing past it.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant                                 | Statement                                                 |
| ------------------------------------------------------- | --------------------------------------------------------- |
| <a id="inv-enfsnap-1-9vz2he"></a>`INV-ENFSNAP-1-9VZ2HE` | One canonical snapshot; monotone; two proof paths only.   |
| <a id="req-enfsnap-1-fyn3bw"></a>`REQ-ENFSNAP-1-FYN3BW` | Atomic advance+outbound processing; at-most-once release. |
| <a id="req-enfsnap-2-mgrcy8"></a>`REQ-ENFSNAP-2-MGRCY8` | Batch splits converge to the identical result.            |
| <a id="req-enfsnap-3-vd9t8a"></a>`REQ-ENFSNAP-3-VD9T8A` | Same-fork advances must consume pending inbound blocks.   |

## Assumptions and constraints

- Proof verification is delegated to the [proof-verification module](./proof-verification.md) and
  dispute-window state to the [dispute-window module](./dispute-window.md); this module composes
  their verdicts ([`REQ-CONTRACT-ARCH-2-BE651C`](contracts.md#req-contract-arch-2-be651c): shared validation, identical on every path).
- The consumer adapter executes during withdrawal release; a broken or malicious adapter blocking
  the advance is a known open question
  ([cross-layer-messages.md](../settlement/cross-layer-messages.md) — blocked-withdrawal handling).
- Gas bounds the range per transaction; [`REQ-ENFSNAP-2-MGRCY8`](snapshot-adoption.md#req-enfsnap-2-mgrcy8) is what makes that a cost knob rather than
  a correctness risk.

## Security considerations

Everything that leaves the channel passes here, so the adversarial submissions are: forged or
gapped outbound ranges (linkage verification), double-release across overlapping batches
(prune-then-process with at-most-once release), over-withdrawal (the deposits cap), regression or
sideways adoption (monotonicity and the two proof paths), and admission erasure (the inbound-
consumption gate). Housekeeping that clears consumed data must never clear anything a still-open
window could need — retention obligations mirror
[durability.md](../storage/durability.md) [`REQ-STOR-4-MF6FT6`](../storage/durability.md#req-stor-4-mf6ft6) on-chain.

## Verification and test plan

### Requirement test matrix

| Plan item                                                     | Requirements / invariants                                           | Setup and stimulus                                                                                                   | Expected result                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-enfsnap-1-9vz2he.t1"></a>`INV-ENFSNAP-1-9VZ2HE.T1` | [`INV-ENFSNAP-1-9VZ2HE`](snapshot-adoption.md#inv-enfsnap-1-9vz2he) | Attempt advances that regress, jump forks without links, follow contestable links, and valid advances on both paths. | Only the two valid paths mutate the snapshot; monotonicity holds; contestable links reject.                   | <a id="inv-enfsnap-1-9vz2he.t1.p1"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P1` — both valid paths; <a id="inv-enfsnap-1-9vz2he.t1.p2"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P2` — older snapshot rejected; <a id="inv-enfsnap-1-9vz2he.t1.p3"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P3` — unexpired challenge link rejected; <a id="inv-enfsnap-1-9vz2he.t1.p4"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P4` — multi-generation link walk; <a id="inv-enfsnap-1-9vz2he.t1.p5"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P5` — equal snapshot rejected; <a id="inv-enfsnap-1-9vz2he.t1.p6"></a>`INV-ENFSNAP-1-9VZ2HE.T1.P6` — idempotent re-adoption. |
| <a id="req-enfsnap-1-fyn3bw.t1"></a>`REQ-ENFSNAP-1-FYN3BW.T1` | [`REQ-ENFSNAP-1-FYN3BW`](snapshot-adoption.md#req-enfsnap-1-fyn3bw) | Advance with valid, overlapping, gapped, and consumer-failing outbound ranges.                                       | Atomicity holds; overlaps release nothing twice; gaps reject; a failing withdrawal reverts the whole advance. | <a id="req-enfsnap-1-fyn3bw.t1.p1"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P1` — valid range and release; <a id="req-enfsnap-1-fyn3bw.t1.p2"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P2` — overlap pruned; <a id="req-enfsnap-1-fyn3bw.t1.p3"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P3` — gapped range rejected; <a id="req-enfsnap-1-fyn3bw.t1.p4"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P4` — consumer failure reverts atomically; <a id="req-enfsnap-1-fyn3bw.t1.p5"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P5` — withdrawals-cap boundary; <a id="req-enfsnap-1-fyn3bw.t1.p6"></a>`REQ-ENFSNAP-1-FYN3BW.T1.P6` — non-linked range rejected.  |
| <a id="req-enfsnap-2-mgrcy8.t1"></a>`REQ-ENFSNAP-2-MGRCY8.T1` | [`REQ-ENFSNAP-2-MGRCY8`](snapshot-adoption.md#req-enfsnap-2-mgrcy8) | Perform equivalent advances as one batch and as several splits, including across dispute generations.                | Identical final snapshot, position, and totals for every split.                                               | <a id="req-enfsnap-2-mgrcy8.t1.p1"></a>`REQ-ENFSNAP-2-MGRCY8.T1.P1` — split permutations converge; <a id="req-enfsnap-2-mgrcy8.t1.p2"></a>`REQ-ENFSNAP-2-MGRCY8.T1.P2` — split across a fork transition; <a id="req-enfsnap-2-mgrcy8.t1.p3"></a>`REQ-ENFSNAP-2-MGRCY8.T1.P3` — minimal (single-block) batches.                                                                                                                                                                                                                                                                                 |
| <a id="req-enfsnap-3-vd9t8a.t1"></a>`REQ-ENFSNAP-3-VD9T8A.T1` | [`REQ-ENFSNAP-3-VD9T8A`](snapshot-adoption.md#req-enfsnap-3-vd9t8a) | Advance same-fork with pending inbound blocks consumed, partially consumed, and ignored by the new snapshot.         | Only fully consuming advances succeed.                                                                        | <a id="req-enfsnap-3-vd9t8a.t1.p1"></a>`REQ-ENFSNAP-3-VD9T8A.T1.P1` — fully consumed; <a id="req-enfsnap-3-vd9t8a.t1.p2"></a>`REQ-ENFSNAP-3-VD9T8A.T1.P2` — pending block ignored → rejected; <a id="req-enfsnap-3-vd9t8a.t1.p3"></a>`REQ-ENFSNAP-3-VD9T8A.T1.P3` — inbound arriving concurrently with the advance.                                                                                                                                                                                                                                                                            |

## Future Work

_Non-normative._ Resolve the zero-participant residual-funds destination; define which historical
data housekeeping may clear once retention policy is settled.
