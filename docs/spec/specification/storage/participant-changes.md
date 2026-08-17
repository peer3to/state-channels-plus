# Participant-Set Change-Point Store

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The module recording, per fork, the block heights at which the participant set
> changed. Shared storage rules: [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

State proofs crossing a membership change need a milestone hop at exactly the changing block
([state-proofs.md](../disputes/state-proofs.md), [`REQ-SP-3-SP1JG4`](../disputes/state-proofs.md#req-sp-3-sp1jg4)). This module records the change
points — per fork, the set of heights where the participant set changed — so proof construction can
enumerate the hops in a range without replaying history.

## Requirements and invariants

**<a id="req-pscstore-1-7bdtev"></a>`REQ-PSCSTORE-1-7BDTEV` — Complete ordered change points.** Recording a change point is idempotent per
(fork, height). Range reads return the change points ascending by height. Bounds are inclusive on
both ends; an open start defaults to the earliest recorded point, an open end to the latest. A
bounded range is meaningful only when its end exceeds its start — an equal or inverted pair returns
nothing, so a single height is read as part of a wider range, never alone. A missed change point
makes downstream proofs unbuildable, so the producing pipeline MUST record every
membership-changing block it commits.

## Assumptions and constraints

- What counts as a membership change is decided by the pipeline that executes the block; this
  module records positions only.
- Shared durability/retention rules: [durability.md](./durability.md); change points share the
  retention obligations of the proofs they enable.

## Security considerations

An omitted change point silently weakens the node's ability to build valid membership hops; an
extra one costs only proof size. The failure direction therefore matters more than the data's
secrecy — completeness is the security property.

## Verification and test plan

### Requirement test matrix

| Plan item                                                       | Requirements / invariants                                               | Setup and stimulus                                                                           | Expected result                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="req-pscstore-1-7bdtev.t1"></a>`REQ-PSCSTORE-1-7BDTEV.T1` | [`REQ-PSCSTORE-1-7BDTEV`](participant-changes.md#req-pscstore-1-7bdtev) | Record change points (with duplicates, out of order) and read ranges with every bound shape. | Ascending, deduplicated results; defaults honored; equal/inverted bounds return nothing. | <a id="req-pscstore-1-7bdtev.t1.p1"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P1` — out-of-order recording; <a id="req-pscstore-1-7bdtev.t1.p2"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P2` — open start defaults to earliest; <a id="req-pscstore-1-7bdtev.t1.p3"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P3` — equal and inverted bounds return nothing; <a id="req-pscstore-1-7bdtev.t1.p4"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P4` — per-fork isolation; <a id="req-pscstore-1-7bdtev.t1.p5"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P5` — duplicate recording idempotent; <a id="req-pscstore-1-7bdtev.t1.p6"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P6` — open end defaults to latest; <a id="req-pscstore-1-7bdtev.t1.p7"></a>`REQ-PSCSTORE-1-7BDTEV.T1.P7` — both-bounds read is inclusive of each end. |

## Future Work

_Non-normative._ None currently.
