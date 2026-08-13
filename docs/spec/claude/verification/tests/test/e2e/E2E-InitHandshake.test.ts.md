# test/e2e/E2E-InitHandshake.test.ts — Test Report

> **Test file:** [test/e2e/E2E-InitHandshake.test.ts](../../../../../../../test/e2e/E2E-InitHandshake.test.ts) > **Status:** Authored — engineer verification pending.

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
consequence as a reduced connection count: out-of-window request time, no response within the
window, out-of-window response time, an undecodable junk signature, and a duplicate handshake ack.
Oracles are connection-count and profile-state observations; the suite does not assert
blacklist/exclusion state directly, and challenge-signature forgery/replay is owned by
`test/rpc/initHandshake/InitHandshakeChallenge.test.ts`. Several candidate permutations bundle
boundary sweeps (window edges, each malformed shape) that no single test here covers, so they stay
unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                         | Covers                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Init Handshake > Handshake Completion > should complete handshake successfully and create peer profile`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L16) (line 16)                   | [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1.P1`](../../../../implementation/source/src/rpc/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1.p1)                                                          |
| [`E2E: Init Handshake > Handshake Completion > should update existing profile transport on WebRTC upgrade`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L31) (line 31)                       | [`UNIT-TEST-PROFILE-MANAGER-1.P2`](../../../../implementation/source/src/ProfileManager.ts.md#unit-test-profile-manager-1.p2), [`REQ-UPG-2.T1.P1`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-2-t1-p1) |
| [`E2E: Init Handshake > Time Validation > should disconnect peer when handshake request time difference exceeds agreementTime`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L112) (line 112) | —                                                                                                                                                                                                                                     |
| [`E2E: Init Handshake > Time Validation > should disconnect peer that doesn't respond within agreementTime`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L132) (line 132)                    | —                                                                                                                                                                                                                                     |
| [`E2E: Init Handshake > Time Validation > should disconnect peer when handshake response time doesn't match init time`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L155) (line 155)         | —                                                                                                                                                                                                                                     |
| [`E2E: Init Handshake > Time Validation > should disconnect peer answering with an undecodable (junk) signature`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L177) (line 177)               | —                                                                                                                                                                                                                                     |
| [`E2E: Init Handshake > Duplicate ack > should disconnect + blacklist a peer that sends a duplicate handshake ack`](../../../../../../../test/e2e/E2E-InitHandshake.test.ts#L202) (line 202)             | [`REQ-AUTH-3.T1.P2`](../../../../specification/peer-communication/handshake.md#req-auth-3-t1-p2)                                                                                                                                      |
