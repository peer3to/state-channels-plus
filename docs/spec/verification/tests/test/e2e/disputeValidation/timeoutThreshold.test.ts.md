# test/e2e/disputeValidation/timeoutThreshold.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/timeoutThreshold.test.ts](../../../../../../../test/e2e/disputeValidation/timeoutThreshold.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The test targets the timeout N/N threshold check. `stageTimeoutThresholdDispute` opens a channel
with two founders and adds a spectator that joins on chain while both founders stub the
inclusion of pending inbound messages, so no block applies the join. The joiner is
dispute-eligible on chain (a pending participant of the inbound chain) but is in no snapshot's
participant set, so it signs no block. It is cut off at its latest height L; the founders author
height L + 1 and both sign it. After the timeout deadline of L + 1 the joiner posts a timeout
dispute, with auditing data, that blames the author of L + 1. The joiner signed nothing above L,
so no `DisputeNotLatestState` proof exists, and L + 1 is signed by the participants of L and
L + 1. The oracles assert the posted dispute names the joiner and height L + 1, both founders fire
`onDisputeKilled`, both store exactly one dispute fraud proof of type `TimeoutThreshold`, and the
chain slashes the joiner.

The threshold counter is reachable only for a disputer outside the participant union of L and
L + 1: a disputer inside it must have signed L + 1, so `DisputeNotLatestState` is found first.
This test therefore carries the timeout-threshold IDs.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / timeoutThreshold > a pending joiner blames the author of a block every participant signed → TimeoutThreshold, killed on chain`](../../../../../../../test/e2e/disputeValidation/timeoutThreshold.test.ts#L10) (line 10) | [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P9`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p9), [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P18`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p18), [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P50`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p50), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P14`](../../../../../implementation/source/src/stateManager/dispute/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p14) |
