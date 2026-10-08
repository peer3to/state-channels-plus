# outputState.test.ts

Test file: [test/e2e/disputeValidation/outputState.test.ts](../../../../../../../test/e2e/disputeValidation/outputState.test.ts)

## Overview

The single test checks that the validator recomputes the post-reduction output commitment from
the verified state proof plus dispute input and rejects mismatches. Peer 2's `constructDispute` is
stubbed to overwrite `dispute.outputSnapshotDataHash` with `hash("0x42")`; peer 1's double-sign
block provokes the dispute. The oracles assert peer 2's dispute is initiated and committed without
auditing data, an honest peer fires `onDisputeKilled`, honest peers store a
`DisputeInvalidOutputState` dispute fraud proof, and the fork resolves via `resolveDisputeWait`.
The selfRemoval-flipped variant that fails through the same proof type lives in
`disputeInputFields/selfRemoval.test.ts`. After the permutation atomization, the
output-correctness check failure, its proof family, and its mirrored-predicate agreement exist
as single-scenario IDs, and this test covers them in full.

## Tests

- `dispute.outputSnapshotDataHash = random → DisputeInvalidOutputState`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P21, UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P10, REQ-DISPUTE-PIPE-5-RZZB48.T1.P5
