# HolepunchRelayDispose.test.ts

Test file: [test/transport/HolepunchRelayDispose.test.ts](../../../../../../test/transport/HolepunchRelayDispose.test.ts)
Exercises: [Holepunch](../../../../implementation/source/src/Holepunch.ts.md)

## Overview

Builds a browser-mode Holepunch through the relay fixture, whose relay socket is a recording WebSocket
that never answers, so the real Hyperswarm and relay client wait on the relayer's first `listening`
reply. The test opens the socket, joins a topic, and awaits the disposal: it must resolve, so a hang
fails the test at its timeout.

## Tests

- `disposes while the first topic announce still waits on the relayer's listening reply`: UNIT-TEST-HOLEPUNCH-DISPOSE-1-EXNRFP.P1
