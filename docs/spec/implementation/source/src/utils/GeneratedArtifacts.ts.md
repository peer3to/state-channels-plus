# GeneratedArtifacts.ts — Source Report

> **Source:** [src/utils/GeneratedArtifacts.ts](../../../../../../src/utils/GeneratedArtifacts.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

The generated contract-artifact bundle (ABIs/bytecode) — build output for platform-neutral loading;
never hand-edited. `errorAbis` is the single reachable-manager error union.

## Key design decisions

1. **Committed generated code** so browser bundles need no filesystem artifact loading.
2. **Generator-owned error inventory.** Its inputs include `StateProofFacet` and `UtilityFacet`, so
   the union contains `ECDSAInvalidSignature`, `ECDSAInvalidSignatureLength`, and
   `ECDSAInvalidSignatureS` without a second hand-maintained error list.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                | Specification IDs |
| -------------------------------------------------------------------------- | ----------------- |
| [GeneratedArtifacts.ts](../../../../../../src/utils/GeneratedArtifacts.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

Evidence for ECDSA membership maps to
[`UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P28`](evmErrorHandler.ts.md#unit-test-evm-error-handler-1-dp1mjf.p28);
this generated owner has no second test root.

## Related source reports

- Consumers per the views.
