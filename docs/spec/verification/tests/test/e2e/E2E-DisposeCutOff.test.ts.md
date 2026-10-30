# E2E-DisposeCutOff.test.ts

Test file: [test/e2e/E2E-DisposeCutOff.test.ts](../../../../../../test/e2e/E2E-DisposeCutOff.test.ts)

## Overview

Each case starts three participants in one explicit mode (inline or worker) and disposes one
peer's runtime while that peer holds real block work through the harness stub: a participant's
validation of the writer's gossiped block (`confirmationValidation`), or the writer between
signing its block and gossiping it (`commit`). Inline, the held work is released on the disposed
runtime's in-memory endpoint after the host's cut-off, so it runs on inside the imploding runtime.
The oracles are that `dispose()` settles below `IN_FLIGHT_REPLY_DRAIN_MS` (a worker writer still
holds the client's authoring request, so its reply drain may take that bound plus slack), that
the other peers' host-side count of inbound frames from the disposed peer's address does not grow
after `dispose()` resolved, that the disposed peer's chain nonce is unchanged, that the session
sees no unhandled failure, and that a fresh runtime for the same signer reaches an engaged status.

## Tests

- `dispose during in-flight ingest sends nothing after the cut (inline)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during in-flight ingest sends nothing after the cut (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during block production broadcasts nothing (inline)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
- `dispose during block production broadcasts nothing (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
