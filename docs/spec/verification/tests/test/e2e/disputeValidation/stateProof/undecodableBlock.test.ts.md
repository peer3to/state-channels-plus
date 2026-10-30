# undecodableBlock.test.ts

Test file: [test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/undecodableBlock.test.ts)

## Overview

One robustness case at the decode boundary. `stubConstructDispute` replaces the last
milestone confirmation's `signedBlock.encodedBlock` with 128 junk bytes, so on-chain
`abi.decode` cannot parse it and `hasStateProofHeaderMismatch.staticCall` reverts instead of
returning a verdict. The behavior under test is that `DisputeValidationService` catches that
revert and still produces a fireable proof: the dispute (posted with auditing data) is
killed, honest peers store `DisputeInvalidStateProof`, and the window resolves. This is the
undecodable-with-posted-data → invalid branch of the audit's decode check; the
nothing-posted → unjudgeable/abstention branch is out of scope here. After the permutation
atomization the case carries the service's proof-decode-check-failure permutation; the
abstention split () is the out-of-scope branch,
and `REQ-DISPUTE-PIPE-2-MJRJV1` permutations still bundle whole corruption families, so nothing
else is assigned.

## Tests

- `stateProof.milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk → DisputeInvalidStateProof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P6
