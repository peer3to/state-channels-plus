# test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts — Test Report

> **Test file:** [test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts](../../../../../../test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts) > **Status:** Authored — engineer verification pending.

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
proof from a non-author participant and expects only that submitter slashed. The message-block test tops up a
participant's deposit, advances the channel until a block consumes that inbound block, and lets
the next writer leave so its block emits an exit message. It sends genuine predecessor proofs: the
inbound blocks from the outsider, whose author stays slashable, must slash nobody; the exit block
from a non-author participant must slash only that submitter, because the leaver is no longer
slashable.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                     | Covers                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: invalid-transition proof predecessor binding and replay > outsider forging the predecessor of an honest first and later block slashes nobody`](../../../../../../test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts#L12) (line 12)                        | [`INV-ENFFP-1-BGVZN4.T1.P12`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p12), [`INV-ENFFP-1-BGVZN4.T1.P13`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p13) |
| [`E2E: invalid-transition proof predecessor binding and replay > participant forging the predecessor of an honest later block slashes only the submitter`](../../../../../../test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts#L18) (line 18)                   | —                                                                                                                                                                                                                                  |
| [`E2E: invalid-transition proof predecessor binding and replay > genuine predecessor proofs against honest first and later blocks slash only a participant submitter`](../../../../../../test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts#L24) (line 24)       | [`INV-ENFFP-1-BGVZN4.T1.P16`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p16)                                                                                                                   |
| [`E2E: invalid-transition proof predecessor binding and replay > genuine predecessor proofs against client-built blocks with inbound and outbound messages slash no signer`](../../../../../../test/e2e/E2E-InvalidTransitionPredecessorProof.test.ts#L30) (line 30) | [`INV-ENFFP-1-BGVZN4.T1.P17`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p17)                                                                                                                   |
