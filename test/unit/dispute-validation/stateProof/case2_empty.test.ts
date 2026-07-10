describe("dispute-validation / stateProof / Case 2 (empty stateProof) — see latestStateSnapshotHash", function () {
    // Card item: "no M no S | latestFinalizedState == latestState == genesis // try and break"
    // Covered in:
    //   test/unit/dispute-validation/disputeInputFields/latestStateSnapshotHash.test.ts
    //     → describe "(1) stateProof empty — genesis (no milestones, no signedBlocks)"
    //     → under both "no calldata" and "calldata posted" paths
    //     (claims: stateProof: "fully-empty" + carrier: "genesis" cells).
    // No it() here on purpose: a pointer suite would need a covers() claim,
    // and those cells are already claimed by the real tests above.
});
