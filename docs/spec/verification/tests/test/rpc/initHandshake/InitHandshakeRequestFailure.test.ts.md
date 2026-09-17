# test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts — Test Report

> **Test file:** [test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [InitHandshakeService.ts](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite covers what the initiator does when the handshake challenge request never produces a
response. A host-side probe connects a real `HolepunchTransport` over a recording socket, so the
production constructor starts the real handshake and the challenge frame is the socket's first
write. Each case then ends the request leg a different way: leaving it unanswered until the
agreement window expires, answering it with an error response on the challenge's request id, and
rejecting the router's pending request for that transport as a close does. The oracles are the
socket's destroyed flag and the manager's connection list for whether the transport was closed,
plus the peer-info ban calls, the profile blacklist flag, and the identity blacklist lookup for
the forbidden effect — none of these failures is attributable, so none may punish the peer. The
already-closed case additionally asserts the absence of a close: the connection stays in the
manager and the socket is never destroyed. Signature verification, the round-trip and timestamp
bounds, and finalization are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                      | Covers                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InitHandshake request failure handling > closes the transport of a peer that never answers the handshake challenge`](../../../../../../../test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts#L24) (line 24) | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P6`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p6)   |
| [`InitHandshake request failure handling > closes the transport of a peer that answers the challenge with an error`](../../../../../../../test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts#L39) (line 39)   | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P11`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p11) |
| [`InitHandshake request failure handling > closes nothing when the connection is already gone before the response`](../../../../../../../test/rpc/initHandshake/InitHandshakeRequestFailure.test.ts#L52) (line 52)    | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P12`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p12) |
