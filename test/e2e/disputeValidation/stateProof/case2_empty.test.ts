describe("E2E: dispute validation / stateProof / Case 2 (empty stateProof) — see latestStateSnapshotHash", function () {
    // Card item: "no M no S | latestFinalizedState == latestState == genesis // try and break"
    //
    // Folded into per-field coverage. The only way to "break" an empty stateProof
    // is to feed a non-genesis `dispute.input.latestStateSnapshotHash` — which is
    // precisely the `latestStateSnapshotHash` field's case (1).
    //
    // Tests live in:
    //   test/e2e/disputeValidation/disputeInputFields/latestStateSnapshotHash.test.ts
    //     → describe "(1) stateProof empty — genesis (no milestones, no signedBlocks)"
    //     → under both "no calldata" and "calldata posted" paths.
    it.skip("→ see disputeInputFields/latestStateSnapshotHash → '(1) stateProof empty'", function () {});
});
