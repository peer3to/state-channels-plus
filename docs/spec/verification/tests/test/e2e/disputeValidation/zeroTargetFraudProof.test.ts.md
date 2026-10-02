# test/e2e/disputeValidation/zeroTargetFraudProof.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/zeroTargetFraudProof.test.ts](../../../../../../../test/e2e/disputeValidation/zeroTargetFraudProof.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Both tests apply a failing dispute fraud proof that declares `address(0)` as its target against an
honest committed dispute on the live chain. `lifecycle.timeoutSetup(4)` produces natural timeout
disputes and the tests wait for three commitments. The proof is `DisputeStateProofHeaderMismatch`
against peer 1's dispute, which has no header mismatch, so the handler returns the zero verdict.
The oracles read the transaction receipt and the on-chain slash set: no `DisputeKilled` event is
emitted and the honest disputer is not slashed. The outsider test submits from a funded
non-participant wallet and also checks that nobody is slashed for it. The participant test submits
from byzantine peer 2 and checks that peer 2 is slashed for the invalid proof.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                      | Covers                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`E2E: dispute validation / zero-target dispute fraud proof > outsider zero-target proof against an honest committed dispute -> no kill, no slash`](../../../../../../../test/e2e/disputeValidation/zeroTargetFraudProof.test.ts#L8) (line 8)                         | [`REQ-DIS-3-C4KYSF.T1.P19`](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf.t1.p19) |
| [`E2E: dispute validation / zero-target dispute fraud proof > participant zero-target proof against an honest committed dispute -> submitter slashed, disputer survives`](../../../../../../../test/e2e/disputeValidation/zeroTargetFraudProof.test.ts#L29) (line 29) | —                                                                                                      |
