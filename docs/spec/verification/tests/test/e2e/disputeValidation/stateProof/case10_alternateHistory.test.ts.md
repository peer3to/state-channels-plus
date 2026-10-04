# test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

End-to-end outcomes of an alternate history (`AlternateHistoryStaging`). Alice and Bob author
blocks 0-3, the joiners submit their joins, and all hold block 4; the joiners are then cut off. The
honest history seats the joiners at block 5, which every peer signs; its later blocks carry only
their author's and the joiners' signatures. The alternate history, signed by Alice and Bob only,
never seats them and is longer than the honest one. The double-sign heights are read from the stored
authors of both histories, so Alice and Bob each double-signed once. In every case Charlie's replay
of the posted alternate blocks stores a `BlockDoubleSign` fraud proof against Alice and against Bob,
`waitForAlternateStatesHeld` checks that he holds by hash the snapshot and state of every posted
alternate block (his replay does not abstain), and `waitForColludersSlashed` waits until his dispute
applied the proofs and the chain slashed both.

The first three cases use `stageAlternateHistoryWithoutCharlieAndDavid`: David, a second pending
joiner, holds the honest history, never disputes, and keeps Charlie's dispute from being
threshold-final. In the first case `postDoubleSignEvidence` posts the alternate blocks through the
double-sign heights, below the honest head; after the window both Charlie and David are reduced
to Charlie and David with their deposits and the math sum of the honest head. In the second case
Charlie's dispute is held, Bob posts the alternate head re-signed over a snapshot with one more
deposit than the chain holds (`postAlternateHeadWithInvalidBalance`), Charlie stores
`DisputeInvalidBalanceInvariant` and kills it, and the reduction again takes the honest head. In
the third case `postFullAlternateHistory` posts the whole alternate history with a valid balance:
neither Charlie nor David sees a killed dispute, both are reduced with the math sum of the alternate
head, and after the reduce transaction lands both are on the chain's reduced fork.

The fourth case uses `stageAlternateHistoryWithoutCharlie` (no David) and posts the whole alternate
history. Once Alice and Bob are slashed, Charlie alone is the threshold set: his dispute is final,
Charlie's fork is the chain's reduced fork, and his state has him as the only participant with his
deposit and the math sum of his honest head. `readReduction` then shows that a reduction over the
alternate dispute alone resolves, from Charlie's storage, the alternate head's height and state.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                             | Covers                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 10 (alternate history) > posted alternate history shorter than Charlie's head slashes Alice and Bob and reduces to Charlie's longer honest history`](../../../../../../../../test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts#L31) (line 31)              | [`INV-SP-6-GNW74H.T1.P22`](../../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h.t1.p22), [`REQ-ENFFP-2-JXMYNB.T1.P1`](../../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2-jxmynb.t1.p1) |
| [`E2E: dispute validation / stateProof / Case 10 (alternate history) > posted alternate history with invalid balance invariant is killed and Charlie's shorter history prevails`](../../../../../../../../test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts#L67) (line 67)                               | [`INV-SP-6-GNW74H.T1.P23`](../../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h.t1.p23)                                                                                                                       |
| [`E2E: dispute validation / stateProof / Case 10 (alternate history) > posted alternate history with valid balance invariant slashes Alice and Bob and reduces to the longest valid chain`](../../../../../../../../test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts#L107) (line 107)                   | [`INV-SP-6-GNW74H.T1.P20`](../../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h.t1.p20)                                                                                                                       |
| [`E2E: dispute validation / stateProof / Case 10 (alternate history) > slashing leaves Charlie the only threshold signer → his dispute is final and closes the window; reduction from Charlie's honest head`](../../../../../../../../test/e2e/disputeValidation/stateProof/case10_alternateHistory.test.ts#L156) (line 156) | [`INV-SP-6-GNW74H.T1.P21`](../../../../../../specification/disputes/state-proofs.md#inv-sp-6-gnw74h.t1.p21)                                                                                                                       |
