# E2E-StoredProof.test.ts

Test file: [test/e2e/E2E-StoredProof.test.ts](../../../../../../test/e2e/E2E-StoredProof.test.ts)

## Overview

Two live-channel workflows check the stored proof's chain-driven writers on every peer. In the first,
three peers finalize blocks 0 and 1 and post a snapshot update: each peer's stored proof is re-rooted
at the posted snapshot, and a later final block advances it above that anchor. In the second, a
dispute moves a four-peer channel to a reduced fork: each honest peer's stored proof is on the new
fork, rooted at its installed genesis or at a later posted snapshot, with the state at its final
point; the old fork has no stored proof, and a final block on the new fork advances it.

## Tests

- `a snapshot update re-roots every peer's stored proof at the posted snapshot, and a later final block advances it above that anchor`: REQ-PROOFSTORE-4-XB8Z9W.T1.P2, REQ-PROOFSTORE-2-DBN7SY.T1.P4
- `a dispute moves the channel to a reduced fork → each honest peer's stored proof is on the new fork with its state, none on the old fork, and a final block advances it`: REQ-PROOFSTORE-5-ZH56D4.T1.P2
