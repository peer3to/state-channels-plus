# errorWire.ts

> **Source:** [src/rpc/internal/errorWire.ts](../../../../../../../src/rpc/internal/errorWire.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-ERROR-WIRE-1-ZWGJ00

Fail-safe codec

- Setup: Call `serializeError` and `deserializeError` on errors carrying hostile metadata
- Oracle: The message, name, and revert data survive; failing metadata becomes `undefined`; the codec never throws

- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P1` — ethers metadata whose `toJSON` throws is dropped and the message survives
- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P2` — delay data that cannot be cloned is dropped and the message survives
- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P3` — round-trips a thrown string
- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P4` — restores nested info.error.data as a decodable revert
- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P5` — restores VM return bytes as a decodable revert
- [x] `UNIT-TEST-ERROR-WIRE-1-ZWGJ00.P6` — preserves the custom error name and originating peer
