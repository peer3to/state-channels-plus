# test/e2e/disputeValidation/stateProof/case5_lastMilestoneFinalityAndAuditingData.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case5_lastMilestoneFinalityAndAuditingData.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_lastMilestoneFinalityAndAuditingData.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single case for the no-auditing-data admission rule. After a voluntary leave and a further
transition give the fork milestone structure, `stubConstructDispute` forces peer 2's dispute
to claim `postedAuditingData = false` while the proof's last milestone lacks threshold
finality; peer 1's invalid state-transition block provides the dispute trigger. The oracle:
all peers observe `onDisputeKilled`, honest peers store a
`DisputeLastMilestoneNotFinalAndNoAuditingData` dispute fraud proof, and the dispute window
resolves. This is the canonical, chain-checkable branch of the without-posted-data rule — an
upload whose last anchor is not provably final must post its data, so auditors kill rather
than abstain; the unjudgeable/abstention branch and calldata-path verification are out of
scope. The applicable permutations (`REQ-DISPUTE-PIPE-2.T1.P4` "incomplete evidence",
`REQ-SP-1` finality bundles) cover wider evidence families than this single scenario, so no
ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                        | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / stateProof / last-milestone finality and auditing data > dispute.postedAuditingData = false AND stateProof.milestones[-1] is not final > → DisputeLastMilestoneNotFinalAndNoAuditingData`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_lastMilestoneFinalityAndAuditingData.test.ts#L6) (line 6) | —      |
