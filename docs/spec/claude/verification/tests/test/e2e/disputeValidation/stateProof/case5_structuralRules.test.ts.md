# test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite pins the structural admission rules of `verifyStateProof` as auditors evaluate them
through the mirrored canonical logic: `preDisputeSetupCalldataPath` yields a milestones-only
proof, `stubConstructDispute` mutates peer 3's dispute, and peer 1's double-sign provides the
trigger. The first case copies a real milestone block into `stateProof.signedBlocks` so both
arrays are non-empty — the milestones-XOR-signedBlocks constraint rejects the proof and the
dispute dies with `DisputeInvalidStateProof` (the copy keeps headers matching so the header
check cannot fire first). The second empties `milestones[0].blockConfirmations`, which fails
milestone verification the same way. The third appends an unfinalized milestone confirmation
whose author signature belongs to a different signer, killed as
`DisputeInvalidBlockStructure`. Oracles throughout: dispute initiated with auditing data,
`onDisputeKilled` observed, the exact proof type stored by honest peers, and the window
resolved. Header-mismatch and replay-level tampers are out of scope (Case 4 and the
milestone-content suite). After the permutation atomization the tail-signature case carries
the block-structure-check permutation; the facet's suffix-break splits target signed-block
suffixes, not milestone confirmations, and the empty-confirmations case still matches no
single-scenario ID, so that row stays unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                        | Covers                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / structural rules > stateProof.milestones and stateProof.signedBlocks are mutually exclusive > stateProof.milestones.length > 0 AND stateProof.signedBlocks.length > 0 → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L6) (line 6) | [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P5`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p5)      |
| [`E2E: dispute validation / stateProof / structural rules > each milestone must have at least one blockConfirmation > stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L60) (line 60)                                       | —                                                                                                                                                                                              |
| [`E2E: dispute validation / stateProof / structural rules > unfinalized milestone block structure > invalid tail signature → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L104) (line 104)                                                                             | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P8`](../../../../../../implementation/source/src/stateManager/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p8) |
