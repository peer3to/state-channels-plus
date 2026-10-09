# zeroTargetFraudProof.test.ts

Test file: [test/e2e/disputeValidation/zeroTargetFraudProof.test.ts](../../../../../../../test/e2e/disputeValidation/zeroTargetFraudProof.test.ts)

## Overview

Both tests apply a failing dispute fraud proof that declares `address(0)` as its target against an
honest committed dispute on the live chain. `lifecycle.timeoutSetup(4)` produces natural timeout
disputes and the tests wait for three commitments. The proof is `DisputeStateProofHeaderMismatch`
against peer 1's dispute, which has no header mismatch, so the handler returns the zero verdict.
It is sent through `tamper.submitForgedFraudProof` with an explicit submitter and target. The
oracles: the dispute's commitment is in the window before and after the submission, the receipt
has no `DisputeKilled` event, and the honest disputer is not slashed. The outsider test submits
from a funded non-participant wallet and checks that the on-chain slash set is unchanged. The
participant test submits from byzantine peer 2 and checks that peer 2 is slashed for the invalid
proof.

## Tests

- `outsider zero-target proof against an honest committed dispute -> no kill, no slash`: REQ-DIS-3-C4KYSF.T1.P19
- `participant zero-target proof against an honest committed dispute -> submitter slashed, disputer survives`: none
