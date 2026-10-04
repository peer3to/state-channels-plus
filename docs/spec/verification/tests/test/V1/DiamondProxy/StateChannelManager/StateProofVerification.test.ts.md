# test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateProofFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Hardhat suite that calls the state-proof entry points routed through the Math channel proxy on a
locally built genesis dispute (factory `SnapshotData`, the fork ID derived from it, and a matching
`disputeAuditingDataHash`). Four robustness cases corrupt one input — auditing data that does not
match the committed hash, or a milestone whose one block is undecodable (`0x1234`) — and assert
that `verifyStateProof`, `isCorrectLatestState`, `verifyMilestones` (`valid` false) and
`isMilestoneFinal` (false plus the zero hash) return a negative answer instead of reverting, so a
malformed proof cannot brick dispute verification. The `isCorrectLatestState` case reads the latest
block through `tryDecodeBlock`, so it demonstrates the invalid-decode half of tryDecode
([`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p7)); the valid-decode half
([`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P4`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p4)) is not exercised here.

One routing case calls `getAnchorSnapshot`, `verifyMilestones` and `isStateProofLinked` through
the proxy with an empty proof on a channel the chain does not hold: `canUseOnChainSnapshot` is false
and the stored snapshot is empty, the walk is valid and its finalized snapshot is the fork genesis the dispute names, and
the empty proof is linked. No real milestone chain, membership hop or threshold signature is
verified here; those walk semantics are covered by the Foundry walk suite.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`StateChannelManagerProxy.verifyStateProof > returns false when supplied auditing data does not match disputeAuditingDataHash`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L23) (line 23)          | [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P56`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p56)                                                                                                                                                                                 |
| [`StateChannelManagerProxy.verifyStateProof > isCorrectLatestState returns false instead of reverting when latest block is undecodable`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L38) (line 38)  | [`UNIT-TEST-UTILITY-FACET-1-ER4P0V.P7`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol.md#unit-test-utility-facet-1-er4p0v.p7), [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P57`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p57) |
| [`StateChannelManagerProxy.verifyStateProof > verifyMilestones returns false instead of reverting when a milestone block is undecodable`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L50) (line 50) | [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P63`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p63)                                                                                                                                                                                 |
| [`StateChannelManagerProxy.verifyStateProof > isMilestoneFinal returns false instead of reverting when a milestone block is undecodable`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L64) (line 64) | [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P64`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p64)                                                                                                                                                                                 |
| [`StateChannelManagerProxy.verifyStateProof > routes getAnchorSnapshot, verifyMilestones and isStateProofLinked through the proxy`](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts#L76) (line 76)       | [`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P78`](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md#unit-test-state-proof-facet-1-jsb4sr.p78)                                                                                                                                                                                 |
