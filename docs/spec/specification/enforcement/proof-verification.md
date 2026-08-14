# Proof-Verification Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module exposing the protocol's verification predicates — state proofs,
> milestone finality, block linkage and structure, threshold signatures, and the channel-balance
> invariant — as reusable, side-effect-free checks. Composition rules:
> [contracts.md](./contracts.md). Semantics owners: [state-proofs.md](../disputes/state-proofs.md),
> [finality.md](../protocol-model/finality.md),
> [cross-layer-messages.md](../settlement/cross-layer-messages.md).

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Predicate inventory](#predicate-inventory)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

Owned state: none. Every predicate is a pure or read-only function of its inputs plus committed
channel state. That statelessness is what makes the module the primary payload of the
[local mirror](./local-mirror.md): the same predicates run as the client's local check engine, and
[`INV-MIRROR-1-VAF778`](local-mirror.md#inv-mirror-1-vaf778) forbids reimplementing them anywhere else.

## Predicate inventory

| Predicate family            | Verifies (semantics owner)                                                                                                                                                                                               | Consumed by                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| State-proof verification    | The full claimed-latest-state proof against auditing data; header consistency; correct latest state ([state-proofs.md](../disputes/state-proofs.md))                                                                     | Dispute audit and adjudication; sync verification (locally).                                                                        |
| Milestone finality          | Direct and virtual finality per milestone, membership-union thresholds across hops, skipped milestones below the snapshot ([state-proofs.md](../disputes/state-proofs.md), [finality.md](../protocol-model/finality.md)) | Same-fork snapshot advance; dispute audit; sync.                                                                                    |
| Block linkage and structure | Hash linkage plus author signatures on the non-final suffix; per-block structural validity with first-invalid-index reporting                                                                                            | State-proof verification; dispute fraud proofs.                                                                                     |
| Threshold signatures        | Unanimous threshold over a canonical encoding with per-signer deduplication ([identity.md](../protocol-model/identity.md))                                                                                               | Opening, admission, dispute finalization, milestone checks.                                                                         |
| Balance invariant           | Aggregate soundness: total deposits equal total withdrawals plus in-state balances ([cross-layer-messages.md](../settlement/cross-layer-messages.md) §6)                                                                 | Sync verification (client-side); prospective on-chain use is [`OQ-19-Y8FDQX`](../../implementation/open-questions.md#oq-19-y8fdqx). |
| Snapshot/genesis shape      | Genesis identity (fork id = hash of genesis data), snapshot ordering                                                                                                                                                     | Adoption paths; sync.                                                                                                               |

**Known constraint (current behavior).** The state-proof checks accept a proof carrying milestones
_or_ trailing signed blocks, and reject one carrying both — the non-final suffix must ride inside
the last milestone's confirmations on that path. Whether that exclusivity is intended or
incidental needs an engineer decision before implementations diverge on it; flagged with the
state-proof open questions.

## Requirements and invariants

**<a id="inv-enfproof-1-dr1n9b"></a>`INV-ENFPROOF-1-DR1N9B` — Side-effect-free verification.** No predicate mutates channel state, emits
protocol events, or depends on caller identity; a predicate's verdict is a pure function of its
inputs and committed state, equal for every caller and every evaluation context satisfying the
[mirror equivalence constraints](./local-mirror.md).

**[`REQ-ENFPROOF-1-RH4WEM`](proof-verification.md#req-enfproof-1-rh4wem) — Single verification authority.** Every consumer — adoption, adjudication,
fraud enforcement, and off-chain audit — MUST verify through these predicates; no consumer may
carry a private variant of any check they cover ([`REQ-CONTRACT-ARCH-2-BE651C`](contracts.md#req-contract-arch-2-be651c) on-chain,
[`INV-MIRROR-1-VAF778`](local-mirror.md#inv-mirror-1-vaf778) off-chain).

**<a id="req-enfproof-2-yzdcxm"></a>`REQ-ENFPROOF-2-YZDCXM` — Deduplicated threshold counting.** Threshold verification MUST count each
distinct recovered signer at most once, over exactly the canonical encoding, against exactly the
required set; signature-encoding malleability MUST NOT yield double counting
([identity.md](../protocol-model/identity.md)).

**<a id="req-enfproof-3-eedr2y"></a>`REQ-ENFPROOF-3-EEDR2Y` — Falsifying detail on failure.** Structural predicates MUST report enough detail
to act on a failure objectively (e.g. the first invalid block index), so fraud-proof construction
can cite the exact violation rather than re-deriving it.

## Assumptions and constraints

- Verification cost is gas-bounded on-chain; proof sizes are constrained by the owning documents'
  bounds ([state-proofs.md](../disputes/state-proofs.md)).
- Predicates evaluate committed state as-is; whether that state is fresh is the caller's problem
  (on-chain it always is; locally see [`REQ-MIRROR-3-THD7K8`](local-mirror.md#req-mirror-3-thd7k8)).
- The milestone-XOR-suffix constraint above is normative _as current behavior_ pending the
  engineer decision.

## Security considerations

These predicates are the protocol's judiciary: an unsound acceptance forges history, an unsound
rejection censors valid claims, and a side effect would turn verification into an attack surface.
Threats: crafted proofs targeting boundary conditions (empty proofs, genesis anchoring, membership
hops), signature malleability against threshold counts, gas-exhaustion proofs sized to pass
locally and fail on-chain (bounded input rules), and divergence between consumers (excluded by
<a id="req-enfproof-1-rh4wem"></a>`REQ-ENFPROOF-1-RH4WEM` — one authority, everywhere).

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                              | Setup and stimulus                                                                                              | Expected result                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-enfproof-1-dr1n9b.t1"></a>`INV-ENFPROOF-1-DR1N9B.T1` | [`INV-ENFPROOF-1-DR1N9B`](proof-verification.md#inv-enfproof-1-dr1n9b) | Evaluate every predicate from distinct callers and contexts, inspecting state and events before/after.          | Verdicts are caller-independent; zero state or event effects.             | <a id="inv-enfproof-1-dr1n9b.t1.p1"></a>`INV-ENFPROOF-1-DR1N9B.T1.P1` — state-proof verification, no effects; <a id="inv-enfproof-1-dr1n9b.t1.p2"></a>`INV-ENFPROOF-1-DR1N9B.T1.P2` — caller independence; <a id="inv-enfproof-1-dr1n9b.t1.p3"></a>`INV-ENFPROOF-1-DR1N9B.T1.P3` — repeated evaluation stability; <a id="inv-enfproof-1-dr1n9b.t1.p4"></a>`INV-ENFPROOF-1-DR1N9B.T1.P4` — milestone finality, no effects; <a id="inv-enfproof-1-dr1n9b.t1.p5"></a>`INV-ENFPROOF-1-DR1N9B.T1.P5` — block linkage/structure, no effects; <a id="inv-enfproof-1-dr1n9b.t1.p6"></a>`INV-ENFPROOF-1-DR1N9B.T1.P6` — threshold signatures, no effects; <a id="inv-enfproof-1-dr1n9b.t1.p7"></a>`INV-ENFPROOF-1-DR1N9B.T1.P7` — balance invariant, no effects; <a id="inv-enfproof-1-dr1n9b.t1.p8"></a>`INV-ENFPROOF-1-DR1N9B.T1.P8` — snapshot/genesis shape, no effects. |
| <a id="req-enfproof-1-rh4wem.t1"></a>`REQ-ENFPROOF-1-RH4WEM.T1` | [`REQ-ENFPROOF-1-RH4WEM`](proof-verification.md#req-enfproof-1-rh4wem) | Present one artifact (proof, threshold, range) to every consuming path on-chain and through the mirror.         | Identical verdicts on every path for valid and invalid artifacts.         | <a id="req-enfproof-1-rh4wem.t1.p1"></a>`REQ-ENFPROOF-1-RH4WEM.T1.P1` — adoption path agrees; <a id="req-enfproof-1-rh4wem.t1.p2"></a>`REQ-ENFPROOF-1-RH4WEM.T1.P2` — local mirror agrees under the equivalence constraints; <a id="req-enfproof-1-rh4wem.t1.p3"></a>`REQ-ENFPROOF-1-RH4WEM.T1.P3` — invalid artifact rejected identically everywhere; <a id="req-enfproof-1-rh4wem.t1.p4"></a>`REQ-ENFPROOF-1-RH4WEM.T1.P4` — adjudication path agrees; <a id="req-enfproof-1-rh4wem.t1.p5"></a>`REQ-ENFPROOF-1-RH4WEM.T1.P5` — fraud-enforcement path agrees.                                                                                                                                                                                                                                                                                                     |
| <a id="req-enfproof-2-yzdcxm.t1"></a>`REQ-ENFPROOF-2-YZDCXM.T1` | [`REQ-ENFPROOF-2-YZDCXM`](proof-verification.md#req-enfproof-2-yzdcxm) | Verify thresholds with duplicate signers, malleated encodings, non-members, missing members, and the exact set. | Only the exact deduplicated set passes; malleability never double-counts. | <a id="req-enfproof-2-yzdcxm.t1.p1"></a>`REQ-ENFPROOF-2-YZDCXM.T1.P1` — duplicate signer counted once; <a id="req-enfproof-2-yzdcxm.t1.p2"></a>`REQ-ENFPROOF-2-YZDCXM.T1.P2` — malleated signature; <a id="req-enfproof-2-yzdcxm.t1.p3"></a>`REQ-ENFPROOF-2-YZDCXM.T1.P3` — non-member signer; <a id="req-enfproof-2-yzdcxm.t1.p4"></a>`REQ-ENFPROOF-2-YZDCXM.T1.P4` — membership-union hop thresholds; <a id="req-enfproof-2-yzdcxm.t1.p5"></a>`REQ-ENFPROOF-2-YZDCXM.T1.P5` — missing member.                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-enfproof-3-eedr2y.t1"></a>`REQ-ENFPROOF-3-EEDR2Y.T1` | [`REQ-ENFPROOF-3-EEDR2Y`](proof-verification.md#req-enfproof-3-eedr2y) | Submit proofs with a known first structural violation at varied positions.                                      | The reported detail identifies exactly the injected violation.            | <a id="req-enfproof-3-eedr2y.t1.p1"></a>`REQ-ENFPROOF-3-EEDR2Y.T1.P1` — violation at the first position; <a id="req-enfproof-3-eedr2y.t1.p2"></a>`REQ-ENFPROOF-3-EEDR2Y.T1.P2` — multiple violations report the first; <a id="req-enfproof-3-eedr2y.t1.p3"></a>`REQ-ENFPROOF-3-EEDR2Y.T1.P3` — valid proof reports none; <a id="req-enfproof-3-eedr2y.t1.p4"></a>`REQ-ENFPROOF-3-EEDR2Y.T1.P4` — violation at a middle position; <a id="req-enfproof-3-eedr2y.t1.p5"></a>`REQ-ENFPROOF-3-EEDR2Y.T1.P5` — violation at the last position.                                                                                                                                                                                                                                                                                                                            |

## Future Work

_Non-normative._ Resolve the milestone-XOR-suffix exclusivity; on-chain balance-invariant
enforcement at snapshot update ([`OQ-19-Y8FDQX`](../../implementation/open-questions.md#oq-19-y8fdqx)); proof-size/gas budget table per
predicate for deployment planning.
