# test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts — Test Report

> **Test file:** [test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Each test starts a live three-peer channel that authors blocks 0 and 1, then reads the real signed
blocks back from peer 0's storage with their stored predecessor data: the real predecessor block,
the snapshot it commits to (the genesis snapshot for block 0) and that snapshot's state. The first
two tests forge that snapshot onto another fork with a random state, so nothing links it to the
block. The third test sends the genuine predecessor data unchanged, which reaches the on-chain
replay of client-built blocks. The proof is applied on-chain through the
routed `applyFraudProofs`, and the oracle is the on-chain slash set. The outsider test submits a
proof against the first block and one against the later block from a funded non-participant
wallet, and checks that nobody is slashed. The participant test submits the later-block proof from
a participant who did not author it, and checks that only that submitter is slashed. The genuine
test submits both genuine proofs from the outsider and expects nobody slashed, then the later-block
proof from a non-author participant and expects only that submitter slashed.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                  | Covers                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: unlinked previous snapshot in an invalid-transition proof > outsider forging the predecessor of an honest first and later block slashes nobody`](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts#L11) (line 11)                  | [`INV-ENFFP-1-BGVZN4.T1.P12`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p12), [`INV-ENFFP-1-BGVZN4.T1.P13`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p13) |
| [`E2E: unlinked previous snapshot in an invalid-transition proof > participant forging the predecessor of an honest later block slashes only the submitter`](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts#L17) (line 17)             | —                                                                                                                                                                                                                                  |
| [`E2E: unlinked previous snapshot in an invalid-transition proof > genuine predecessor proofs against honest first and later blocks slash only a participant submitter`](../../../../../../test/e2e/E2E-UnlinkedPreviousSnapshotFraudProof.test.ts#L23) (line 23) | [`INV-ENFFP-1-BGVZN4.T1.P16`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p16)                                                                                                                   |
