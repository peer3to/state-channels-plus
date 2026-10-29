import { StateSnapshot } from "@/models";
import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import {
    postSnapshotFrom,
    stageUninstalledFinalReducedFork
} from "@test/fixtures/ProofOwnerStaging";
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
        const snapshotBefore = await h.query.getOnChainSnapshotHash();

        expect(await postSnapshotFrom(h, 0)).to.equal("posted");
        expect(await h.query.getOnChainSnapshotHash()).to.not.equal(
            snapshotBefore
        );
    });

    it("a mined post resolves with the snapshot the chain now holds", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();
        const snapshotBefore = await h.query.getOnChainSnapshotHash();

        const encodedSnapshot = await h.execOnHost(h.getPeer(0), async (sm) => {
            const posted = await sm.snapshotUpdateService.postStateSnapshotWait(
                sm.forkId
            );
            return posted?.encode() ?? null;
        });

        expect(encodedSnapshot, "a mined post returns its snapshot").to.not.be
            .null;
        const posted = StateSnapshot.decode(encodedSnapshot!);
        const onChain = await h.channelManager.getStateSnapshot(h.channelId);
        expect(posted.hash).to.not.equal(snapshotBefore);
        expect(posted.hash).to.equal(await h.query.getOnChainSnapshotHash());
        expect(posted.snapshotData.participants).to.deep.equal([
            ...onChain.snapshotData.participants
        ]);
        expect(posted.snapshotData.participants).to.have.members(
            h.peers.map((peer) => peer.address)
        );
    });

    it("rejects with the disputed-fork refusal when a dispute commits between preparation and send", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const send = await h.rpcStub.holdSnapshotPostSend(0);
        let refusal: string | null = null;
        try {
            const posted = postSnapshotFrom(h, 0);
            await send.waitUntilHeld();
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.stateProof.milestones = [];
            });
            refusal = await send.release();
            expect(await posted).to.equal(
                "RaceConditionSnapshotUpdateDisputedFork"
            );
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
                        await sm.snapshotUpdateService.postStateSnapshotWait(
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

    it("a walk to a final reduced fork this peer has not installed yet waits: no fork calldata, the post resolves undefined; after the install the post adopts that fork", async function () {
        const h = TestSession.getHarness();
        const { forkId, reducedForkId, release, installedWait } =
            await stageUninstalledFinalReducedFork(h);
        try {
            const result = await h.execOnHost(
                h.getPeer(0),
                async (sm, { reducedForkId }) => {
                    const prepared =
                        await sm.snapshotUpdateService[
                            "prepareUpdateStateSnapshotFork"
                        ]();
                    const posted =
                        await sm.snapshotUpdateService.postStateSnapshotWait(
                            sm.forkId
                        );
                    return {
                        isInstalled:
                            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                                reducedForkId
                            ) !== undefined,
                        canPost: prepared.canPost,
                        callDataCount: prepared.callData.length,
                        posted: posted !== undefined
                    };
                },
                { reducedForkId }
            );

            expect(result.isInstalled, "premise: the fork is not installed").to
                .be.false;
            expect(result.canPost).to.equal(false);
            expect(result.callDataCount).to.equal(0);
            expect(result.posted).to.equal(false);
        } finally {
            await release();
        }

        // the held reduction installs; the next post adopts the reduced fork
        await installedWait();
        expect(
            (await chainSnapshot(h)).forkID,
            "premise: no other post moved the chain off the disputed fork"
        ).to.equal(forkId);
        const recovered = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                const prepared =
                    await sm.snapshotUpdateService[
                        "prepareUpdateStateSnapshotFork"
                    ]();
                const posted =
                    await sm.snapshotUpdateService.postStateSnapshotWait(
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
        expect(recovered).to.deep.equal({
            canPost: true,
            callDataCount: 1,
            posted: true
        });
        expect((await chainSnapshot(h)).forkID).to.equal(reducedForkId);
    });

    it("once the channel is closed on chain, the same-fork preparation returns nothing to post without building a state proof or reading local outbound blocks, and the post resolves undefined", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        // both members exit: the snapshot that lands the last exit has no
        // participant, and the chain closes the channel
        await h.transition.participantLeaveStateTransition();
        await h.transition.participantLeaveStateTransition();
        await waitFor(
            async () => !(await h.channelManager.isChannelOpen(h.channelId))[0],
            h.event.protocolEventTimeoutMs()
        );
        expect(
            (await chainSnapshot(h)).forkID,
            "premise: the close deleted the chain snapshot"
        ).to.equal(ethers.ZeroHash);

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                // record-only: each call still runs the real method
                const outbound = sm.storage.outboundMessages;
                const agreement = sm.agreementManager;
                const readRange = outbound.getMessageBlocksInRange;
                const buildProof = agreement.buildStateProof;
                const reads = { rangeReads: 0, proofBuilds: 0 };
                outbound.getMessageBlocksInRange = (...args) => {
                    reads.rangeReads += 1;
                    return readRange.apply(outbound, args);
                };
                agreement.buildStateProof = (...args) => {
                    reads.proofBuilds += 1;
                    return buildProof.apply(agreement, args);
                };
                try {
                    const prepared = await sm.snapshotUpdateService[
                        "prepareUpdateSnapshotSameFork"
                    ](sm.forkId);
                    const posted =
                        await sm.snapshotUpdateService.postStateSnapshotWait(
                            sm.forkId
                        );
                    return {
                        localBlockCount: sm.storage.blocks.getNextBlockHeight(
                            sm.forkId
                        ),
                        canPost: prepared.canPost,
                        callDataCount: prepared.callData.length,
                        posted: posted !== undefined,
                        ...reads
                    };
                } finally {
                    // the own properties shadow the prototype methods
                    Reflect.deleteProperty(outbound, "getMessageBlocksInRange");
                    Reflect.deleteProperty(agreement, "buildStateProof");
                }
            },
            {}
        );

        expect(
            result.localBlockCount,
            "premise: the member holds blocks of the closed fork"
        ).to.be.greaterThan(0);
        expect(result).to.deep.include({
            canPost: false,
            callDataCount: 0,
            posted: false,
            rangeReads: 0,
            proofBuilds: 0
        });
    });

    it("a same-fork post whose snapshot has not consumed the on-chain inbound head reverts with the pending-inbound refusal", async function () {
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

        expect(await postSnapshotFrom(h, 0)).to.equal(
            "RaceConditionPendingInboundNotConsumed"
        );
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
