# InitHandshakeDisconnectPolicy.test.ts — Verification Report

> **Test file:** [test/rpc/initHandshake/InitHandshakeDisconnectPolicy.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeDisconnectPolicy.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [InitHandshakeService](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md)

## Overview

Two handshake outcomes that no end-to-end run can observe, driven through the real manager fixture
and a control probe rather than a stub. The first stages a peer whose address this node has already
verified and then lets the ack window expire: the oracle reads the socket, the connection registry,
the identity blacklist, the profile blacklist, and the recorded bootstrap `ban` calls, so it fails if
the transport survives, if any exclusion appears, or if a ban is written. The second stages an
identity this node already excluded and has it answer a handshake on a second connection: the same
oracle asserts the profile is blacklisted again and exactly one `ban(true)` reaches the new
bootstrap handle, which is what a plain close would have missed. Both probes wait out real protocol
timeouts, so each raises its own control-request budget; neither changes the mocha timeout.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                 | Covers                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`InitHandshake disconnect policy > closes a verified peer whose handshake ack times out without excluding it`](../../../../../../../test/rpc/initHandshake/InitHandshakeDisconnectPolicy.test.ts#L24) (line 24) | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P10`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p10), [`REQ-AUTH-4-JWCF71.T1.P7`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p7) |
| [`InitHandshake disconnect policy > re-bans an excluded identity that answers a handshake on a new connection`](../../../../../../../test/rpc/initHandshake/InitHandshakeDisconnectPolicy.test.ts#L40) (line 40) | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P12`](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p12), [`REQ-AUTH-4-JWCF71.T1.P6`](../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p6) |
