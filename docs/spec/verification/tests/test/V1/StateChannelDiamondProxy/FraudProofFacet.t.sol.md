# test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [FraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Foundry property suite that drives the `hasInvalidTimestamp` predicate through the deployed
diamond (`DiamondHarness.deployDiamond()`, typed as `StateChannelManagerInterface` — the
harness deploys the proxy and hands back its full routed surface), building signed
`InvalidTimestampProof`s for both branches: genesis (previous state snapshot) and non-genesis
(previous signed block). The oracles are the boolean verdicts of the predicate: neither branch
ever reverts on attacker-influenceable timestamps, the valid-timestamp region is one contiguous
interval (no valid/invalid/valid holes), the verdict is insensitive to `channelId`/`forkId`,
honest skew up to `evidenceTime + P2P_TIME` is never flagged, the first-block grace boundary and
the later-block no-grace boundary flip at exactly +1 second, and a forged author signature makes
the proof inert. The predicate obligation [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04) is what this suite proves, and each of its
permutations maps to exactly one declaration below. Three further declarations drive
`runFraudProof` itself on a `WrongGenesisHarness` (the facet deployed against its own storage,
wired to a real `UtilityFacet` so block authenticity resolves, with the dispute window and
`evidenceTime` each case needs seeded directly) to pin the reverts a wrong-genesis proof gets on
the dispute-window path: the origin fork it names has no window at all
([`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p14)), the
window is open but its kill period is still running, so the revert carries the deadline measured
from the last evidence submission next to the strictly earlier current timestamp
([`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P15`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p15)), and
the window leaves no genesis timestamp available, so the revert names the channel, the origin
fork and the block's fork as three distinct values
([`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P16`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p16)). Each
expected payload is hand-derived in the test from the seeded values, never read back out of the
facet.

The last eleven declarations apply invalid-transition proofs through the diamond's routed
`applyFraudProofs` and `applyDisputeFraudProofs` on a real open channel of three participants. The
staged blocks are honest `add(1)` blocks built as clients build them: the replayed snapshot keeps
the parent `originForkId` (asserted) and a first block keeps height 0. The first declaration
checks that genuine predecessors slash only the participant who submitted the false proof. The
fuzz cases keep honest blocks and give the handler full-range previous snapshots and states, and
decodable predecessor blocks that are not the real one; each call must succeed. The oracle is the
on-chain slash set: no signer is ever slashed, a non-participant submitter changes nothing, and an
undecodable predecessor reverts the call. The same unlinked proof nested in a dispute proof never
kills the honest dispute holding the block. Three cases keep the true positives: a linked
predecessor whose replay misses the block's snapshot hash, and a first or later block that links
to another fork's snapshot, all slash the signer.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                          | Covers                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`testFuzz_hasInvalidTimestamp_genesisNeverReverts`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L76) (line 76)                                           | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p1)   |
| [`testFuzz_hasInvalidTimestamp_nonGenesisNeverReverts`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L83) (line 83)                                        | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P2`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p2)   |
| [`testFuzz_hasInvalidTimestamp_validRegionHasNoHoles`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L98) (line 98)                                         | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P3`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p3)   |
| [`testFuzz_hasInvalidTimestamp_ignoresChannelAndFork`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L111) (line 111)                                       | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p4)   |
| [`testFuzz_hasInvalidTimestamp_honestBlockNeverFraud`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L128) (line 128)                                       | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P5`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p5)   |
| [`test_hasInvalidTimestamp_firstBlockGraceBoundary`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L134) (line 134)                                         | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P6`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p6)   |
| [`test_hasInvalidTimestamp_laterBlockHasNoFirstBlockGrace`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L142) (line 142)                                  | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P7`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p7)   |
| [`testFuzz_hasInvalidTimestamp_forgedSignatureInert`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L160) (line 160)                                        | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P8`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p8)   |
| [`test_runFraudProof_wrongGenesisWithoutDisputeWindow_revertsNamingTheMissingWindow`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L193) (line 193)        | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p14) |
| [`test_runFraudProof_wrongGenesisInsideKillPeriod_revertsNamingDeadlineAndCurrentTimestamp`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L206) (line 206) | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P15`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p15) |
| [`test_runFraudProof_wrongGenesisWithoutGenesisTimestamp_revertsNamingChannelAndBothForks`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L234) (line 234)  | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P16`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p16) |
| [`test_applyFraudProofs_linkedHonestBlocksKeepSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L345) (line 345)                                       | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P10`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p10) |
| [`testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestFirstBlockSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L366) (line 366)             | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P17`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p17) |
| [`testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestLaterBlockSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L379) (line 379)             | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P18`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p18) |
| [`test_applyFraudProofs_wrongPredecessorSlashesParticipantSubmitter`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L403) (line 403)                        | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P23`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p23) |
| [`test_applyFraudProofs_undecodablePredecessorRevertsWithoutSlashing`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L426) (line 426)                       | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P24`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p24) |
| [`test_applyFraudProofs_unlinkedOtherForkSnapshotSlashesParticipantSubmitter`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L443) (line 443)               | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P19`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p19) |
| [`test_applyFraudProofs_linkedInvalidTransitionSlashesSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L460) (line 460)                               | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P20`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p20) |
| [`test_applyFraudProofs_linkedOtherForkSnapshotSlashesSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L486) (line 486)                               | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P21`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p21) |
| [`test_applyFraudProofs_linkedOtherForkLaterBlockSlashesSigner`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L507) (line 507)                             | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P25`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p25) |
| [`testFuzz_applyDisputeFraudProofs_nestedUnlinkedSnapshotNeverKillsHonestDispute`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L556) (line 556)           | [`INV-ENFFP-1-BGVZN4.T1.P15`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p15)                                                                      |
| [`test_applyDisputeFraudProofs_nestedUnlinkedOtherForkSnapshotSlashesParticipantSubmitter`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L570) (line 570)  | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P22`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p22) |
