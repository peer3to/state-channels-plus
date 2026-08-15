# test/e2e/disputeValidation/invalidStateProofAuditing.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/invalidStateProofAuditing.test.ts](../../../../../../../test/e2e/disputeValidation/invalidStateProofAuditing.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test exercises the self-slash guard for a failing `DisputeInvalidStateProof` on the
calldata path. Peer 0 posts a valid dispute with real auditing data (captured via
`postTamperedDispute` with a no-op tamper), and the test waits for its commitment. Byzantine peer
2 then clones the real auditing data, replaces `latestFinalizedStateStateMachineState` with 128
random bytes so its hash no longer matches `dispute.input.disputeAuditingDataHash`, and submits it
directly through `applyDisputeFraudProofs`. The oracles assert the byzantine proof author is
slashed on-chain, the valid dispute's commitment is still present in the window's commitments, and
normal reduction settles the fork without the slashed participant (`resolveDisputeWait` with one
synthetic on-chain participant from the calldata setup). The failing-proof self-slash permutation
itself is assigned to the genesis-linkage sibling test, which additionally asserts the honest
target stays unslashed; after the permutation atomization this test records the facet-level
self-slash branch and the slash-then-reduce consumption invariant instead.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                        | Covers                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / invalidStateProofAuditing > [calldata posted] auditingData.latestFinalizedStateStateMachineState = random → proof author slashed; valid dispute resolves`](../../../../../../../test/e2e/disputeValidation/invalidStateProofAuditing.test.ts#L12) (line 12) | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p4), [`INV-DVP-6-RFSBRQ.T1.P1`](../../../../../implementation/views/architecture/sdk/dispute-pipeline.md#inv-dvp-6-rfsbrq.t1.p1) |
