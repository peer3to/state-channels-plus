# reducedForkTimestampMismatch.test.ts

Test file: [test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts](../../../../../../../test/e2e/disputeValidation/reducedForkTimestampMismatch.test.ts)

## Overview

Long-running convergence test across two consecutive dispute reductions (fork A→B→C). Five peers
start; the next-to-write peer submits an invalid state-transition block, the resulting dispute is
resolved through `resolveDisputeWait`, and after the first reduction the test also waits for local
snapshots to change off the pre-dispute fork. A second attacker repeats the pattern on fork B.
After each reduction, and through six further honest state transitions on the twice-reduced fork,
the oracle is `assert.sync.peersInSyncWait` over the surviving honest peers — guarding the
regression where a reduced fork's genesis timestamp mismatch would desynchronize survivors. The
test asserts sync and fork settlement only; it does not inspect reduced-output contents,
slash sets, or on-chain snapshot advancement. After the permutation atomization, the
predecessor-case successor-fork permutations are single scenarios that this back-to-back
reduction covers: the second window runs on a fork that is itself a reduction product.

## Tests

- `fork A→B→C: two reductions then sustained honest activity → all survivors stay in sync`: REQ-DIS-6-Y92H1M.T1.P7, INV-DVP-5-NAJRB0.T1.P6
