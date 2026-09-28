# index.ts — Source Report

> **Source:** [src/cache/index.ts](../../../../../../src/cache/index.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [protocol/finality.md](../../../views/protocol/finality.md)

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

The `@/cache` module barrel: re-exports everything from
[SignerRecoveryCache](./SignerRecoveryCache.ts.md) and [EcrecoverCache](./EcrecoverCache.ts.md)
([#L1](../../../../../../src/cache/index.ts#L1), [#L2](../../../../../../src/cache/index.ts#L2)),
including their test-only reset and size helpers.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live in the two modules it re-exports._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                     |
| ------------ | -------------------------------------------- |
| Inputs       | None.                                        |
| Outputs      | The two modules' exports under one path.     |
| Owned state  | None (each module owns its own memo).        |
| Side effects | None.                                        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                      | Specification IDs |
| ------------------------------------------------ | ----------------- |
| [index.ts](../../../../../../src/cache/index.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Re-exporting does not create a second memo: ES module evaluation gives one instance of each
  module per thread, whether imported through this barrel or directly.

## Specification adherence

- No behavior of its own.

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

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [SignerRecoveryCache.ts](./SignerRecoveryCache.ts.md), [EcrecoverCache.ts](./EcrecoverCache.ts.md).
