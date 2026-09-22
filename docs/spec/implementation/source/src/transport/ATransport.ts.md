# ATransport.ts

> **Source:** [src/transport/ATransport.ts](../../../../../../src/transport/ATransport.ts)
>
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B

Neutral transport structural boundary.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: A real internal transport is recognized as neutral but has no peer-address, network type or peer manager metadata.

- [x] `UNIT-TEST-ATRANSPORT-NEUTRAL-1-M1EF2B.P1` — Has a neutral transport surface without network identity metadata
