# DisputeUpdateHook.test.ts

Test file: [test/unit/DisputeUpdateHook.test.ts](../../../../../../test/unit/DisputeUpdateHook.test.ts)
Exercises: [P2pEventHooksUtils.ts](../../../../implementation/source/src/utils/P2pEventHooksUtils.ts.md)

## Overview

Both cases open a four-peer channel, let the next writer author an invalid state transition and wait
until the honest peers' disputes are committed and resolved. One honest peer's mirror and chain
`getWindowCommitments` reads are recorded (record-only; every read still reaches the real contract).

The first case requires no mirror read, at least one chain read, no failed read, and exactly one
`onDisputeUpdate` notification per `DisputeCommitted` event the peer handled. The second (which carries the permutation, as it shows both the chain read and the skip) makes the
peer's first chain read fail (an ABI-cut revert): exactly one read fails, that update notification is
skipped (one fewer notification than committed disputes), and the event pipeline has no failed block
and is not disposed.

## Tests

- `a committed dispute's update notification follows a chain read of the window's commitments, and no mirror read`: none
- `a failed chain read of the window's commitments skips that update notification and leaves the event pipeline running`: REQ-MIRROR-6-0WSB4V.T1.P31
