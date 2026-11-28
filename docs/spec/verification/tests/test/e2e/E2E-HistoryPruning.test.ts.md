# E2E-HistoryPruning.test.ts

Test file: [test/e2e/E2E-HistoryPruning.test.ts](../../../../../../test/e2e/E2E-HistoryPruning.test.ts)

## Overview

Every case runs with `PRUNE_HISTORY` on for all peers through the session config. Two cases
finalize blocks, post a snapshot and finalize more before they act: a new spectator then syncs from
the pruned participants, or honest peers dispute an invalid transition and the dispute reduces to
the next fork. The side-chain case stages the seated-joiner history and posts the colluders' bypass
dispute; the joiner's real audit stores and sends the final-point regression kill. The own-upload
case leaves the writer without one signature on its block, so the silenced peer's final point is
later and its pruning removes the state at the writer's final point; the writer goes offline, the
others author one more block, and the writer's own self-removal dispute omits its auditing data.
Oracles are each peer's held blocks and stored proof, counters, recorded kills and uploads, chain
dispute logs, slashes, and the peers' local fork.

## Tests

- `past several final points and a chain anchor advance, every participant keeps only the anchor block below its final point, and a new spectator syncs from the pruned peers and follows the channel`: REQ-PROOFSTORE-8-R38KY5.T1.P7, REQ-STOR-4-MF6FT6.T1.P4
- `past several final points and a chain anchor advance, honest peers dispute an invalid transition: no auditor stores a counter, the dispute reduces to the next fork and every honest peer follows it`: REQ-PROOFSTORE-8-R38KY5.T1.P8
- `pruning on, the colluders' dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is still killed by Charlie's DisputeFinalPointRegression, and exactly Alice and Bob are slashed`: REQ-PROOFSTORE-8-R38KY5.T1.P9, REQ-STOR-4-MF6FT6.T1.P5
- `pruning on, an auditor whose state at the disputer's final point is pruned (its own final point and latest state are later) does not judge that proof, stores no counter, sends no kill, and its own dispute upload lands on chain`: REQ-PROOFSTORE-8-R38KY5.T1.P10
