# keys.ts

> **Source:** [keys.ts](../../../../../../src/storage/keys.ts#L1)
>
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`INV-BLKSTORE-1-MK4W8D` (Index consistency)](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)

## UNIT-TEST-KEYS-32-FMYDFT

Coordinate encoding

- Setup: Use real fork hashes and zero/positive heights; output equals the original colon-joined representation and separates coordinates.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-KEYS-32-FMYDFT.P1` — preserves zero-height coordinates
- [x] `UNIT-TEST-KEYS-32-FMYDFT.P2` — separates positive heights and fork identities
