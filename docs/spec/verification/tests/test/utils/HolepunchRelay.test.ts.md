# HolepunchRelay.test.ts

Test file: [test/utils/HolepunchRelay.test.ts](../../../../../../test/utils/HolepunchRelay.test.ts)
Exercises: [HolepunchRelay](../../../../implementation/source/src/HolepunchRelay.ts.md)

## Overview

Verifies the public relay wrapper over a typed global-WebSocket boundary while using the real
DHT, stream, Hyperswarm, and `RelayerPool` construction.

## Tests

- `stays idle when no relayer URL is configured`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1
- `reconnects after a relay socket closes`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2
- `keeps reconnecting after the whole relay pool fails`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3
- `keeps retrying one configured relay`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4
- `resets failed-relay exclusions after a successful connection`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5
- `deduplicates error and close events from one socket`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6
