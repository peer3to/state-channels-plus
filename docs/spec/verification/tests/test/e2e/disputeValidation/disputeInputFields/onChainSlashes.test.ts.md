# test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three tests attack `dispute.input.onChainSlashes`. First, a disputer appends an address that was
never slashed on-chain; the dispute commits, an honest peer kills it, and honest peers store a
`DisputeOnChainSlashesNotSubset` proof (resolution runs without asserting attacker removal, since
the winning counter-dispute is not controlled). Second, a participant is genuinely slashed and
evicted through a full dispute-and-resolve cycle, then a later dispute lists that address even
though it is no longer in the snapshot's participants — killed as `InvalidDisputeReason`. Third, a
dispute lists 8 random addresses (more than `maxSlashCount`); the oracle is that reduction must
not out-of-bounds panic, the fork resolves, and `slashedOnChainExactly` pins the final on-chain
slash set to exactly the two real offenders. Each test covers one side of the subset rule; after
the permutation atomization the slash-subset and stated-reason check failures, their proof
families, their mirrored-predicate agreements, and the adversarial-input reduction case are
single-scenario IDs covered below.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes includes address not slashed on-chain → DisputeOnChainSlashesNotSubset`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L6) (line 6)                         | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P12`](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p12), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P7`](../../../../../../implementation/source/src/stateManager/utils/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p7), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P8`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p8)                                                                                                              |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes contains address not in latestStateSnapshot participants → InvalidDisputeReason`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L47) (line 47)              | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P20`](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p20), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P13`](../../../../../../implementation/source/src/stateManager/utils/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p13), [`REQ-DISPUTE-PIPE-5-RZZB48.T1.P16`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48.t1.p16), [`REQ-DIS-1-XAJ1VA.T1.P5`](../../../../../../specification/disputes/disputes.md#req-dis-1-xaj1va.t1.p5) |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes has > maxSlashCount distinct addresses → reduce must not OOB-panic, both offenders slashed`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L101) (line 101) | [`REQ-DIS-4-6J6YYG.T1.P14`](../../../../../../specification/disputes/disputes.md#req-dis-4-6j6yyg.t1.p14)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
