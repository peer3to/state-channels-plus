import { StateSnapshot } from "@/models";
import { Status, timeoutWaitTime } from "@/types";
import { Codec, Type } from "@/utils";
import { waitForceJoinCountingStarted } from "@test/fixtures/ForceJoinCountingStaging";
import {
    expectInitialSyncSkipped,
    postSnapshotSeenBy,
    spawnSpectatorAfterFirstHandshake,
    stageReducedWithoutAdoption,
    syncLatestFromUninstalledSuccessor
} from "@test/fixtures/MilestoneSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * Plan 35 "Preserve the existing bot-connection fixes": lobby discovery,
 * terminal leave on channel close, inbound-blocked exit, latest-state sync
 * fork, and the force-join bounds.
 */
describe("E2E: Bot connection fixes", function () {
    it("E23 (spectator): both lobby founders announce the opened channel and a later spectator discovers it and syncs from them", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-plan35-lobby-announced-spectator");
        const [first, second, spectator] = h.peers;
        const results = await Promise.all(
            [first, second].map((peer) =>
                peer.p2pInstance.p2pSigner.joinLobby(topic)
            )
        );
        const channelId = results[0]!.channelId;
        expect(results[1]!.channelId).to.equal(channelId);

        expect(
            await spectator.p2pInstance.p2pSigner.connectToChannel(channelId)
        ).to.equal(true);
        await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
        expect(
            await h.control(spectator).query.getChannelId().request()
        ).to.equal(channelId);
        // both founders joined the channel's discovery key
        await waitFor(
            async () =>
                (await h
                    .control(spectator)
                    .query.isConnectedTo(first.address)
                    .request()) &&
                (await h
                    .control(spectator)
                    .query.isConnectedTo(second.address)
                    .request()),
            h.event.protocolEventTimeoutMs()
        );
    });

    it("E23 (joiner): a joiner discovers a lobby-opened channel through its founders and its join lands on chain", async function () {
        const h = TestSession.getHarness();
        await h.setup(3, { autoConnect: false });
        const topic = ethers.id("e2e-plan35-lobby-announced-joiner");
        const [first, second, joiner] = h.peers;
        const results = await Promise.all(
            [first, second].map((peer) =>
                peer.p2pInstance.p2pSigner.joinLobby(topic)
            )
        );
        const channelId = results[0]!.channelId;

        expect(
            await joiner.p2pInstance.p2pSigner.connectToChannel(channelId, {
                shouldJoin: true,
                balance: { amount: 500n, data: "0x" }
            })
        ).to.equal(true);
        expect(
            await h.channelManager.getPendingParticipants(channelId)
        ).to.include(joiner.address);
    });

    it("E24: terminal leaves of both founders settle when their exits close the channel", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const channelId = h.channelId;
        const exits: Promise<unknown>[] = [];
        for (const peer of h.peers)
            peer.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
                exits.push(peer.p2pInstance.p2pContractInstance.leaveChannel());
            });

        const leaves = h.peers.map((peer) => peer.p2pInstance.leaveChannel());
        await h.transition.advanceState();
        await waitFor(
            () => exits.length === 2,
            h.event.protocolEventTimeoutMs()
        );
        await Promise.all(exits);
        // Both leavers stop writing; their runtimes dispose once the leaves
        // settle.
        for (const peer of h.peers)
            h.contextApi.markAfkPeer({ afkPeerIndex: peer.index });

        await Promise.all(leaves);
        expect(await h.channelManager.getOpenChannelIds(0, 100)).to.not.include(
            channelId
        );
        expect(await h.channelManager.getParticipants(channelId)).to.deep.equal(
            []
        );
    });

    it("E25: founders whose exits wait on an unconsumed join do not report a posted snapshot; their self-removal disputes settle the leaves and seat the joiner", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const joiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, joiner.index]
        });
        const founders = [h.getPeer(0), h.getPeer(1)];
        // The founders never include the join, so its inbound message stays
        // unconsumed on chain while they exit.
        await h.byzantine.stubPendingInboundInclusion(0);
        await h.byzantine.stubPendingInboundInclusion(1);
        const founderDisputes = await Promise.all(
            founders.map((founder) =>
                h.rpcStub.recordDisputeSubmissions(founder.index, {
                    forward: true
                })
            )
        );
        await h.join.joinChannelWait({ joiner });
        const chainSnapshotHash = async () =>
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).hash;
        const snapshotBefore = await chainSnapshotHash();
        const exits: Promise<unknown>[] = [];
        for (const founder of founders)
            founder.p2pInstance.events.on(
                "p2pEventHooks",
                "onLeaveTurn",
                () => {
                    exits.push(
                        founder.p2pInstance.p2pContractInstance.leaveChannel()
                    );
                }
            );
        const forkId = h.activeForkId!;

        const leaves = founders.map((founder) =>
            founder.p2pInstance.leaveChannel()
        );
        await h.transition.advanceState({ waitForPeers: [0, 1] });
        await waitFor(
            () => exits.length === 2,
            h.event.protocolEventTimeoutMs()
        );
        await Promise.all(exits);
        for (const founder of founders)
            h.contextApi.markAfkPeer({ afkPeerIndex: founder.index });
        // The blocked snapshot post returned false, so each exit disputed.
        await waitFor(
            async () =>
                (
                    await Promise.all(
                        founderDisputes.map((recorder) =>
                            recorder.submissions()
                        )
                    )
                ).every((submissions) => submissions.length > 0),
            h.event.protocolEventTimeoutMs()
        );
        for (const [index, recorder] of founderDisputes.entries()) {
            const dispute = Codec.decode(
                (await recorder.submissions())[0].encodedDispute,
                Type.Dispute
            );
            expect(dispute.input.disputer).to.equal(founders[index].address);
            expect(dispute.input.selfRemoval).to.equal(true);
            expect(dispute.input.forkId).to.equal(forkId);
        }
        // no exit snapshot was posted before the disputes
        expect(await chainSnapshotHash()).to.equal(snapshotBefore);
        // the recorder sees each upload at its send; the window opens once
        // the first one is mined
        await waitFor(
            () => h.channelManager.isForkDisputed(h.channelId, forkId),
            h.event.protocolEventTimeoutMs()
        );

        await Promise.all(leaves);
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.deep.equal([joiner.address]);
    });

    it("E26: a latest-state sync request served by a responder whose installed state lags the chain-derived fork succeeds without blacklisting either side", async function () {
        const outcome = await syncLatestFromUninstalledSuccessor(
            TestSession.getHarness()
        );
        expect(outcome.responderFork).to.equal(outcome.sourceForkId);
        expect(outcome.requesterFork).to.not.equal(outcome.sourceForkId);
        expect(outcome.requesterBlacklistedResponder).to.equal(false);
        expect(outcome.responderBlacklistedRequester).to.equal(false);
    });

    it("H11 (adoption after the slashed handshake, mirror lagging): a fresh spectator skips a first-handshake peer its mirror still lists but the chain has slashed, then syncs from an honest participant after the successor adoption lands", async function () {
        const h = TestSession.getHarness();
        const { successor, honest, releaseAdoption } =
            await stageReducedWithoutAdoption(h, [0, 2, 3]);
        const slashed = h.getPeer(1);
        const { spectator, beforeAdoption, atFirstHandshake } =
            await spawnSpectatorAfterFirstHandshake(h, 1, honest, async () => {
                // The adoption lands, after the slashed handshake, and every
                // honest mirror applies it before any honest peer can answer
                // the spectator: no responder serves the source fork's window
                // afterwards.
                await releaseAdoption();
                const adopted = await postSnapshotSeenBy(
                    h,
                    0,
                    honest,
                    successor
                );
                expect(adopted.forkID).to.equal(successor);
            });
        // the mirror cached the source snapshot, which lists the slashed peer
        expect(beforeAdoption.mirrorParticipant).to.equal(true);
        // At its handshake a mirror read would sync from it; the chain would
        // not: it subtracts the slash.
        expect(atFirstHandshake).to.deep.equal({
            mirrorParticipant: true,
            chainParticipant: false,
            chainSlashed: true
        });
        await expectInitialSyncSkipped(
            h,
            spectator,
            slashed,
            honest,
            successor
        );
    });

    it("H11 (reduce landed, adoption failed): a fresh spectator whose first handshake is with a peer the chain snapshot still lists but the chain has slashed skips it and syncs from an honest participant", async function () {
        const h = TestSession.getHarness();
        const { successor, honest } = await stageReducedWithoutAdoption(
            h,
            [0, 2, 3]
        );
        const slashed = h.getPeer(1);
        const { spectator, atFirstHandshake } =
            await spawnSpectatorAfterFirstHandshake(h, 1, honest);
        // The chain snapshot still lists the slashed peer, but the chain's
        // participant check subtracts its slash; the spectator's fresh
        // mirror holds the snapshot without the slash, so a mirror read
        // would sync from it.
        expect(atFirstHandshake).to.deep.equal({
            mirrorParticipant: true,
            chainParticipant: false,
            chainSlashed: true
        });
        await expectInitialSyncSkipped(
            h,
            spectator,
            slashed,
            honest,
            successor
        );
    });

    it("H11 (same fork): a fresh spectator whose first handshake is with a slashed peer that reduced onto the same successor skips it and syncs from an honest participant", async function () {
        const h = TestSession.getHarness();
        const { successor, honest } = await stageReducedWithoutAdoption(
            h,
            [0, 1, 2, 3]
        );
        const slashed = h.getPeer(1);
        await waitFor(
            async () =>
                (await h.control(slashed).query.getForkId().request()) ===
                successor,
            h.event.protocolEventTimeoutMs()
        );
        const { spectator, atFirstHandshake } =
            await spawnSpectatorAfterFirstHandshake(h, 1, honest);
        expect(atFirstHandshake.chainSlashed).to.equal(true);
        await expectInitialSyncSkipped(
            h,
            spectator,
            slashed,
            honest,
            successor
        );
    });

    it("H11 (not a member): a fresh spectator whose first handshake is with a synced spectator that is not slashed and not a member skips it and syncs from a participant", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const participants = [0, 1, 2];
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: participants,
            minimumBlocks: 2,
            maximumBlocks: 20,
            waitForFinalization: true
        });
        const observer = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [...participants, observer.index]
        });
        const { spectator, atFirstHandshake } =
            await spawnSpectatorAfterFirstHandshake(
                h,
                observer.index,
                participants
            );
        expect(atFirstHandshake).to.deep.equal({
            mirrorParticipant: false,
            chainParticipant: false,
            chainSlashed: false
        });
        await expectInitialSyncSkipped(
            h,
            spectator,
            observer,
            participants,
            h.activeForkId!
        );
    });

    it("E27: a joiner whose join no block includes, while writers produce no blocks, forces it by dispute once its time bound passes", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const joiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, joiner.index]
        });
        const forkId = h.activeForkId!;
        const height = await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request();

        // No peer runs its participant-timeout check and no block follows
        // the join, so only the joiner's time bound can start a dispute.
        for (const index of [0, 1, joiner.index])
            await h.rpcStub.suppressTimeoutCheck(index);
        await h.join.joinChannelWait({ joiner });
        // N = participants + 1 turns, each one full writer window
        const bound =
            3 * h.event.participantTimeoutWaitMs(height! + 1) +
            h.event.protocolEventTimeoutMs();
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING, {
            timeoutMs: bound,
            timeoutMessage: "the joiner's time bound never forced its join"
        });

        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(true);
        expect(
            await h
                .control(h.getPeer(0))
                .query.getLatestBlockHeight(forkId)
                .request()
        ).to.equal(height);
        // seated by the reduction genesis
        expect(
            await h.execOnHost(joiner, async (sm) =>
                (await sm.diamondStateMachine.getParticipants()).map(String)
            )
        ).to.include(joiner.address);
        // the reducer's adoption post lands the reduced fork on chain after
        // the local install
        await waitFor(
            async () =>
                (await h.channelManager.getParticipants(h.channelId)).includes(
                    joiner.address
                ),
            h.event.protocolEventTimeoutMs()
        );
    });

    it("E28 (delayed observation): the force-join timeout window starts on observing the own join, without grace, while block counting waits agreementTime", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const joiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, joiner.index]
        });
        await h.byzantine.stubPendingInboundInclusion(0);
        await h.byzantine.stubPendingInboundInclusion(1);
        const observation = await h.rpcStub.holdInboundMessageEvents(
            joiner.index
        );
        const tasks = await h.rpcStub.recordScheduledTasks(joiner.index);
        const forceJoin = () =>
            h.execOnHost(joiner, async (sm) => ({
                countingStartsAt:
                    sm.storage.forceJoin.getCountingStartsAt() ?? null,
                submissionHeight:
                    sm.storage.forceJoin.getJoinSubmissionBlockHeight() ?? null,
                timeConfig: sm.timeConfig
            }));
        const deadlines = async () =>
            (await tasks.tasks()).filter(
                (task) => task.taskName === "force join deadline"
            );
        try {
            await h.join.joinChannelWait({ joiner });
            await waitFor(
                async () => (await observation.heldCount()) > 0,
                h.event.protocolEventTimeoutMs()
            );
            // the join is on chain, but the joiner has not observed it
            expect(
                await h.channelManager.getPendingParticipants(h.channelId)
            ).to.include(joiner.address);
            expect((await forceJoin()).countingStartsAt).to.equal(null);
            expect(await deadlines()).to.deep.equal([]);

            const observedAt = await h
                .control(joiner)
                .query.getClockTimeInSeconds()
                .request();
            await observation.release();
            await waitFor(
                async () => (await deadlines()).length === 1,
                h.event.protocolEventTimeoutMs()
            );
            const { countingStartsAt, submissionHeight, timeConfig } =
                await forceJoin();
            expect(countingStartsAt).to.be.at.least(
                observedAt + timeConfig.agreementTime
            );
            expect((await deadlines())[0].delayMs).to.equal(
                3 * timeoutWaitTime(timeConfig, submissionHeight! + 1) * 1000
            );
        } finally {
            await tasks.restore();
            await observation.release();
        }
    });

    it("E28 (expired authorization): a pending joiner whose join never lands walks away once the join authorization expires", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const joiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, joiner.index]
        });
        // The authorization deadline is the test input: a few seconds out.
        const deadline = (await h.provider.getBlock("latest"))!.timestamp + 5;
        const prepared = await h.join.buildJoinChannelConfirmation({
            joiner,
            channelId: h.channelId,
            jcOverrides: { deadlineTimestamp: BigInt(deadline) }
        });
        const restoreSubmission =
            await h.rpcStub.failMembershipSubmissionUncertain(
                joiner.index,
                "joinChannel"
            );
        try {
            // the submission outcome is uncertain: the joiner stays pending
            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(false);
        } finally {
            await restoreSubmission();
        }
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );

        let walkedAway = false;
        const leave = joiner.p2pInstance.p2pSigner.leaveChannel().then(() => {
            walkedAway = true;
        });
        // Chain time moves only with blocks: once the deadline passed, one
        // ordinary transaction lets the chain show the expiry.
        const expiry = waitFor(
            async () =>
                (await h
                    .control(joiner)
                    .query.getClockTimeInSeconds()
                    .request()) > deadline,
            h.event.protocolEventTimeoutMs()
        ).then(async () => {
            // an unused account of this slot, so no peer nonce races it
            const funder = h.signerFor(slotAccountIndex(h.peers.length));
            await (
                await funder.sendTransaction({
                    to: await funder.getAddress(),
                    value: 0n
                })
            ).wait();
        });
        await h.transition.keepAuthoringUntil({
            until: () => walkedAway,
            waitForPeers: [0, 1, 2],
            maximumBlocks: 20
        });
        await expiry;
        await leave;
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);
    });

    it("E29: a fast table that authors the block bound inside the join's grace is not disputed; once counting starts the omitted join forces a dispute that seats the joiner", async function () {
        const h = TestSession.getHarness();
        // The grace is the test input: wide enough for N + 1 blocks.
        await h.lifecycle.start(2, 0, { timeConfig: { agreementTime: 8 } });
        const { peer } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1],
            minimumBlocks: 2,
            maximumBlocks: 20
        });
        const joiner = h.getPeer(peer.index);
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, joiner.index]
        });
        const forkId = h.activeForkId!;
        const restores = await Promise.all(
            [0, 1].map((index) =>
                h.byzantine.stubPendingInboundInclusion(index)
            )
        );
        await h.join.joinChannelWait({ joiner });
        let countingStartsAt: number | null = null;
        await waitFor(async () => {
            countingStartsAt = await h.execOnHost(
                joiner,
                async (sm) => sm.storage.forceJoin.getCountingStartsAt() ?? null
            );
            return countingStartsAt !== null;
        }, h.event.protocolEventTimeoutMs());

        // N + 1 blocks without the join, all inside the grace.
        await h.transition.advanceState({ count: 4, waitForPeers: [0, 1] });
        expect(
            await h.control(joiner).query.getClockTimeInSeconds().request(),
            "the blocks landed inside the grace"
        ).to.be.lessThan(countingStartsAt!);
        expect(
            await h.execOnHost(joiner, async (sm) => ({
                countingFromHeight:
                    sm.storage.forceJoin.getCountingFromHeight() ?? null,
                disputeStarted: sm.storage.forceJoin.hasDisputeStarted()
            }))
        ).to.deep.equal({ countingFromHeight: null, disputeStarted: false });
        expect(
            await h.channelManager.isForkDisputed(h.channelId, forkId)
        ).to.equal(false);

        // After the grace the omitted join is counted: the first counted
        // block starts the bound and the dispute fires N = 3 blocks later.
        await waitForceJoinCountingStarted(h, joiner.index);
        await h.transition.advanceState({ count: 4, waitForPeers: [0, 1] });
        await h.event.waitForPeers("onInitiatingDispute", [joiner.index], 1, {
            mode: "atLeast"
        });
        for (const restore of restores) await restore();
        await h.dispute.resolveDisputeWait({ forkId });
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PARTICIPATING
        );
    });
});
