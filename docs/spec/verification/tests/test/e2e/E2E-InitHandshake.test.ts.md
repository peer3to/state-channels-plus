# test/e2e/E2E-InitHandshake.test.ts — Test Report

> **Test file:** [test/e2e/E2E-InitHandshake.test.ts](../../../../../../test/e2e/E2E-InitHandshake.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the real handshake protocol between live peers through the `MathTestSession`
harness: peers start with real transports, connect, and the assertions read handshake completion,
peer profiles, and connection counts back over the harness control port. The happy paths prove
mutual completion (including a third peer joining via an observer) and that a WebRTC upgrade
initiated through `webRTCSetupService.initiateWebRTC` swaps the existing profile's transport from
HOLEPUNCH to WEBRTC in place — the same tagged profile object survives the cutover. The
adversarial paths inject faults through harness control RPCs (`sendInvalidTimeHandshakeRequest`,
`initiateHandshakeWithFaultyResponse`, `sendDuplicateHandshakeAck`) and assert the honest side's
consequence, split by fault class: an undecodable junk signature and a duplicate ack blacklist the
authenticated sender, while out-of-window request and response times and an unanswered request
close the connection and suspend the peer for the runtime. Oracles read connection state and the
profile's blacklist and suspension flags separately, so a suspension can never pass as a penalty. Challenge domain separation is owned by
`test/rpc/initHandshake/InitHandshakeChallenge.test.ts`; the adversarial
authentication-evidence permutations of [`INV-AUTH-1-J0PRYA.T1`](../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya.t1) (replayed signature,
metadata-only claim, wrong-challenge signature) have no covering test anywhere yet.
Remaining unassigned permutations here are exact-boundary scenarios (at-deadline, maximum
honest skew, window edges) and malformed shapes that no test here drives.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Init Handshake > Handshake Completion > should complete handshake successfully and create peer profile`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L16) (line 16)                  | [`INV-AUTH-1-J0PRYA.T1.P1`](../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya.t1.p1), [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P1`](../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r.p1), [`INV-HSK-1-R44CN1.T1.P1`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-1-r44cn1.t1.p1), [`INV-HSK-5-3E60DY.T1.P1`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-5-3e60dy.t1.p1), [`REQ-HSK-1-Y9JQS3.T1.P1`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#req-hsk-1-y9jqs3.t1.p1) |
| [`E2E: Init Handshake > Handshake Completion > should update existing profile transport on WebRTC upgrade`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L31) (line 31)                      | [`UNIT-TEST-PROFILE-MANAGER-1-PTVSZ5.P2`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-profile-manager-1-ptvsz5.p2), [`REQ-UPG-2-WH7BC7.T1.P1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-wh7bc7.t1.p1)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: Init Handshake > Time Validation > should suspend peer when handshake request time difference exceeds agreementTime`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L116) (line 116) | [`INV-HSK-5-3E60DY.T1.P3`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-5-3e60dy.t1.p3), [`REQ-AUTH-4-JWCF71.T1.P4`](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p4) |
| [`E2E: Init Handshake > Time Validation > should suspend peer that doesn't respond within agreementTime`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L147) (line 147) | [`INV-HSK-5-3E60DY.T1.P5`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-5-3e60dy.t1.p5), [`REQ-HSK-1-Y9JQS3.T1.P5`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#req-hsk-1-y9jqs3.t1.p5), [`REQ-AUTH-4-JWCF71.T1.P1`](../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71.t1.p1) |
| [`E2E: Init Handshake > Time Validation > should suspend peer when handshake response time doesn't match init time`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L182) (line 182) | [`INV-HSK-5-3E60DY.T1.P7`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#inv-hsk-5-3e60dy.t1.p7) |
| [`E2E: Init Handshake > Time Validation > should blacklist peer answering with an undecodable (junk) signature`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L212) (line 212) | [`REQ-HSK-1-Y9JQS3.T1.P3`](../../../../implementation/views/architecture/sdk/rpc/handshake.md#req-hsk-1-y9jqs3.t1.p3) |
| [`E2E: Init Handshake > Duplicate ack > should disconnect + blacklist a peer that sends a duplicate handshake ack`](../../../../../../test/e2e/E2E-InitHandshake.test.ts#L243) (line 243)            | [`REQ-AUTH-3-ZV74KB.T1.P2`](../../../../specification/peer-communication/handshake.md#req-auth-3-zv74kb.t1.p2), [`REQ-RPC-4-9VX0B9.T1.P6`](../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9.t1.p6), [`INTEGRATION-TEST-RPC-6-009EGG.P4`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-6-009egg.p4)                                                                                                                                                                                                                                                                                                                          |

Targeted setup uses detached connect dispatch and explicit terminal settlement. Initial-load evidence proves
the first eligible resolved participant starts exactly one request; later handshakes add connections but do
not start another pending or failed initial-load attempt.
