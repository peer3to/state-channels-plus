# E2E-DisposeCutOff.test.ts

Test file: [test/e2e/E2E-DisposeCutOff.test.ts](../../../../../../test/e2e/E2E-DisposeCutOff.test.ts)

## Overview

Each case starts three participants in one explicit mode (inline or worker) and disposes one
peer's runtime while that peer holds real work through the harness stub: a participant's
validation of the writer's gossiped block (`confirmationValidation`), the writer between signing
its block and gossiping it (`commit`), or a dispute upload queued behind the signer's nonce mutex.
The held work is released after the host's cut-off, so it runs on inside the imploding runtime:
inline on the disposed runtime's in-memory endpoint, in a worker by a control request that follows
the dispose request on the host's port. The oracles are that `dispose()` settles below
`IN_FLIGHT_REPLY_DRAIN_MS`, that the other peers' captured inbound frames from the disposed peer's
address, read before `dispose()`, do not grow within a one-second window after it resolved, that
the disposed peer's chain nonce is unchanged, that no dispute is committed for the held upload,
that the session sees no unhandled failure, and that a fresh runtime for the same signer reaches
an engaged status. With the network cut removed from the cut-off, both `commit` cases fail on the
frame oracle.

The inline leak case starts three inline participants with two blocks, hands the realm's `Clock`
the first peer's provider and disposes that peer, so its provider outlives the runtime. Before the disposal it
arms a `TimeoutManager` task and counts streamed chain logs and double-signature callbacks on the
disposed peer and on a live sibling. The disposal is held at its gas report, which runs after the
children step. While it is held, the third peer requests a dispute (a chain log on
the channel), and the test recovers two different signatures by one fresh wallet over one message
through the realm's signer recovery cache. Once the sibling saw the log and its timer fired, and
one more second passed, the sibling counts one double-signature callback and the disposed peer
counts no timer run, no chain log and no double-signature callback; the disposal is then released.
With the event listener released after the children step, the disposed peer counts the chain log.
It tests inline mode's shared realm and is kept while the SDK supports inline mode.

The sibling case disposes one inline peer, then has a live sibling's ingest of the writer's next
block collect work that rejects after the disposed peer's grace period: the session drain must
report that rejection. It covers the harness's per-peer execution context, so it maps no ID.

## Tests

- `dispose during in-flight ingest sends nothing after the cut (inline)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during in-flight ingest sends nothing after the cut (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during block production broadcasts nothing (inline)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
- `dispose during block production broadcasts nothing (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3, REQ-SDK-ARCH-2-QBZAT8.T1.P5
- `dispose during a dispute upload held at the nonce mutex sends no transaction (inline)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `dispose during a dispute upload held at the nonce mutex sends no transaction (worker)`: REQ-SDK-ARCH-2-QBZAT8.T1.P3
- `a disposed inline runtime's timer, chain logs and double-signature listener fire nothing afterwards`: REQ-RUNTIME-3-VQXW59.T1.P92
- `an inline sibling's failure after a peer's cut still surfaces in the drain`: none
