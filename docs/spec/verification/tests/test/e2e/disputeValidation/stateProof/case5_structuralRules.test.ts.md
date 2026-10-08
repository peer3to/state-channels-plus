# test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite submits disputes with malformed milestone proofs and observes real audit counters
and dispute kills. An empty milestone produces `DisputeInvalidStateProof`. An invalid tail
author signature, a broken previous-block hash and a skipped height in a genesis block-zero
run produce `DisputeInvalidBlockStructure`. The tests mutate real constructed disputes and
check the stored counter type and the resulting window. The table assigns only permutations
fully established by each declaration; these cases do not establish cross-milestone identity
consistency for two differently signed blocks.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                                                           | Covers                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / stateProof / structural rules > each milestone must have at least one blockConfirmation > stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L7) (line 7)               | —                                                                                                                                                                                                      |
| [`E2E: dispute validation / stateProof / structural rules > unfinalized milestone block structure > invalid tail signature → DisputeInvalidBlockStructure`](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L49) (line 49)                                                     | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P8`](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p8) |
| [`E2E: dispute validation / stateProof / structural rules > unfinalized milestone block structure > genesis block-0 milestone blockConfirmations[1].previousBlockHash = random → DisputeInvalidBlockStructure`](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L96) (line 96) | —                                                                                                                                                                                                      |
| [`E2E: dispute validation / stateProof / structural rules > unfinalized milestone block structure > genesis block-0 milestone skipped height → DisputeInvalidBlockStructure`](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L144) (line 144)                                 | —                                                                                                                                                                                                      |
