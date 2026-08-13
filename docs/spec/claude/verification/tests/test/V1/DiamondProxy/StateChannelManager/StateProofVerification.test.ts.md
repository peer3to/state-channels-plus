# test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateProofFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Hardhat robustness suite that static-calls the state-proof entry points routed through the Math
channel proxy — `verifyStateProof`, `isCorrectLatestState`, `verifyMilestones`,
`isMilestoneFinal` — on a locally built genesis dispute (Codec-encoded `SnapshotData`, derived
fork id, matching `disputeAuditingDataHash`). Every test then corrupts one input: mismatched
auditing data against the committed hash, or undecodable signed-block/milestone bytes
(`0x1234`), and the single oracle is that each entry returns `false` (plus the zero hash for
`isMilestoneFinal`) instead of reverting — the tryDecode-style graceful-failure contract that
keeps a malformed proof from bricking dispute verification. No positive verification of a real
milestone chain, membership hops, suffix linkage, or threshold signatures happens here. The
planned `UNIT-TEST-STATE-PROOF-FACET-1` permutations all target those verification semantics
(valid chains, hop thresholds, first-invalid indexes), and `UNIT-TEST-UTILITY-FACET-1.P4`
("tryDecode paths") bundles the valid-decode half this suite never exercises, so no ID is fully
covered and all rows stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                            | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`StateChannelManagerProxy.verifyStateProof > returns false when supplied auditing data does not match disputeAuditingDataHash`](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L25) (line 25)          | —      |
| [`StateChannelManagerProxy.verifyStateProof > returns false instead of reverting when signedBlocks contain undecodable bytes`](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L40) (line 40)            | —      |
| [`StateChannelManagerProxy.verifyStateProof > isCorrectLatestState returns false instead of reverting when latest block is undecodable`](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L52) (line 52)  | —      |
| [`StateChannelManagerProxy.verifyStateProof > verifyMilestones returns false instead of reverting when a milestone block is undecodable`](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L64) (line 64) | —      |
| [`StateChannelManagerProxy.verifyStateProof > isMilestoneFinal returns false instead of reverting when a milestone block is undecodable`](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L78) (line 78) | —      |
