// @spec-test-coverage-ignore: shared honest-leaver dispute staging
import { stageInboundBlockedExit } from "./BotConnectionFixesStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeIsClosed } from "./RuntimeRootObservation";
import { Status } from "@/types";
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
        // This case idles while the exit post is held and the disputes
        // commit. Keep the production writer window.
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

    // Other honest peers contribute their newer state through the live
    // window. They remain active so this exercises normal dispute replies.
    // The removed leaver's own reduction attempt stands down at its
    // submission: its chain write would revert as a non-participant.
    const leaverReduction = await h.rpcStub.holdReductionAttempt(
        leaver.index,
        "submit",
        "undefined"
    );
    // The exit block's finality posts at once, and the post parks at its
    // send; the leaver's dispute parks in its construction, past the
    // barrier. Install the send wrapper last so releasing it preserves the
    // reduction submission recorder.
    const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
    const rebuild = await h.rpcStub.holdAuditingDataRebuild(
        leaver.index,
        "auditingData"
    );
    await h.transition.participantLeaveStateTransition({
        leaverIndex: leaver.index,
        waitForPeers: others
    });
    return { forkId, leaver, others, leaverReduction, send, rebuild };
}

// the leaver's committed dispute is its latest signed state for every auditor
async function assertLeaverDisputeIsLatestState(
    h: MathPeerTestHarness,
    forkId: ForkId,
    leaverAddress: string,
    honest: number[],
    signedAtDispute: { height: number } | null
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
    expect(dispute.input.selfRemoval).to.equal(true);
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

export async function assertHonestLeaverKillPeriodRefusal(
    h: MathPeerTestHarness
): Promise<void> {
    // a dispute commits between the post's chain read and its broadcast ->
    // the chain refuses the post because the fork is disputed
    const { forkId, leaver, others, leaverReduction, send, rebuild } =
        await stageHeldLeaverExitPost(h);
    let reductionReleased = false;
    // the reduced state's terminal abort may already have removed the host
    const releaseReduction = async () => {
        if (reductionReleased || runtimeIsClosed(leaver.p2pInstance)) return;
        reductionReleased = true;
        try {
            await leaverReduction.release();
        } catch (error) {
            // the abort can dispose the host while the release is in flight
            if (!runtimeIsClosed(leaver.p2pInstance)) throw error;
        }
    };
    let signedAtDispute: { height: number } | null = null;
    let offender: number | undefined;
    let snapshotBeforeRelease: Hash | undefined;
    try {
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
            // the chain refused the post for the disputed fork, not another reason
            expect(await send.release()).to.equal(
                "RaceConditionSnapshotUpdateDisputedFork"
            );
            // the leaver's own dispute, raised at once by the dispute it
            // observed while exiting, is parked in construction; it carries
            // the self-removal its exit block set
            await rebuild.waitUntilHeld();
            signedAtDispute = await h
                .control(leaver)
                .query.getLatestSignedBlockByParticipant(forkId, leaver.address)
                .request();
        } finally {
            await rebuild.release();
            await send.release();
        }

        const honest = others.filter((index) => index !== offender);
        const dispute = await assertLeaverDisputeIsLatestState(
            h,
            forkId,
            leaver.address,
            honest,
            signedAtDispute
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
        await releaseReduction();
        expect(
            (await h.quiesceHosts()).map((error) => error.message)
        ).to.deep.equal([]);
    } finally {
        await releaseReduction();
    }
}

export async function assertHonestPeersContributeAfterSelfRemoval(
    h: MathPeerTestHarness
): Promise<void> {
    // The leaver's exit post is refused while an inbound join no snapshot
    // has consumed is pending. Its leave watchdog is held and expires once
    // the others moved on, so the self-removal dispute follows the staging
    // it must outlast, not a fixed delay.
    const {
        joiner,
        leaver,
        remainingPeerIndices,
        disputes,
        includeInboundAgain,
        expireWatchdog
    } = await stageInboundBlockedExit(h, {
        holdWatchdog: true,
        forwardDisputes: true,
        // engineer decision (Luka, 2026-10-12): 6s, not the staging's 4s. The
        // others audit the leaver's dispute, then contribute into its window;
        // under load that path can outlast a 4s evidence period.
        evidenceTime: 6
    });
    const forkId = h.activeForkId!;
    const honest = [...remainingPeerIndices, joiner.index];
    // blind to gossip: the leaver's latest state stays at its exit
    const restoreConfirmations = await h.rpcStub.dropNetworkConfirmations(
        leaver.index
    );
    try {
        // the others consume the join and seat the joiner, then author
        // newer state the leaver never sees until its watchdog disputes
        await includeInboundAgain();
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [joiner.index],
            status: Status.PARTICIPATING,
            waitForPeers: remainingPeerIndices
        });
        await expireWatchdog();
        await h.transition.keepAuthoringUntil({
            until: async () => (await disputes.submissions()).length > 0,
            waitForPeers: honest,
            maximumBlocks: 16
        });

        await h.dispute.resolveDisputeWait({
            forkId,
            assertMaliciousRemoved: false,
            honestPeerIndices: honest
        });
        const settledHashes = await h.query.getDisputeHashes({
            peerIndices: [honest[0]!],
            disputedForkId: forkId
        });
        const settledDisputes = (
            await Promise.all(
                settledHashes.map((disputeHash) =>
                    h.query.getDispute(honest[0]!, disputeHash)
                )
            )
        ).filter((dispute) => dispute !== null);
        const selfRemoval = settledDisputes.find((dispute) =>
            addressesEqual(dispute.input.disputer, leaver.address)
        );
        if (!selfRemoval)
            throw new Error("Committed self-removal dispute is missing");
        expect(selfRemoval.input.selfRemoval).to.equal(true);

        // the others contributed their newer state into the leaver's window
        const contributions = settledDisputes.filter(
            (dispute) => !addressesEqual(dispute.input.disputer, leaver.address)
        );
        expect(contributions.length).to.be.greaterThan(0);
        const slashed = await h.query.onChainSlashedParticipants(honest[0]!);
        for (const contribution of contributions) {
            expect(contribution.input.requireExistingDisputeWindow).to.equal(
                true
            );
            expect(contribution.input.selfRemoval).to.equal(false);
            expect(contribution.input.latestStateSnapshotHash).to.not.equal(
                selfRemoval.input.latestStateSnapshotHash
            );
            expect(slashed).to.not.include(contribution.input.disputer);
        }
        expect(slashed).to.not.include(leaver.address);
        for (const peerIndex of honest) {
            const control = h.control(h.getPeer(peerIndex));
            expect(
                await control.query.getDisputeFraudProofTypes().request()
            ).to.not.include(
                String(DisputeFraudProofType.DisputeNotLatestState)
            );
            // the reduced state keeps every contributor and drops the leaver
            const participants = await control.query
                .getParticipants()
                .request();
            for (const contribution of contributions)
                expect(participants).to.include(contribution.input.disputer);
            expect(participants).to.not.include(leaver.address);
        }
    } finally {
        await restoreConfirmations();
    }
}
