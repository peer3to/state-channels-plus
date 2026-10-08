# E2E-StateTransition.test.ts

Test file: [test/e2e/E2E-StateTransition.test.ts](../../../../../../test/e2e/E2E-StateTransition.test.ts)

## Overview

Happy-path smoke suite for the core state-transition loop. It starts real 3–4 peer sessions
through the harness lifecycle, advances state through the real state-transition gossip path
(`h.transition.advanceState` by count and by full leader-rotation rounds), and asserts
convergence: all peers in sync and at the exact expected block height (n transitions after
genesis land at height n−1). The fourth test stages an invalid-state-transition dispute against a
malicious peer, resolves it on-chain, advances three more blocks on the reduced fork, and asserts
only the honest peers remain in sync — i.e. ordinary block production keeps working after fork
resolution. Oracles are the sync/height assertion helpers and dispute lifecycle waits only; the
suite inspects no queue, storage, signature, or timestamp detail. Fault classification, timing
windows, and queue behavior are out of scope (owned by the fraud-proof, timestamp-grace, and
BlockQueueManager suites). After the permutation atomization the round-robin leader-election
scenarios stand alone, so the full-rotation and post-fork-recovery tests carry their
`REQ-FIN-6-YZWJX2.T1` scenarios; the remaining candidates (signature/authentication variants,
`UNIT-TEST-STATE-TRANSITION-SERVICE-1-W4MKDS`.\*` gating) still have no dedicated demonstration here and
stay unassigned.

## Tests

- `should handle consecutive blocks between participants`: none
- `should handle full round rotation`: REQ-FIN-6-YZWJX2.T1.P1
- `should handle multiple rotation rounds`: none
- `should handle honest peer transitions after fork resolution`: REQ-FIN-6-YZWJX2.T1.P7
