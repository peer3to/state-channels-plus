# test/e2e/disputeValidation/disputeInputFields/timeout.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/timeout.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Eight tests audit the `dispute.input.timeout` claim conditions end-to-end, mostly by letting a
natural timeout fire (a peer that never writes) while one disputer's `constructDispute` or posted
dispute is tampered. Linkage and schedule violations are each killed by the matching proof type:
wrong `timeout.blockHeight` → `TimeoutNotLinkedToLatestState`; wrong `timeout.participant` →
`TimeoutParticipantNotNext`; a timeout posted before its wait period elapses → `TimeoutTooEarly`
plus an on-chain slash of the disputer; a forced timeout for a block whose calldata is already
on-chain → `TimeoutCalldataPosted`, with the honest killers verified absent from the slash set.
The `TimeoutTooEarly` group also covers the upload-side race guard (revert with
`RaceConditionDisputeTimeoutWindowCreatedTooEarly` when the window predates the claimed deadline),
a false-positive guard where a valid timeout dispute stores zero dispute fraud proofs, and a
forged `TimeoutTooEarly` against a legitimate dispute that slashes its author. A lifecycle test
asserts a peer that left the channel never initiates a phantom timeout dispute. Most matching
spec permutations bundle valid and invalid timeout scenarios or deadline boundary sweeps across
several of these tests, so they stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                      | Covers                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L13) (line 13)                       | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L56) (line 56)                                     | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > existing window predates timeout deadline → upload reverts with race-condition guard`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L94) (line 94)           | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L139) (line 139) | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L175) (line 175)         | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > TimeoutTooEarly > forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L213) (line 213)           | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > leaver does not dispute a timeout after leaving the channel`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L242) (line 242)                                                    | —                                                                                                      |
| [`E2E: dispute validation / disputeInputFields / timeout > dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/timeout.test.ts#L283) (line 283)    | [`REQ-ENFFP-1.T1.P3`](../../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1-t1-p3) |
