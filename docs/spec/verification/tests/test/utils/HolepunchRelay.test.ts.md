# HolepunchRelay.test.ts

Test file: [test/utils/HolepunchRelay.test.ts](../../../../../../test/utils/HolepunchRelay.test.ts)
Exercises: [HolepunchRelay](../../../../implementation/source/src/HolepunchRelay.ts.md)

## Overview

Verifies the public relay wrapper over a typed global-WebSocket boundary while using the real
DHT, stream, Hyperswarm, and `RelayerPool` construction. The boundary dispatches real `Event`s
targeting the socket; its browser-style failure before open closes the socket before the error
event fires, which is when the relay stream rejects its opening. That case records the reasons
handed to the pool and every unhandled rejection after a real macrotask. A close event carries a
close code and reason, which the close case reads back from the reason handed to the pool. A
socket that is already CLOSED when it is created makes the relay reject its opening with its own
Error and no socket event; a close event alone, and a failure after disposal, are the other
before-open cases. An unparsable URL and an https URL, each after a valid one, show that
initialization rejects the configuration before any socket exists. A shared recorder from the
fixtures records each rejection nobody handled once.

## Tests

- `stays idle when no relayer URL is configured`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P1
- `reconnects after a relay socket closes`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P2, UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P9
- `keeps reconnecting after the whole relay pool fails`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P3
- `keeps retrying one configured relay`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P4
- `resets failed-relay exclusions after a successful connection`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P5
- `deduplicates error and close events from one socket`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P6, REQ-UPG-5-YQV7MJ.T1.P8
- `a relay socket closing after disposal neither logs nor reconnects`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P7
- `fails over once, with no unhandled rejection, when a socket fails before it opens`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P8, REQ-UPG-5-YQV7MJ.T1.P9
- `fails over once, naming the relayer, when the relay's opening rejects with its own Error`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P10, REQ-UPG-5-YQV7MJ.T1.P10
- `counts one failure when a socket closes before it opens with no error event`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P11, REQ-UPG-5-YQV7MJ.T1.P11
- `a relay opening that fails after disposal neither counts a failure nor reconnects`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P12, REQ-UPG-5-YQV7MJ.T1.P12
- `throws at initialization for an invalid relayer URL among valid ones, a configuration error, and opens no socket, counts no relay failure and retries nothing`: UNIT-TEST-HOLEPUNCH-RELAY-1-QF3FKY.P13, REQ-UPG-5-YQV7MJ.T1.P13
