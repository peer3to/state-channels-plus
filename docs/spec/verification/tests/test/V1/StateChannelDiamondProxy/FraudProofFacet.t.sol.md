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
the proof inert. Slashing and the other fraud-proof types (`applyFraudProofs` and its
bookkeeping) are out of scope here. The slash-outcome application permutations
([`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p1)–`P13`) each require proof application and its slash
outcome, which this suite never performs, so none of them is assigned here; the
predicate obligation [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04) is what this suite proves, and each of its
permutations maps to exactly one declaration below. One further declaration drives
`runFraudProof` itself on a `WrongGenesisHarness` (the facet deployed against its own empty
storage, wired to a real `UtilityFacet` so block authenticity resolves) to pin the revert a
wrong-genesis proof gets when the origin fork it names has no dispute window
([`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p14)).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                   | Covers                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`testFuzz_hasInvalidTimestamp_genesisNeverReverts`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L49) (line 49)                                    | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P1`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p1)   |
| [`testFuzz_hasInvalidTimestamp_nonGenesisNeverReverts`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L56) (line 56)                                 | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P2`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p2)   |
| [`testFuzz_hasInvalidTimestamp_validRegionHasNoHoles`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L71) (line 71)                                  | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P3`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p3)   |
| [`testFuzz_hasInvalidTimestamp_ignoresChannelAndFork`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L84) (line 84)                                  | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P4`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p4)   |
| [`testFuzz_hasInvalidTimestamp_honestBlockNeverFraud`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L101) (line 101)                                | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P5`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p5)   |
| [`test_hasInvalidTimestamp_firstBlockGraceBoundary`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L107) (line 107)                                  | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P6`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p6)   |
| [`test_hasInvalidTimestamp_laterBlockHasNoFirstBlockGrace`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L115) (line 115)                           | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P7`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p7)   |
| [`testFuzz_hasInvalidTimestamp_forgedSignatureInert`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L133) (line 133)                                 | [`UNIT-TEST-FRAUD-PROOF-FACET-2-RVFP04.P8`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-2-rvfp04.p8)   |
| [`test_runFraudProof_wrongGenesisWithoutDisputeWindow_revertsNamingTheMissingWindow`](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol#L142) (line 142) | [`UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md#unit-test-fraud-proof-facet-1-bwvnpg.p14) |
