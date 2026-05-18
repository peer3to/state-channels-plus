import { DisputeFraudProofType } from "@/types/sol-enums";
import { hash } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

// Trello card Case 2: no milestones, no signedBlocks | latestFinalizedState == latestState == genesis.
// Try to break by lying about the latestStateSnapshotHash while leaving the proof empty.

describe("E2E: dispute validation / stateProof / Case 2 (empty stateProof)", function () {
    describe("no calldata", function () {
        it("dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
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
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("calldata posted", function () {
        it("dispute.input.stateProof = {} AND dispute.input.latestStateSnapshotHash = random → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.stubConstructDispute(3, (d) => {
                d.input.stateProof.milestones = [];
                d.input.stateProof.signedBlocks = [];
                d.input.latestStateSnapshotHash = hash("0x42");
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });
});
