# test/rpc/initHandshake/InitHandshakeChallenge.test.ts — Test Report

> **Test file:** [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [InitHandshakeService.ts](../../../../../implementation/source/src/rpc/services/initHandshake/InitHandshakeService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite is the focused regression test for the signing-oracle fix in the init-handshake
responder: `InitHandshakeService.buildHandshakeChallengeMessage` must domain-separate what the
responder signs so the endpoint cannot be abused to mint block signatures. Tests drive the static
message builder plus ethers signing/recovery directly — no service instance, transport, or
harness. The oracles: a signature over the domain-separated message recovers the signer under
`verifyMessage`; when the challenge is set to `keccak256(encodedBlock)` (the attack), the
handshake signature does NOT recover the signer under block-style verification (EIP-191 over the
raw 32-byte hash); and the builder normalizes challenge-hash casing to one identical message. The
live request/response endpoints, challenge freshness, time-window checks, and profile
finalization are out of scope (exercised by `E2E-InitHandshake`).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                   | Covers                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`InitHandshake challenge domain separation > round-trips: a domain-separated handshake signature recovers the signer`](../../../../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts#L17) (line 17)                               | —                                                                                                                 |
| [`InitHandshake challenge domain separation > does not collide with block signing: the handshake signature is not valid over the raw challenge hash`](../../../../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts#L29) (line 29) | [`INV-AUTH-2-VQ6D54.T1.P1`](../../../../../specification/peer-communication/handshake.md#inv-auth-2-vq6d54.t1.p1) |
| [`InitHandshake challenge domain separation > derives an identical message regardless of challenge-hash casing`](../../../../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts#L48) (line 48)                                      | —                                                                                                                 |
