# Holepunch.ts

> **Source:** [src/Holepunch.ts](../../../../../src/Holepunch.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)

## UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J

Discovery topic lifecycle

- Setup: Drive the real public join/leave surface with a typed swarm recorder, equal-byte buffers, duplicates, absent topics, and restart
- Oracle: Calls and retained topic order match the byte-exact contract; removed topics are not announced again

- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P1` — join and options
- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P2` — separate equal buffer
- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P3` — duplicate first match
- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P4` — absent leave
- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P5` — pre-creation leave
- [x] `UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P6` — no reannouncement after restart

## UNIT-TEST-HOLEPUNCH-32-72PXTG

Discovery reannouncement

- Setup: Record swarm join calls through the real rejoin path; retained duplicate topics appear in insertion order.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-HOLEPUNCH-32-72PXTG.P1` — reannounces duplicate topics in their insertion order
