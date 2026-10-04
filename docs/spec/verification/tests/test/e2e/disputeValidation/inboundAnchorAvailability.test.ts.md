# test/e2e/disputeValidation/inboundAnchorAvailability.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/inboundAnchorAvailability.test.ts](../../../../../../../test/e2e/disputeValidation/inboundAnchorAvailability.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite verifies the posted source of the moved inbound-anchor check: a posted dispute uses its
verified snapshot and creates `DisputeInboundAnchorBehindLatestState` when the claimed anchor is
behind it.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each ID is assigned to at most one test.

| Test declaration                                                                                                                                                                                                                           | Covers                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / inbound anchor availability > a posted snapshot with a behind inbound anchor creates the matching fraud proof`](../../../../../../../test/e2e/disputeValidation/inboundAnchorAvailability.test.ts#L7) (line 7) | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P1`](../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-2-7h4k2d.p1), [`REQ-DISPUTE-PIPE-5-RZZB48.T2.P1`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t2.p1) |
