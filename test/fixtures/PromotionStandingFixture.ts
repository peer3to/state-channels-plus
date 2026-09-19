// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { readMathPeer } from "./OffChainPromotionFixture";
import { Status } from "@/types";
import { Codec, Type, tryDecodeCustomError } from "@/utils";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertPromotionDisputeStanding() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: newcomer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const publication = await h.rpcStub.holdSnapshotPostSend(newcomer.index);
    try {
        await h.transition.insertParticipantOffChain(newcomer.address, 5n, {
            waitForPeers: [0, 1, newcomer.index],
            waitForFinalization: true
        });
        const promoted = await readMathPeer(h, newcomer.index);
        expect(promoted.status).to.equal(Status.PARTICIPATING);
        expect(
            await h.channelManager.canParticipateInDisputes(
                h.channelId,
                newcomer.address
            )
        ).to.equal(false);
        const prepared = await h
            .control(newcomer)
            .dispute.constructDispute(h.activeForkId!)
            .request();
        let rejection: string | undefined;
        try {
            await h.channelManager
                .connect(newcomer.signer)
                .uploadDispute.staticCall(
                    Codec.decode(
                        prepared.encodedDisputeConfirmation,
                        Type.DisputeConfirmation
                    )
                );
        } catch (error) {
            rejection = tryDecodeCustomError(error)?.name;
        }
        expect(rejection).to.equal("ErrorCantParticipateInDispute");
        expect((await readMathPeer(h, newcomer.index)).status).to.equal(
            Status.PARTICIPATING
        );
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, newcomer.index],
            waitForFinalization: true
        });
        const beforePublication = await readMathPeer(h, newcomer.index);
        await publication.release();
        const snapshot = await h.transition.postSnapshotWait({
            peerIndex: newcomer.index
        });
        expect(snapshot?.snapshotData.participants).to.include(
            newcomer.address
        );
        expect(
            await h.channelManager.canParticipateInDisputes(
                h.channelId,
                newcomer.address
            )
        ).to.equal(true);
        expect(
            await h.channelManager.getOnChainThresholdSet(h.channelId)
        ).to.include(newcomer.address);
        const afterPublication = await readMathPeer(h, newcomer.index);
        expect(afterPublication.state.balances).to.deep.equal(
            beforePublication.state.balances
        );
        expect(afterPublication.status).to.equal(Status.PARTICIPATING);
        await h.transition.increment(1, {
            waitForPeers: [0, 1, newcomer.index],
            waitForFinalization: true
        });
        h.assert.dispute.noDisputes();
    } finally {
        await publication.release();
    }
}

export async function assertUnpublishedPromotionTimeout() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: newcomer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const publication = await h.rpcStub.holdSnapshotPostSend(newcomer.index);
    for (const index of [0, 1])
        await h
            .control(h.getPeer(index))
            .stub.stubSuppressDisputeInitiation()
            .request();
    let restoreDelivery: (() => Promise<void>) | undefined;
    try {
        await h.transition.insertParticipantOffChain(newcomer.address, 5n, {
            waitForPeers: [0, 1, newcomer.index],
            waitForFinalization: true
        });
        if ((await h.query.getNextPeerToWrite()).index === newcomer.index)
            await h.transition.increment(1, {
                waitForPeers: [0, 1, newcomer.index],
                waitForFinalization: true
            });
        expect(
            await h.channelManager.canParticipateInDisputes(
                h.channelId,
                newcomer.address
            )
        ).to.equal(false);
        await h.control(newcomer).stub.observeDisputeParticipation().request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(newcomer)
                        .stub.getDisputeParticipationObservation()
                        .request()
                ).warnings > 0,
            h.event.protocolEventTimeoutMs()
        );
        const observed = await h
            .control(newcomer)
            .stub.getDisputeParticipationObservation()
            .request();
        expect(observed.attempts).to.be.greaterThan(0);
        expect(observed.status).to.equal(Status.PARTICIPATING);
        expect(observed.disposed).to.equal(false);
        expect(observed.didDispute).to.equal(false);
        const unlocked = await h.execOnHost(
            h.getPeer(newcomer.index),
            async (sm) => {
                await sm.disputeManager.mutex.lock({
                    taskName: "verify rejected timeout released mutex"
                });
                sm.disputeManager.mutex.unlock();
                return true;
            }
        );
        expect(unlocked).to.equal(true);
        // After the live arrival window, recover the next ordinary authored block
        // through verified sync, whose timestamp policy accepts proven history.
        restoreDelivery = await h.rpcStub.dropNetworkConfirmations(
            newcomer.index
        );
        const author = await h.query.getNextPeerToWrite();
        const before = await readMathPeer(h, newcomer.index);
        await h.transition.increment(1, {
            waitForPeers: [author.index],
            waitForFinalization: false
        });
        const next = await h
            .control(author)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        if (!next) throw new Error("Expected a resumed author block");
        const synced = await h
            .control(newcomer)
            .spectate.sync(author.address, h.activeForkId!, next.height)
            .request();
        expect(synced).to.equal(true);
        const after = await readMathPeer(h, newcomer.index);
        expect(after.height).to.equal(before.height + 1);
        expect(after.status).to.equal(Status.PARTICIPATING);
        expect(
            (
                await h
                    .control(newcomer)
                    .stub.getDisputeParticipationObservation()
                    .request()
            ).disposed
        ).to.equal(false);
    } finally {
        if (restoreDelivery) await restoreDelivery();
        await h
            .control(newcomer)
            .stub.restoreDisputeParticipationObservation()
            .request();
        for (const index of [0, 1])
            await h
                .control(h.getPeer(index))
                .stub.restoreDisputeInitiation()
                .request();
        await publication.release();
    }
}
