# DetachedPromises.ts

> **Source:** [src/utils/DetachedPromises.ts](../../../../../../src/utils/DetachedPromises.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-DETACHED-OBSERVE-1-VS9S55

Observable operation outcomes

- Setup: Use the real component and its normal collaborators, controlling only the named boundary.
- Oracle: The stated result holds without the forbidden side effect.

- [x] `UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P1` — collects fulfilled work without calling the error route
- [x] `UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P2` — routes the original rejection once and preserves it in the drain
