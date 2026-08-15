# test/V1/UniversalDeployment.test.ts — Test Report

> **Test file:** [test/V1/UniversalDeployment.test.ts](../../../../../../test/V1/UniversalDeployment.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A Hardhat suite for the two deployment paths in `scripts/V1/deploy`. The Local Diamond half
drives `deployLocalDiamond` through a `LocalContractExecutorSigner` (the client-local EVM
executor) and then exercises the mirror's event-replication handlers on the deployed
`LocalDiamond`: stale `onWithdrawalsUpdated`/`onChannelStorageCleared` events (older timestamps
replayed after newer ones) must be ignored, duplicate `onOnChainSlashAdded` calls must
deduplicate, and a replayed `onDisputeCommitted` must leave exactly one commitment with the
newer evidence timestamp — oracles are the mirror's read-back views (`getChannelBalance`,
`getOnChainSlashedParticipants`, `getDisputeWindows`). The consumer-facet half deploys the
production proxy via `deploy` and asserts the constructor's zero-means-default timing sentinels
(`getAllTimes` → 15/5/30/30, gas limit 3,000,000), a custom dispute-execution gas limit, and
that `open` against a non-contract consumer facet address reverts. Channel protocol flows
(open/join/dispute semantics) are out of scope; the suite verifies deployment wiring and mirror
replication only, so no single Exercises component is named.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Universal Deployment > Local Diamond > deploys a local state machine directly with the signer`](../../../../../../test/V1/UniversalDeployment.test.ts#L50) (line 50)           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Universal Deployment > Local Diamond > deploys successfully`](../../../../../../test/V1/UniversalDeployment.test.ts#L58) (line 58)                                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Universal Deployment > Local Diamond > ignores stale overwrite events and deduplicates on-chain slashes`](../../../../../../test/V1/UniversalDeployment.test.ts#L70) (line 70) | [`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P1`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md#unit-test-local-diamond-1-pje47m.p1), [`UNIT-TEST-LOCAL-DIAMOND-1-PJE47M.P2`](../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md#unit-test-local-diamond-1-pje47m.p2), [`REQ-MIRROR-2-E9F3TM.T1.P1`](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm.t1.p1) |
| [`Universal Deployment > consumer facet Deployment > deploys with consumer facet`](../../../../../../test/V1/UniversalDeployment.test.ts#L168) (line 168)                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Universal Deployment > consumer facet Deployment > deploys with a custom dispute execution gas limit`](../../../../../../test/V1/UniversalDeployment.test.ts#L183) (line 183)  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [`Universal Deployment > consumer facet Deployment > fails with invalid consumer facet`](../../../../../../test/V1/UniversalDeployment.test.ts#L195) (line 195)                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
