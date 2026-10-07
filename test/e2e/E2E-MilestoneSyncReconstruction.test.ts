import { Status } from "@/types";
import {
    addSyncOnlyObserverAtGenesis,
    chainSnapshot,
    constructedDisputeOnChain,
    encodePayload,
    forgeRepeatedTailTransition,
    freshSpectatorStopsOnPayload,
    freshSpectatorSyncedFrom,
    keepOnlyAuthorSignatures,
    latestHeight,
    milestoneStarts,
    missingBlockHeights,
    nextWriters,
    proofHeights,
    pruneBelowAnchor,
    reconstructedProof,
    reconstructionFromChainAnchor,
    restartPeerRuntime,
    servedPayload,
    stageLaggingConstructionMirror,
    stageOverlappingSupport,
    stageReducedWithoutAdoption,
    stagePromotedChannel,
    stageSyncedThroughParticipation,
    stageUnpostedLeave,
    syncSpectatorOnServedPayload,
    syncFromResponder,
    syncFromServedPayload,
    waitForMutualConnection
} from "@test/fixtures/MilestoneSyncStaging";
import { readMathPeer } from "@test/fixtures/OffChainPromotionFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * Plan 35 (milestone-only state proof) workflows across sync, replay,
 * persistence and reconstruction: what a receiver verifies and stores, and
 * that every synced peer rebuilds a proof the chain accepts.
 */
