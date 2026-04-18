import { DisputeFraudProofType } from "@/types/sol-enums";
import { hash } from "@/utils";
import {
    DisputeTampering,
    expectMilestonesOnlyStateProof,
    expectSignedBlocksOnlyStateProof,
    PeerTestHarness,
    TestSession
} from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: latestStateSnapshotHash", function () {
    describe("no calldata", function () {
        describe("empty proof vs hash stub, non-signedBlocks", function () {
            it("DisputeInvalidStateProof: hash stub only (synced auditors)", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();

                // Stub peer 1's dispute construction to corrupt latestStateSnapshotHash.
                // postedAuditingData remains false → no-calldata path.
                h.tamper.stubConstructDispute(1, (d) => {
                    expectMilestonesOnlyStateProof(d.input.stateProof);
                    DisputeTampering.tamperInvalidStateProof(d);
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

            it("DisputeInvalidStateProof: empty proof, latestStateSnapshotHash ≠ genesis", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();

                // Empty proof implies latest state is genesis; claiming a non-genesis hash is invalid.
                h.tamper.stubConstructDispute(1, (dispute) => {
                    dispute.input.stateProof.milestones = [];
                    dispute.input.stateProof.signedBlocks = [];
                    dispute.input.latestStateSnapshotHash = hash("0x42");
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

        describe("signedBlocks, full storage vs pipeline", function () {
            it("DisputeInvalidStateProof: wrong hash, auditors have blocks", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupDisconnectedPeer();

                h.tamper.stubConstructDispute(3, (d) => {
                    expectSignedBlocksOnlyStateProof(d.input.stateProof);
                    DisputeTampering.tamperInvalidStateProof(d);
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

            it("DisputeInvalidStateProof: wrong hash, pipeline (genesis-only auditor)", async function () {
                const h = TestSession.getHarness();
                // peer 2 disconnects before the 2 state transitions, so it holds the
                // genesis block (produced before disconnect) but not the signedBlocks that
                // appear in the dispute proof
                await h.scenario.preDisputeSetupDisconnectedPeer({
                    timeConfig: { p2pTime: 3 }
                });

                h.tamper.stubConstructDispute(3, (d) => {
                    expectSignedBlocksOnlyStateProof(d.input.stateProof);
                    DisputeTampering.tamperInvalidStateProof(d);
                });

                await h.byzantine.submitDoubleSignBlock(1);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: false
                });
                // peer 2 has no P2P connections but still monitors on-chain events.
                // It is the peer we require to kill the dispute to confirm the pipeline path works with incomplete storage.
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

    describe("calldata posted", function () {
        describe("milestones, full auditors: hash stub | empty proof", function () {
            it("DisputeInvalidStateProof:  wrong hash, auditors complete (hash stub)", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();

                h.tamper.stubConstructDispute(
                    3,
                    DisputeTampering.tamperInvalidStateProof
                );

                await h.byzantine.submitDoubleSignBlock(0);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: true
                });

                await h.event.waitForPeers("onDisputeKilled", [1], 1, {
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

            it("DisputeInvalidStateProof: empty proof, latestStateSnapshotHash ≠ genesis", async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetupCalldataPath();

                h.tamper.stubConstructDispute(3, (d) => {
                    d.input.stateProof.milestones = [];
                    d.input.stateProof.signedBlocks = [];
                    d.input.latestStateSnapshotHash = hash("0x42");
                });

                await h.byzantine.submitDoubleSignBlock(0);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [3],
                    initiatedWithAuditingData: true
                });

                await h.event.waitForPeers("onDisputeKilled", [1], 1, {
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

        it("DisputeInvalidStateProof: milestones, wrong hash, pipeline (missing last block)", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.timeoutSetup(4, 2, {
                timeConfig: {
                    evidenceTime: 6,
                    agreementTime: 6
                }
            });
            // peer 2 leaves — all four peers (including peer 1) observe the milestone
            await h.transition.participantLeaveDetached({
                statusTimeoutMs: 20000
            });
            // peer 3, peer 0, peer 1 each take a turn; peer 1 is now NOT "next"
            await h.transition.advanceState({
                waitForPeers: [0, 1, 3],
                count: 3
            });

            await h.network.disconnectPeer(1);
            // peer 3 writes one more block — peer 1 misses exactly this one block
            await h.transition.advanceState({
                waitForPeers: [0, 3],
                count: 1
            });
            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "expected at least one milestone in stateProof for this setup"
                    );
                }
                DisputeTampering.tamperInvalidStateProof(d);
            });

            await h.byzantine.submitInvalidStateTransitionBlock(0);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });
            // peer 0 (full storage) and peer 1 (missing the latest block)
            // both audit via the calldata path; require peer 1 specifically to kill
            // the dispute to confirm pipeline detection with incomplete storage.
            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait();
        });
    });
});
