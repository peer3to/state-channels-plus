# HolepunchLeaveTopic.test.ts

Test file: [test/transport/HolepunchLeaveTopic.test.ts](../../../../../../test/transport/HolepunchLeaveTopic.test.ts)
Exercises: [Holepunch](../../../../implementation/source/src/Holepunch.ts.md)

## Overview

Record swarm join calls through the real rejoin path; retained duplicate topics appear in insertion order.

Drives the real public join/leave surface with a typed swarm recorder to verify byte equality,
duplicates, no-op leaves, lazy creation, and restart replay.

## Tests

- `records a joined Buffer topic with server and client discovery enabled`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P1, REQ-UPG-6-BC60XD.T1.P1
- `removes the first byte-equal topic and calls swarm leave`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P2, REQ-UPG-6-BC60XD.T1.P2
- `keeps the second duplicate join after leaving once`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P3, REQ-UPG-6-BC60XD.T1.P3
- `does nothing when leaving a topic that was never joined`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P4, REQ-UPG-6-BC60XD.T1.P4
- `does nothing when leave runs before lazy swarm creation`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P5, REQ-UPG-6-BC60XD.T1.P5
- `does not reannounce a topic removed before a rejoin cycle`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P6, REQ-UPG-6-BC60XD.T1.P6
- `reannounces duplicate topics in their insertion order`: UNIT-TEST-HOLEPUNCH-32-72PXTG.P1
