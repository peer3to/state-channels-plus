# InitHandshakeChallenge.test.ts

Test file: [test/rpc/initHandshake/InitHandshakeChallenge.test.ts](../../../../../../../test/rpc/initHandshake/InitHandshakeChallenge.test.ts)
Exercises: [InitHandshakeService.ts](../../../../../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md)

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

## Tests

- `round-trips: a domain-separated handshake signature recovers the signer`: none
- `does not collide with block signing: the handshake signature is not valid over the raw challenge hash`: INV-AUTH-2-VQ6D54.T1.P1
- `derives an identical message regardless of challenge-hash casing`: none
