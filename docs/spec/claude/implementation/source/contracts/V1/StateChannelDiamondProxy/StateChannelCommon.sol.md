# StateChannelCommon.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The shared base every facet inherits: storage access, slash-set maintenance (append + queries up
to timestamp), pending-participant derivation by walking unconsumed inbound JOINs, inbound/
outbound chain verification and application, snapshot/block linkage predicates, dispute-window
commitment helpers, threshold-set derivation, `canParticipateInDisputes`, block authenticity.

## Key design decisions

1. **Shared-validation-by-inheritance:** one implementation of every multi-path predicate — the pre-refactor mechanism for `REQ-CONTRACT-ARCH-2` (the planned refactor moves stateless pieces to libraries; the base is the named size offender).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------- |
| Inputs       | Internal calls from facets.                                                              |
| Outputs      | Predicates/derivations; storage mutations.                                               |
| Owned state  | Accessor to the shared layout (declares none itself beyond the inherited slot-0 layout). |
| Side effects | Slash-set appends, stream-head advances.                                                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                    | Specification IDs                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [StateChannelCommon.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol) | `REQ-CONTRACT-ARCH-2`, [`INV-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Inherited-layout discipline (facets stateless) is what keeps `delegatecall` sound.

## Specification adherence

- Identical predicate semantics on every path by construction; append-only slash set with timestamps ([`INV-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1) storage half).

## Specification contradictions

None demonstrated.

## Missing behavior

The size-reduction decomposition (612 lines / ~9.7KB compiled riding into every facet) — architecture future work.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                 | Implementation status | Evidence                                                                                                                                                                                            | Gap / divergence                                                |
| --------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `REQ-CONTRACT-ARCH-2`                                                                   | Covered               | **Here:** single inherited implementations of shared predicates.                                                                                                                                    | None (mechanism changes with the refactor, semantics must not). |
| [`INV-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1) | Covered               | **Here:** append-only slash storage + timestamp-bounded queries. **Other files:** writers in [FraudProofFacet](./FraudProofFacet.sol.md)/[DisputeFraudProofFacet](./DisputeFraudProofFacet.sol.md). | None.                                                           |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation        | Public entry and setup                                                   | Oracle and forbidden effects                                                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-channel-common-1"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1` | Shared predicates | Drive each shared predicate/derivation through two different facet paths | Identical classification per path; pending derivation matches unconsumed JOINs; slash queries respect timestamps | <a id="unit-test-state-channel-common-1.p1"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1.P1` — cross-path predicate agreement; <a id="unit-test-state-channel-common-1.p2"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1.P2` — pending-participant derivation; <a id="unit-test-state-channel-common-1.p3"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1.P3` — slash append/query bounds; <a id="unit-test-state-channel-common-1.p4"></a>`UNIT-TEST-STATE-CHANNEL-COMMON-1.P4` — authenticity predicate parity with client use |

## Related source reports

- All facet reports; [utils/DisputeUtils](./utils/DisputeUtils.sol.md), [utils/BlockUtils](./utils/BlockUtils.sol.md).
