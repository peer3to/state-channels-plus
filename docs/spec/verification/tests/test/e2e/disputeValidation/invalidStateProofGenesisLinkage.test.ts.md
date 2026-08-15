# test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts](../../../../../../../test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test proves that a failing `DisputeInvalidStateProof` submission slashes its submitter
and leaves its honest target untouched. `lifecycle.timeoutSetup(4)` produces natural timeout
disputes; the test confirms the honest disputer's dispute is a non-posted genesis dispute (empty
`stateProof`, `postedAuditingData === false`). Byzantine peer 2 fetches the real auditing data for
that empty proof via `dispute.getAuditingData`, corrupts
`genesisStateSnapshotData.stateMachineStateHash` so `keccak256(genesisStateSnapshotData)` no
longer equals the forkId (unlinked genesis), and applies the proof against the honest dispute
through `applyDisputeFraudProofs`. The oracles read the on-chain slash set directly: the honest
disputer must not appear in it, and the byzantine submitter must. Dispute resolution and reduction
are out of scope — the test ends at the slash assertions. The other permutations of the same plan
item (declared-vs-proven mismatch, mirror preflight) are separate scenarios and stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                | Covers                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / DisputeInvalidStateProof genesis linkage > unlinked genesisStateSnapshotData against a valid genesis dispute → submitter slashed, honest disputer survives`](../../../../../../../test/e2e/disputeValidation/invalidStateProofGenesisLinkage.test.ts#L12) (line 12) | [`REQ-ENFFP-1-BREACW.T1.P1`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1-breacw.t1.p1) |
