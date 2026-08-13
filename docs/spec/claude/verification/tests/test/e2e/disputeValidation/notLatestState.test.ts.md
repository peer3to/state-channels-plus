# test/e2e/disputeValidation/notLatestState.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/notLatestState.test.ts](../../../../../../../../test/e2e/disputeValidation/notLatestState.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test targets the truncated-suffix check: a disputer must present its own latest signed
state. After `preDisputeSetup` the channel advances three more transitions (peer 0 has signed up
to block 4), then peer 0's `constructDispute` is stubbed to call
`truncateStateProofToHeight(dispute, 2)`, so the uploaded dispute claims block 2 as latest while
peer 0's signature exists on block 4. Peer 1's double-sign block provokes the dispute. The oracles
assert peer 0's dispute is initiated and committed without auditing data, at least one honest peer
fires `onDisputeKilled`, honest peers store a `DisputeNotLatestState` dispute fraud proof, and the
fork resolves to a successor. What evidence the killer used to prove the newer signed block is not
inspected. After the permutation atomization, the disputer-latest-state check failure, its proof
family, and its mirrored-predicate agreement exist as single-scenario IDs, and this test covers
them in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / notLatestState > dispute.input.stateProof truncated below disputer's last signed block → DisputeNotLatestState`](../../../../../../../../test/e2e/disputeValidation/notLatestState.test.ts#L5) (line 5) | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P14`](../../../../../implementation/source/src/stateManager/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1.p14), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1.P9`](../../../../../implementation/source/src/stateManager/utils/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1.p9), [`REQ-DISPUTE-PIPE-5.T1.P1`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-t1-p1) |
