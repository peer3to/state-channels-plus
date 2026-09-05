// @spec-test-coverage-ignore: shared honest-leaver overlap and admitted-signature staging
import { expect } from "chai";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { addressesEqual } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";

export async function assertHonestLeaverDisputeOrdering(
    h: MathPeerTestHarness,
    admittedIncoming: boolean
): Promise<void> {
    // The overlap from FIND-LEAVE-2: the leaver prepares its exit post
    // against a chain with no pending inbound, its top-up is mined before
    // the post broadcasts, the chain refuses the post, the fallback
    // self-removal dispute starts, and only then does a block consume the
    // top-up and make the leaver eligible to sign again. Its dispute must
    // stay its latest state.
    const timeConfig = {
        // This case deliberately idles through the exit-post delay and the
        // forced join before authoring. Keep the production writer window.
        p2pTime: 15,
        agreementTime: 6,
        chainFallbackTime: 2,
        evidenceTime: 12
    };
    await h.lifecycle.timeoutSetup(5, 2, { timeConfig });
    const forkId = h.activeForkId!;
    const allPeerIndices = h.peers.map((peer) => peer.index);
    const leaver = await h.query.getNextPeerToWrite();
    const others = allPeerIndices.filter(
        (peerIndex) => peerIndex !== leaver.index
    );

    await h.transition.participantLeaveStateTransition({
        leaverIndex: leaver.index,
        waitForPeers: others
    });
    // Other honest peers contribute their newer state through the live
    // window. They remain active so this exercises normal dispute replies.
    // The removed leaver's own reduction attempt stands down at its
    // submission: its chain write would revert as a non-participant.
    const leaverReduction = await h.rpcStub.holdReductionAttempt(
        leaver.index,
        "submit",
        "undefined"
    );
    // The post parks at its send once prepared; the fallback dispute
    // parks in its construction, past the barrier. Install the send wrapper
    // last so releasing it preserves the reduction submission recorder.
    const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
    const rebuild = await h.rpcStub.holdAuditingDataRebuild(leaver.index);
    let admittedSignature: { release: () => Promise<boolean> } | undefined;
    let signedAtDispute: { height: number } | null = null;
    try {
        await send.waitUntilHeld();
        // Mined between the post's chain read and its broadcast.
        await h.join.forceInboundJoinWait({
            participant: leaver.address,
            observePeerIndices: others
        });
        if (admittedIncoming) {
            const signature = await h.rpcStub.holdBlockWork(
                leaver.index,
                "signature"
            );
            admittedSignature = signature;
            await h.transition.advanceState({
                waitForPeers: others,
                count: 1,
                waitForFinalization: false
            });
            await signature.waitUntilEntered();
            await send.release();
            await waitFor(
                async () =>
                    (await h
                        .control(leaver)
                        .stub.getStateMutexWaiterCount()
                        .request()) > 0
            );
            await signature.release();
        } else {
            await send.release();
        }
        await rebuild.waitUntilHeld();
        signedAtDispute = await h
            .control(leaver)
            .query.getLatestSignedBlockByParticipant(forkId, leaver.address)
            .request();

        // The block consuming the top-up re-adds the leaver, and one
        // more follows; the leaver, disputing the fork, signs neither.
        await h.transition.advanceState({
            waitForPeers: others,
            count: admittedIncoming ? 1 : 2,
            waitForFinalization: false
        });
    } finally {
        await admittedSignature?.release();
        await rebuild.release();
        await send.release();
    }

    try {
        await h.assert.dispute.committedWait({
            peersIndices: others,
            expectedCount: 1
        });
        const disputeHashes = await h.query.getDisputeHashes({
            peerIndices: [others[0]!],
            disputedForkId: forkId
        });
        const disputes = await Promise.all(
            disputeHashes.map((disputeHash) =>
                h.query.getDispute(others[0]!, disputeHash)
            )
        );
        const dispute = disputes.find(
            (candidate) =>
                candidate &&
                addressesEqual(candidate.input.disputer, leaver.address)
        );
        if (!dispute)
            throw new Error("Committed self-removal dispute is missing");
        expect(dispute.input.selfRemoval).to.equal(true);
        expect(addressesEqual(dispute.input.disputer, leaver.address)).to.equal(
            true
        );

        // The leaver signed nothing on the fork after its dispute started,
        // so the dispute is its latest state for every auditor.
        const lastSigned = await h
            .control(h.getPeer(others[0]!))
            .query.getLatestSignedBlockByParticipant(forkId, leaver.address)
            .request();
        expect(lastSigned?.height).to.equal(signedAtDispute?.height);
        const signedSnapshotHash = await h.execOnHost(
            h.getPeer(others[0]!),
            (sm, args) =>
                sm.agreementManager.getLatestSignedBlockByParticipant(
                    args.forkId,
                    args.leaver
                )?.block.stateSnapshotHash,
            { forkId, leaver: leaver.address }
        );
        expect(dispute.input.latestStateSnapshotHash).to.equal(
            signedSnapshotHash
        );

        await h.dispute.resolveDisputeWait({
            forkId,
            assertMaliciousRemoved: false,
            honestPeerIndices: others
        });
        const settledHashes = await h.query.getDisputeHashes({
            peerIndices: [others[0]!],
            disputedForkId: forkId
        });
        const settledDisputes = await Promise.all(
            settledHashes.map((disputeHash) =>
                h.query.getDispute(others[0]!, disputeHash)
            )
        );
        const contributions = settledDisputes.filter(
            (candidate) =>
                candidate &&
                !addressesEqual(candidate.input.disputer, leaver.address)
        );
        expect(contributions.length).to.be.greaterThan(0);
        for (const contribution of contributions) {
            expect(contribution!.input.requireExistingDisputeWindow).to.equal(
                true
            );
            expect(contribution!.input.selfRemoval).to.equal(false);
            expect(
                await h.query.onChainSlashedParticipants(others[0]!)
            ).to.not.include(contribution!.input.disputer);
            expect(
                await h
                    .control(h.getPeer(others[0]!))
                    .query.getParticipants()
                    .request()
            ).to.include(contribution!.input.disputer);
        }
        for (const peerIndex of others) {
            expect(
                await h
                    .control(h.getPeer(peerIndex))
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.not.include(
                String(DisputeFraudProofType.DisputeNotLatestState)
            );
        }
        expect(
            await h.query.onChainSlashedParticipants(others[0]!)
        ).to.not.include(leaver.address);
        // Whether the reduction also consumed the leaver's own top-up,
        // which would re-list it through its join, depends on the
        // top-up's place in the window; either way no slash took its seat.
    } finally {
        await leaverReduction.release();
    }
}
