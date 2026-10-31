# E2E-DisposeCutOff.test.ts

Test file: [test/e2e/E2E-DisposeCutOff.test.ts](../../../../../../test/e2e/E2E-DisposeCutOff.test.ts)

## Overview

Each case starts three worker participants and disposes one peer's runtime while that peer holds
real work through the harness stub: a participant's validation of the writer's gossiped block
(`confirmationValidation`), the writer between signing its block and gossiping it (`commit`), or a
dispute upload queued behind the signer's nonce mutex. The held work is released after the host's
cut-off by a control request that follows the dispose request on the host's port, so it runs on
inside the imploding runtime. The oracles are that `dispose()` settles below five seconds, that the other peers' captured inbound frames from the disposed peer's
address, read before `dispose()`, do not grow within a one-second window after it resolved, that
the disposed peer's chain nonce is unchanged, that no dispute is committed for the held upload,
that the session sees no unhandled failure, and that a fresh runtime for the same signer reaches
an engaged status. With the network cut removed from the cut-off, the `commit` case fails on the
frame oracle.

The leak case starts three worker participants and holds one peer's disposal after its children,
inside the release of its provider's listeners, so the worker's realm, its static `Clock` reading
through that provider and its signer recovery cache outlive the cut. Before the disposal the
disposed peer and a live peer arm a probe timer and count streamed chain logs and double-signature
callbacks. While the disposal is held, a third peer requests a dispute (a chain log on the
channel) and each worker recovers two different signatures by one fresh wallet over one message.
Once the live peer saw the log, its timer and one double-signature log, the disposed peer has
recorded no timer run, no chain log and no double-signature callback; the disposal is then
released.

The sibling case disposes one inline peer, then has a live sibling's ingest of the writer's next
block collect work that rejects after the disposed peer's grace period: the session drain must
report that rejection. It tests the detached-promise registry that sibling runtimes share in one
realm, so it stays inline, and covers the harness's per-peer execution context, so it maps no ID.

## Tests

- `dispose during in-flight ingest sends nothing after the cut (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during block production broadcasts nothing (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
- `dispose during a dispute upload held at the nonce mutex sends no transaction (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `a disposed runtime's timer, chain logs and double-signature listener fire nothing while its disposal ends (worker)`: REQ-RUNTIME-3-VQXW59.T1.P92
- `an inline sibling's failure after a peer's disposal still surfaces in the drain`: none
