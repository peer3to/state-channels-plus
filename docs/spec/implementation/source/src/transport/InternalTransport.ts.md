# InternalTransport.ts

> **Source:** [src/transport/InternalTransport.ts](../../../../../../src/transport/InternalTransport.ts)
>
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2

Internal connection exclusion from network delivery and owned close settlement.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: Untyped network selection throws without sending or falling back to self. Repeated close emits once, rejects its held call once and clears timers while a sibling remains usable.

- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P1` — Rejects an internal transport passed to an untyped network request
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P2` — Rejects an internal transport passed to an untyped network send
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P3` — Rejects an internal transport passed to an untyped network recipient list
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P4` — Closes once and rejects only calls owned by that connection
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P5` — Sending after close rejects
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P6` — A supplied close reason reaches the pending caller unchanged
- [x] `UNIT-TEST-INTERNAL-TRANSPORT-1-3G1YG2.P7` — Both real port subscriptions are removed once
