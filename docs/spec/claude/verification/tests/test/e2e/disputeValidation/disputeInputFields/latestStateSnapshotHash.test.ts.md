# test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Nine tests sweep the binding between `dispute.input.latestStateSnapshotHash` and the state
proof's latest block across the three proof shapes — (1) empty proof claiming genesis, (2)
signedBlocks-only, (3) milestones-only — crossed with the no-calldata and calldata-posted upload
paths and with fully synced versus disconnected auditors. Each test stubs the disputer's
`constructDispute` to randomize the hash (the empty-shape cases also clear milestones and
signedBlocks; shape expectations are guarded via `expectMilestonesOnlyStateProof` /
`expectSignedBlocksOnlyStateProof`), provokes the dispute with a byzantine double-sign or
invalid-state-transition block, and asserts initiation with the expected auditing-data flag, an
`onDisputeKilled` from a named auditor, a stored `DisputeInvalidStateProof` dispute fraud proof,
and fork resolution. The disconnected-auditor variants pin the kill on the peer whose local
storage is stale or genesis-only, showing the audit pipeline reconstructs what it needs from
on-chain events. Every test here is an invalid-side case; the applicable spec permutations bundle
valid and invalid scenarios (and the state-proof linkage IDs belong to the stateProof suite), so
no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (1) stateProof empty — genesis (no milestones, no signedBlocks) > all peers are in sync > [no calldata] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L12) (line 12)                                                 | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L49) (line 49)                                                                             | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (3) stateProof.milestones only — last milestone block commits to hash > auditor peer 3 disconnected — local storage stale, pipeline still kills > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 3)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L83) (line 83)        | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (2) stateProof.signedBlocks only — last signedBlock commits to hash > peers synced — auditor peer 0 has full signedBlocks chain locally > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 0)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L126) (line 126)              | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > no calldata > (2) stateProof.signedBlocks only — last signedBlock commits to hash > auditor peer 2 disconnected — local storage genesis-only, pipeline still kills > [no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L160) (line 160) | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (1) stateProof empty — genesis (no milestones, no signedBlocks) > all peers are in sync > [calldata posted] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L201) (line 201)                                       | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > all peers are in sync > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L241) (line 241)                                                                   | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (3) stateProof.milestones only — last milestone block commits to hash > peers not synced — auditor peer 1 disconnected (misses latest block) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L277) (line 277) | —      |
| [`E2E: dispute validation / disputeInputFields / latestStateSnapshotHash > calldata posted > (2) stateProof.signedBlocks only — last signedBlock commits to hash > peers not synced — auditor peer 2 disconnected (calldata forced) > [calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts#L342) (line 342)       | —      |
