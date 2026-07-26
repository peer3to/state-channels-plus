import { expect } from "chai";

import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: stale-membership dispute", function () {
    it("departed author + stale resulting snapshot in a stateProof → DisputeBlockAuthorNotParticipant only, then killed on-chain", async function () {
        const h = TestSession.getHarness();

        // peer 2 will leave; 0/1/3 stay as the honest disputers
        await h.lifecycle.timeoutSetup(4, 0);
        await h.assert.sync.peersInSyncWait();
        const forkId = h.activeForkId!;

        // advance while everyone is still a member -> the head snapshot lists the
        // leaver as a participant. capture its hash: the "stale" snapshot.
        await h.transition.advanceState({ count: 2 });
        const staleInfo = await h
            .control(h.getPeer(0))
            .query.getLatestBlockInfo(forkId)
            .request();
        if (!staleInfo) throw new Error("missing pre-leave head block info");
        const staleSnapshotHash = staleInfo.stateSnapshotHash;

        // the stale-era set still lists the future leaver: a naive membership
        // check against this snapshot would admit the author, so only the
        // coordinate binding can reject it later.
        const preLeaveParticipants = await h
            .control(h.getPeer(0))
            .query.getParticipants()
            .request();
        expect(
            preLeaveParticipants.map((p) => p.toLowerCase()),
            "stale snapshot era must still list the leaver"
        ).to.include(h.getPeer(2).address.toLowerCase());

        // peer 2 leaves, then advance so the current previous snapshot excludes it
        const leaverIndex = await h.transition.participantLeaveWait({
            leaverIndex: 2
        });
        const leaver = h.getPeer(leaverIndex);
        await h.transition.advanceState({ count: 2, waitForPeers: [0, 1, 3] });

        const participants = await h
            .control(h.getPeer(0))
            .query.getParticipants()
            .request();
        expect(
            participants.map((p) => p.toLowerCase()),
            "leaver should be out of the current participant set"
        ).to.not.include(leaver.address.toLowerCase());

        h.event.resetEventSpies();
        h.contextApi.captureOriginalFork();

        // peer 3 builds the dispute; rewrite its stateProof head to a block
        // authored by the leaver that names the stale (pre-leave) snapshot at the
        // head's coordinates. re-signs as the leaver via the shared signer set.
        await h.tamper.stubConstructDispute(
            3,
            async (dispute, sm, args) => {
                const d = sm.p2pManager.localRpc.dispute;
                // the leave finalized everything into milestones; append the
                // attack block to the unfinalized tail of the last milestone.
                d.expectMilestonesOnlyStateProof(dispute.input.stateProof);
                const confirmations =
                    dispute.input.stateProof.milestones.at(
                        -1
                    )?.blockConfirmations;
                if (!confirmations || confirmations.length === 0) {
                    throw new Error("expected a milestone anchor block");
                }
                const anchor = confirmations.at(-1)!;
                const previousHash = d.hash(anchor.signedBlock.encodedBlock);
                await d.appendLastMilestoneSignedBlockInDispute(
                    dispute,
                    (block) => {
                        block.transaction.header.transactionCnt =
                            BigInt(block.transaction.header.transactionCnt) +
                            1n;
                        block.transaction.header.timestamp =
                            BigInt(block.transaction.header.timestamp) + 1n;
                        // leaver authors at the head's next coordinates
                        block.transaction.header.participant =
                            args.leaverAddress as string;
                        block.transaction.body.data = "0x";
                        block.previousBlockHash = previousHash;
                        // the lever: a snapshot whose participants still list the
                        // leaver, bound to stale (pre-leave) coordinates
                        block.stateSnapshotHash =
                            args.staleSnapshotHash as string;
                        return block;
                    }
                );
            },
            {
                args: {
                    leaverAddress: leaver.address,
                    staleSnapshotHash
                }
            }
        );

        await h.byzantine.submitDoubleSignBlock(0);
        await h.assert.dispute.initiatedWait({
            peersIndices: [3],
            initiatedWithAuditingData: false
        });

        await h.event.waitForPeers("onDisputeKilled", [0], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
            peerIndices: [0, 1, 3],
            timeoutMs: 15000
        });

        // exclusivity: the coordinate-binding proof fired, not a structural /
        // state-proof / apply fallback.
        const overlappingProofTypes = [
            DisputeFraudProofType.DisputeInvalidBlockStructure,
            DisputeFraudProofType.DisputeInvalidStateProof,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        ].map((type) => String(toSolidityDisputeFraudProofType(type)));
        for (const peer of h.getFilteredPeers([0, 1, 3])) {
            const proofTypes = await h
                .control(peer)
                .query.getDisputeFraudProofTypes()
                .request();
            expect(proofTypes).to.include(
                String(
                    toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                    )
                )
            );
            for (const overlappingType of overlappingProofTypes) {
                expect(proofTypes).not.to.include(overlappingType);
            }
        }

        // _killDispute slashes the disputer on-chain in the same tx that emits
        // DisputeKilled -> peer 3 (the malicious disputer) is on-chain slashed.
        // deterministic proof the malicious dispute died on-chain, independent of
        // the double-sign fork reduction.
        await h.assert.dispute.slashedOnChain(h.getPeer(3).address);
    });
});
