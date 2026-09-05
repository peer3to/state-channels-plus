import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";
import { Block } from "@/models";
import { Codec, SignatureUtils, Type } from "@/utils";
import type { Address, Bytes } from "@/types/types";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { waitFor } from "@test/utils/waitFor";

/**
 * E2E Tests for Participant Lifecycle (Exit + Join)
 *
 * Maps to:
 *   src/stateManager/StateManager.ts  (startMaybeExitOnChain, joinChannel)
 *   src/eventHandlers/EventHandler.ts (onStateSnapshotUpdated status transitions)
 *   src/evm/P2pSigner.ts              (joinChannel public API)
 *
 * Covers:
 *   1. Exit path  — leaveChannel() → N/N snapshot after agreementTime (+ P2P signature window) →
 *                   exiter awaits receipt and becomes SYNCED; peers observe onStateSnapshotUpdated
 *   2. Join path  — PENDING_PARTICIPANT on broadcast; once the first block whose
 *                   resulting snapshot includes the joiner is processed (success()),
 *                   the joiner is promoted to PARTICIPATING and starts signing.
 */
describe("E2E: Participant Lifecycle", function () {
    describe("Exit path", function () {
        it("removes a normally closed channel from registry pages and the event-derived live set", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2);
            const primaryChannelId = String(h.channelId);
            const extraParticipants = h.peers.map((peer) => peer.address);
            const extraChannels = [
                createOpenChannelTestObject(extraParticipants, {
                    channelId: "participant-registry-extra-first"
                }),
                createOpenChannelTestObject(extraParticipants, {
                    channelId: "participant-registry-extra-second"
                })
            ];
            for (const channel of extraChannels) {
                const signed = await Promise.all(
                    h.peers.map((peer) =>
                        SignatureUtils.signOpenChannel(channel, peer.signer)
                    )
                );
                await h.channelManager.open({
                    encodedOpenChannel: signed[0].encoded,
                    signatures: signed.map((entry) => entry.signature as Bytes)
                });
            }

            await h.transition.participantLeaveStateTransition();
            await h.transition.participantLeaveStateTransition();
            await waitFor(
                async () =>
                    !(await h
                        .control(h.peers[0])
                        .query.isChannelOpen(primaryChannelId)
                        .request()),
                h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                }),
                50
            );

            const liveFromEvents = new Set(
                (
                    await h.channelManager.queryFilter(
                        h.channelManager.filters.ChannelOpened()
                    )
                ).map((event) => String(event.args.channelId))
            );
            const snapshots = await h.channelManager.queryFilter(
                h.channelManager.filters.StateSnapshotUpdated()
            );
            for (const event of snapshots) {
                if (
                    event.args.stateSnapshot.snapshotData.participants
                        .length === 0
                ) {
                    liveFromEvents.delete(String(event.args.channelId));
                }
            }
            const registry = await h
                .control(h.peers[0])
                .query.getOpenChannelIds()
                .request();
            expect([...liveFromEvents].sort()).to.deep.equal(
                [...registry].sort()
            );
            expect(registry).not.to.include(primaryChannelId);
            expect(registry).to.include.members(
                extraChannels.map((channel) => String(channel.channelId))
            );
        });

        it("should demote exiting participant to SYNCED when state snapshot is updated on-chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            const leaverIndex = await h.transition.participantLeaveWait();
            expect(leaverIndex).to.equal(
                2,
                "expected peer 2 to leave given start(3,2) turn order"
            );

            // Remaining participants are unaffected
            const remaining = h.peers.filter((p) => p.index !== leaverIndex);
            for (const p of remaining) {
                expect(await h.control(p).query.getStatus().request()).to.equal(
                    Status.PARTICIPATING,
                    `Peer ${p.index} should remain PARTICIPATING`
                );
            }
        });

        it("exiting participant does not sign blocks authored after its leave", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);

            // Detached: the leaver's process stays alive and connected while
            // its exit completes, which is exactly when it must not keep
            // signing (its signature is no longer in the participant union).
            const leaverIndex = await h.transition.participantLeaveDetached();
            const remaining = h.peers
                .map((p) => p.index)
                .filter((i) => i !== leaverIndex);

            await h.transition.advanceState({
                count: 1,
                waitForPeers: remaining,
                waitForFinalization: true
            });

            const forkId = h.activeForkId!;
            const bundle = await h
                .control(h.getPeer(remaining[0]))
                .query.getLatestBlockBundle(forkId)
                .request();
            expect(bundle).to.not.be.null;

            const block = Block.fromBlockConfirmation({
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: bundle!.confirmationSignatures
            });
            const leaverAddress = h.getPeer(leaverIndex).address as Address;
            expect(
                block.allSignerAddresses.has(leaverAddress),
                "leaver signed a post-leave block"
            ).to.equal(false);

            // And nobody got blacklisted over stray signatures in the process.
            for (const i of remaining) {
                for (const j of remaining) {
                    if (i === j) continue;
                    expect(
                        await h
                            .control(h.getPeer(i))
                            .query.isBlacklisted(h.getPeer(j).address)
                            .request(),
                        `peer ${i} blacklisted honest peer ${j}`
                    ).to.equal(false);
                }
            }
        });

        it("public terminal leave settles before disposal and excludes the former signer", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const leaver = h.getPeer(1);
            const remaining = [0, 2];
            let exitPromise: Promise<unknown> | undefined;
            leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
                exitPromise =
                    leaver.p2pInstance.p2pContractInstance.leaveChannel();
            });

            const leave = leaver.p2pInstance.leaveChannel();
            await h.transition.advanceState();
            await waitFor(() => exitPromise !== undefined);
            await exitPromise;
            // The exit block is authored: the leaver never writes again and
            // its runtime disposes once the leave settles, so harness queries
            // stop routing through it; the others keep the slot alive while
            // the exit snapshot lands.
            h.contextApi.markAfkPeer({ afkPeerIndex: leaver.index });
            let leaveSettled = false;
            const settledLeave = leave.then(() => {
                leaveSettled = true;
            });
            await h.transition.keepAuthoringUntil({
                until: () => leaveSettled,
                waitForPeers: remaining,
                excludePeerIndices: [leaver.index],
                maximumBlocks: 20
            });
            await settledLeave;
            expect(
                (await h.channelManager.getParticipants(h.channelId)).includes(
                    leaver.address
                )
            ).to.equal(false);

            await h.transition.advanceState({
                count: 1,
                waitForPeers: remaining,
                waitForFinalization: true
            });
            const bundle = await h
                .control(h.getPeer(remaining[0]))
                .query.getLatestBlockBundle(h.activeForkId!)
                .request();
            expect(bundle).to.not.equal(null);
            const block = Block.fromBlockConfirmation({
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: bundle!.confirmationSignatures
            });
            expect(
                block.allSignerAddresses.has(leaver.address as Address)
            ).to.equal(false);
            for (const peerIndex of remaining) {
                const otherIndex = remaining.find(
                    (candidate) => candidate !== peerIndex
                )!;
                expect(
                    await h
                        .control(h.getPeer(peerIndex))
                        .query.isBlacklisted(h.getPeer(otherIndex).address)
                        .request()
                ).to.equal(false);
            }
        });
    });

    describe("Join path", function () {
        it("should set PENDING_PARTICIPANT on join broadcast, then PARTICIPATING once joiner appears in a block", async function () {
            const h = TestSession.getHarness();

            await h.lifecycle.start(2);

            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 1,
                maximumBlocks: 20,
                waitForFinalization: true,
                statusTimeoutMessage: "Spectator did not reach SYNCED status"
            });
            await h.assert.sync.peersInSyncWait({ peerIndices: [0, 1, 2] });

            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner: spectator,
                channelId: h.channelId
            });

            const releaseReceipt = await h.rpcStub.holdMembershipReceipt(
                spectator.index,
                "joinChannel"
            );
            const joinPromise = spectator.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await waitFor(
                async () =>
                    (await h
                        .control(spectator)
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            await releaseReceipt();
            expect(await joinPromise).to.equal(true);
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            // Ensure all honest peers have stored the inbound message before
            // the block producer runs, so the join is included in the block
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            await h.transition.advanceState({ count: 1 });

            // Joiner is now PARTICIPATING — promoted inside success() when the first
            // block that includes them in the resulting participant set was processed.
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(
                Status.PARTICIPATING,
                "Joiner should be PARTICIPATING after the first block that includes them"
            );
        });

        it("pending join fault survives until a failed receipt restores SYNCED", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2);
            // Sync itself is the subject here and no transition is scheduled
            // while the spawn blocks, so the non-authoring exception applies.
            const spectator = await h.join.addSpectatorDetached();
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner: spectator,
                channelId: h.channelId
            });
            await h.control(spectator).stub.stubRecordAbort().request();
            const releaseReceipt = await h.rpcStub.holdMembershipReceipt(
                spectator.index,
                "joinChannel",
                true
            );
            const join = spectator.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await waitFor(
                async () =>
                    (await h
                        .control(spectator)
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                await h.control(spectator).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            const restoreJunk = await h.rpcStub.stubSpectateJunkPayload([0]);
            try {
                await h
                    .control(spectator)
                    .spectate.startSync(
                        h.getPeer(0).address,
                        prepared.expectedForkId,
                        0
                    )
                    .request();
                await waitFor(
                    () =>
                        h
                            .control(spectator)
                            .query.isBlacklisted(h.getPeer(0).address)
                            .request(),
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await h.control(spectator).stub.wasAbortCalled().request()
                ).to.equal(false);
                await releaseReceipt();
                expect(await join).to.equal(false);
                expect(
                    await h.control(spectator).query.getStatus().request()
                ).to.equal(Status.SYNCED);
            } finally {
                await restoreJunk();
                await releaseReceipt();
            }
        });

        it("pending join fault preserves the successful on-chain join and inbound message", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2);
            // Sync itself is the subject here and no transition is scheduled
            // while the spawn blocks, so the non-authoring exception applies.
            const spectator = await h.join.addSpectatorDetached();
            await h.event.waitUntilPeerStatus(spectator.index, Status.SYNCED);
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner: spectator,
                channelId: h.channelId
            });
            await h.control(spectator).stub.stubRecordAbort().request();
            const releaseReceipt = await h.rpcStub.holdMembershipReceipt(
                spectator.index,
                "joinChannel"
            );
            const join = spectator.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await waitFor(
                async () =>
                    (await h
                        .control(spectator)
                        .stub.getHeldMembershipReceiptCount()
                        .request()) === 1,
                h.event.protocolEventTimeoutMs()
            );

            const restoreJunk = await h.rpcStub.stubSpectateJunkPayload([0]);
            try {
                await h
                    .control(spectator)
                    .spectate.startSync(
                        h.getPeer(0).address,
                        prepared.expectedForkId,
                        0
                    )
                    .request();
                await waitFor(
                    () =>
                        h
                            .control(spectator)
                            .query.isBlacklisted(h.getPeer(0).address)
                            .request(),
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await h.control(spectator).stub.wasAbortCalled().request()
                ).to.equal(false);
                await releaseReceipt();
                expect(await join).to.equal(true);
                expect(
                    await h.channelManager.getPendingParticipants(h.channelId)
                ).to.include(spectator.address);
                await h.assert.storage.honestPeersObserveInboundMessageWait();
            } finally {
                await restoreJunk();
                await releaseReceipt();
            }
        });

        it("preserves a landed pending join when the same confirmation is retried", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2);
            const { peer: spectator } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 1,
                maximumBlocks: 20,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();
            // The confirmation build and the two join transactions take
            // seconds on a loaded host while the writer slot sits idle; an
            // idle slot lets a participant time out and reduce the channel
            // under the join. Keep authoring until the join's inbound block
            // is observed.
            let joinObserved = false;
            const keepAlive = h.transition.keepAuthoringUntil({
                until: () => joinObserved,
                waitForPeers: [0, 1],
                maximumBlocks: 40
            });
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner: spectator,
                channelId: h.channelId
            });

            await spectator.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await h.execOnHost(
                h.getPeer(spectator.index),
                async (sm, args) => sm.setStatus(args.status),
                { status: Status.SYNCED }
            );

            expect(
                await spectator.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                )
            ).to.equal(true);
            const retryState = await h.execOnHost(
                h.getPeer(spectator.index),
                async (sm) => ({
                    status: sm.status,
                    joinSubmissionHeight:
                        sm.storage.forceJoin.getJoinSubmissionBlockHeight()
                }),
                {}
            );
            expect(retryState.status).to.equal(Status.PENDING_PARTICIPANT);
            expect(retryState.joinSubmissionHeight).to.not.equal(undefined);

            await h.assert.storage.honestPeersObserveInboundMessageWait();
            joinObserved = true;
            await keepAlive;
            await h.transition.advanceState({ count: 1 });
            expect(
                await h
                    .control(h.getPeer(spectator.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PARTICIPATING);
        });
    });
});
