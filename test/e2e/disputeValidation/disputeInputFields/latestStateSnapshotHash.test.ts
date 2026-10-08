import { DisputeFraudProofType } from "@/types/sol-enums";
import { ForkId } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";

//   (1) no milestones → genesis
//   (2) one unfinalized genesis block-0 milestone → its last block commits to
//       the hash; not everyone signed it, so the dispute posts auditing data
//   (3) a threshold-final last milestone → its last block commits to the hash

describe("E2E: dispute validation / disputeInputFields / latestStateSnapshotHash", function () {
    describe("no calldata", function () {
        describe("(1) stateProof empty — genesis (no milestones)", function () {
            describe("all peers are in sync", function () {
                it("[no calldata] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetup();
                    await h.assert.sync.peersInSyncWait();
                    const forkId = h.activeForkId!;

                    // Construct the honest replacement after the kill is observed;
                    // an earlier output can finalize before it includes that slash.
                    await h.dispute.suppressDisputeInitiation([
                        h.getPeer(0).index
                    ]);

                    await h.tamper.stubConstructDispute(1, (dispute, sm) => {
                        dispute.input.stateProof.milestones = [];
                        dispute.input.latestStateSnapshotHash =
                            sm.p2pManager.localRpc.dispute.randomHash();
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.rpcStub.restoreDisputeInitiationAndDispute(
                        0,
                        forkId
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });
        });

        describe("(3) threshold-final last milestone — last milestone block commits to hash", function () {
            describe("all peers are in sync", function () {
                it("[no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetup();
                    await h.assert.sync.peersInSyncWait();
                    const forkId = h.activeForkId!;

                    // Build the honest replacement after the kill's slash is observed;
                    // a pre-kill output can finalize against the smaller threshold.
                    await h.dispute.suppressDisputeInitiation([
                        h.getPeer(0).index
                    ]);

                    await h.tamper.stubConstructDispute(1, async (d, sm) => {
                        const svc = sm.p2pManager.localRpc.dispute;
                        await svc.expectFinalizedStateProof(
                            d.input.forkId as ForkId,
                            d.input.stateProof
                        );
                        d.input.latestStateSnapshotHash = svc.randomHash();
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.rpcStub.restoreDisputeInitiationAndDispute(
                        0,
                        forkId
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });

            describe("auditor peer 3 disconnected — local storage stale, pipeline still kills", function () {
                it("[no calldata] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 3)", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetup({ peerCount: 4 });
                    const forkId = h.activeForkId!;

                    const disconnectedAuditorIndex = 3;
                    await h.network.blacklistAndDisconnectPeer(
                        disconnectedAuditorIndex
                    );

                    await h.tamper.stubConstructDispute(1, async (d, sm) => {
                        const svc = sm.p2pManager.localRpc.dispute;
                        await svc.expectFinalizedStateProof(
                            d.input.forkId as ForkId,
                            d.input.stateProof
                        );
                        d.input.latestStateSnapshotHash = svc.randomHash();
                    });

                    await h.byzantine.submitInvalidStateTransitionBlock(2);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [1],
                        initiatedWithAuditingData: false
                    });
                    // peer 3 lacks post-disconnect state locally but still audits via on-chain events.
                    await h.event.waitForPeers(
                        "onDisputeKilled",
                        [disconnectedAuditorIndex],
                        1,
                        { mode: "atLeast" }
                    );
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });
        });
    });

    describe("calldata posted", function () {
        describe("(1) stateProof empty — genesis (no milestones)", function () {
            describe("all peers are in sync", function () {
                it("[calldata posted] dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupCalldataPath();
                    await h.assert.sync.peersInSyncWait();
                    const forkId = h.activeForkId!;

                    await h.tamper.stubConstructDispute(3, (d, sm) => {
                        d.input.stateProof.milestones = [];
                        d.input.latestStateSnapshotHash =
                            sm.p2pManager.localRpc.dispute.randomHash();
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({
                        forkId,
                        syntheticOnChainParticipants: 1
                    });
                });
            });
        });

        describe("(3) threshold-final last milestone — last milestone block commits to hash", function () {
            describe("all peers are in sync", function () {
                it("[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupCalldataPath();
                    await h.assert.sync.peersInSyncWait();
                    const forkId = h.activeForkId!;

                    await h.tamper.stubConstructDispute(3, (d, sm) => {
                        d.input.latestStateSnapshotHash =
                            sm.p2pManager.localRpc.dispute.randomHash();
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({
                        forkId,
                        syntheticOnChainParticipants: 1
                    });
                });
            });

            describe("peers not synced — auditor peer 1 disconnected (misses latest block)", function () {
                it("[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 1)", async function () {
                    const h = TestSession.getHarness();
                    const disconnectedAuditorIndex = 1;

                    // The disconnected auditor recovers the calldata, audits,
                    // and kills inside the kill period; the file's other
                    // calldata-path cases give that twelve seconds.
                    await h.lifecycle.timeoutSetup(4, 2, {
                        timeConfig: {
                            evidenceTime: 12,
                            agreementTime: 6
                        }
                    });

                    const leaverIndex =
                        await h.transition.participantLeaveStateTransition();
                    await h.transition.advanceState({
                        waitForPeers: [0, 1, 3],
                        count: 3
                    });

                    await h.network.blacklistAndDisconnectPeer(
                        disconnectedAuditorIndex
                    );
                    await h.transition.advanceState({
                        waitForPeers: [0, 3],
                        count: 1
                    });
                    h.contextApi.captureOriginalFork();
                    const disputedForkId = h.context.originalForkId!;
                    h.event.resetEventSpies();

                    await h.tamper.stubConstructDispute(3, (d, sm) => {
                        if (d.input.stateProof.milestones.length === 0) {
                            throw new Error(
                                `expected milestones in stateProof (leaver was peer ${leaverIndex})`
                            );
                        }
                        d.input.latestStateSnapshotHash =
                            sm.p2pManager.localRpc.dispute.randomHash();
                        d.postedAuditingData = true;
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({
                        forkId: disputedForkId
                    });
                });
            });
        });

        describe("(2) unfinalized genesis block-0 milestone — last block commits to hash", function () {
            // preDisputeSetupDisconnectedPeer: peer 2 disconnects during setup and
            // never signs, so the proof is one unfinalized genesis block-0
            // milestone and the dispute posts its auditing data. Same hash
            // tamper; we assert which auditor kills.
            describe("peers synced — auditor peer 0 has the full milestone locally", function () {
                it("[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 0)", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupDisconnectedPeer();
                    const forkId = h.activeForkId!;

                    await h.tamper.stubConstructDispute(3, async (d, sm) => {
                        const svc = sm.p2pManager.localRpc.dispute;
                        await svc.expectUnfinalizedStateProof(
                            d.input.forkId as ForkId,
                            d.input.stateProof
                        );
                        d.input.latestStateSnapshotHash = svc.randomHash();
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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });

            describe("auditor peer 2 disconnected — local storage genesis-only, pipeline still kills", function () {
                it("[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)", async function () {
                    const h = TestSession.getHarness();
                    await h.scenario.preDisputeSetupDisconnectedPeer({
                        timeConfig: { p2pTime: 3 }
                    });
                    const forkId = h.activeForkId!;

                    await h.tamper.stubConstructDispute(3, async (d, sm) => {
                        const svc = sm.p2pManager.localRpc.dispute;
                        await svc.expectUnfinalizedStateProof(
                            d.input.forkId as ForkId,
                            d.input.stateProof
                        );
                        d.input.latestStateSnapshotHash = svc.randomHash();
                    });

                    await h.byzantine.submitDoubleSignBlock(1);

                    await h.assert.dispute.initiatedWait({
                        peersIndices: [3],
                        initiatedWithAuditingData: true
                    });
                    // Peer 2 lacks the post-disconnect blocks locally but still audits via on-chain events.
                    await h.event.waitForPeers("onDisputeKilled", [2], 1, {
                        mode: "atLeast"
                    });
                    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                        {
                            disputeFraudProofType:
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });

            describe("peers not synced — auditor peer 2 disconnected (proof replay held)", function () {
                it("[calldata posted] dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof (killed by peer 2)", async function () {
                    const h = TestSession.getHarness();
                    const disconnectedAuditorIndex = 2;

                    await h.scenario.preDisputeSetupDisconnectedPeer({
                        timeConfig: { p2pTime: 3 }
                    });
                    const forkId = h.activeForkId!;

                    await h.tamper.stubConstructDispute(3, async (d, sm) => {
                        const svc = sm.p2pManager.localRpc.dispute;
                        await svc.expectUnfinalizedStateProof(
                            d.input.forkId as ForkId,
                            d.input.stateProof
                        );
                        d.input.latestStateSnapshotHash = svc.randomHash();
                    });

                    const replay = await h.rpcStub.holdBlockWork(
                        disconnectedAuditorIndex,
                        "proofConfirmationValidation"
                    );
                    try {
                        await h.byzantine.submitDoubleSignBlock(1);
                        await replay.waitUntilEntered();
                        // A concurrent dispute/calldata event clears gossip for this fork.
                        await h.execOnHost(
                            h.getPeer(disconnectedAuditorIndex),
                            (sm) => sm.blockQueueManager.clearFork(sm.forkId)
                        );
                    } finally {
                        await replay.release();
                    }

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
                                DisputeFraudProofType.DisputeInvalidStateProof
                        }
                    );
                    await h.dispute.resolveDisputeWait({ forkId });
                });
            });
        });
    });
});
