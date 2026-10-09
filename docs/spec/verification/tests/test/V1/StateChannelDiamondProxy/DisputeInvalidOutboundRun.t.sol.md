# DisputeInvalidOutboundRun.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeInvalidOutboundRun.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeInvalidOutboundRun.t.sol)
Exercises: [StateProofFacet](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md)

## Overview

Applies `DisputeInvalidOutboundRun` through the dispute fraud-proof pipeline against a committed posted dispute
whose latest state holds outbound block 3 (withdrawals 35); the staged outbound chain is blocks 1 (10), 2 (20)
and 3 (5). Each case seeds the chain anchor directly. Valid runs (from the anchor, built at an older anchor and
then cut by a later one, from an anchor on another fork, empty with the anchor at or above the latest head) leave
the dispute committed and slash the challenger. A missing, forged or unlinked block, or an empty run while the
latest head is above the anchor, kills the dispute and slashes the disputer. So does a run with an extra linked block 4 above the latest head,
and a run whose block 2 keeps its predecessor and height but carries a `MaxUint256` message balance, which
overflows the anchor's withdrawals: the counter kills the dispute instead of reverting. A direct case calls
`verifyOutboundRunAboveAnchor` on a `UtilityFacet` wired to a real MathStateMachine: the overflowing run
returns invalid (with both blocks above the anchor) without a revert, and the genuine run returns valid.
Four cases forge the latest state itself (signed only by its author): its outbound head is the
overflowing block 2 right above the anchor, so links, height and end head pass and the balance
reaches `addBalance`. The direct verifier returns invalid with that one block above the anchor and no
revert; the counter `isDisputeOutboundRunInvalid` returns true and the allegation kills the dispute; a
`StateSnapshotFacet` post with that snapshot reverts `ErrorOutboundMessageBlocksInvalid`. A verifier
wired to a stand-in `addBalance` that loops until out of gas, called with 1,000,000 gas, reverts
`ErrorOutboundBalanceSumOutOfGas` instead of returning a verdict. Uncommitted data, omitted data and
committed data whose latest state is not the dispute's are rejected as no evidence. The oracles are the
commitment count and both slash records.

## Tests

- `test_outboundRun_runFromTheAnchorToTheLatestHeadIsValid`: REQ-DIS-12-AXY60R.T1.P1
- `test_outboundRun_runBuiltAtAnOlderAnchorStaysValidAfterTheAnchorMoves`: REQ-DIS-12-AXY60R.T1.P2
- `test_outboundRun_anchorOnAnOlderForkIsAStartAcrossTheForkGenesis`: REQ-DIS-12-AXY60R.T1.P3
- `test_outboundRun_emptyRunIsValidWhenTheAnchorHoldsTheLatestHead`: REQ-DIS-12-AXY60R.T1.P4
- `test_outboundRun_runBelowAnAnchorAtTheLatestHeadIsCutOff`: REQ-DIS-12-AXY60R.T1.P5
- `test_outboundRun_emptyRunIsValidWhenTheAnchorIsAboveTheLatestHead`: REQ-DIS-12-AXY60R.T1.P6
- `test_outboundRun_missingBlockAboveTheAnchorKills`: REQ-DIS-12-AXY60R.T1.P7
- `test_outboundRun_emptyRunBelowTheLatestHeadKills`: REQ-DIS-12-AXY60R.T1.P8
- `test_outboundRun_forgedBlockKills`: REQ-DIS-12-AXY60R.T1.P9
- `test_outboundRun_forgedLinkKills`: REQ-DIS-12-AXY60R.T1.P10
- `test_outboundRun_extraBlockAboveTheLatestHeadKills`: REQ-DIS-12-AXY60R.T1.P19
- `test_outboundRun_overflowingBalanceKills`: REQ-DIS-12-AXY60R.T1.P20, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P84
- `test_outboundRun_overflowingBalanceIsInvalidNotARevert`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P12
- `test_outboundRun_latestHeadAtAnOverflowingBlockIsInvalidNotARevert`: UNIT-TEST-UTILITY-FACET-1-ER4P0V.P13, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P77
- `test_outboundRun_latestHeadAtAnOverflowingBlockKills`: REQ-DIS-12-AXY60R.T1.P22, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P85
- `test_outboundRun_snapshotPostWithAnOverflowingHeadRejectsTheRun`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P47
- `test_outboundRun_outOfGasInTheSumIsNoVerdict`: REQ-DIS-12-AXY60R.T1.P23, UNIT-TEST-STATE-CHANNEL-COMMON-1-WJ73FK.P78
- `test_outboundRun_dataOtherThanTheCommittedDataIsNoEvidence`: REQ-DIS-12-AXY60R.T1.P11
- `test_outboundRun_omittedDataIsNoEvidence`: REQ-DIS-12-AXY60R.T1.P12
- `test_outboundRun_postedLatestStateOtherThanTheDisputesIsNoEvidence`: REQ-DIS-12-AXY60R.T1.P13
