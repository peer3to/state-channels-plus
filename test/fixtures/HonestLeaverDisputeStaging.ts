// @spec-test-coverage-ignore: shared honest-leaver overlap and admitted-signature staging
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeIsClosed } from "./RuntimeRootObservation";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { ForkId, Hash } from "@/types/types";
import { addressesEqual } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

async function findDisputeBy(
    h: MathPeerTestHarness,
    observerIndex: number,
    forkId: ForkId,
    disputer: string
) {
    const disputeHashes = await h.query.getDisputeHashes({
        peerIndices: [observerIndex],
        disputedForkId: forkId
    });
    const disputes = await Promise.all(
        disputeHashes.map((disputeHash) =>
            h.query.getDispute(observerIndex, disputeHash)
        )
    );
    return disputes.find(
        (candidate) =>
            candidate && addressesEqual(candidate.input.disputer, disputer)
    );
}

// a removed leaver whose exit post is parked at its send, with its dispute
// construction and reduction submit held
async function stageHeldLeaverExitPost(h: MathPeerTestHarness) {
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
    const leaver = await h.query.getNextPeerToWrite();
    const others = h.peers
        .map((peer) => peer.index)
        .filter((peerIndex) => peerIndex !== leaver.index);

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
    return { forkId, leaver, others, leaverReduction, send, rebuild };
}

// the leaver's committed dispute is its latest signed state for every auditor
async function assertLeaverDisputeIsLatestState(
    h: MathPeerTestHarness,
    forkId: ForkId,
    leaverAddress: string,
    honest: number[],
    signedAtDispute: { height: number } | null,
    selfRemoval: boolean
) {
    await h.assert.dispute.committedWait({
        peersIndices: honest,
        expectedCount: 1
    });
    const findLeaverDispute = () =>
        findDisputeBy(h, honest[0]!, forkId, leaverAddress);
    // the window may already hold other disputes when the leaver's lands
    await waitFor(async () => (await findLeaverDispute()) !== undefined);
    const dispute = await findLeaverDispute();
    if (!dispute) throw new Error("Committed self-removal dispute is missing");
    // a leaver that disputed the fork before its post was refused keeps
    // that dispute; the fallback adds no second one
    expect(dispute.input.selfRemoval).to.equal(selfRemoval);
    expect(addressesEqual(dispute.input.disputer, leaverAddress)).to.equal(
        true
    );

    // The leaver signed nothing on the fork after its dispute started,
    // so the dispute is its latest state for every auditor.
    const lastSigned = await h
        .control(h.getPeer(honest[0]!))
        .query.getLatestSignedBlockByParticipant(forkId, leaverAddress)
        .request();
    expect(lastSigned?.height).to.equal(signedAtDispute?.height);
    const signedSnapshotHash = await h.execOnHost(
        h.getPeer(honest[0]!),
        (sm, args) =>
            sm.agreementManager.getLatestSignedBlockByParticipant(
                args.forkId,
                args.leaver
            )?.block.stateSnapshotHash,
        { forkId, leaver: leaverAddress }
    );
    expect(dispute.input.latestStateSnapshotHash).to.equal(signedSnapshotHash);
    return dispute;
}

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
    const { forkId, leaver, others, leaverReduction, send, rebuild } =
        await stageHeldLeaverExitPost(h);
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
        await assertLeaverDisputeIsLatestState(
            h,
            forkId,
            leaver.address,
            others,
            signedAtDispute,
            true
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
        // A terminal abort already removed the held host and its executor.
        if (!runtimeIsClosed(leaver.p2pInstance))
            await leaverReduction.release();
    }
}

