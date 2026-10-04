# test/e2e/disputeValidation/stateProof/case2_empty.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case2_empty.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case2_empty.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

An honest empty-proof dispute end to end. `timeoutSetup(4)` opens a four-peer channel where no block is
ever authored, and peer 0 is marked AFK, so peers 1, 2 and 3 dispute it at genesis with the normal
dispute construction. The oracles: all three honest peers initiate a dispute, peer 1's dispute carries
a state proof with zero milestones (an empty proof is the fork genesis), the fork resolves with peers
1, 2 and 3 as reducers and without the AFK peer 0, and none of the honest peers is in the on-chain
slash set. Wrong-genesis and latest-hash
rejection cases for the empty proof live in
`test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts` under
"(1) stateProof empty".

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                  | Covers                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 2 (empty stateProof) > empty genesis timeout dispute resolves without honest slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case2_empty.test.ts#L8) (line 8) | [`REQ-SP-4-NCSEX4.T1.P27`](../../../../../../specification/disputes/state-proofs.md#req-sp-4-ncsex4.t1.p27) |
