# HolepunchRelay.ts

> **Source:** [src/HolepunchRelay.ts](../../../../../src/HolepunchRelay.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-UPG-5-YQV7MJ` (Relay retries converge without stale work)](../../../specification/peer-communication/transport-upgrade.md#req-upg-5-yqv7mj)

## UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY

Relay wrapper connection lifecycle

- Setup: Initialize the public wrapper over a typed WebSocket boundary and drive socket open, error, and close events through the real DHT/Hyperswarm construction
- Oracle: Empty configuration stays idle; failures reconnect through pool exhaustion; success resets selection; paired events schedule once

- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1` — empty configuration no-op
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2` — close reconnect
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3` — full-pool exhaustion keeps reconnecting
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4` — single-relay retry loop
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5` — success resets exclusions
- [x] `UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6` — paired error/close deduplication
