# InitHandshakeTiming.test.ts

Test file: [test/rpc/initHandshake/InitHandshakeTiming.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeTiming.test.ts)
Exercises: [InitHandshakeService](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md), [InitHandshakeRpcMethods](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeRpcMethods.ts.md)

## Overview

The handshake timing filters through the real endpoints on one runtime, with the agreement window
read from the fixture. Request-time cases call the responder endpoint on a transport keyed by a
Hyperswarm key, unauthenticated or already proven, with the time ahead of, behind, and exactly on the
window. Response cases start the real initiator handshake toward a recording socket, read the
challenge it wrote, and answer it as a random wallet: with the response time ahead of, behind, or on
the window, with the local clock moved for the round-trip check, as a refusal, or validly. The
acknowledgement cases answer validly and then fire the captured acknowledgement timeout, once and
three times. Every case reads the strike count by key, the suspension of key and address, the
transport state, and the absence of a verdict.

## Tests

- `strikes an unauthenticated sender whose request time is ahead of the window`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P8
- `strikes an unauthenticated sender whose request time is behind the window`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P9
- `signs a request whose time sits exactly on the upper window bound`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P10
- `signs a request whose time sits exactly on the lower window bound`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P11
- `keys the request-skew strike by the EVM address of an authenticated sender`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P12
- `suspends the sender key once its skewed requests reach the retry bound`: UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P13
- `strikes a responder whose response time is ahead of the window`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P11
- `strikes a responder whose response time is behind the window`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P15
- `accepts a response time exactly on the window bound`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P16
- `strikes a responder whose round trip exceeds the agreement time`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P12
- `accepts a round trip exactly equal to the agreement time`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P17
- `strikes a responder that refuses the challenge instead of answering it`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P13
- `acknowledges a valid response and keeps the transport open`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P18
- `strikes the verified peer once when its acknowledgement never arrives`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P10
- `suspends both the key and the verified address at the third missing acknowledgement`: UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P14
