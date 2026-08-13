# test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the auditor's milestone-snapshot consistency checks end to end:
`setupTwoLeaversAcrossMilestones` builds a fork whose state proof carries three milestones
(M1/M2/M3), and `postTamperedDispute` posts peer 0's dispute after mutating the M2 row of the
calldata auditing data and recomputing `disputeAuditingDataHash`, so the upload passes the
hash-binding gate and the corruption must be caught by the audit. The tampers are: a random
`latestInboundMessageBlockHash` in the M2 snapshot (1.1), the M2 row replaced by M3's snapshot
(1.3) or M1's snapshot (1.4), and — with the pending join staged inline between M1 and M2 —
the M2 participant list stripped of the pending joiner (1.5). The oracle is the honest
auditors' reaction: peers 0, 1, and 3 observe `onDisputeKilled`, and peers 1 and 3 store a
`DisputeInvalidStateProof` dispute fraud proof. Case 1.2 (honest M2 row) is skipped as
redundant with the valid disputes other suites already commit on honest setups. Upload-gate
reverts and signedBlocks-only proofs are out of scope (`uploadRevert/` and Case 3). After the
permutation atomization, Case 1.1 carries the mirrored `DisputeInvalidStateProof` predicate
permutation; the remaining [`REQ-SP-3-SP1JG4`](../../../../../../specification/disputes/state-proofs.md#req-sp-3-sp1jg4)/[`REQ-SP-7-70EMAT`](../../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat) and [`REQ-DISPUTE-PIPE-2-MJRJV1`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1) scenarios still
have no single-test match here — the tampers hit auditing-data snapshot rows, not hop
signatures or thresholds — so they stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                       | Covers                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.1: auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = random > Case 1.1 → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts#L17) (line 17)                     | [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P6`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p6) |
| [`E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.2: auditingData.milestoneSnapshots[1] left honest (M2 inbound hash valid, snapshot matches M2) > → dispute commits without DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts#L56) (line 56) | —                                                                                                                                   |
| [`E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.3: auditingData.milestoneSnapshots[1] = milestoneSnapshots[2] (M2 row claims M3 snapshot, skip-ahead) > Case 1.3 → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts#L60) (line 60)         | —                                                                                                                                   |
| [`E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.4: auditingData.milestoneSnapshots[1] = milestoneSnapshots[0] (M2 row claims M1 snapshot, stay-back) > Case 1.4 → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts#L97) (line 97)          | —                                                                                                                                   |
| [`E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.5: auditingData.milestoneSnapshots[1].snapshotData.participants omits pending joiner (M1 colluding on M2) > Case 1.5 → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts#L134) (line 134)   | —                                                                                                                                   |
