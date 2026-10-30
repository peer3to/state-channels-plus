# E2E-InitHandshake.test.ts

Test file: [test/e2e/E2E-InitHandshake.test.ts](../../../../../../test/e2e/E2E-InitHandshake.test.ts)

## Overview

The suite drives the real handshake protocol between live peers through the `MathTestSession`
harness: peers start with real transports, connect, and the assertions read handshake completion,
peer profiles, and connection counts back over the harness control port. The happy paths prove
mutual completion (including a third peer joining via an observer) and that a WebRTC upgrade
initiated through `webRTCSetupService.initiateWebRTC` swaps the existing profile's transport from
HOLEPUNCH to WEBRTC in place — the same tagged profile object survives the cutover. The
adversarial paths inject faults through harness control RPCs (`sendInvalidTimeHandshakeRequest`,
`initiateHandshakeWithFaultyResponse`, `sendDuplicateHandshakeAck`) and assert the honest side's
consequence: an undecodable junk signature and a duplicate ack blacklist the authenticated sender,
while the timing faults are bounded instead — a response timeout and an out-of-window response
timestamp only disconnect and the same identity reconnects with one strike recorded, and repeated
out-of-window request times suspend the sender for the session only on the round that reaches its
retry bound, with the two earlier rounds reconnecting and proving no penalty was recorded. A first
contact with a skewed clock is counted by the discovery key it announced and refused by that key at
the bound, and a verified peer whose acknowledgement is dropped is struck once and reconnects when
acks flow again. Oracles read connection state, profile blacklist state, the strike count, and the
suspension. Challenge domain separation is owned by
`test/rpc/initHandshake/InitHandshakeChallenge.test.ts`; the adversarial
authentication-evidence permutations of `INV-AUTH-1-J0PRYA.T1` (replayed signature,
metadata-only claim, wrong-challenge signature) have no covering test anywhere yet.
Remaining unassigned permutations here are exact-boundary scenarios (at-deadline, maximum
honest skew, window edges) and malformed shapes that no test here drives.

## Tests

- `should complete handshake successfully and create peer profile`: INV-AUTH-1-J0PRYA.T1.P1, UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P1, REQ-AUTH-3-ZV74KB.T1.P6, REQ-AUTH-6-E7SSH3.T1.P1, REQ-AUTH-1-RF901K.T1.P7
- `should update existing profile transport on WebRTC upgrade`: UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P2, REQ-UPG-2-WH7BC7.T1.P1
- `should suspend peer only once its handshake request time skew reaches the retry bound`: REQ-AUTH-4-JWCF71.T1.P4, REQ-AUTH-4-JWCF71.T1.P5, REQ-AUTH-6-E7SSH3.T1.P10
- `should disconnect without punishing a peer that doesn't respond within agreementTime`: REQ-AUTH-6-E7SSH3.T1.P11, REQ-AUTH-4-JWCF71.T1.P8
- `should disconnect without punishing a peer whose handshake response time doesn't match init time`: REQ-AUTH-6-E7SSH3.T1.P12, REQ-AUTH-4-JWCF71.T1.P9
- `should blacklist peer answering with an undecodable (junk) signature`: REQ-AUTH-1-RF901K.T1.P6, REQ-AUTH-4-JWCF71.T1.P7
- `should disconnect + blacklist a peer that sends a duplicate handshake ack`: REQ-AUTH-3-ZV74KB.T1.P2, REQ-RPC-4-9VX0B9.T1.P6, INTEGRATION-TEST-RPC-6-009EGG.P4

Targeted setup uses detached connect dispatch and explicit terminal settlement. Initial-load evidence proves
the first eligible resolved participant starts exactly one request; later handshakes add connections but do
not start another pending or failed initial-load attempt.

- `should suspend a first-contact peer by its discovery key once its skewed requests reach the retry bound`: REQ-AUTH-4-JWCF71.T1.P6
- `should strike a verified peer whose acknowledgement is lost and let it reconnect`: REQ-AUTH-4-JWCF71.T1.P2
