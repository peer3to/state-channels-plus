import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

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
                return {
                    canPost: prepared.canPost,
                    callDataCount: prepared.callData.length
                };
            },
            {}
        );

        expect(result.canPost).to.equal(true);
        expect(result.callDataCount).to.equal(0);
    });

    it("submits a prepared snapshot", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                const posted = await sm.snapshotUpdateService[
                    "postStateSnapshotWait"
                ](sm.forkId);
                return {
                    posted: posted !== undefined
                };
            },
            {}
        );

        expect(result.posted).to.equal(true);
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
                        canPost: prepared.canPost,
                        callDataCount: prepared.callData.length,
                        posted: posted !== undefined
                    };
                },
                {}
            );

            expect(result.canPost).to.equal(false);
            expect(result.callDataCount).to.equal(0);
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
                const posted = await sm.snapshotUpdateService[
                    "postStateSnapshotWait"
                ](args.forkId);
                return {
                    canPost: prepared.canPost,
                    callDataCount: prepared.callData.length,
                    postedSnapshotHash: posted?.hash ?? null
                };
            },
            { forkId: h.activeForkId! }
        );

        expect(result.canPost).to.equal(false);
        expect(result.callDataCount).to.equal(0);
        expect(result.postedSnapshotHash).to.equal(null);
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

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                const prepared =
                    await sm.snapshotUpdateService[
                        "prepareUpdateStateSnapshotFork"
                    ]();
                const parsed =
                    sm.stateChannelManagerContract.interface.parseTransaction({
                        data: prepared.callData[0]
                    });
                return {
                    canPost: prepared.canPost,
                    callDataCount: prepared.callData.length,
                    functionName: parsed?.name ?? null,
                    targetForkId: String(parsed?.args[1].forkId ?? "")
                };
            },
            {}
        );

        expect(result.canPost).to.equal(true);
        expect(result.callDataCount).to.equal(1);
        expect(result.functionName).to.equal("updateStateSnapshotFork");
        expect(result.targetForkId).to.equal(second.finalResolution.forkId);
    });
});
