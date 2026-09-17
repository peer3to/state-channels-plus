import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id, ZeroAddress } from "ethers";

/**
 * E2E Tests for Timeout Management
 *
 * Maps to: src/agreementManager/AgreementManager.ts
 *          src/utils/TimeoutManager.ts
 *          src/Clock.ts
 *
 * Tests timeout detection, forced timeouts, and network liveness during disconnections.
 */
describe("E2E: Timeouts", function () {
    describe("Basic Timeout Scenarios", function () {
        it("should handle timeout when next peer to write does not author a block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);

            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1]
            });
            await h.assert.dispute.didNotInitiate({ peers: [2] });
            h.assert.calldata.noCalldataPosted();
        });

        it("should demonstrate timeout creates disputes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1]
            });
        });
    });

    describe("Network Disconnection Timeouts", function () {
        it("should handle timeout when non-author peer disconnects (calldata posting)", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 4,
                    evidenceTime: 3
                }
            });
            await h.network.blacklistAndDisconnectPeer(2);
            // TODO - under load Peer 1 can hit StateChannelManagerProxy's RaceConditionBlockCalldataTimestampTooLate revert; fix the timing bug (not #391 - that tracker sets the E2E-Timeouts cluster aside as an anomaly)
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] }); // Peers 0 and 1 write (peer 2 disconnected)
            await h.assert.calldata.calldataPosted();
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
        });

        it("should handle timeout when author peer disconnects", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 4);
            h.event.resetEventSpies();
            await h.network.blacklistAndDisconnectPeer(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 2]
            });
        });
    });

    describe("Forced Timeout (Junk Calldata)", function () {
        it("should create forced timeout when peer posts junk calldata that is rejected", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const currentBlockHeight = await h
                .control(h.peers[0])
                .query.getLatestBlockHeight(h.activeForkId!)
                .request();
            if (currentBlockHeight === null) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                height: currentBlockHeight + 1
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            await h.assert.dispute.initiatedWait({
                peersIndices: [0, 1]
            });
            await h.assert.dispute.committedWait();
            await h.assert.storage.storedTimeout({
                timedoutParticipantIndex: 2
            });
        });

        it("junk calldata lands while the timeout dispute is in flight → the pipeline rejects it and the forced timeout commits", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const forkId = h.activeForkId!;
            const writer = h.getPeer(2);
            const disputers = [h.getPeer(0), h.getPeer(1)];
            // hold both plain timeouts at the upload, then really send them
            const uploads = await Promise.all(
                disputers.map((peer) =>
                    h.rpcStub.recordDisputeSubmissions(peer.index, {
                        hold: true,
                        forward: true
                    })
                )
            );
            try {
                for (const upload of uploads) await upload.waitUntilHeld();
                h.event.resetEventSpies();
                await h.byzantine.postJunkCalldataOnChain(writer.index, {
                    height: 2
                });
                // each disputer's handler finished, its ingest meeting the marker
                await h.event.waitUntilEventOccurs(
                    "onBlockCalldataPosted",
                    undefined,
                    [0, 1]
                );
                for (const upload of uploads) await upload.release();

                await h.assert.dispute.committedWait({ peersIndices: [0, 1] });
                for (const [i, peer] of disputers.entries()) {
                    await waitFor(
                        async () =>
                            (
                                await h
                                    .control(peer)
                                    .query.getTimeout(forkId)
                                    .request()
                            )?.isForced === true,
                        h.event.hostExecTimeoutMs()
                    );
                    const timeouts = (await uploads[i].submissions()).map(
                        (submission) =>
                            Codec.decode(
                                submission.encodedDispute,
                                Type.Dispute
                            ).input.timeout
                    );
                    expect(timeouts[0].isForced).to.equal(false);
                    expect(timeouts[timeouts.length - 1].isForced).to.equal(
                        true
                    );
                }
                const slashed = await h
                    .control(h.getPeer(0))
                    .query.getOnChainSlashedParticipants()
                    .request();
                expect(slashed).to.not.include(h.getPeer(0).address);
                expect(slashed).to.not.include(h.getPeer(1).address);
            } finally {
                for (const upload of uploads) await upload.restore();
            }
        });

        it("authentic junk failing its state transition lands while the timeout dispute is in flight → the fraud-proof dispute slashes the writer with no timeout", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const forkId = h.activeForkId!;
            const writer = h.getPeer(2);
            const disputers = [h.getPeer(0), h.getPeer(1)];
            const uploads = await Promise.all(
                disputers.map((peer) =>
                    h.rpcStub.recordDisputeSubmissions(peer.index, {
                        hold: true,
                        forward: true
                    })
                )
            );
            try {
                for (const upload of uploads) await upload.waitUntilHeld();
                h.event.resetEventSpies();
                await h.byzantine.postJunkCalldataOnChain(writer.index, {
                    height: 2,
                    authentic: true
                });
                // each disputer's handler finished, its ingest meeting the marker
                await h.event.waitUntilEventOccurs(
                    "onBlockCalldataPosted",
                    undefined,
                    [0, 1]
                );
                for (const upload of uploads) await upload.release();

                await h.assert.dispute.committedWait({
                    peersIndices: [0, 1],
                    expectedCount: 1
                });
                const slashedOnChain = async () =>
                    await h
                        .control(h.getPeer(0))
                        .query.getOnChainSlashedParticipants()
                        .request();
                await waitFor(
                    async () =>
                        (await slashedOnChain()).includes(writer.address),
                    h.event.protocolEventTimeoutMs()
                );
                const slashed = await slashedOnChain();
                expect(slashed).to.not.include(h.getPeer(0).address);
                expect(slashed).to.not.include(h.getPeer(1).address);
                const submissions = (
                    await Promise.all(
                        uploads.map((upload) => upload.submissions())
                    )
                ).flat();
                // only the refused plain uploads named the writer
                expect(
                    submissions
                        .map(
                            (submission) =>
                                Codec.decode(
                                    submission.encodedDispute,
                                    Type.Dispute
                                ).input.timeout.participant
                        )
                        .filter((participant) => participant !== ZeroAddress)
                ).to.deep.equal([writer.address, writer.address]);
                expect(
                    submissions.some((submission) =>
                        submission.fraudProofParticipants.includes(
                            writer.address
                        )
                    )
                ).to.equal(true);
                for (const peer of disputers)
                    expect(
                        await h.control(peer).query.getTimeout(forkId).request()
                    ).to.equal(null);
            } finally {
                for (const upload of uploads) await upload.restore();
            }
        });

        it("valid calldata lands while the timeout dispute is in flight → the refused disputer stores the block, never forcing or getting slashed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const disputer = h.getPeer(0);
            const auditor = h.getPeer(2);
            // the writer authors in its window but nobody else sees the block yet
            const { leader, authored, startHeight, forkId } =
                await h.transition.authorNextBlockOffWireWait({
                    observerIndex: disputer.index
                });
            // an early plain timeout parks at its upload, then really sends
            const upload = await h.rpcStub.recordDisputeSubmissions(
                disputer.index,
                { hold: true, forward: true }
            );
            const refused = h
                .control(disputer)
                .stub.startTimeoutConstruction(leader.address, startHeight)
                .request({ timeoutMs: h.event.hostExecTimeoutMs() });
            await upload.waitUntilHeld();
            h.event.resetEventSpies();
            // the valid block is posted in time, while our upload is in flight
            await h
                .control(leader)
                .validation.postBlockCalldataOnChain(
                    authored.encodedSignedBlock
                )
                .request();
            // the handler finished: its ingest met the marker and dropped the block
            await h.event.waitUntilEventOccurs(
                "onBlockCalldataPosted",
                undefined,
                [disputer.index]
            );
            expect(
                await h
                    .control(disputer)
                    .query.getBlockByHeight(forkId, startHeight)
                    .request()
            ).to.equal(null);
            await upload.release();
            await refused;

            const slashed = async () =>
                await h
                    .control(auditor)
                    .query.getOnChainSlashedParticipants()
                    .request();
            // no restores: a slashed disputer's runtime is gone, and teardown
            // discards the session anyway
            await waitFor(async () => {
                if ((await slashed()).includes(disputer.address)) return true;
                try {
                    return (
                        (await h
                            .control(disputer)
                            .query.getBlockByHeight(forkId, startHeight)
                            .request()) !== null
                    );
                } catch {
                    return false;
                }
            }, h.event.hostExecTimeoutMs() * 2);
            expect(await slashed()).to.not.include(disputer.address);
            expect(
                await h.control(disputer).query.getTimeout(forkId).request()
            ).to.equal(null);
            const timeouts = (await upload.submissions()).map(
                (submission) =>
                    Codec.decode(submission.encodedDispute, Type.Dispute).input
                        .timeout
            );
            expect(timeouts.map((t) => t.isForced)).to.deep.equal([false]);
        });

        it("authentic calldata not linked to the head, posted at the writer's own turn → the forced timeout commits and no honest peer is slashed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const forkId = h.activeForkId!;
            const writer = h.getPeer(2);
            await h.byzantine.postJunkCalldataOnChain(writer.index, {
                height: 2,
                authentic: true,
                previousBlockHash: id("not the head") as Hash
            });

            await h.assert.dispute.committedWait({ peersIndices: [0, 1] });
            for (const peer of [h.getPeer(0), h.getPeer(1)])
                await waitFor(
                    async () =>
                        (
                            await h
                                .control(peer)
                                .query.getTimeout(forkId)
                                .request()
                        )?.isForced === true,
                    h.event.hostExecTimeoutMs()
                );
            expect(
                await h.control(h.getPeer(0)).query.getTimeout(forkId).request()
            ).to.deep.equal({ isForced: true, participant: writer.address });
            const slashed = await h
                .control(h.getPeer(0))
                .query.getOnChainSlashedParticipants()
                .request();
            expect(slashed).to.not.include(h.getPeer(0).address);
            expect(slashed).to.not.include(h.getPeer(1).address);
        });

        it("bad-signature junk posted for the writer's next turn, then silence at that turn → the forced timeout commits", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2);
            const forkId = h.activeForkId!;
            const writerAddress = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            const writer = h.peers.find((p) => p.address === writerAddress)!;
            const honest = h.peers.filter((p) => p.index !== writer.index);
            // three participants -> the writer's next turn is three heights on
            await h.byzantine.postJunkCalldataOnChain(writer.index, {
                height: 5
            });
            await h.transition.advanceState({
                count: 3,
                waitForPeers: h.peers.map((p) => p.index)
            });
            expect(
                await h.control(honest[0]).query.getNextToWrite().request()
            ).to.equal(writer.address);

            await h.assert.dispute.committedWait({
                peersIndices: honest.map((p) => p.index)
            });
            for (const peer of honest)
                await waitFor(
                    async () =>
                        (
                            await h
                                .control(peer)
                                .query.getTimeout(forkId)
                                .request()
                        )?.isForced === true,
                    h.event.hostExecTimeoutMs()
                );
            const slashed = await h
                .control(honest[0])
                .query.getOnChainSlashedParticipants()
                .request();
            for (const peer of honest)
                expect(slashed).to.not.include(peer.address);
        });

        it("should handle timeout when previous peer posted junk calldata and next peer doesn't author block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 3);

            const currentBlockHeight = await h
                .control(h.peers[0])
                .query.getLatestBlockHeight(h.activeForkId!)
                .request();
            if (currentBlockHeight === null) {
                throw new Error("No current block found");
            }

            await h.byzantine.postJunkCalldataOnChain(2, {
                height: currentBlockHeight
            });
            await h.event.waitUntilEventOccurs("onBlockCalldataPosted");
            h.event.resetEventSpies();
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [1, 2]
            });
            await h.assert.storage.storedTimeout({
                timedoutParticipantIndex: 0,
                peerToCheck: 1
            }); // peer 0 should be timed out for not authoring block
            await h.assert.storage.storedTimeout({
                timedoutParticipantIndex: 0,
                peerToCheck: 2
            }); // peer 0 should be timed out for not authoring block
        });
    });

    describe("Network Liveness", function () {
        it("should maintain liveness when peer disconnects mid-transaction", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.network.blacklistAndDisconnectPeer(2);
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1] });
            h.assert.dispute.noDisputes();
        });
    });
});
