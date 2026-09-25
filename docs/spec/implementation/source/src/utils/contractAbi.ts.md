# contractAbi.ts

> **Source:** [src/utils/contractAbi.ts](../../../../../../src/utils/contractAbi.ts)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-CONTRACT-ARCH-1-9W5390` (Stable external boundary)](../../../../specification/enforcement/contracts.md#req-contract-arch-1-9w5390)
  Partial: This helper does not choose the manager surfaces.

## UNIT-TEST-CONTRACT-ABI-1-HW1A66

Stable ABI composition

- Setup: Merge real generated manager surfaces.
- Oracle: Complete fragments remain and duplicate identities appear once.

- [x] `UNIT-TEST-CONTRACT-ABI-1-HW1A66.P1` — callable/event completeness
- [x] `UNIT-TEST-CONTRACT-ABI-1-HW1A66.P2` — error-union completeness and uniqueness
