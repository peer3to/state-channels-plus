# test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One robustness case at the decode boundary. `stubConstructDispute` replaces the
`signedBlock.encodedBlock` of the last block in the last milestone with 128 junk bytes, so on-chain
`abi.decode` cannot parse it. `hasStateProofHeaderMismatch` does not revert on that block: it
skips it and reports no header mismatch. The behavior under test: the structure check of the last
milestone finds the undecodable position, so the dispute (posted with auditing data) is killed,
honest peers store `DisputeInvalidBlockStructure`, and the window resolves. An undecodable block in a milestone below the on-chain snapshot is not a structure
allegation; that case lives in `case6_proofStart.test.ts`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / undecodableBlock > stateProof.milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk → DisputeInvalidBlockStructure`](../../../../../../../../test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts#L12) (line 12) | [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P6`](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-1-xbca09.p6)<br>[`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P16`](../../../../../../implementation/source/src/stateManager/ingest/README.md#integration-test-ingest-admission-1-ea0c8h.p16) |
