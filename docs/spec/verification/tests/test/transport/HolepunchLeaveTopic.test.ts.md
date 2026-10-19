# HolepunchLeaveTopic.test.ts

Test file: [test/transport/HolepunchLeaveTopic.test.ts](../../../../../../test/transport/HolepunchLeaveTopic.test.ts)
Exercises: [Holepunch](../../../../implementation/source/src/Holepunch.ts.md)

## Overview

Record swarm join calls through the real rejoin path; retained duplicate topics appear in insertion order.

Drives the real public join/leave surface with a typed swarm recorder to verify byte equality,
duplicates, no-op leaves, lazy creation, and restart replay. The lookup cases let the test complete
or fail each announce and record every topic lookup; the ban-release cases call `ban` on the peer
info Holepunch hands to a new connection's transport. The lookup cases also read the time since join on
the success logs, including for a topic joined twice and left once. The attempt case injects a shared
recording swarm with another owner's `update` listener and counts the attempt logs per dial.

## Tests

- `records a joined Buffer topic with server and client discovery enabled`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P1, REQ-UPG-6-BC60XD.T1.P1
- `removes the first byte-equal topic and calls swarm leave`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P2, REQ-UPG-6-BC60XD.T1.P2
- `keeps the second duplicate join after leaving once`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P3, REQ-UPG-6-BC60XD.T1.P3
- `does nothing when leaving a topic that was never joined`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P4, REQ-UPG-6-BC60XD.T1.P4
- `does nothing when leave runs before lazy swarm creation`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P5, REQ-UPG-6-BC60XD.T1.P5
- `does not reannounce a topic removed before a rejoin cycle`: UNIT-TEST-HOLEPUNCH-TOPIC-1-SYJT8J.P6, REQ-UPG-6-BC60XD.T1.P6
- `reannounces duplicate topics in their insertion order`: UNIT-TEST-HOLEPUNCH-32-72PXTG.P1
- `looks a joined topic up once after its announce completes`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P1, UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P8
- `keeps the announce timing of a duplicate join after leaving once`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P9
- `does not look up a topic left before its announce completes`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P2
- `does not look up a topic after the swarm is destroyed`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P3
- `looks each joined topic up once when a peer's ban is released`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P4
- `looks no topic up when a peer is banned`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P5
- `logs a failed announce at debug level and does not look the topic up`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P6
- `logs a failed topic lookup at debug level`: UNIT-TEST-HOLEPUNCH-LOOKUP-1-CS5RF8.P7
- `logs one attempt per dial and keeps other update listeners on a shared swarm`: UNIT-TEST-HOLEPUNCH-ATTEMPT-1-H6QZVK.P1, UNIT-TEST-HOLEPUNCH-ATTEMPT-1-H6QZVK.P2
