# test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives the proof start end to end. `stageExitAnchoredFork` lets one participant exit, so the
chain holds a same-fork snapshot above height 0; that snapshot is the start of the state-proof walk.
Two cases post a claim that ends below it through `postTamperedDispute`: a proof whose only block is
an unlinked block that `craftProofBlock` builds and the forger signs one height below the snapshot
(auditing data posted, latest-state hash set to that block's snapshot hash), and an empty proof without
auditing data. For both, the oracle waits until at least one honest peer stores
`DisputeStateProofBelowOnChainAnchor`, waits for the fork to resolve with the honest peers as
reducers (the forger case also asserts the forger is removed), and asserts that no honest peer is in
the on-chain slash set. The third case uses `stageAuditorBehindOnChainAnchor`: the prover's local copy
of the on-chain snapshot stays at the genesis, a double sign makes it dispute, and the recorded
submission shows a proof whose first block is below the on-chain snapshot height; the chain accepts
it, the dispute resolves, and the prover is not slashed. The fourth case posts an honest
self-removal dispute (`postTamperedDispute`, not marked malicious) with a prepended milestone
`[0, undecodable, snapshot height − 1]` wholly below the snapshot, its snapshot added to the posted
auditing data and the auditing-data hash recomputed. The live auditors commit it; a peer that
already left sends a `DisputeInvalidBlockStructure` allegation at block index 1 from its own key,
and the disputer is not slashed, because the chain judges only the last milestone. The oracle then
waits until the auditor's balance-invariant read runs, resolves the fork, and asserts for every
auditor: no stored fraud proof, no `onDisputeKilled`, the skipped milestone's snapshot not
persisted, and no participant slashed.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 6 (proof start) > a dispute whose only block is an unlinked forgery below the on-chain anchor → DisputeStateProofBelowOnChainAnchor, the forger is removed, no honest slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts#L25) (line 25)                                                                                                                                                              | [`REQ-SP-8-9PK9TS.T2.P4`](../../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p4), [`UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P19`](../../../../../../implementation/source/src/stateManager/dispute/DisputeFraudProofService.ts.md#unit-test-dispute-fraud-proof-service-1-zvpvc0.p19), [`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-3-AY91RS.P72`](../../../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md#unit-test-dispute-validation-service-3-ay91rs.p72) |
| [`E2E: dispute validation / stateProof / Case 6 (proof start) > an empty-proof dispute after a same-fork exit snapshot → DisputeStateProofBelowOnChainAnchor, no honest slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts#L69) (line 69)                                                                                                                                                                                                          | [`REQ-SP-8-9PK9TS.T2.P5`](../../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p5)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: dispute validation / stateProof / Case 6 (proof start) > a prover whose mirror missed the exit snapshot builds from the genesis; the chain accepts it; the dispute resolves; no slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts#L97) (line 97)                                                                                                                                                                                           | [`REQ-SP-8-9PK9TS.T2.P7`](../../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p7)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`E2E: dispute validation / stateProof / Case 6 (proof start) > a committed posted proof with an undecodable block in a milestone below the on-chain anchor is audited valid through the lifecycle: no fraud proof, no kill, the skipped prefix is not persisted, the balance check still runs, a structure allegation at that position cannot punish the submitter, no honest slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case6_proofStart.test.ts#L128) (line 128) | [`REQ-SP-8-9PK9TS.T2.P8`](../../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t2.p8)                                                                                                                                                                                                                                                                                                                                                                                                                       |
