# InitHandshakeRpcMethods.ts

> **Source:** [src/rpc/network/services/initHandshake/InitHandshakeRpcMethods.ts](../../../../../../../../../src/rpc/network/services/initHandshake/InitHandshakeRpcMethods.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../../../views/architecture/sdk/rpc/README.md), [architecture/sdk/rpc/handshake.md](../../../../../../views/architecture/sdk/rpc/handshake.md)

## Requirements

- [`INV-AUTH-2-VQ6D54` (Domain separation)](../../../../../../../specification/peer-communication/handshake.md#inv-auth-2-vq6d54)
- [`REQ-AUTH-1-RF901K` (Validate before signing)](../../../../../../../specification/peer-communication/handshake.md#req-auth-1-rf901k)
- [`REQ-RPC-4-9VX0B9` (Replay and concurrency)](../../../../../../../specification/peer-communication/rpc.md#req-rpc-4-9vx0b9)
- [`REQ-ID-4-BNEKCM` (Domain-separated signing forms)](../../../../../../../specification/protocol-model/identity.md#req-id-4-bnekcm)
- [`INV-AUTH-1-J0PRYA` (Signature is the only proof)](../../../../../../../specification/peer-communication/handshake.md#inv-auth-1-j0prya)
- [`REQ-AUTH-4-JWCF71` (Penalty requires proof, and clock faults are not proof)](../../../../../../../specification/peer-communication/handshake.md#req-auth-4-jwcf71)

## UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4

Endpoint validation

- Setup: Send malformed shapes, NaN/inf/boundary times, valid requests, and duplicate acks
- Oracle: Invalid input disconnects before signing; valid requests sign under the tag; duplicate ack terminates+excludes

- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P1` — non-hex challenge
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P2` — NaN time
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P3` — window boundary
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P4` — valid sign path
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P5` — duplicate ack violation
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P6` — wrong-length challenge
- [ ] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P7` — infinite time
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P8` — a request time ahead of the window records one strike on an unauthenticated sender's key
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P9` — a request time behind the window records one strike on an unauthenticated sender's key
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P10` — a request time exactly on the upper window bound signs
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P11` — a request time exactly on the lower window bound signs
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P12` — an authenticated sender's skewed request is keyed by its EVM address
- [x] `UNIT-TEST-INIT-HANDSHAKE-METHODS-1-2739T4.P13` — the third skewed request on one key suspends it
