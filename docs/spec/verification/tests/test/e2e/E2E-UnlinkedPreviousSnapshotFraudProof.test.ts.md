# test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts — Test Report

> **Test file:** [test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Both tests start a live three-peer channel that authors blocks 0 and 1, then read the real signed
blocks back from peer 0's storage. Each forged `BlockInvalidStateTransition` proof carries an honest
block and its real predecessor block, and peer 0's own snapshot with its fork id replaced, plus a
random state. Nothing links that snapshot to the block. The proof is applied on-chain through the
routed `applyFraudProofs`, and the oracle is the on-chain slash set. The outsider test submits a
proof against the first block and one against the later block from a funded non-participant
wallet, and checks that nobody is slashed. The participant test submits the later-block proof from
a participant who did not author it, and checks that only that submitter is slashed.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                      | Covers                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: unlinked previous snapshot in an invalid-transition proof > outsider forging the predecessor of an honest first and later block slashes nobody`](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts#L10) (line 10)      | [`INV-ENFFP-1-BGVZN4.T1.P12`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p12), [`INV-ENFFP-1-BGVZN4.T1.P13`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p13) |
| [`E2E: unlinked previous snapshot in an invalid-transition proof > participant forging the predecessor of an honest later block slashes only the submitter`](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts#L16) (line 16) | —                                                                                                                                                                                                                                  |
