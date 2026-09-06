# HolepunchRelay.test.ts — Verification Report

> **Test file:** [test/utils/HolepunchRelay.test.ts](../../../../../../test/utils/HolepunchRelay.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [HolepunchRelay](../../../../implementation/source/src/HolepunchRelay.ts.md)

## Overview

Verifies the public relay wrapper over a typed global-WebSocket boundary while using the real
DHT, stream, Hyperswarm, and `RelayerPool` construction.

## Tests and covered test IDs

| Test declaration                                                                                                                                     | Covers                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`HolepunchRelay > stays idle when no relayer URL is configured`](../../../../../../test/utils/HolepunchRelay.test.ts#L17) (line 17)                 | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p1) |
| [`HolepunchRelay > reconnects after a relay socket closes`](../../../../../../test/utils/HolepunchRelay.test.ts#L25) (line 25)                       | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p2) |
| [`HolepunchRelay > keeps reconnecting after the whole relay pool fails`](../../../../../../test/utils/HolepunchRelay.test.ts#L38) (line 38)          | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p3) |
| [`HolepunchRelay > keeps retrying one configured relay`](../../../../../../test/utils/HolepunchRelay.test.ts#L57) (line 57)                          | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p4) |
| [`HolepunchRelay > resets failed-relay exclusions after a successful connection`](../../../../../../test/utils/HolepunchRelay.test.ts#L73) (line 73) | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p5) |
| [`HolepunchRelay > deduplicates error and close events from one socket`](../../../../../../test/utils/HolepunchRelay.test.ts#L90) (line 90)          | [`UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6`](../../../../implementation/source/src/HolepunchRelay.ts.md#unit-test-holepunch-relay-1-qf3fky.p6) |