export async function assertHonestLeaverKillPeriodRefusal(
    h: MathPeerTestHarness,
    leaverDisputesFirst: boolean
): Promise<void> {
    // a dispute commits between the post's chain read and its broadcast ->
    // the chain refuses the post because the fork is disputed
    const { forkId, leaver, others, leaverReduction, send, rebuild } =
        await stageHeldLeaverExitPost(h);
    let signedAtDispute: { height: number } | null = null;
    let offender: number | undefined;
    let snapshotBeforeRelease: Hash | undefined;
    try {
        await send.waitUntilHeld();
        offender = (await h.query.getNextPeerToWrite()).index;
        await h.byzantine.submitInvalidStateTransitionBlock(offender);
        await h.assert.dispute.committedWait({
            peersIndices: others.filter((index) => index !== offender),
            expectedCount: 1
        });
        snapshotBeforeRelease = await h.query.getOnChainSnapshotHash();
        // kill period still open before the release
        const killPeriod = await h.query.killPeriod(forkId, others[0]!);
        expect(killPeriod.windowExists).to.equal(true);
        expect(killPeriod.isExpired).to.equal(false);
        if (leaverDisputesFirst) {
            // the leaver's own dispute of the invalid block leaves before the
            // post is released: it lands, or parks behind the post's send
            await rebuild.waitUntilHeld();
            signedAtDispute = await h
                .control(leaver)
                .query.getLatestSignedBlockByParticipant(forkId, leaver.address)
                .request();
            await rebuild.release();
            const observer = others.find((index) => index !== offender)!;
            await waitFor(
                async () =>
                    (await send.waitUntilHeld()) > 1 ||
                    (await findDisputeBy(
                        h,
                        observer,
                        forkId,
                        leaver.address
                    )) !== undefined
            );
        }
        // the chain refused the post for the disputed fork, not another reason
        expect(await send.release()).to.equal(
            "RaceConditionSnapshotUpdateDisputedFork"
        );
        if (!leaverDisputesFirst) {
            // the leaver's own dispute against the invalid block is already
            // parked in construction -> keep it there until the refused post's
            // fallback marks the exit, so it is captured as the self-removal
            await waitFor(() =>
                h.control(leaver).query.getForceExit().request()
            );
            await rebuild.waitUntilHeld();
            signedAtDispute = await h
                .control(leaver)
                .query.getLatestSignedBlockByParticipant(forkId, leaver.address)
                .request();
        }
    } finally {
        await rebuild.release();
        await send.release();
    }

    const honest = others.filter((index) => index !== offender);
    try {
        const dispute = await assertLeaverDisputeIsLatestState(
            h,
            forkId,
            leaver.address,
            honest,
            signedAtDispute,
            !leaverDisputesFirst
        );
        // the refused post changed nothing on chain
        expect(await h.query.getOnChainSnapshotHash()).to.equal(
            snapshotBeforeRelease
        );
        expect(dispute.postedAuditingData).to.equal(false);
        for (const peerIndex of honest) {
            const storedProofs = await h.execOnHost(
                h.getPeer(peerIndex),
                (sm) =>
                    sm.storage.disputeFraudProofs
                        .getDisputeFraudProofs()
                        .map((proof) => ({
                            disputer: proof.dispute.input.disputer,
                            proofType: String(proof.proofType)
                        })),
                {}
            );
            expect(
                storedProofs
                    .filter((proof) =>
                        addressesEqual(proof.disputer, leaver.address)
                    )
                    .map((proof) => proof.proofType)
            ).to.deep.equal([]);
        }
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: honest
        });
        await h.assert.dispute.slashedOnChainExactly([
            h.getPeer(offender!).address
        ]);
        // the reduced state removed the leaver for every honest peer
        for (const peerIndex of honest) {
            const participants = await h
                .control(h.getPeer(peerIndex))
                .query.getParticipants()
                .request();
            expect(
                participants.some((participant) =>
                    addressesEqual(participant, leaver.address)
                )
            ).to.equal(false);
        }
        // the leaver's parked reduction submit settles before quiesce
        await leaverReduction.release();
        expect(
            (await h.quiesceHosts()).map((error) => error.message)
        ).to.deep.equal([]);
    } finally {
        await leaverReduction.release();
    }
}
