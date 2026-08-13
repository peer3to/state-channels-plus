# DeepCopyProxy.ts — Source Report

> **Source:** [src/utils/DeepCopyProxy.ts](../../../../../../../src/utils/DeepCopyProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

The defensive-copy proxy wrapping storage modules: method results (and inputs where applicable)
are deep-copied so callers cannot alias stored objects.

## Key design decisions

1. **Copy-at-the-boundary as a global policy** beats per-call discipline — the storage system's aliasing safety in 35 lines.

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

| Source file                                                         | Specification IDs |
| ------------------------------------------------------------------- | ----------------- |
| [DeepCopyProxy.ts](../../../../../../../src/utils/DeepCopyProxy.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Aliasing prevention backing the storage-fidelity edge ([`REQ-IX-9-AV56NR`](../../../../specification/storage/README.md#req-ix-9-av56nr)).

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

| Unit test ID                                                                        | Obligation     | Public entry and setup                                 | Oracle and forbidden effects                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-deep-copy-proxy-1-wwx3nz"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ` | Copy semantics | Mutate returned/stored objects through wrapped modules | No aliasing in either direction; nested structures copied | <a id="unit-test-deep-copy-proxy-1-wwx3nz.p1"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P1` — result mutation isolated; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p2"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P2` — input mutation isolated; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p3"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P3` — nested handling; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p4"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P4` — cyclic handling |

## Related source reports

- [Storage](../storage/Storage.ts.md).
