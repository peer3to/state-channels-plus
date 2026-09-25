// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { MathPeerTestHarness } from "./MathPeerTestHarness";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { Status } from "@/types";
import { MathTestSession } from "@test/harness";
import { decodeMathState } from "@test/utils/mathHarnessAbi";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function readMathPeer(h: MathPeerTestHarness, index: number) {
    const value = await h.execOnHost(h.getPeer(index), async (sm) => {
        const block = sm.storage.blocks.getLatestBlock(sm.forkId);
        const snapshot = sm.storage.getStateSnapshot({
            forkId: sm.forkId,
            height: block?.height ?? -1
        });
        return {
            encodedState: String(await sm.diamondStateMachine.getState()),
            status: sm.status,
            height: block?.height ?? -1,
            inbound: String(
                snapshot?.snapshotData.latestInboundMessageBlockHash
            ),
            outbound: String(
                snapshot?.snapshotData.latestOutboundMessageBlockHash
            ),
            max: sm.storage.queues.maxChannelParticipants
        };
    });
    return { ...value, state: decodeMathState(value.encodedState) };
}

export async function assertOffChainPromotion(
    h: MathPeerTestHarness,
    atCapacity = false
) {
    await h.lifecycle.start(2, 1, {
        maxChannelParticipants: atCapacity ? 2 : 3
    });
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({
        peerIndices: [0, 1, spectator.index],
        waitForFinalization: false
    });
    const before = await readMathPeer(h, spectator.index);
    expect(before.status).to.equal(Status.SYNCED);
    expect(before.state.participants).not.to.include(spectator.address);
    const author = await h.query.getNextPeerToWrite();
    const authorIndex = before.state.participants.indexOf(author.address);
    expect(authorIndex).to.be.at.least(0);
    const spectatorControl = h.control(spectator);
    const publication = await h.rpcStub.holdSnapshotPostSend(spectator.index);
    await spectatorControl.stub
        .observeAdmission({ holdGossip: true })
        .request();
    try {
        await h.transition.insertParticipantOffChain(spectator.address, 5n, {
            waitForPeers: [0, 1, spectator.index],
            waitForFinalization: false
        });
        const after = await readMathPeer(h, spectator.index);
        expect(after.height).to.equal(before.height + 1);
        expect(after.inbound).to.equal(before.inbound);
        expect(after.outbound).to.equal(before.outbound);
        expect(after.state.number).to.equal(before.state.number);
        expect(after.state.currentTurnIndex).to.equal(
            before.state.currentTurnIndex + 1n
        );
        expect(
            after.state.balances.reduce((sum, balance) => sum + balance, 0n)
        ).to.equal(
            before.state.balances.reduce((sum, balance) => sum + balance, 0n)
        );
        expect(
            Number(await h.channelManager.getMaxChannelParticipants())
        ).to.equal(atCapacity ? 2 : 3);
        expect(after.max).to.equal(atCapacity ? 2 : 3);
        const observed = await spectatorControl.stub
            .getAdmissionObservation()
            .request();
        if (atCapacity) {
            expect(after.status).to.equal(Status.SYNCED);
            expect(after.state.participants).to.deep.equal(
                before.state.participants
            );
            expect(after.state.balances).to.deep.equal(before.state.balances);
            expect(observed.broadcasts).to.equal(0);
        } else {
            expect(after.status).to.equal(Status.PARTICIPATING);
            expect(after.state.participants).to.deep.equal([
                ...before.state.participants,
                spectator.address
            ]);
            expect(after.state.balances[authorIndex]).to.equal(
                before.state.balances[authorIndex] - 5n
            );
            expect(after.state.balances.at(-1)).to.equal(5n);
            expect(observed.heldGossip).to.be.greaterThan(0);
            expect(
                await h.channelManager.getOnChainThresholdSet(h.channelId)
            ).not.to.include(spectator.address);
            for (const index of [0, 1]) {
                await waitFor(
                    async () =>
                        (await h
                            .control(h.getPeer(index))
                            .query.getSourceEligibility(spectator.address)
                            .request()) === SourceEligibility.ELIGIBLE
                );
                const eligibility = await h
                    .control(h.getPeer(index))
                    .query.getSourceEligibility(spectator.address)
                    .request();
                expect(eligibility).to.equal(SourceEligibility.ELIGIBLE);
                await h
                    .control(h.getPeer(index))
                    .stub.observeAdmission()
                    .request();
            }
        }
        await spectatorControl.stub.releaseAdmissionGossip().request();
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, spectator.index],
            waitForFinalization: true
        });
        if (!atCapacity) {
            for (const index of [0, 1]) {
                const counts = await h
                    .control(h.getPeer(index))
                    .stub.getAdmissionObservation()
                    .request();
                expect(counts.chainReads).to.equal(0);
                expect(counts.syncRequests).to.equal(0);
            }
        }
        await h.transition.advanceState({
            count: atCapacity ? 1 : 3,
            waitForPeers: [0, 1, spectator.index],
            waitForFinalization: true
        });
        if (!atCapacity) {
            const authored = await h.execOnHost(
                h.getPeer(0),
                (sm, args) =>
                    [...sm.storage.blocks.getIterator(sm.forkId)].some(
                        (block) =>
                            block.height > args.afterHeight &&
                            block.author === args.newcomer
                    ),
                { afterHeight: after.height, newcomer: spectator.address }
            );
            expect(authored).to.equal(true);
        }
        h.assert.dispute.noDisputes();
    } finally {
        await spectatorControl.stub.releaseAdmissionGossip().request();
        await publication.release();
        await Promise.all(
            [0, 1, spectator.index].map((index) =>
                h
                    .control(h.getPeer(index))
                    .stub.restoreAdmissionObservation()
                    .request()
            )
        );
    }
}

