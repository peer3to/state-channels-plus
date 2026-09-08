# HolepunchLeaveTopic.test.ts — Verification Report

> **Test file:** [test/transport/HolepunchLeaveTopic.test.ts](../../../../../../test/transport/HolepunchLeaveTopic.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Holepunch](../../../../implementation/source/src/Holepunch.ts.md)

## Overview

Record swarm join calls through the real rejoin path; retained duplicate topics appear in insertion order.

Drives the real public join/leave surface with a typed swarm recorder to verify byte equality,
duplicates, no-op leaves, lazy creation, and restart replay.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                   | Covers                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Holepunch topic lifecycle > records a joined Buffer topic with server and client discovery enabled`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L29) (line 29) | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P1`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p1), [`REQ-UPG-6-BC60XD.T1.P1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p1) |
| [`Holepunch topic lifecycle > removes the first byte-equal topic and calls swarm leave`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L46) (line 46)               | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P2`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p2), [`REQ-UPG-6-BC60XD.T1.P2`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p2) |
| [`Holepunch topic lifecycle > keeps the second duplicate join after leaving once`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L58) (line 58)                     | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P3`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p3), [`REQ-UPG-6-BC60XD.T1.P3`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p3) |
| [`Holepunch topic lifecycle > does nothing when leaving a topic that was never joined`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L70) (line 70)                | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P4`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p4), [`REQ-UPG-6-BC60XD.T1.P4`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p4) |
| [`Holepunch topic lifecycle > does nothing when leave runs before lazy swarm creation`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L80) (line 80)                | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P5`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p5), [`REQ-UPG-6-BC60XD.T1.P5`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p5) |
| [`Holepunch topic lifecycle > does not reannounce a topic removed before a rejoin cycle`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L93) (line 93)              | [`UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P6`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-topic-1-syjt8j.p6), [`REQ-UPG-6-BC60XD.T1.P6`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd.t1.p6) |
| [`Holepunch topic lifecycle > reannounces duplicate topics in their insertion order`](../../../../../../test/transport/HolepunchLeaveTopic.test.ts#L17) (line 17)                  | [`UNIT-TEST-HOLEPUNCH-32-72PXTG.P1`](../../../../implementation/source/src/Holepunch.ts.md#unit-test-holepunch-32-72pxtg.p1)                                                                                                                                 |
