# bytes32.ts

> **Source:** [bytes32.ts](../../../../../../src/utils/bytes32.ts)

## Requirements

- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)
- [`REQ-LC-5-MM0BM9` (A followed channel is subscribed on every connection)](../../../../specification/runtime/light-client.md#req-lc-5-mm0bm9)

## UNIT-TEST-BYTES32-32-E6KC18

Bytes32 validation and the log topic of an indexed value

- Setup: Call requireBytes32 with undefined and valid zero hash; compare exact supplied error message and void return. Call indexedTopic with a 32-byte channel id, a one-byte hex value and the same byte as bytes; compare with the zero-padded 32-byte value.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-BYTES32-32-E6KC18.P1` — uses the caller message for undefined bytes32 input
- [x] `UNIT-TEST-BYTES32-32-E6KC18.P2` — validates bytes32 without returning a normalized value
- [x] `UNIT-TEST-BYTES32-32-E6KC18.P3` — a 32-byte channel id is its own log topic
- [x] `UNIT-TEST-BYTES32-32-E6KC18.P4` — a shorter value, hex or bytes, is left-padded to 32 bytes