export async function assertVerifiedSyncPromotion() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const restoreDelivery = await h.rpcStub.dropNetworkConfirmations(
        spectator.index
    );
    const publication = await h.rpcStub.holdSnapshotPostSend(spectator.index);
    await h.control(spectator).stub.observeAdmission().request();
    try {
        const before = await readMathPeer(h, spectator.index);
        await h.transition.insertParticipantOffChain(spectator.address, 5n, {
            waitForPeers: [0, 1],
            waitForFinalization: false
        });
        expect((await readMathPeer(h, spectator.index)).height).to.equal(
            before.height
        );
        const insertion = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        if (!insertion) throw new Error("Expected the insertion block");
        expect(
            await h.channelManager.getOnChainThresholdSet(h.channelId)
        ).not.to.include(spectator.address);
        const synced = await h
            .control(spectator)
            .spectate.sync(
                h.getPeer(0).address,
                h.activeForkId!,
                insertion.height
            )
            .request();
        expect(synced).to.equal(true);
        const replay = await h
            .control(spectator)
            .stub.getAdmissionObservation()
            .request();
        expect(replay.proofEntries).to.be.greaterThan(0);
        expect(replay.proofSources).to.equal(0);
        expect(replay.syncRequests).to.equal(1);
        const after = await readMathPeer(h, spectator.index);
        expect(after.status).to.equal(Status.PARTICIPATING);
        expect(after.state.participants).to.include(spectator.address);
        expect(after.height).to.equal(insertion.height);
        expect(
            (await h
                .control(spectator)
                .query.getSourceEligibility(spectator.address)
                .request()) === SourceEligibility.ELIGIBLE
        ).to.equal(true);
        expect(
            await h.channelManager.getOnChainThresholdSet(h.channelId)
        ).not.to.include(spectator.address);
        await restoreDelivery();
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        await h.transition.advanceState({
            count: 3,
            waitForPeers: [0, 1, spectator.index],
            waitForFinalization: true
        });
        h.assert.dispute.noDisputes();
    } finally {
        await restoreDelivery();
        await publication.release();
        await h.control(spectator).stub.restoreAdmissionObservation().request();
    }
}

export async function assertPromotionBeforeReceiverApplication(
    overlap = false
) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: newcomer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const author = await h.query.getNextPeerToWrite();
    const receiver = h.getPeer(author.index === 0 ? 1 : 0);
    const application = await h.rpcStub.holdBlockWork(
        receiver.index,
        "confirmationValidation"
    );
    const publication = await h.rpcStub.holdSnapshotPostSend(newcomer.index);
    await h
        .control(newcomer)
        .stub.observeAdmission({ holdGossip: true })
        .request();
    await h.control(newcomer).stub.holdSpectateResponses().request();
    await h.control(receiver).stub.observeAdmission().request();
    try {
        await h.transition.insertParticipantOffChain(newcomer.address, 5n, {
            waitForPeers: [author.index, newcomer.index],
            waitForFinalization: false
        });
        await application.waitUntilEntered();
        const insertion = await h
            .control(newcomer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        if (!insertion)
            throw new Error("Expected a promoted peer's insertion block");
        expect((await readMathPeer(h, newcomer.index)).status).to.equal(
            Status.PARTICIPATING
        );
        expect(
            await h
                .control(receiver)
                .query.getSourceEligibility(newcomer.address)
                .request()
        ).to.equal(SourceEligibility.ABSENT);
        await h.control(newcomer).stub.releaseAdmissionGossip().request();
        await waitFor(
            async () =>
                (await h
                    .control(newcomer)
                    .stub.getHeldSpectateResponseCount()
                    .request()) === 1
        );
        expect(
            (await h.control(receiver).stub.getAdmissionObservation().request())
                .syncRequests
        ).to.equal(1);
        if (overlap) {
            await h
                .control(newcomer)
                .byzantine.sendBlockConfirmation(
                    insertion.encodedBlockConfirmation,
                    receiver.address
                )
                .request();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(receiver)
                            .stub.getAdmissionObservation()
                            .request()
                    ).chainReads >= 2
            );
            expect(
                await h
                    .control(receiver)
                    .query.isBlacklisted(newcomer.address)
                    .request()
            ).to.equal(false);
            expect(
                (
                    await h
                        .control(receiver)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedSyncs
            ).to.equal(0);
        }
        await application.release();
        await h.control(newcomer).stub.releaseSpectateResponses().request();
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        await waitFor(
            async () =>
                (
                    await h
                        .control(receiver)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedSyncs >= 1
        );
        expect(
            (await h
                .control(receiver)
                .query.getSourceEligibility(newcomer.address)
                .request()) === SourceEligibility.ELIGIBLE
        ).to.equal(true);
        expect(
            (
                await h
                    .control(receiver)
                    .query.getLatestBlockBundle(h.activeForkId!)
                    .request()
            )?.hash
        ).to.equal(insertion.hash);
        expect(
            await h
                .control(receiver)
                .query.isBlacklisted(newcomer.address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(receiver)
                .query.isBlacklisted(author.address)
                .request()
        ).to.equal(false);
        await h.transition.increment(1, {
            waitForPeers: [0, 1, newcomer.index],
            waitForFinalization: true
        });
        h.assert.dispute.noDisputes();
    } finally {
        await application.release();
        await h.control(newcomer).stub.releaseSpectateResponses().request();
        await h.control(newcomer).stub.restoreAdmissionObservation().request();
        await h.control(receiver).stub.restoreAdmissionObservation().request();
        await publication.release();
    }
}
