# FraudProofFacet.t.sol

Test file: [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol)
Exercises: [FraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md)

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
the proof inert. The predicate obligation `UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04` is what this suite proves, and each of its
permutations maps to exactly one declaration below. Three further declarations drive
`runFraudProof` itself on a `WrongGenesisHarness` (the facet deployed against its own storage,
wired to a real `UtilityFacet` so block authenticity resolves, with the dispute window and
`evidenceTime` each case needs seeded directly) to pin the reverts a wrong-genesis proof gets on
the dispute-window path: the origin fork it names has no window at all
(`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14`), the
window is open but its kill period is still running, so the revert carries the deadline measured
from the last evidence submission next to the strictly earlier current timestamp
(`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P15`), and
the window leaves no genesis timestamp available, so the revert names the channel, the origin
fork and the block's fork as three distinct values
(`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P16`). Each
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

## Tests

- `testFuzz_hasInvalidTimestamp_genesisNeverReverts`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P1
- `testFuzz_hasInvalidTimestamp_nonGenesisNeverReverts`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P2
- `testFuzz_hasInvalidTimestamp_validRegionHasNoHoles`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P3
- `testFuzz_hasInvalidTimestamp_ignoresChannelAndFork`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P4
- `testFuzz_hasInvalidTimestamp_honestBlockNeverFraud`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P5
- `test_hasInvalidTimestamp_firstBlockGraceBoundary`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P6
- `test_hasInvalidTimestamp_laterBlockHasNoFirstBlockGrace`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P7
- `testFuzz_hasInvalidTimestamp_forgedSignatureInert`: UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P8
- `test_runFraudProof_wrongGenesisWithoutDisputeWindow_revertsNamingTheMissingWindow`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14
- `test_runFraudProof_wrongGenesisInsideKillPeriod_revertsNamingDeadlineAndCurrentTimestamp`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P15
- `test_runFraudProof_wrongGenesisWithoutGenesisTimestamp_revertsNamingChannelAndBothForks`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P16
- `test_applyFraudProofs_linkedHonestBlocksKeepSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P10
- `testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestFirstBlockSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P17
- `testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestLaterBlockSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P18
- `test_applyFraudProofs_wrongPredecessorSlashesParticipantSubmitter`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P23
- `test_applyFraudProofs_undecodablePredecessorRevertsWithoutSlashing`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P24
- `test_applyFraudProofs_unlinkedOtherForkSnapshotSlashesParticipantSubmitter`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P19
- `test_applyFraudProofs_linkedInvalidTransitionSlashesSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P20
- `test_applyFraudProofs_linkedOtherForkSnapshotSlashesSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P21
- `test_applyFraudProofs_linkedOtherForkLaterBlockSlashesSigner`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P25
- `testFuzz_applyDisputeFraudProofs_nestedUnlinkedSnapshotNeverKillsHonestDispute`: INV-ENFFP-1-BGVZN4.T1.P15
- `test_applyDisputeFraudProofs_nestedUnlinkedOtherForkSnapshotSlashesParticipantSubmitter`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P22
