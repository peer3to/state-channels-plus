# HolepunchRelay.ts

> **Source:** [src/HolepunchRelay.ts](../../../../../src/HolepunchRelay.ts)

## Requirements

- [`REQ-UPG-5-YQV7MJ` (Relay retries converge without stale work)](../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj)
- [`REQ-RUNTIME-9-P5VPT5` (An uncaught non-error failure is reported as one error)](../../../specification/runtime/execution.md#req-runtime-9-p5vpt5)

## UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY

Relay wrapper connection lifecycle

- Setup: Initialize the public wrapper over a typed WebSocket boundary and drive socket open, error, and close events through the real DHT/Hyperswarm construction
- Oracle: Empty configuration stays idle; failures reconnect through pool exhaustion; success resets selection; paired events schedule once; a socket that fails before it opens, also by the relay's own Error or by a close event alone, is one pool failure, with a reason naming the relayer and no unhandled rejection; a close reason names the relayer, close code and close reason; after disposal a socket event or a failed relay opening neither logs nor reconnects; an invalid relayer URL among valid ones throws at initialization, before any socket opens, and is no pool failure

- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1` — empty configuration no-op
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2` — close reconnect
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3` — full-pool exhaustion keeps reconnecting
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4` — single-relay retry loop
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5` — success resets exclusions
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6` — paired error/close deduplication
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P7` — disposal detaches the socket and cancels the pending retry
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P8` — a socket that fails before it opens is one pool failure naming the relayer, with no unhandled rejection
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P9` — a close event becomes a pool failure whose Error names the relayer, the close code and the close reason
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P10` — a relay opening that rejects with the relay's own Error is one pool failure whose Error names the relayer and keeps the relay's Error as its cause
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P11` — a socket that closes before it opens, with no error event, is one pool failure and no unhandled rejection
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P12` — a socket that fails before it opens after disposal counts no failure, schedules no retry and leaves no unhandled rejection
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P13` — an invalid relayer URL among valid ones, unparsable or not ws/wss, throws out of initialization before any socket opens; no pool failure, no retry
