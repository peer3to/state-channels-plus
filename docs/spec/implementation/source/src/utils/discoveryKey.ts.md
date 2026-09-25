# discoveryKey.ts

> **Source:** [src/utils/discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts)

## Requirements

- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)

## UNIT-TEST-DISCOVERY-KEY-32-F0QWHX

Discovery bytes and validation

- Setup: Derive raw and domain-separated keys with boundary hex inputs and compare exact bytes/errors; direct validator cases assert caller error and void return.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P1` — rejects short IDs in both discovery derivations
- [x] `UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P2` — rejects long IDs in both discovery derivations
- [x] `UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P3` — rejects malformed IDs in both discovery derivations
- [x] `UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P4` — preserves mixed-case channel bytes and targeted derivation
