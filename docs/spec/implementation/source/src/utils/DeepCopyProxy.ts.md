# DeepCopyProxy.ts — Source Report

> **Source:** [src/utils/DeepCopyProxy.ts](../../../../../../src/utils/DeepCopyProxy.ts) > **Status:** Authored — engineer verification pending.
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
2. **Generator results are deliberately returned unwrapped** ([DeepCopyProxy.ts L19-25](../../../../../../src/utils/DeepCopyProxy.ts#L19-L25)) — deep-copying the generator object itself would destroy it, so the code returns it as-is. The rationale is sound but the consequence is not: the values it goes on to yield are never copied either, which is [`FIND-STORAGE-6-MT9Z2D`](../../../../audit/open-findings.md#find-storage-6-mt9z2d).

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

| Source file                                                      | Specification IDs                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [DeepCopyProxy.ts](../../../../../../src/utils/DeepCopyProxy.ts) | [`REQ-STOR-6-SKP0KM`](../../../../specification/storage/durability.md#req-stor-6-skp0km) — owns the copy-on-write/copy-on-read boundary for every store module, and is the single place the sequential-read exemption is introduced. |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Aliasing prevention backing the storage-fidelity edge ([`REQ-IX-9-AV56NR`](../../../../specification/interactions.md#req-ix-9-av56nr)).

## Specification contradictions

- [`REQ-STOR-6-SKP0KM`](../../../../specification/storage/durability.md#req-stor-6-skp0km) requires
  value semantics for every read shape, sequential entry-at-a-time reads included. The generator
  branch ([L19-25](../../../../../../src/utils/DeepCopyProxy.ts#L19-L25)) returns the generator
  untouched, so values yielded by `getIterator` alias store state and can be mutated without an
  explicit store operation — [`FIND-STORAGE-6-MT9Z2D`](../../../../audit/open-findings.md#find-storage-6-mt9z2d).

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                  | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap / divergence                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-STOR-6-SKP0KM`](../../../../specification/storage/durability.md#req-stor-6-skp0km) | `Contradicts`         | **Here:** arguments are deep-copied before the call and non-generator results deep-copied after ([L14-18](../../../../../../src/utils/DeepCopyProxy.ts#L14-L18), [L27-28](../../../../../../src/utils/DeepCopyProxy.ts#L27-L28)), which satisfies the rule for reads by key, coordinates, range, and index; the generator branch ([L19-25](../../../../../../src/utils/DeepCopyProxy.ts#L19-L25)) exempts sequential reads. **Other files:** [Storage.ts.md](../storage/Storage.ts.md) wraps every module in this proxy; [BlockStorage.ts.md](../storage/BlockStorage.ts.md) and [MessageBlockStorage.ts.md](../storage/MessageBlockStorage.ts.md) own the two generators reached through it. | Values yielded by a store generator are not copied, so a caller can mutate stored state without a store operation ([`FIND-STORAGE-6-MT9Z2D`](../../../../audit/open-findings.md#find-storage-6-mt9z2d)). |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                        | Obligation     | Public entry and setup                                 | Oracle and forbidden effects                              | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-deep-copy-proxy-1-wwx3nz"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ` | Copy semantics | Mutate returned/stored objects through wrapped modules | No aliasing in either direction; nested structures copied | <a id="unit-test-deep-copy-proxy-1-wwx3nz.p1"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P1` — result mutation isolated; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p2"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P2` — input mutation isolated; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p3"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P3` — nested handling; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p4"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P4` — cyclic handling; <a id="unit-test-deep-copy-proxy-1-wwx3nz.p5"></a>`UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P5` — a wrapped method returning a generator: the generator still works lazily and each yielded value is isolated from store state |

## Related source reports

- [Storage](../storage/Storage.ts.md).
