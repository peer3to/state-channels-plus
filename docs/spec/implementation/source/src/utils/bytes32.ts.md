# bytes32.ts

> **Source:** [bytes32.ts](../../../../../../src/utils/bytes32.ts#L1)
>
> **Design views:** [components.md](../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)

## UNIT-TEST-BYTES32-32-E6KC18

Bytes32 validation only

- Setup: Call requireBytes32 with undefined and valid zero hash; compare exact supplied error message and void return.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-BYTES32-32-E6KC18.P1` — uses the caller message for undefined bytes32 input
- [x] `UNIT-TEST-BYTES32-32-E6KC18.P2` — validates bytes32 without returning a normalized value
