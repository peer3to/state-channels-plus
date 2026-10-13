# Holepunch.ts

> **Source:** [src/Holepunch.ts](../../../../../src/Holepunch.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-UPG-6-BC60XD` (Discovery topic leave is byte-exact and durable)](../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd)
- [`REQ-UPG-7-61PHDB` (Discovery converges for every join order)](../../../specification/peer-communication/transport-upgrade.md#req-upg-7-61phdb)
    - `announceTopic` looks the topic up once more after this peer's own announce completes (`flushed`): Hyperswarm 4.17.2 misses a peer whose announce is in flight during its lookup and looks up again only every 10 minutes, so of two peers that join together the later one finds the other. Releasing a fallback ban (`bannablePeerInfo`) looks up the joined topics once: the peer is found again only if it is still announced on them; no peer is dialed by key.
    - Partial: relayed (browser) connections break that tie-break ([`FIND-UPG-GLARE-1-98VA3A`](../../../audit/open-findings.md#find-upg-glare-1-98va3a)), and a relayed leave stays announced ([`FIND-UPG-RELAY-2-0TVHJ4`](../../../audit/open-findings.md#find-upg-relay-2-0tvhj4)).
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
