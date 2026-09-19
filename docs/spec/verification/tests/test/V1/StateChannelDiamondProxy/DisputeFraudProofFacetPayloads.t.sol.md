# test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeFraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md), [DisputeManagerFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Five Foundry component tests pin the operands the dispute race-condition reverts carry, so a
payload that names the right error with the wrong values fails. Three drive the deployed diamond
(`DiamondHarness`); two drive `TimeoutTooEarlyPayloadHarness`, a test-only contract that inherits
`DisputeFraudProofFacet` and `UtilityFacet` and exposes the internal `_handleTimeoutTooEarly`
handler plus a single block-calldata-commitment seed — the production handler body still runs.

The first opens a channel, uploads a dispute so the evidence window opens at a known absolute
timestamp, then warps strictly past the window's evidence period and uploads a second dispute from
the other participant; the revert must name the period end computed from the first upload and the
later current timestamp as two different values. The second and fourth build a genesis snapshot
whose `originForkId` is a distinct constant and derive the claimed fork as the hash of that
snapshot data, with no dispute window on the origin fork and no matching on-chain snapshot, so the
chain cannot date the genesis; both timeout-proof pipelines — the `TimeoutTooEarly` handler and
the routed `validateTimeoutCalldataPostedProof` — must name channel, origin fork and target fork,
three mutually distinct hashes asserted distinct in the test. The third and fifth put a previous
block's calldata commitment on chain (seeded on the harness, and posted through the diamond's real
`postBlockCalldata` for the routed case) while the proof denies any on-chain timestamp for it; the
revert must carry that previous block's fork, height, author and stored commitment, each different
from the timed-out block's corresponding value, so a payload built from the wrong block fails.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                                                 | Covers                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_uploadDispute_evidencePeriodExpired_revertsCarryingPeriodEndAndCurrentTimestamp`](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol#L85) (line 85)                               | [`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P16`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md#unit-test-dispute-manager-facet-1-b4kky2.p16)            |
| [`test_handleTimeoutTooEarly_genesisTimestampUnavailable_revertsCarryingChannelOriginAndTargetForks`](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol#L111) (line 111)                | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P24`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p24) |
| [`test_handleTimeoutTooEarly_previousBlockCalldataPosted_revertsCarryingForkHeightAuthorAndCommitment`](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol#L145) (line 145)              | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P25`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p25) |
| [`test_validateTimeoutCalldataPostedProof_genesisTimestampUnavailable_revertsCarryingChannelOriginAndTargetForks`](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol#L187) (line 187)   | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P26`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p26) |
| [`test_validateTimeoutCalldataPostedProof_previousBlockCalldataPosted_revertsCarryingForkHeightAuthorAndCommitment`](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeFraudProofFacetPayloads.t.sol#L226) (line 226) | [`UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P27`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md#unit-test-dispute-fraud-proof-facet-1-qk8hq7.p27) |
