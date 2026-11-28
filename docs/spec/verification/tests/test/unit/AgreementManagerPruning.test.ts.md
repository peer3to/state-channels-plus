# AgreementManagerPruning.test.ts

Test file: [test/unit/AgreementManagerPruning.test.ts](../../../../../../test/unit/AgreementManagerPruning.test.ts)
Exercises: [AgreementManager.ts](../../../../implementation/source/src/agreementManager/AgreementManager.ts.md)

## Overview

Each case runs a live in-process channel through the harness with `PRUNE_HISTORY` set by the
session config or turned on for one peer with the `stub.setHistoryPruning` control; one peer that
prunes nothing serves the block, snapshot and state hashes per height (`heldHistoryAt`). The cases
let final points advance, post a snapshot to move the chain anchor, call the real
`reRootStoredProof` with and without a dispute mirrored on the fork (a real self-removal dispute,
waited for in the local diamond), and move the channel to a reduced fork. They assert, per height,
which blocks, snapshots and states the pruning peer holds, its stored proof, and its fork genesis.

## Tests

- `pruning on, final points advance over several blocks → the blocks and states between the anchor and the final point are gone; their snapshots, the final-point block with its state and the tail stay`: REQ-PROOFSTORE-8-R38KY5.T1.P2
- `pruning off (the default), final points advance over several blocks → every block, snapshot and state stays`: REQ-PROOFSTORE-8-R38KY5.T1.P1
- `pruning on, a snapshot update moves the chain anchor → below it the blocks, snapshots and states are gone; the anchor block with its snapshot and state and the fork genesis with its state stay`: REQ-PROOFSTORE-8-R38KY5.T1.P3, REQ-STOR-4-MF6FT6.T1.P1, REQ-STOR-4-MF6FT6.T1.P3
- `pruning on, a re-root while the local diamond mirrors a dispute on the fork → nothing below the new anchor is deleted`: REQ-PROOFSTORE-8-R38KY5.T1.P5, REQ-STOR-4-MF6FT6.T1.P2
- `pruning on, a re-root with no dispute mirrored on the fork → the history below the new anchor is deleted`: REQ-PROOFSTORE-8-R38KY5.T1.P4
- `pruning on, a dispute moves the chain anchor from a fork it was adopted on to a reduced fork → the left fork, still disputed in the mirror, keeps its history at every honest peer`: REQ-PROOFSTORE-8-R38KY5.T1.P6
