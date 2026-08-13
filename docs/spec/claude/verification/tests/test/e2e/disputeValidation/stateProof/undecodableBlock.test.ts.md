# test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One robustness case at the decode boundary. `stubConstructDispute` replaces the last
milestone confirmation's `signedBlock.encodedBlock` with 128 junk bytes, so on-chain
`abi.decode` cannot parse it and `hasStateProofHeaderMismatch.staticCall` reverts instead of
returning a verdict. The behavior under test is that `DisputeValidationService` catches that
revert and still produces a fireable proof: the dispute (posted with auditing data) is
killed, honest peers store `DisputeInvalidStateProof`, and the window resolves. This is the
undecodable-with-posted-data → invalid branch of the audit's decode check; the
nothing-posted → unjudgeable/abstention branch is out of scope here. The related permutations
(`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P2` spans both unjudgeable causes;
`REQ-DISPUTE-PIPE-2` permutations bundle whole corruption families) are broader than this
single test, so no ID is assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                   | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / stateProof / undecodableBlock > stateProof.milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk → DisputeInvalidStateProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts#L11) (line 11) | —      |
