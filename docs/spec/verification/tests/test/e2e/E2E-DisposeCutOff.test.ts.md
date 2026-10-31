# E2E-DisposeCutOff.test.ts

Test file: [test/e2e/E2E-DisposeCutOff.test.ts](../../../../../../test/e2e/E2E-DisposeCutOff.test.ts)

## Overview

Each case starts three worker participants and disposes one peer's runtime while that peer holds
real work through the harness stub: a participant's validation of the writer's gossiped block
(`confirmationValidation`), the writer between signing its block and gossiping it (`commit`), or a
dispute upload queued behind the signer's nonce mutex. The held work is released after the host's
cut-off by a control request that follows the dispose request on the host's port, so it runs on
inside the imploding runtime. The oracles are that `dispose()` settles below
`IN_FLIGHT_REPLY_DRAIN_MS`, that the other peers' captured inbound frames from the disposed peer's
address, read before `dispose()`, do not grow within a one-second window after it resolved, that
the disposed peer's chain nonce is unchanged, that no dispute is committed for the held upload,
that the session sees no unhandled failure, and that a fresh runtime for the same signer reaches
an engaged status. With the network cut removed from the cut-off, the `commit` case fails on the
frame oracle.

## Tests

- `dispose during in-flight ingest sends nothing after the cut (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during block production broadcasts nothing (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
- `dispose during a dispute upload held at the nonce mutex sends no transaction (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
