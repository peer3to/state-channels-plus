# E2E-PrunedInboundFraudProof.test.ts — Test Report

> **Test file:** [test/e2e/E2E-PrunedInboundFraudProof.test.ts](../../../../../../test/e2e/E2E-PrunedInboundFraudProof.test.ts) > **Status:** Authored; engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Both cases start from the shared staging in `PrunedInboundStaging`. It starts a three-peer
channel, lands a real top-up on chain, lets honest blocks consume it, and posts a same-fork
snapshot. It then asserts that the on-chain snapshot's inbound head is that top-up, so adoption
pruned it, and finds the honest signed block that carried it.

The first case submits, from a participant's own signer, a forged-inbound proof over that honest
block and the pruned top-up through `applyFraudProofs` on the manager. It asserts the revert
decodes to `RaceConditionBlockHeightTooOld` with the snapshot's inbound height and the cited
block's height, that the on-chain slash set stays empty, and that the channel then advances with
every peer in sync. The second case has the next writer gossip a block carrying a fabricated
inbound block one above the pruned head. It asserts that honest peers initiate and commit a
dispute, store a `ForgedInboundMessageBlock` fraud proof, and slash the forger on chain, and that
only the honest peers stay in sync after the dispute resolves.

A third case resolves that dispute, then adopts the reduced fork on chain from an honest peer and
asserts the adopted snapshot is on the honest peers' new fork with inbound height S. A later
top-up is consumed and adopted at S+1 with the honest peers in sync, and a forged-inbound proof
over the original pruned block still reverts `RaceConditionBlockHeightTooOld` naming S+1.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                     | Covers                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`E2E: Pruned inbound fraud proof > genuine inbound pruned by a snapshot -> forged-inbound proof against its honest author reverts, nobody slashed, channel advances`](../../../../../../test/e2e/E2E-PrunedInboundFraudProof.test.ts#L9) (line 9)                   | [`INV-ENFFP-1-BGVZN4.T1.P16`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p16) |
| [`E2E: Pruned inbound fraud proof > fabricated inbound above the pruned head -> honest peers dispute, the forger is slashed`](../../../../../../test/e2e/E2E-PrunedInboundFraudProof.test.ts#L47) (line 47)                                                          | [`INV-ENFFP-1-BGVZN4.T1.P18`](../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1-bgvzn4.t1.p18) |
| [`E2E: Pruned inbound fraud proof > dispute resolved after a prune -> the reduced fork keeps the snapshot inbound height, the next top-up is adopted, the pruned proof stays refused`](../../../../../../test/e2e/E2E-PrunedInboundFraudProof.test.ts#L69) (line 69) | [`REQ-DIS-6-Y92H1M.T1.P17`](../../../../specification/disputes/disputes.md#req-dis-6-y92h1m.t1.p17)              |
