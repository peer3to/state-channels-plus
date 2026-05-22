import { DisputeFraudProofType } from "@/types/sol-enums";
import { hash as randomHash } from "@test/factory";
import {
    expectMilestonesOnlyStateProof,
    expectSignedBlocksOnlyStateProof,
    MathTestSession as TestSession
} from "@test/harness";

//   (1) no milestones, no signedBlocks → genesis
//   (2) signedBlocks only → last signedBlock commits to the hash
//   (3) milestones only → last milestone block commits to the hash

describe("E2E: dispute validation / disputeInputFields / latestStateSnapshotHash", function () {
    describe("no calldata", function () {
        describe("(1) stateProof empty — genesis (no milestones, no signedBlocks)", function () {
            describe("peers synced to dispute.input.latestStateSnapshot", function () {
                it("dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetup();

                    h.tamper.stubConstructDispute(1, (dispute) => {
                        dispute.input.stateProof.milestones = [];
                        dispute.input.stateProof.signedBlocks = [];
                        dispute.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitInvalidStateTransitionBlock(2);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [1],
                        initiatedWithAuditingData: false
                    });

                    await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 10000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });
        });

        describe("(3) stateProof.milestones only — last milestone block commits to hash", function () {
            describe("peers synced to dispute.input.latestStateSnapshot", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetup();

                    h.tamper.stubConstructDispute(1, (d) => {
                        expectMilestonesOnlyStateProof(d.input.stateProof);
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitInvalidStateTransitionBlock(2);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [1],
                        initiatedWithAuditingData: false
                    });

                    await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 10000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });
        });

        describe("(2) stateProof.signedBlocks only — last signedBlock commits to hash", function () {
            // preDisputeSetupDisconnectedPeer builds signedBlocks-only proofs; peer 2
            // disconnects during setup. Same hash tamper; we assert which auditor kills.
            describe("peers synced — auditor peer 0 has full signedBlocks chain locally", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 0)", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupDisconnectedPeer();

                    h.tamper.stubConstructDispute(3, (d) => {
                        expectSignedBlocksOnlyStateProof(d.input.stateProof);
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: false
                    });
                    await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 15000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });

            describe("auditor peer 2 disconnected — local storage genesis-only, pipeline still kills", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupDisconnectedPeer({
                        timeConfig: { p2pTime: 3 }
                    });

                    h.tamper.stubConstructDispute(3, (d) => {
                        expectSignedBlocksOnlyStateProof(d.input.stateProof);
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: false
                    });
                    // Peer 2 lacks post-disconnect signedBlocks locally but still audits via on-chain events.
                    await h.event.waitForPeers("onDisputeKilled", [2], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 10000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });
        });
    });

    describe("calldata posted", function () {
        describe("(1) stateProof empty — genesis (no milestones, no signedBlocks)", function () {
            describe("peers synced to dispute.input.latestStateSnapshot", function () {
                it("dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupCalldataPath();

                    h.tamper.stubConstructDispute(3, (d) => {
                        d.input.stateProof.milestones = [];
                        d.input.stateProof.signedBlocks = [];
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: true
                    });

                    await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 15000
                        }
                    );
                    await h.dispute.resolveDisputeWait({
                        syntheticOnChainParticipants: 1
                    });
                });
            });
        });

        describe("(3) stateProof.milestones only — last milestone block commits to hash", function () {
            describe("peers synced to dispute.input.latestStateSnapshot", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupCalldataPath();

                    h.tamper.stubConstructDispute(3, (d) => {
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: true
                    });

                    await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 10000
                        }
                    );
                    await h.dispute.resolveDisputeWait({
                        syntheticOnChainParticipants: 1
                    });
                });
            });

            describe("peers not synced — auditor peer 1 disconnected (misses latest block)", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)", async function () {
                    const h = TestSession.getHarness();
                    const disconnectedAuditorIndex = 1;

                    await h.lifecycle.timeoutSetup(4, 2, {
                        timeConfig: {
                            evidenceTime: 6,
                            agreementTime: 6
                        }
                    });

                    const leaverIndex =
                        await h.transition.participantLeaveDetached({
                            statusTimeoutMs: 20000
                        });
                    await h.transition.advanceState({
                        waitForPeers: [0, 1, 3],
                        count: 3
                    });

                    await h.network.disconnectPeer(disconnectedAuditorIndex);
                    await h.transition.advanceState({
                        waitForPeers: [0, 3],
                        count: 1
                    });
                    h.contextApi.captureOriginalFork();
                    h.event.resetEventSpies();

                    h.tamper.stubConstructDispute(3, (d) => {
                        if (d.input.stateProof.milestones.length === 0) {
                            throw new Error(
                                `expected milestones in stateProof (leaver was peer ${leaverIndex})`
                            );
                        }
                        d.input.latestStateSnapshotHash = randomHash();
                    });

                    await h.byzantine.submitInvalidStateTransitionBlock(0);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: true
                    });
                    await h.event.waitForPeers(
                        "onDisputeKilled",
                        [disconnectedAuditorIndex],
                        1,
                        { mode: "atLeast" }
                    );
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 15000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });
        });

        describe("(2) stateProof.signedBlocks only — last signedBlock commits to hash", function () {
            describe("peers not synced — auditor peer 2 disconnected (calldata forced)", function () {
                it("dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)", async function () {
                    const h = TestSession.getHarness();
                    const disconnectedAuditorIndex = 2;

                    await h.scenario.preDisputeSetupDisconnectedPeer({
                        timeConfig: { p2pTime: 3 }
                    });

                    // signedBlocks-only disputes do not auto-post calldata (no milestones).
                    h.tamper.stubConstructDispute(3, (d) => {
                        expectSignedBlocksOnlyStateProof(d.input.stateProof);
                        d.input.latestStateSnapshotHash = randomHash();
                        d.postedAuditingData = true;
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: true
                    });
                    await h.event.waitForPeers(
                        "onDisputeKilled",
                        [disconnectedAuditorIndex],
                        1,
                        { mode: "atLeast" }
                    );
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof,
                            timeoutMs: 15000
                        }
                    );
                    await h.dispute.resolveDisputeWait();
                });
            });
        });
    });
});
