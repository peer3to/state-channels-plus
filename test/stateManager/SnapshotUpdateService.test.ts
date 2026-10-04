import { Status } from "@/types";
import type { ForkId } from "@/types/types";
import {
    chainSnapshot,
    committedSnapshotHash,
    deleteStoredBlocks,
    postSameForkSnapshot,
    postSnapshotAt,
    prepareSameForkPost,
    restoreStoredBlocks,
    stageLeftChannel,
    stageUnsignedGenesisTip
} from "@test/fixtures/StateProofConstructionStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("SnapshotUpdateService", function () {
    it("returns an admissible no-op when the on-chain fork is not disputed", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                const prepared =
                    await sm.snapshotUpdateService[
                        "prepareUpdateStateSnapshotFork"
                    ]();
                return prepared.kind;
            },
            {}
        );

        expect(result).to.equal("nothing");
    });

    it("blocks same-fork calldata for a fork whose snapshot is not on chain", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const prepared = await sm.snapshotUpdateService[
                    "prepareUpdateSnapshotSameFork"
                ](args.forkId);
                return prepared.kind === "blocked"
                    ? prepared.reason
                    : prepared.kind;
            },
            { forkId: ethers.id("fork not on chain") as ForkId }
        );

        expect(result).to.equal("fork-not-posted");
    });

    it("resolves false when a dispute commits between preparation and send", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const send = await h.rpcStub.holdSnapshotPostSend(0);
        let refusal: string | null = null;
        try {
            const posted = h.execOnHost(h.getPeer(0), (sm) =>
                sm.snapshotUpdateService.postStateSnapshotWait(sm.forkId)
            );
            await send.waitUntilHeld();
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.stateProof.milestones = [];
            });
            refusal = await send.release();
            expect(await posted).to.equal(false);
        } finally {
            await send.release();
        }
        expect(refusal).to.equal("RaceConditionSnapshotUpdateDisputedFork");
    });

    it("blocks fork calldata while the current dispute has no final reduced result", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 8 }
        });
        const targetPeer = h.getPeer(0);
        await h.control(targetPeer).stub.stubHoldReductionTasks().request();
        await h.byzantine.submitInvalidStateTransitionBlock(1);
        await h.assert.dispute.initiatedAndCommitedWait({ expectedCount: 1 });

        try {
            const result = await h.execOnHost(
                targetPeer,
                async (sm) => {
                    const prepared =
                        await sm.snapshotUpdateService[
                            "prepareUpdateStateSnapshotFork"
                        ]();
                    const posted =
                        await sm.snapshotUpdateService.postStateSnapshot(
                            sm.forkId
                        );
                    return {
                        prepared,
                        posted: posted !== undefined
                    };
                },
                {}
            );

            expect(result.prepared).to.deep.equal({
                kind: "blocked",
                reason: "reduction"
            });
            expect(result.posted).to.equal(false);
        } finally {
            await h
                .control(targetPeer)
                .stub.restoreReductionTasks(false)
                .request();
        }
    });

    it("blocks same-fork calldata when its snapshot has not consumed the on-chain inbound head", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();

        for (const peerIndex of [0, 1, 2]) {
            await h.byzantine.stubPendingInboundInclusion(peerIndex);
        }
        await joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2]
        });

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const prepared = await sm.snapshotUpdateService[
                    "prepareUpdateSnapshotSameFork"
                ](args.forkId);
                const posted = await sm.snapshotUpdateService.postStateSnapshot(
                    args.forkId
                );
                return {
                    prepared,
                    postedSnapshotHash: posted?.hash ?? null
                };
            },
            { forkId: h.activeForkId! }
        );

        expect(result.prepared).to.deep.equal({
            kind: "blocked",
            reason: "inbound"
        });
        expect(result.postedSnapshotHash).to.equal(null);
    });

    it("resolves false when a same-fork update waits on an inbound message its snapshot has not consumed", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();

        for (const peerIndex of [0, 1, 2]) {
            await h.byzantine.stubPendingInboundInclusion(peerIndex);
        }
        await joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2]
        });
        const snapshotBefore = await h.query.getOnChainSnapshotHash();

        const posted = await h.execOnHost(
            h.getPeer(0),
            (sm, args) =>
                sm.snapshotUpdateService.postStateSnapshotWait(args.forkId),
            { forkId: h.activeForkId! }
        );

        expect(posted).to.equal(false);
        expect(await h.query.getOnChainSnapshotHash()).to.equal(snapshotBefore);
    });

    it("resolves true when no same-fork update is needed", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const snapshotBefore = await h.query.getOnChainSnapshotHash();

        const posted = await h.execOnHost(h.getPeer(0), (sm) =>
            sm.snapshotUpdateService.postStateSnapshotWait(sm.forkId)
        );

        expect(posted).to.equal(true);
        expect(await h.query.getOnChainSnapshotHash()).to.equal(snapshotBefore);
    });

    it("walks two finalized dispute windows and prepares one terminal fork update", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({
            peerCount: 4,
            timeConfig: { evidenceTime: 3 }
        });
        for (const peer of h.peers) {
            await h.control(peer).stub.stubPostStateSnapshot().request();
        }

        const first = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 1
        });
        await h.dispute.resolveFinalDispute(first);
        await h.transition.advanceState({
            waitForPeers: h.getActiveHonestPeers().map((peer) => peer.index)
        });
        const second = await h.dispute.submitFinalDispute({
            maliciousPeerIndex: 2,
            finalAuthorPeerIndex: 0
        });
        await h.dispute.resolveFinalDispute(second);

        // Both windows were finalized at dispute upload, so the chain already
        // records each reduced fork. Every peer's scheduled ordinary attempt
        // still fires at the kill period's end; it converges on the recorded
        // result and writes nothing, so the chain snapshot stays at the
        // original fork and the walk below has two windows to traverse.
        const killPeriod = await h.query.killPeriod(second.forkId, 0);
        await h.event.waitUntilTimestamp(
            killPeriod.killPeriodEnd +
                resolveTestTimeConfig(h.options.timeConfig).chainFallbackTime +
                1
        );
        expect(
            (await h.channelManager.getStateSnapshot(h.channelId)).forkId
        ).to.equal(first.forkId);

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                const prepared =
                    await sm.snapshotUpdateService[
                        "prepareUpdateStateSnapshotFork"
                    ]();
                if (prepared.kind !== "ready") return { kind: prepared.kind };
                const parsed =
                    sm.stateChannelManagerContract.interface.parseTransaction({
                        data: prepared.callData
                    });
                return {
                    kind: prepared.kind,
                    functionName: parsed?.name ?? null,
                    targetForkId: String(parsed?.args[1].forkId ?? "")
                };
            },
            {}
        );

        expect(result.kind).to.equal("ready");
        expect(result.functionName).to.equal("updateStateSnapshotFork");
        expect(result.targetForkId).to.equal(second.finalResolution.forkId);
    });

    // a same-fork post proves final state only
    describe("same-fork post from the generation start", function () {
        it("unfinal zero does not post snapshot", async function () {
            const h = TestSession.getHarness();
            await stageUnsignedGenesisTip(h, 3, 1);

            expect(await postSameForkSnapshot(h, 0)).to.equal(true);
            expect((await chainSnapshot(h)).isGenesis).to.equal(true);
        });

        it("normal anchor alone posts nothing", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            const start = await postSnapshotAt(h, 0, 2);
            // block 3 never reaches the threshold
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });

            // the run holding the start maps to the start snapshot: not newer
            expect(await postSameForkSnapshot(h, 0)).to.equal(true);
            expect((await chainSnapshot(h)).hash).to.equal(start.hash);
        });

        it("post stops at threshold completion", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            // blocks 3 and 4 never reach the threshold
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });

            // block 2 completes the threshold; the unfinal tip tail is left out
            expect(await prepareSameForkPost(h, 0)).to.deep.equal([1]);
            expect(await postSameForkSnapshot(h, 0)).to.equal(true);
            expect((await chainSnapshot(h)).blockHeight).to.equal(2);
        });

        it("final zero join posts snapshot", async function () {
            const h = TestSession.getHarness();
            await h.setup(4, { timeConfig: { chainFallbackTime: 60 } });
            await h.lifecycle.openChannelForParticipants([0, 1, 2]);
            for (const peer of h.peers)
                await h.control(peer).stub.stubPostStateSnapshot().request();
            const joiner = h.getPeer(3);
            await h.join.connectSpectator(joiner);
            await waitFor(
                async () =>
                    (await h.control(joiner).query.getStatus().request()) ===
                    Status.SYNCED,
                h.event.protocolEventTimeoutMs()
            );
            // block 0 consumes the forced join; old and new participants sign it
            await h.join.forceInboundJoinWait({
                participant: joiner.address,
                observePeerIndices: [0, 1, 2, 3]
            });
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2, 3]
            });

            expect(await postSameForkSnapshot(h, 0)).to.equal(true);
            const onChain = await chainSnapshot(h);
            expect(onChain.blockHeight).to.equal(0);
            expect(onChain.snapshotData.participants).to.have.length(4);
            expect(onChain.hash).to.equal(await committedSnapshotHash(h, 0, 0));
        });

        it("final zero exit posts snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0, { timeConfig: { agreementTime: 4 } });
            for (const peer of h.peers)
                await h.control(peer).stub.stubPostStateSnapshot().request();
            // the first writer leaves in block 0, which everyone signs
            await h.transition.advanceState({ txFn: (c) => c.leaveChannel() });
            await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
            expect((await chainSnapshot(h)).isGenesis).to.equal(true);
            const leaver = (await h
                .control(h.getPeer(0))
                .query.getBlockByHeight(h.activeForkId!, 0)
                .request())!.author;
            const poster = h.peers.find(
                (peer) => peer.address !== leaver
            )!.index;

            expect(await postSameForkSnapshot(h, poster)).to.equal(true);
            const onChain = await chainSnapshot(h);
            expect(onChain.blockHeight).to.equal(0);
            expect(onChain.snapshotData.participants).to.have.length(2);
            expect(onChain.hash).to.equal(
                await committedSnapshotHash(h, poster, 0)
            );
        });

        it("forged normal-anchor advance is refused", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: { chainFallbackTime: 60 }
            });
            await postSnapshotAt(h, 0, 2);
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });

            // the run [2, 3] from the start block claims its unfinal last snapshot
            const refusal = await h.execOnHost(h.getPeer(0), async (sm) => {
                const am = sm.agreementManager;
                const { stateProof } = await am.buildStateProof(sm.forkId, 3);
                const run = stateProof.milestones[0];
                const forged = sm.storage.stateSnapshots.getStateSnapshotByHash(
                    am.getLastBlockFromMilestone(run)!.stateSnapshotHash
                )!;
                return sm.stateChannelManagerContract.updateStateSnapshotSameFork
                    .staticCall(sm.channelId, [run], [forged.toStruct()], [])
                    .then(
                        () => "",
                        (error: { data?: string }) =>
                            sm.stateChannelManagerContract.interface.parseError(
                                error.data!
                            )?.name
                    );
            });

            expect(refusal).to.equal("ErrorInvalidStateProof");
        });

        it("failed snapshot construction submits nothing", async function () {
            const h = TestSession.getHarness();
            const { changeHeight, remaining } = await stageLeftChannel(h);
            await deleteStoredBlocks(h, remaining[0], [changeHeight]);

            const error = await postSameForkSnapshot(h, remaining[0]).then(
                () => "",
                String
            );

            expect(error).to.match(
                /missing the participant-change block at height 2/
            );
            expect((await chainSnapshot(h)).isGenesis).to.equal(true);
        });

        it("repaired data permits snapshot retry", async function () {
            const h = TestSession.getHarness();
            const { changeHeight, remaining } = await stageLeftChannel(h);
            const removed = await deleteStoredBlocks(h, remaining[0], [
                changeHeight
            ]);
            const error = await postSameForkSnapshot(h, remaining[0]).then(
                () => "",
                String
            );
            expect(error).to.match(/missing the participant-change/);

            await restoreStoredBlocks(h, remaining[0], removed);

            expect(await postSameForkSnapshot(h, remaining[0])).to.equal(true);
            const onChain = await chainSnapshot(h);
            expect(onChain.blockHeight).to.equal(4);
            expect(onChain.snapshotData.participants).to.have.length(3);
        });
    });
});
