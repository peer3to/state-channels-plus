import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import {
    MathTestSession as TestSession,
    DisputeTampering
} from "@test/harness";

// Trello card Case 5: other - try and break it. Catch-all for stateProof-shape
// fraud paths that don't fit cleanly under Cases 1-4: both-arrays-non-empty
// invariant, empty milestone confirmations, missing auditing data, milestone
// block-content corruption, milestones-with-incomplete-storage.

describe("E2E: dispute validation / stateProof / Case 5 (other shape-breakers)", function () {
    describe("both arrays non-empty (verifyStateProof invariant)", function () {
        it("stateProof.milestones.length > 0 AND stateProof.signedBlocks.length > 0 → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            // preDisputeSetupCalldataPath produces a milestones-only state proof.
            await h.scenario.preDisputeSetupCalldataPath();

            // Inject an extra signedBlock alongside the real milestones.
            // verifyStateProof rejects any proof where both arrays are non-empty.
            // Copy a real milestone block so headers match dispute.input (factory.signedBlock
            // uses a dummy channelId which would trigger DisputeStateProofHeaderMismatch).
            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "Expected milestones in calldata-path state proof"
                    );
                }
                const src =
                    d.input.stateProof.milestones[0].blockConfirmations[0]
                        .signedBlock;
                d.input.stateProof.signedBlocks = [
                    {
                        encodedBlock: src.encodedBlock,
                        signature: src.signature
                    }
                ];
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
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("milestone with empty blockConfirmations", function () {
        it("stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            // Empty blockConfirmations on the first milestone causes
            // _isMilestoneFinalWithExpectedParticipants to return (false, 0)
            // immediately, making _tryVerifyMilestones return false.
            h.tamper.stubConstructDispute(3, (d) => {
                if (d.input.stateProof.milestones.length === 0) {
                    throw new Error(
                        "Expected milestones in calldata-path state proof"
                    );
                }
                d.input.stateProof.milestones[0].blockConfirmations = [];
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
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("last milestone not final and no auditing data", function () {
        it("dispute.postedAuditingData = false AND last milestone not final → DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });

            //  peer 0 turn
            await h.transition.advanceState({ waitForPeers: [0, 1] });

            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(2, (dispute) => {
                dispute.postedAuditingData = false;
            });

            // Peer 1 submits a faulty block
            await h.byzantine.submitInvalidStateTransitionBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [2],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("milestone block content corruption", function () {
        it("stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt += 5 → DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                timeConfig: { evidenceTime: 6 }
            });
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            h.tamper.stubConstructDispute(0, async (dispute) => {
                const stateProof = dispute.input.stateProof;

                const localDiamond = h.getLocalDiamond(0);
                const [hasBlock, latestBlock] =
                    await localDiamond.getLatestBlockFromStateProof(stateProof);
                if (!hasBlock) {
                    throw new Error(
                        "State proof does not contain a block to tamper with"
                    );
                }

                latestBlock.transaction.header.transactionCnt =
                    BigInt(latestBlock.transaction.header.transactionCnt) + 5n;

                stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                    Codec.encode(latestBlock, Type.Block);
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });
    });

    describe("milestones, wrong latestStateSnapshotHash, auditor with incomplete storage (pipeline)", function () {
        it("dispute.input.latestStateSnapshotHash tampered AND auditor missing last block → DisputeInvalidStateProof", async function () {
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

    describe("milestones, full auditors, wrong latestStateSnapshotHash (calldata)", function () {
        it("dispute.input.latestStateSnapshotHash tampered → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            h.tamper.stubConstructDispute(
                3,
                DisputeTampering.tamperInvalidStateProof
            );

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
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({
                syntheticOnChainParticipants: 1
            });
        });
    });
});
