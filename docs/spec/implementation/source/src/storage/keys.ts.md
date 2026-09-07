# keys.ts — Source Report

> **Source:** [keys.ts](../../../../../../src/storage/keys.ts#L1)  
> **Status:** Authored — engineer verification pending.  
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Represent a block location as its existing fork-and-height string key.

## Key design decisions

CoordinateKey gives maps domain meaning without changing runtime representation. Calldata storage adds its author suffix separately. See [keys.ts](../../../../../../src/storage/keys.ts#L1).

## Inputs, outputs, state, and side effects

Represent a block location as its existing fork-and-height string key. This helper does no validation or parsing. Callers supply valid fork IDs and heights; QueueStorage retains the inverse parser.

## Linked requirements

| Source file                                         | Specification IDs                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [keys.ts](../../../../../../src/storage/keys.ts#L1) | [`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d) |

This file contributes only its operation above; [BlockStorage.ts.md](BlockStorage.ts.md) owns the surrounding policy.

## Assumptions, dependencies, trust boundaries, and limits

This helper does no validation or parsing. Callers supply valid fork IDs and heights; QueueStorage retains the inverse parser.

## Specification adherence

The operation supports [`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d) within the caller-owned policy described above.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                  | Gap / divergence            |
| -------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`INV-BLKSTORE-1-MK4W8D`](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d) | Covered               | **Here:** Represent a block location as its existing fork-and-height string key. [keys.ts](../../../../../../src/storage/keys.ts#L1). **Other files:** [BlockStorage.ts.md](BlockStorage.ts.md) supplies the surrounding protocol policy. | None for this contribution. |

## Component test obligations

| Unit test ID                                                    | Obligation          | Public entry and setup                                                                                                            | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-keys-32-fmydft"></a>`UNIT-TEST-KEYS-32-FMYDFT` | Coordinate encoding | Use real fork hashes and zero/positive heights; output equals the original colon-joined representation and separates coordinates. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-keys-32-fmydft.p1"></a>`UNIT-TEST-KEYS-32-FMYDFT.P1` — preserves zero-height coordinates; <a id="unit-test-keys-32-fmydft.p2"></a>`UNIT-TEST-KEYS-32-FMYDFT.P2` — separates positive heights and fork identities |

## Related source reports

- [BlockStorage.ts.md](BlockStorage.ts.md)
