# Holepunch.ts

> **Source:** [src/Holepunch.ts](../../../../../src/Holepunch.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)
    - Partial: `leave` — a relayed leave stays announced, so [`REQ-UPG-6-BC60XD.T1.P8`](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p8) stays open ([`FIND-UPG-RELAY-2-0TVHJ4`](../../../audit/open-findings.md#find-upg-relay-2-0tvhj4)).
- [`REQ-UPG-7-61PHDB` (Discovery converges for every join order)](../../../specification/peer-communication/transport-upgrade.md#req-upg-7-61phdb)
- [`REQ-UPG-8-06HTCM` (Fallback is re-established within one agreement window)](../../../specification/peer-communication/transport-upgrade.md#req-upg-8-06htcm)

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

## UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8

Topic lookup after an announce and after a ban release

- Setup: Drive the real join/leave surface and the peer info Holepunch hands to a new connection's transport over a recording swarm whose announces (`flushed`) the test completes or fails and whose topic lookups (`status(topic).refresh()`) it records.
- Oracle: A completed announce of a still-joined topic starts one lookup; a topic left first, or a destroyed swarm, starts none; `ban(false)` looks each joined topic up once and `ban(true)` looks nothing up; a failed announce or lookup is one debug message and reaches no warning or error.

- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P1` — one lookup after the announce completes, none before
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P2` — no lookup of a topic left before its announce completes
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P3` — no lookup after the swarm is destroyed
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P4` — `ban(false)` looks each joined topic up exactly once
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P5` — `ban(true)` looks nothing up
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P6` — a failed announce is logged at debug level and starts no lookup
- [x] `UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P7` — a failed lookup is logged at debug level
