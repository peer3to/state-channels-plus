// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Commit a real spam-dispute kill; hold reduction so assertions stay on its fork. */
export async function stageQueueSlash(
    dropEvents: boolean,
    retainHonestCopy = false
) {
    const h = MathTestSession.getHarness();
    const { forkId, spammer, killer } =
        await h.scenario.stageUnkilledSpamDispute({
            killerIndex: 2,
            beforeDispute: async () => {
                for (const peer of h.peers) {
                    await h
                        .control(peer)
                        .stub.stubHoldReductionTasks()
                        .request();
                    await h.dispute.suppressDisputeInitiation([peer.index]);
                }
            }
        });
    const observer = h.getPeer(0);
    const dropped = dropEvents
        ? await h.rpcStub.dropSlashLogs(observer.index)
        : undefined;
    expect(
        await h
            .control(observer)
            .query.getSourceEligibility(spammer.address)
            .request()
    ).to.equal(SourceEligibility.ELIGIBLE);
    const block = await h
        .control(observer)
        .query.getLatestBlockBundle(forkId)
        .request();
    if (!block) throw new Error("Expected historical block");
    const hold = retainHonestCopy
        ? await h.rpcStub.holdBlockWork(observer.index, "storedMerge")
        : undefined;
    if (hold) {
        await h
            .control(killer)
            .byzantine.sendBlockConfirmation(
                block.encodedBlockConfirmation,
                observer.address
            )
            .request();
        await hold.waitUntilEntered();
    }
    const retained = await h
        .control(observer)
        .query.getQueuedRetention(block.hash)
        .request();
    if (!dropEvents)
        await h.control(observer).stub.observeAdmission().request();
    await h.execOnHost(
        killer,
        async (sm, args) => {
            const dispute = sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .find(
                    (proof) =>
                        proof.dispute.input.disputer === args.source &&
                        proof.dispute.input.forkId === args.forkId
                )?.dispute;
            if (!dispute)
                throw new Error("Expected real spam-dispute evidence");
            await sm.disputeManager.killDispute(dispute);
        },
        { source: spammer.address, forkId }
    );
    if (dropped) await dropped.waitUntilDropped();
    else {
        await h.event.waitForAllPeers("onChainSlashed", 1);
        await h.event.waitForAllPeers("onDisputeKilled", 1);
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getSourceEligibility(spammer.address)
                    .request()) === SourceEligibility.SLASHED
        );
    }
    if (!dropEvents) {
        const observation = await h
            .control(observer)
            .stub.getAdmissionObservation()
            .request();
        expect(observation.chainReads).to.equal(0);
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
    expect(
        await h.channelManager.getOnChainSlashedParticipants(h.channelId)
    ).to.include(spammer.address);
    return {
        h,
        forkId,
        spammer,
        killer,
        observer,
        dropped,
        block,
        hold,
        retained
    };
}

export async function assertSlashAdmission(
    mode: "observed" | "unseen" | "refresh"
) {
    const f = await stageQueueSlash(mode !== "observed");
    const { h, observer, spammer, block } = f;
    await h
        .control(observer)
        .stub.observeAdmission({ source: spammer.address })
        .request();
    try {
        if (mode === "refresh")
            await h.execOnHost(observer, (sm) =>
                sm.membershipService.resetEligibility()
            );
        if (mode === "observed") {
            // Reconnect only to exercise intake after the normal slash disconnect.
            // This clears transport punishment, never the membership service's slash evidence.
            await h.network.reconnectPeers([observer.index, spammer.index]);
            await waitFor(
                async () =>
                    await h
                        .control(observer)
                        .handshake.isHandshakeCompleted(spammer.address)
                        .request()
            );
            await waitFor(
                async () =>
                    await h
                        .control(spammer)
                        .handshake.isHandshakeCompleted(observer.address)
                        .request()
            );
        }
        await h
            .control(spammer)
            .byzantine.sendBlockConfirmation(
                block.encodedBlockConfirmation,
                observer.address
            )
            .request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedIntakes >= 1
        );
        if (mode === "refresh")
            await waitFor(
                async () =>
                    (await h
                        .control(observer)
                        .query.getSourceEligibility(spammer.address)
                        .request()) === SourceEligibility.SLASHED
            );
        const state = await h
            .control(observer)
            .query.getSourceEligibility(spammer.address)
            .request();
        expect(state).to.equal(
            mode === "unseen"
                ? SourceEligibility.ELIGIBLE
                : SourceEligibility.SLASHED
        );
        expect(
            (await h.control(observer).stub.getAdmissionObservation().request())
                .syncRequests
        ).to.equal(0);
        expect(
            (await h.control(observer).stub.getAdmissionObservation().request())
                .chainReads
        ).to.equal(mode === "refresh" ? 1 : 0);
        const stored = await h
            .control(observer)
            .query.getBlockByHash(block.hash)
            .request();
        expect(stored?.hash).to.equal(block.hash);
        expect(stored?.confirmationSignatures).to.have.members(
            block.confirmationSignatures
        );
    } finally {
        await f.dropped?.release();
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}

export async function assertSlashPreservesHonestWork() {
    const f = await stageQueueSlash(false, true);
    const { h, observer, spammer, killer, block } = f;
    try {
        // Stored copies enter the normal merge directly; they have no queue record.
        expect(f.retained).to.equal(null);
        await h.network.reconnectPeers([observer.index, spammer.index]);
        await waitFor(
            async () =>
                await h
                    .control(observer)
                    .handshake.isHandshakeCompleted(spammer.address)
                    .request()
        );
        await waitFor(
            async () =>
                await h
                    .control(spammer)
                    .handshake.isHandshakeCompleted(observer.address)
                    .request()
        );
        await h
            .control(observer)
            .stub.observeAdmission({ source: spammer.address })
            .request();
        await h
            .control(spammer)
            .byzantine.sendBlockConfirmation(
                block.encodedBlockConfirmation,
                observer.address
            )
            .request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedIntakes >= 1
        );
        expect(
            await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()
        ).to.deep.equal(f.retained);
        expect(
            (await h.control(observer).stub.getAdmissionObservation().request())
                .syncRequests
        ).to.equal(0);
        await f.hold!.release();
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getQueuedRetention(block.hash)
                    .request()) === null
        );
        expect(
            (
                await h
                    .control(observer)
                    .query.getBlockByHash(block.hash)
                    .request()
            )?.hash
        ).to.equal(block.hash);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(killer.address)
                .request()
        ).to.equal(false);
    } finally {
        await f.hold?.release();
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}