describe("E2E: Milestone sync and reconstruction", function () {
    it("E01: a participant that missed the unfinalized genesis-linked block-0 run syncs it, replays block 0 from genesis and authors the next block", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const forkId = h.activeForkId!;
        const author = await h.query.getNextPeerToWrite();
        const receiver = h.getPeer(author.index === 0 ? 1 : 0);
        // The receiver neither sees nor signs block 0, so block 0 stays below
        // the two-party threshold; its own writer timeout stays quiet.
        const restoreDrop = await h.rpcStub.dropNetworkConfirmations(
            receiver.index
        );
        const restoreTimeouts = await h.rpcStub.suppressTimeoutCheck(
            receiver.index
        );
        await h.byzantine.stubCalldataHandler(receiver.index);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [author.index],
            waitForFinalization: false
        });

        const served = await reconstructedProof(h, author.index, forkId);
        expect(served.milestoneConfirmationHeights).to.deep.equal([[0]]);
        expect(served.chainReplayBlockIndex).to.equal(0);
        expect(served.finalizedSnapshotHash).to.equal(
            served.genesisSnapshotHash
        );
        expect(served.verified).to.equal(true);
        expect(
            await h
                .control(receiver)
                .query.getLatestBlockHeight(forkId)
                .request()
        ).to.equal(null);

        expect(
            await syncFromResponder(
                h,
                receiver,
                h.getPeer(author.index),
                forkId,
                0
            )
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: 0
        });
        expect(
            await h.control(receiver).query.getBlockHashAt(forkId, 0).request()
        ).to.equal(
            await h
                .control(h.getPeer(author.index))
                .query.getBlockHashAt(forkId, 0)
                .request()
        );
        expect(
            await h
                .control(receiver)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(h.getPeer(author.index))
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );

        await restoreDrop();
        await restoreTimeouts();
        await h.byzantine.restoreCalldataHandler(receiver.index);
        expect((await h.query.getNextPeerToWrite()).index).to.equal(
            receiver.index
        );
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1],
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
        const rebuilt = await reconstructedProof(h, receiver.index, forkId);
        expect(rebuilt.verified).to.equal(true);
        expect(rebuilt.latestProofHeight).to.equal(2);
    });

    it("E03: a later joiner that synced past a finalized join reconstructs the join hop and constructs a dispute the chain verifies", async function () {
        const h = TestSession.getHarness();
        const { forkId, participants, changeHeight } =
            await stagePromotedChannel(h, { postPromotionBlocks: 2 });
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: participants,
            minimumBlocks: 2,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const laterJoiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, laterJoiner.index]
        });
        await h.join.joinChannelWait({ joiner: laterJoiner });
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [laterJoiner.index],
            status: Status.PARTICIPATING,
            waitForPeers: participants,
            maximumBlocks: 20
        });
        const members = [...participants, laterJoiner.index];
        await h.transition.advanceState({
            count: 2,
            waitForPeers: members,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({ peerIndices: members });

        expect(
            await h
                .control(laterJoiner)
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).to.include(changeHeight);
        const rebuilt = await reconstructedProof(h, laterJoiner.index, forkId);
        expect(rebuilt.verified).to.equal(true);
        expect(rebuilt.startSnapshotHash).to.equal(rebuilt.genesisSnapshotHash);
        expect(milestoneStarts(rebuilt)).to.include(changeHeight);

        const dispute = await constructedDisputeOnChain(
            h,
            laterJoiner.index,
            forkId
        );
        expect(dispute.verified).to.equal(true);
        expect(dispute.milestoneStarts).to.include(changeHeight);
    });

    it("E04: a peer synced across a departure and a join serves its reconstructed proof to a participant and posts a snapshot through the union hops", async function () {
        const h = TestSession.getHarness();
        const { forkId, leaverIndex, remaining, changeHeight } =
            await stageUnpostedLeave(h);
        const { peer: joinerPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: remaining,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const joiner = h.getPeer(joinerPeer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, joiner.index]
        });
        await h.join.joinChannelWait({ joiner });
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [joiner.index],
            status: Status.PARTICIPATING,
            waitForPeers: remaining,
            maximumBlocks: 20
        });
        const members = [...remaining, joiner.index];
        await h.transition.advanceState({
            count: 2,
            waitForPeers: members,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({ peerIndices: members });
        const joinHeight = (
            await h
                .control(h.getPeer(remaining[0]))
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).at(-1)!;
        expect(joinHeight).to.be.greaterThan(changeHeight);

        const { peer: syncedPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: members,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const synced = h.getPeer(syncedPeer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...members, synced.index]
        });
        expect(
            await h
                .control(synced)
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).to.include.members([changeHeight, joinHeight]);
        const rebuilt = await reconstructedProof(h, synced.index, forkId);
        expect(rebuilt.verified).to.equal(true);
        expect(milestoneStarts(rebuilt)).to.include.members([
            changeHeight,
            joinHeight
        ]);

        const tip = await latestHeight(h, synced, forkId);
        // A fresh spectator walks the synced peer's proof, union hops
        // included, from its own empty state.
        const fresh = await freshSpectatorSyncedFrom(
            h,
            synced,
            members,
            members,
            forkId
        );
        expect(await latestHeight(h, fresh, forkId)).to.equal(tip);
        expect(
            await h
                .control(fresh)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(synced)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
        expect(
            await h
                .control(fresh)
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).to.include.members([changeHeight, joinHeight]);

        const posted = await h.transition.postSnapshotWait({
            peerIndex: synced.index,
            forkId: String(forkId)
        });
        expect(posted).to.not.equal(undefined);
        const onChain = await chainSnapshot(h);
        expect(onChain.hash).to.equal(posted!.hash);
        expect(onChain.blockHeight).to.equal(tip);
        expect(onChain.snapshotData.participants.map(String)).to.not.include(
            h.getPeer(leaverIndex).address
        );
        expect(onChain.snapshotData.participants.map(String)).to.include(
            joiner.address
        );
    });

    it("E05: participant changes inside an unfinalized tail stay in the last milestone and a sync-only observer replays them", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, { maxChannelParticipants: 5 });
        const observer = await addSyncOnlyObserverAtGenesis(h);
        const participants = [0, 1, 2];
        await h.transition.advanceState({
            count: 3,
            waitForPeers: participants,
            waitForFinalization: true
        });
        // Two off-chain insertions of members that never sign: every block
        // from the first insertion on stays below the threshold. Author until
        // both insertions and the block after them fall to running writers.
        await h.transition.keepAuthoringUntil({
            until: async () => {
                const { state } = await readMathPeer(h, 0);
                const turn = state.currentTurnIndex;
                return (turn + 1n) % 4n < 3n && (turn + 2n) % 5n < 3n;
            },
            waitForPeers: participants,
            maximumBlocks: 10
        });
        const forkId = h.activeForkId!;
        const inserted = [
            ethers.Wallet.createRandom().address,
            ethers.Wallet.createRandom().address
        ];
        for (const address of inserted)
            await h.transition.insertParticipantOffChain(address, 5n, {
                waitForTurn: true,
                waitForSync: true,
                waitForPeers: participants,
                waitForFinalization: false
            });
        await h.transition.advanceState({
            count: 1,
            waitForPeers: participants,
            waitForFinalization: false
        });
        const responder = h.getPeer(0);
        const tip = await latestHeight(h, responder, forkId);
        const changes = (
            await h
                .control(responder)
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).slice(-2);
        expect(changes).to.deep.equal([tip - 2, tip - 1]);

        const served = await reconstructedProof(h, responder.index, forkId);
        expect(served.verified).to.equal(true);
        const lastRun = served.milestoneConfirmationHeights.at(-1)!;
        expect(lastRun).to.include.members(changes);
        expect(lastRun[0]).to.be.lessThan(changes[0]);
        expect(milestoneStarts(served)).to.not.include(changes[0]);
        expect(milestoneStarts(served)).to.not.include(changes[1]);
        expect(served.chainReplayBlockIndex).to.be.at.most(
            lastRun.indexOf(changes[0])
        );

        expect(
            await syncFromResponder(h, observer, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(observer)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
        expect(
            (await readMathPeer(h, observer.index)).state.participants
        ).to.include.members(inserted);
        const rebuilt = await reconstructedProof(h, observer.index, forkId);
        expect(rebuilt.verified).to.equal(true);
        expect(milestoneStarts(rebuilt)).to.not.include(changes[0]);
        expect(milestoneStarts(rebuilt)).to.not.include(changes[1]);
    });

    it("E06: a builder whose mirror lags a newer chain anchor builds a larger proof from the genesis that the chain and a peer accept, and rebuilds from the anchor once the mirror catches up", async function () {
        const h = TestSession.getHarness();
        const staged = await stageLaggingConstructionMirror(h);
        const { forkId, anchor, tip, changeHeight } = staged;

        const lagging = await reconstructedProof(h, 0, forkId);
        const current = await reconstructedProof(h, 1, forkId);
        expect(lagging.startSnapshotHash).to.equal(lagging.genesisSnapshotHash);
        expect(current.startSnapshotHash).to.equal(anchor.hash);
        expect(lagging.verified).to.equal(true);
        expect(current.verified).to.equal(true);
        expect(lagging.latestProofHeight).to.equal(tip);
        expect(milestoneStarts(lagging)).to.include(changeHeight);
        expect(lagging.milestoneCount).to.be.greaterThan(
            current.milestoneCount
        );

        // A fresh spectator accepts the larger proof from the newer anchor.
        const fresh = await freshSpectatorSyncedFrom(
            h,
            h.getPeer(0),
            staged.participants,
            staged.participants,
            forkId
        );
        expect(await latestHeight(h, fresh, forkId)).to.equal(tip);
        expect(
            await h
                .control(fresh)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(h.getPeer(0))
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );

        expect(await staged.release()).to.be.greaterThan(0);
        const caughtUp = await reconstructedProof(h, 0, forkId);
        expect(caughtUp.startSnapshotHash).to.equal(anchor.hash);
        expect(caughtUp.verified).to.equal(true);
        expect(caughtUp.latestProofHeight).to.equal(tip);
    });

    it("E07: a lagging spectator accepts a proof that starts below its final point, keeps its own state and replays the newer tail without blacklisting", async function () {
        const h = TestSession.getHarness();
        const { forkId, participants, changeHeight } =
            await stagePromotedChannel(h, { postPromotionBlocks: 1 });
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: participants,
            minimumBlocks: 2,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const spectator = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, spectator.index]
        });
        const finalHeight = await latestHeight(h, spectator, forkId);
        const finalHash = await h
            .control(spectator)
            .query.getBlockHashAt(forkId, finalHeight)
            .request();
        await h.network.blacklistAndDisconnectPeer(spectator.index);
        // the isolated spectator learns no tail block from posted calldata
        await h.byzantine.stubCalldataHandler(spectator.index);

        // The third writer neither sees nor signs the next two blocks, so
        // they form an unfinalized tail on top of the spectator's final point.
        const [first, second, silent] = await nextWriters(h, 0, 3);
        for (const index of participants)
            await h.rpcStub.suppressTimeoutCheck(index);
        await h.rpcStub.dropNetworkConfirmations(silent);
        await h.byzantine.stubCalldataHandler(silent);
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [first, second],
            waitForFinalization: false
        });
        const responder = h.getPeer(first);
        const tip = await latestHeight(h, responder, forkId);
        expect(tip).to.equal(finalHeight + 2);

        const payload = await servedPayload(h, responder, forkId);
        const heights = proofHeights(payload);
        expect(
            heights[0][0],
            "the proof starts below the final point"
        ).to.equal(changeHeight);
        expect(heights[0][0]).to.be.lessThan(finalHeight);
        expect(heights.at(-1)).to.deep.equal([
            finalHeight,
            finalHeight + 1,
            finalHeight + 2
        ]);

        await h.network.reconnectPeers([spectator.index]);
        await waitForMutualConnection(h, spectator, responder);
        expect(await latestHeight(h, spectator, forkId)).to.equal(finalHeight);
        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(spectator)
                .query.getBlockHashAt(forkId, finalHeight)
                .request()
        ).to.equal(finalHash);
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    it("E08: a spectator blacklists a responder whose valid proof ends below its finalized point and keeps its state", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 2 });
        const forkId = h.activeForkId!;
        const responder = h.getPeer(1);
        const early = encodePayload(await servedPayload(h, responder, forkId));
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 2,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const spectator = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, spectator.index]
        });
        const finalHeight = await latestHeight(h, spectator, forkId);
        const stateBefore = await h
            .control(spectator)
            .query.getLatestStateMachineStateHash(forkId)
            .request();

        expect(
            await syncFromServedPayload(
                h,
                spectator,
                responder,
                early,
                forkId,
                finalHeight
            )
        ).to.deep.equal({
            synced: false,
            rejections: ["proof ends below the finalized state"],
            blacklisted: true,
            latestHeight: finalHeight
        });
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(stateBefore);
    });

    it("E08 (honest lagging responder): a spectator blacklists an honest isolated spectator whose own valid proof ends below the requester's finalized point", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 2 });
        const forkId = h.activeForkId!;
        const { peer: laggingPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const { peer: requesterPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const lagging = h.getPeer(laggingPeer.index);
        const requester = h.getPeer(requesterPeer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, lagging.index, requester.index]
        });
        await h.network.blacklistAndDisconnectPeer(lagging.index);
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2, requester.index],
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, requester.index]
        });
        const laggingHeight = await latestHeight(h, lagging, forkId);
        const finalHeight = await latestHeight(h, requester, forkId);
        expect(laggingHeight).to.be.lessThan(finalHeight);
        await h.network.reconnectPeers([lagging.index]);
        await waitForMutualConnection(h, requester, lagging);
        expect(await latestHeight(h, lagging, forkId)).to.equal(laggingHeight);

        // The lagging responder serves its own honest head.
        expect(
            await syncFromResponder(
                h,
                requester,
                lagging,
                forkId,
                laggingHeight
            )
        ).to.deep.equal({
            synced: false,
            rejections: ["proof ends below the finalized state"],
            blacklisted: true,
            latestHeight: finalHeight
        });
    });

    it("E08 (honest restarted responder): a spectator blacklists an honest spectator that restarted, came back older than the requester's finalized point and serves its own valid proof; the requester keeps its newer state", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        await h.transition.advanceState({ count: 2 });
        const forkId = h.activeForkId!;
        const participants = [0, 1, 2];
        const { peer: responderPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: participants,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const { peer: requesterPeer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: participants,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const requester = h.getPeer(requesterPeer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, responderPeer.index, requester.index]
        });

        // The responder restarts: a fresh runtime with empty storage, for the
        // same key, syncs again while the participants keep authoring.
        const responder = await restartPeerRuntime(h, responderPeer.index, [
            ...participants,
            requester.index
        ]);
        await h.transition.keepAuthoringUntilPeersStatus({
            peerIndices: [responder.index],
            status: Status.SYNCED,
            waitForPeers: [...participants, requester.index]
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, responder.index, requester.index]
        });
        // It comes back older: partitioned from the participants (still
        // connected to the requester) while they finalize two more blocks.
        for (const index of participants) {
            const participant = h.getPeer(index);
            await h
                .control(responder)
                .network.blacklistAndDisconnectPeerByAddress(
                    participant.address
                )
                .request();
            await h
                .control(participant)
                .network.blacklistAndDisconnectPeerByAddress(responder.address)
                .request();
        }
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [...participants, requester.index],
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, requester.index]
        });
        const responderHeight = await latestHeight(h, responder, forkId);
        const finalHeight = await latestHeight(h, requester, forkId);
        expect(responderHeight).to.be.lessThan(finalHeight);
        const finalHash = await h
            .control(requester)
            .query.getBlockHashAt(forkId, finalHeight)
            .request();
        const stateBefore = await h
            .control(requester)
            .query.getLatestStateMachineStateHash(forkId)
            .request();
        await waitForMutualConnection(h, requester, responder);

        // The restarted responder serves its own honest, older head.
        expect(
            await syncFromResponder(
                h,
                requester,
                responder,
                forkId,
                responderHeight
            )
        ).to.deep.equal({
            synced: false,
            rejections: ["proof ends below the finalized state"],
            blacklisted: true,
            latestHeight: finalHeight
        });
        expect(
            await h
                .control(requester)
                .query.getBlockHashAt(forkId, finalHeight)
                .request()
        ).to.equal(finalHash);
        expect(
            await h
                .control(requester)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(stateBefore);
    });

    it("E09: the chain anchor moves into a received proof's range before the receiver verifies it; the sync-only observer persists from that anchor (the anchor block included) and a fresh spectator syncs from its reconstructed proof", async function () {
        const h = TestSession.getHarness();
        const staged = await stagePromotedChannel(h, {
            postPromotionBlocks: 2,
            syncOnlyObserver: true
        });
        const { forkId, participants, changeHeight, tip } = staged;
        const observer = staged.observer!;
        const responder = h.getPeer(0);
        // the writers idle while the observer's verification is held
        for (const index of participants)
            await h.rpcStub.suppressTimeoutCheck(index);
        const served = proofHeights(await servedPayload(h, responder, forkId));
        expect(served[0][0]).to.equal(changeHeight);
        expect(served.at(-1)!.at(-1)).to.equal(tip);

        // The payload arrives and its verification is held.
        await h.control(observer).stub.recordSyncRejections().request();
        const application = await h.rpcStub.holdSpectateSyncApplication(
            observer.index
        );
        await h
            .control(observer)
            .spectate.startSync(responder.address, forkId, tip)
            .request();
        await waitFor(
            async () => (await application.entered()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        // The anchor moves into the proof's range before it is verified.
        const anchor = await h.transition.postSnapshotWait({
            peerIndex: 1,
            forkId: String(forkId)
        });
        expect(anchor).to.not.equal(undefined);
        expect(anchor!.blockHeight).to.be.greaterThan(changeHeight);
        expect(anchor!.blockHeight).to.be.at.most(tip);
        await application.release();
        await waitFor(
            async () => (await latestHeight(h, observer, forkId)) === tip,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h
                .control(observer)
                .stub.restoreRecordedSyncRejections()
                .request()
        ).to.deep.equal([]);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(responder.address)
                .request()
        ).to.equal(false);

        // Persisted from the observed anchor: nothing
        // below it, the anchor block itself is stored.
        expect(
            await missingBlockHeights(
                h,
                observer,
                forkId,
                0,
                anchor!.blockHeight - 1
            )
        ).to.deep.equal(
            Array.from({ length: anchor!.blockHeight }, (_, height) => height)
        );
        expect(
            await h
                .control(observer)
                .query.getBlockHashAt(forkId, anchor!.blockHeight)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getBlockHashAt(forkId, anchor!.blockHeight)
                .request()
        );
        const rebuilt = await reconstructedProof(h, observer.index, forkId);
        expect(rebuilt.startSnapshotHash).to.equal(anchor!.hash);
        expect(rebuilt.verified).to.equal(true);
        expect(rebuilt.latestProofHeight).to.equal(tip);

        const fresh = await freshSpectatorSyncedFrom(
            h,
            observer,
            participants,
            participants,
            forkId
        );
        expect(
            await h
                .control(fresh)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(observer)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    it("E30: a spectator synced after an unposted leave keeps the departure hop and reconstructs chain-valid proofs before and after progress and after adopting the exit snapshot", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining, changeHeight } = await stageUnpostedLeave(h);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: remaining,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const spectator = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        expect(
            await h
                .control(spectator)
                .query.getParticipantChangeHeights(forkId)
                .request()
        ).to.deep.equal([changeHeight]);
        const synced = await reconstructedProof(h, spectator.index, forkId);
        expect(synced.startSnapshotHash).to.equal(synced.genesisSnapshotHash);
        expect(milestoneStarts(synced)[0]).to.equal(changeHeight);
        expect(synced.verified).to.equal(true);

        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        const progressed = await reconstructedProof(h, spectator.index, forkId);
        expect(milestoneStarts(progressed)[0]).to.equal(changeHeight);
        expect(progressed.latestProofHeight).to.equal(
            synced.latestProofHeight! + 1
        );
        expect(progressed.verified).to.equal(true);

        const anchor = await h.transition.postSnapshotWait({
            peerIndex: remaining[0],
            forkId: String(forkId)
        });
        expect(anchor).to.not.equal(undefined);
        expect(anchor!.blockHeight).to.be.greaterThan(changeHeight);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        const adopted = await reconstructionFromChainAnchor(
            h,
            spectator.index,
            forkId
        );
        expect(adopted.startSnapshotHash).to.equal(anchor!.hash);
        expect(
            Math.min(...adopted.milestoneConfirmationHeights.flat())
        ).to.be.at.least(anchor!.blockHeight);
        expect(adopted.latestProofHeight).to.equal(
            progressed.latestProofHeight! + 1
        );
        expect(adopted.verified).to.equal(true);
    });

    it("E30 (pruned): after adopting the exit snapshot the synced spectator prunes history below it and still reconstructs, serves, posts a snapshot and constructs a dispute the chain verifies", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining } = await stageUnpostedLeave(h);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: remaining,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const spectator = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        const anchor = await h.transition.postSnapshotWait({
            peerIndex: remaining[0],
            forkId: String(forkId)
        });
        expect(anchor).to.not.equal(undefined);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        await reconstructionFromChainAnchor(h, spectator.index, forkId);

        const pruned = await pruneBelowAnchor(
            h,
            spectator,
            forkId,
            anchor!.blockHeight
        );
        expect(pruned.prunedHeights.length).to.be.greaterThan(0);
        expect(pruned.prunedSnapshotHashes.length).to.be.greaterThan(0);
        expect(
            await missingBlockHeights(
                h,
                spectator,
                forkId,
                0,
                anchor!.blockHeight - 1
            )
        ).to.deep.equal(
            Array.from({ length: anchor!.blockHeight }, (_, height) => height)
        );

        const rebuilt = await reconstructedProof(h, spectator.index, forkId);
        expect(rebuilt.startSnapshotHash).to.equal(anchor!.hash);
        expect(rebuilt.verified).to.equal(true);

        // A fresh spectator syncs from the pruned spectator's payload.
        const fresh = await freshSpectatorSyncedFrom(
            h,
            spectator,
            remaining,
            remaining,
            forkId,
            { authorThroughCreation: true }
        );
        expect(
            await h
                .control(fresh)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );

        const dispute = await constructedDisputeOnChain(
            h,
            spectator.index,
            forkId
        );
        expect(dispute.verified).to.equal(true);

        await h.transition.advanceState({
            count: 1,
            waitForPeers: remaining,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...remaining, spectator.index]
        });
        const posted = await h.transition.postSnapshotWait({
            peerIndex: spectator.index,
            forkId: String(forkId)
        });
        expect(posted).to.not.equal(undefined);
        expect(posted!.blockHeight).to.be.greaterThan(anchor!.blockHeight);
        expect((await chainSnapshot(h)).hash).to.equal(posted!.hash);
    });

    it("E31: a sync-only observer stores only the separated milestone runs whose virtual-voting evidence spans several blocks, and constructs a dispute the chain verifies without the gap history", async function () {
        const h = TestSession.getHarness();
        const { forkId, observer, tip, participants } =
            await stagePromotedChannel(h, {
                postPromotionBlocks: 6,
                syncOnlyObserver: true
            });
        // the channel idles while the observer syncs and is inspected
        for (const index of participants)
            await h.rpcStub.suppressTimeoutCheck(index);
        const responder = h.getPeer(0);
        // The head's finality now comes from the authors of three blocks.
        await keepOnlyAuthorSignatures(h, 0, forkId, [tip - 2, tip - 1, tip]);
        const served = await reconstructedProof(h, 0, forkId);
        const runs = served.milestoneConfirmationHeights;
        expect(runs.at(-1)).to.deep.equal([tip - 2, tip - 1, tip]);
        expect(served.chainReplayBlockIndex).to.equal(1);
        const changeRunEnd = runs.at(-2)!.at(-1)!;
        expect(changeRunEnd, "a gap separates the runs").to.be.lessThan(
            tip - 3
        );

        expect(
            await syncFromResponder(h, observer!, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        const stored = new Set(runs.flat());
        expect(
            await missingBlockHeights(h, observer!, forkId, 0, tip)
        ).to.deep.equal(
            Array.from({ length: tip + 1 }, (_, height) => height).filter(
                (height) => !stored.has(height)
            )
        );
        const rebuilt = await reconstructedProof(h, observer!.index, forkId);
        expect(rebuilt.milestoneConfirmationHeights).to.deep.equal(runs);
        expect(rebuilt.verified).to.equal(true);
        expect(
            (await constructedDisputeOnChain(h, observer!.index, forkId))
                .verified
        ).to.equal(true);
    });

    it("E31 (overlapping proof): the chain verifies an overlapping compact proof; a sync-only observer persists each shared block once with its evidence, stores no gap history, and reconstructs a proof and dispute the chain verifies", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOverlappingSupport(h, {
            syncOnlyObserver: true
        });
        const { forkId, proof, responder, tip } = staged;
        const observer = staged.observer!;
        expect(proof.verified).to.equal(true);
        const runs = proof.milestoneConfirmationHeights;
        const shared = runs
            .at(-2)!
            .filter((height) => runs.at(-1)!.includes(height));
        expect(shared.length).to.be.greaterThan(0);

        expect(
            await syncFromResponder(h, observer, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        // one stored block per shared height, with the responder's evidence
        const evidence = async (peerIndex: number, height: number) => {
            const bundle = await h
                .control(h.getPeer(peerIndex))
                .query.getBlockByHeight(forkId, height)
                .request();
            return (
                bundle && {
                    hash: bundle.hash,
                    signers: [
                        bundle.author,
                        ...bundle.confirmationSignerAddresses
                    ].sort()
                }
            );
        };
        for (const height of shared)
            expect(await evidence(observer.index, height)).to.deep.equal(
                await evidence(responder.index, height)
            );
        // compact: nothing outside the proof runs
        const stored = new Set(runs.flat());
        expect(
            await missingBlockHeights(h, observer, forkId, 0, tip)
        ).to.deep.equal(
            Array.from({ length: tip + 1 }, (_, height) => height).filter(
                (height) => !stored.has(height)
            )
        );
        const rebuilt = await reconstructedProof(h, observer.index, forkId);
        expect(rebuilt.milestoneConfirmationHeights).to.deep.equal(runs);
        expect(rebuilt.verified).to.equal(true);
        expect(
            (await constructedDisputeOnChain(h, observer.index, forkId))
                .verified
        ).to.equal(true);
    });

    it("a spectator first served an older valid answer, then a future gossip block: the queue-timeout probe installs a compact proof above that block, keeps every honest source, and the spectator follows later blocks", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const participants = [0, 1, 2];
        await h.transition.advanceState({
            count: 1,
            waitForPeers: participants,
            waitForFinalization: true
        });
        const forkId = h.activeForkId!;
        const older = encodePayload(
            await servedPayload(h, h.getPeer(0), forkId)
        );
        const olderHeight = await latestHeight(h, h.getPeer(0), forkId);
        await h.transition.advanceState({
            count: 3,
            waitForPeers: participants,
            waitForFinalization: true
        });

        // Every responder answers the initial sync with the older answer;
        // the writers author through the spectator's creation and run no
        // timeout check during the idle sync.
        for (const index of participants)
            await h.rpcStub.suppressTimeoutCheck(index);
        const spectator = await syncSpectatorOnServedPayload(
            h,
            older,
            participants,
            participants
        );
        expect(await latestHeight(h, spectator, forkId)).to.equal(olderHeight);

        // Record the spectator's later syncs; each still runs for real.
        await h.rpcStub.recordSpectateSync(spectator.index, { forward: true });
        // Two final blocks inside one queue timeout: the first reaches the
        // spectator as a future block, and the probe's compact proof ends at
        // the second, above it.
        const futureHeight = (await latestHeight(h, h.getPeer(0), forkId)) + 1;
        await h.transition.advanceState({
            count: 2,
            waitForPeers: participants,
            waitForFinalization: true
        });
        const head = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHash(forkId)
            .request();
        await waitFor(
            async () =>
                (await h
                    .control(spectator)
                    .query.getLatestBlockHash(forkId)
                    .request()) === head,
            h.event.protocolEventTimeoutMs()
        );
        // the catch-up came from the probe's sync, not from gossip
        expect(
            await h.rpcStub.spectateSyncCallCount(spectator.index)
        ).to.be.greaterThan(0);
        expect(
            await h
                .control(spectator)
                .query.getBlockHashAt(forkId, futureHeight)
                .request()
        ).to.equal(null);

        await h.transition.advanceState({
            count: 1,
            waitForPeers: [...participants, spectator.index],
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, spectator.index]
        });
        for (const index of participants)
            expect(
                await h
                    .control(spectator)
                    .query.isBlacklisted(h.getPeer(index).address)
                    .request()
            ).to.equal(false);
    });

    it("E34 (valid repeated tail): a tail block that also supports the earlier change hop is still replayed and its state reaches the observer", async function () {
        const h = TestSession.getHarness();
        const { forkId, observer, responder, proof, tip } =
            await stageOverlappingSupport(h, { syncOnlyObserver: true });
        const lastRun = proof.milestoneConfirmationHeights.at(-1)!;
        const tail = lastRun.slice(proof.chainReplayBlockIndex);
        expect(tail.length).to.be.greaterThan(0);
        expect(proof.milestoneConfirmationHeights.at(-2)).to.include(tail[0]);

        expect(
            await syncFromResponder(h, observer!, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        for (const height of tail)
            expect(
                await h
                    .control(observer!)
                    .query.getBlockHashAt(forkId, height)
                    .request()
            ).to.equal(
                await h
                    .control(responder)
                    .query.getBlockHashAt(forkId, height)
                    .request()
            );
        expect(
            await h
                .control(observer!)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    it("E34 (invalid repeated tail): a forged transition in a tail block that also supports the change hop is replayed, not pre-stored, and stops a fresh spectator", async function () {
        const h = TestSession.getHarness();
        const { forkId, responder, participants } =
            await stageOverlappingSupport(h, { syncOnlyObserver: false });
        const forged = await forgeRepeatedTailTransition(
            h,
            await servedPayload(h, responder, forkId)
        );
        const stopped = await freshSpectatorStopsOnPayload(
            h,
            encodePayload(forged),
            participants
        );
        expect(stopped.closed).to.equal(true);
        // The walk accepted the proof and the sync persisted it (SYNCED);
        // only then the tail replay met the forged transition and the
        // spectating strategy aborted (back to OPENED), not the walk.
        const synced = stopped.statuses.indexOf(Status.SYNCED);
        expect(synced).to.be.at.least(0);
        expect(stopped.statuses[synced + 1]).to.equal(Status.OPENED);
        // the honest peers keep their history
        expect(
            (await reconstructedProof(h, responder.index, forkId)).verified
        ).to.equal(true);
    });

    it("E37: a spectator reconstructs chain-valid proofs when synced, pending, participating, after progress and after the anchor moves", async function () {
        const h = TestSession.getHarness();
        const { forkId, member, status, joinHeight, anchor, stages } =
            await stageSyncedThroughParticipation(h);
        expect(status).to.equal(Status.PENDING_PARTICIPANT);
        expect(joinHeight).to.not.equal(undefined);
        for (const stage of [
            stages.synced,
            stages.pending,
            stages.participating,
            stages.progressed
        ]) {
            expect(stage.verified).to.equal(true);
            expect(stage.startSnapshotHash).to.equal(stage.genesisSnapshotHash);
        }
        expect(milestoneStarts(stages.participating)).to.include(joinHeight);
        expect(milestoneStarts(stages.progressed)).to.include(joinHeight);
        expect(stages.progressed.latestProofHeight).to.equal(
            stages.participating.latestProofHeight! + 2
        );
        expect(stages.anchored.startSnapshotHash).to.equal(anchor.hash);
        expect(stages.anchored.verified).to.equal(true);
        expect(
            (await constructedDisputeOnChain(h, member.index, forkId)).verified
        ).to.equal(true);
    });

    it("E37 (pruned): after the anchor moves the participant prunes history below it and still reconstructs, serves, posts a snapshot and constructs a dispute the chain verifies", async function () {
        const h = TestSession.getHarness();
        const { forkId, member, participants, anchor } =
            await stageSyncedThroughParticipation(h);
        // Pruning and chain verification must not idle the next writer while
        // this case still has later blocks to author.
        let inspected = false;
        const inspecting = (async () => {
            const pruned = await pruneBelowAnchor(
                h,
                member,
                forkId,
                anchor.blockHeight
            );
            expect(pruned.prunedHeights.length).to.be.greaterThan(0);
            expect(pruned.prunedSnapshotHashes.length).to.be.greaterThan(0);
            const rebuilt = await reconstructedProof(h, member.index, forkId);
            expect(rebuilt.startSnapshotHash).to.equal(anchor.hash);
            expect(rebuilt.verified).to.equal(true);
        })().finally(() => {
            inspected = true;
        });
        await Promise.all([
            inspecting,
            h.transition.keepAuthoringUntil({
                until: () => inspected,
                waitForPeers: participants,
                maximumBlocks: 20
            })
        ]);

        // A fresh spectator syncs from the pruned participant's payload.
        const fresh = await freshSpectatorSyncedFrom(
            h,
            member,
            participants,
            participants,
            forkId,
            { authorThroughCreation: true }
        );
        expect(
            await h
                .control(fresh)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(member)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
        expect(
            (await constructedDisputeOnChain(h, member.index, forkId)).verified
        ).to.equal(true);

        await h.transition.advanceState({
            count: 1,
            waitForPeers: participants,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({ peerIndices: participants });
        const posted = await h.transition.postSnapshotWait({
            peerIndex: member.index,
            forkId: String(forkId)
        });
        expect(posted).to.not.equal(undefined);
        expect(posted!.blockHeight).to.be.greaterThan(anchor.blockHeight);
        expect((await chainSnapshot(h)).hash).to.equal(posted!.hash);
    });

    it("E39: before the chain adopts the successor the proof starts at the successor genesis, a fresh spectator syncs and rebuilds it, and after adoption reconstruction starts at the successor anchor", async function () {
        const h = TestSession.getHarness();
        // The reduce lands; every adopt-only post fails until the test
        // releases them, so the chain snapshot stays on the source fork.
        const { sourceForkId, successor, honest, releaseAdoption } =
            await stageReducedWithoutAdoption(h, [0, 2, 3]);
        expect(successor).to.not.equal(sourceForkId);
        expect(
            (await h.channelManager.getReducedResult(h.channelId, sourceForkId))
                .reducedForkId
        ).to.equal(successor);
        expect((await chainSnapshot(h)).forkID).to.equal(sourceForkId);

        await h.transition.advanceState({
            count: 2,
            waitForPeers: honest,
            waitForFinalization: true
        });
        const built = await reconstructedProof(h, 0, successor);
        expect(built.startSnapshotHash).to.equal(built.genesisSnapshotHash);
        expect(built.verified).to.equal(true);

        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: honest,
            minimumBlocks: 1,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const spectator = h.getPeer(peer.index);
        // Keep the writer slot alive until the spectator holds the
        // participants' head: it may still catch up from later blocks.
        const caughtUp = async () => {
            const [head, spectatorHead] = await Promise.all([
                h
                    .control(h.getPeer(0))
                    .query.getLatestBlockHash(successor)
                    .request(),
                h
                    .control(spectator)
                    .query.getLatestBlockHash(successor)
                    .request()
            ]);
            return head !== null && head === spectatorHead;
        };
        await h.transition.keepAuthoringUntil({
            until: caughtUp,
            waitForPeers: honest,
            maximumBlocks: 20
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...honest, spectator.index]
        });
        expect(await h.control(spectator).query.getForkId().request()).to.equal(
            successor
        );
        const synced = await reconstructedProof(h, spectator.index, successor);
        expect(synced.startSnapshotHash).to.equal(synced.genesisSnapshotHash);
        expect(synced.genesisSnapshotHash).to.equal(built.genesisSnapshotHash);
        expect(synced.verified).to.equal(true);

        await releaseAdoption();
        const adopted = await h.transition.postSnapshotWait({
            peerIndex: 0,
            forkId: String(successor)
        });
        expect(adopted).to.not.equal(undefined);
        expect((await chainSnapshot(h)).forkID).to.equal(successor);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: honest,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...honest, spectator.index]
        });
        const rebuilt = await reconstructionFromChainAnchor(
            h,
            spectator.index,
            successor
        );
        expect(rebuilt.startSnapshotHash).to.equal(adopted!.hash);
        expect(rebuilt.verified).to.equal(true);
    });
});
