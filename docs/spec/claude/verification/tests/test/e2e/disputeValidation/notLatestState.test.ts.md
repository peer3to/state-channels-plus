# test/e2e/disputeValidation/notLatestState.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/notLatestState.test.ts](../../../../../../../../test/e2e/disputeValidation/notLatestState.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test targets the truncated-suffix check: a disputer must present its own latest signed
state. After `preDisputeSetup` the channel advances three more transitions (peer 0 has signed up
to block 4), then peer 0's `constructDispute` is stubbed to call
`truncateStateProofToHeight(dispute, 2)`, so the uploaded dispute claims block 2 as latest while
peer 0's signature exists on block 4. Peer 1's double-sign block provokes the dispute. The oracles
assert peer 0's dispute is initiated and committed without auditing data, at least one honest peer
fires `onDisputeKilled`, honest peers store a `DisputeNotLatestState` dispute fraud proof, and the
fork resolves to a successor. What evidence the killer used to prove the newer signed block is not
inspected. The nearby spec permutations bundle several scenarios each, so the Covers column stays
empty.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                    | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / notLatestState > dispute.input.stateProof truncated below disputer's last signed block → DisputeNotLatestState`](../../../../../../../../test/e2e/disputeValidation/notLatestState.test.ts#L5) (line 5) | —      |
