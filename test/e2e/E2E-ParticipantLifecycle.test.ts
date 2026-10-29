import { Block, StateSnapshot } from "@/models";
import { Status } from "@/types";
import type { Address, Bytes } from "@/types/types";
import { Codec, SignatureUtils, Type } from "@/utils";
import { recordSnapshotPostWaitResults } from "@test/fixtures/BotConnectionFixesStaging";
import {
    stageExitPostInFlightAcrossClose,
    stageLateJoinerMissingPostedExitBlock
} from "@test/fixtures/ClosedChannelExitPostStaging";
import {
    readTotalStateBalance,
    stageEveryExitBlockedByLateJoin
} from "@test/fixtures/EveryExitBlockedByLateJoinStaging";
import { readTrackedJoin } from "@test/fixtures/ForceJoinCountingStaging";
import { assertLeaverCanBeForceJoinedBackAfterExit } from "@test/fixtures/LeaverRelayFixture";
import { stageLoneLeaverSelfRemoval } from "@test/fixtures/LoneLeaverStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * E2E Tests for Participant Lifecycle (Exit + Join)
 *
 * Maps to:
 *   src/stateManager/membership/LeaveChannelService.ts (exit posts), MembershipService.ts (joinChannel)
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
        it("slash and removal are idempotent after local leave while the chain snapshot still lists the leaver", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            const leaver = await h.query.getNextPeerToWrite();
            const observer = h.peers.find(
                (peer) => peer.index !== leaver.index
            )!;
            const post = await h.rpcStub.holdSnapshotPostSend(leaver.index);
            try {
                await h.transition.participantLeaveStateTransition({
                    leaverIndex: leaver.index
                });
                await post.waitUntilHeld();
                expect(
                    (
                        await h.channelManager.getParticipants(h.channelId)
                    ).includes(leaver.address)
                ).to.equal(true);
                const result = await h.execOnHost(
                    observer,
                    async (sm, args, { ethers }) => {
                        const block = sm.storage.blocks.getLatestBlock(
                            sm.forkId
                        );
                        if (!block) throw new Error("Missing leave block");
                        const snapshot =
                            sm.storage.stateSnapshots.getStateSnapshotByHash(
                                block.stateSnapshotHash
                            );
                        if (!snapshot)
                            throw new Error("Missing leave snapshot");
                        const encodedState =
                            await sm.diamondStateMachine.getState();
                        const participants =
                            await sm.diamondStateMachine.getParticipants();
                        const contract =
                            sm.diamondStateMachine.localDiamondContract;
                        const input = {
                            channelId: sm.channelId,
                            forkId: sm.forkId,
                            latestStateSnapshotHash: snapshot.hash,
                            latestInboundMessageBlockHash:
                                snapshot.snapshotData
                                    .latestInboundMessageBlockHash,
                            lastInboundMessageBlockHeight:
                                snapshot.snapshotData
                                    .latestInboundMessageBlockHeight,
                            stateProof: { milestones: [] },
                            onChainSlashes: [args.leaver],
                            disputeAuditingDataHash: ethers.ZeroHash,
                            disputer: args.leaver,
                            timeout: {
                                participant: ethers.ZeroAddress,
                                blockHeight: 0,
                                minTimeStamp: 0,
                                isForced: false,
                                previousBlockProducer: ethers.ZeroAddress,
                                previousBlockProducerPostedCalldata: false,
                                participantSignatureOnPreviousBlock: "0x"
                            },
                            requireExistingDisputeWindow: false,
                            selfRemoval: true
                        };
                        const once =
                            await contract.computeDisputeOutputState.staticCall(
                                input,
                                snapshot.toStruct(),
                                encodedState,
                                []
                            );
                        const twice =
                            await contract.computeDisputeOutputState.staticCall(
                                input,
                                snapshot.toStruct(),
                                once.encodedModifiedState,
                                []
                            );
                        return {
                            absent: !participants.includes(args.leaver),
                            unchangedOnce:
                                once.encodedModifiedState === encodedState,
                            unchangedTwice:
                                twice.encodedModifiedState === encodedState,
                            firstExits:
                                once.outboundMessageBlock.messages.length,
                            repeatedExits:
                                twice.outboundMessageBlock.messages.length,
                            withdrawalsUnchanged:
                                once.totalWithdrawals.amount ===
                                    snapshot.snapshotData.totalWithdrawals
                                        .amount &&
                                twice.totalWithdrawals.amount ===
                                    snapshot.snapshotData.totalWithdrawals
                                        .amount
                        };
                    },
                    { leaver: leaver.address }
                );
                expect(result).to.deep.equal({
                    absent: true,
                    unchangedOnce: true,
                    unchangedTwice: true,
                    firstExits: 0,
                    repeatedExits: 0,
                    withdrawalsUnchanged: true
                });
            } finally {
                await post.release();
            }
            await h.event.waitUntilPeerStatus(leaver.index, Status.SYNCED);
        });

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

        it("a participant slashed by a dispute, with no leave call, gets onLeftChannel and does not abort", async function () {
            const h = TestSession.getHarness();
            const {
                maliciousPeerIndices: [slashedIndex]
            } = await h.scenario.fourPeersDisputeResolution();
            const slashed = h.getPeer(slashedIndex);

            await h.event.waitUntilLeftChannel(slashedIndex);

            expect(
                await h.channelManager.getParticipants(h.channelId)
            ).to.not.include(slashed.address);
            expect(slashed.eventSpies.onLeftChannel?.callCount).to.equal(1);
            expect(slashed.eventSpies.onAbort?.called).to.equal(false);
            expect(
                await h.control(slashed).query.getStatus().request()
            ).to.equal(Status.SYNCED);
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

        it("remaining peers do not blacklist the leaver after its exit and it can be force-joined back", async function () {
            await assertLeaverCanBeForceJoinedBackAfterExit();
        });

        it("a late joiner's exit post that runs after its co-leavers' exits closed the channel posts nothing and does not fail, and its runtime stays alive and leaves", async function () {
            const h = TestSession.getHarness();
            const { founders, joiner } =
                await stageLateJoinerMissingPostedExitBlock(h);
            const members = [...founders, joiner.index];
            const hostErrors: string[] = [];
            const removeHostErrorListener = joiner.p2pInstance.onHostError(
                (error) => hostErrors.push(error.message)
            );
            const posts = await recordSnapshotPostWaitResults(h, joiner);
            try {
                await posts.holdStarts();
                await h.transition.keepAuthoringUntil({
                    until: async () =>
                        (await h.query.getNextPeerToWrite()).index ===
                        joiner.index,
                    waitForPeers: members,
                    maximumBlocks: 6
                });
                // The joiner exits first: its exit post parks before it
                // prepares anything.
                await h.transition.participantLeaveStateTransition({
                    leaverIndex: joiner.index
                });
                await waitFor(
                    async () => (await posts.started()) >= 1,
                    h.event.protocolEventTimeoutMs()
                );
                // Both founders exit next; their posts land every exit and
                // the empty snapshot closes the channel.
                await h.transition.participantLeaveStateTransition();
                await h.transition.participantLeaveStateTransition();
                await waitFor(
                    async () =>
                        !(await h.channelManager.isChannelOpen(h.channelId))[0],
                    h.event.protocolEventTimeoutMs()
                );
                expect(
                    await posts.results(),
                    "premise: the joiner's exit post had prepared nothing before the close"
                ).to.deep.equal([]);

                await posts.releaseStarts();
                const results = await posts.resultsWait(await posts.started());

                expect(results).to.deep.equal(results.map(() => "no-op"));
                for (const index of members)
                    await h.event.waitUntilLeftChannel(index);
                // the leave's own membership check can drop the joiner to
                // SYNCED before its close event moves it to NOT_OPENED
                await h.event.waitUntilPeerStatus(
                    joiner.index,
                    Status.NOT_OPENED
                );
                expect(hostErrors).to.deep.equal([]);
            } finally {
                removeHostErrorListener();
                await posts.restore();
            }
        });

        it("an exit post prepared against the open fork and still unsent when its co-leavers' exits close the channel is rejected at its estimate with RaceConditionSnapshotForkMismatch, logged as a chain refusal, and the leaver's runtime stays alive and leaves", async function () {
            const h = TestSession.getHarness();
            const staged = await stageExitPostInFlightAcrossClose(h, "send");
            try {
                // the released send is estimated against the closed channel
                expect(await staged.releasePost()).to.equal(
                    "RaceConditionSnapshotForkMismatch"
                );
                await staged.assertRefusedAndLeft(
                    "RaceConditionSnapshotForkMismatch"
                );
                // rejected before broadcast: no transaction was mined
                expect(await staged.readNonce()).to.equal(
                    staged.nonceBeforeRelease
                );
                // no detached error: settleDetached throws on one
                await TestSession.settleDetached();
            } finally {
                await staged.restore();
            }
        });

        it("an exit post whose estimate passed before its co-leavers' exits closed the channel and that is mined after the close reverts in its block, its replay recovers RaceConditionSnapshotForkMismatch, it is logged as a chain refusal, and the leaver's runtime stays alive and leaves", async function () {
            const h = TestSession.getHarness();
            const staged = await stageExitPostInFlightAcrossClose(
                h,
                "broadcast"
            );
            try {
                const rawOutcome = await staged.releasePost();
                // the mined revert's receipt names no custom error
                expect(rawOutcome).to.be.a("string");
                expect(rawOutcome).to.not.equal(
                    "RaceConditionSnapshotForkMismatch"
                );
                // the transaction was mined: the leaver's nonce moved
                expect(await staged.readNonce()).to.equal(
                    staged.nonceBeforeRelease + 1
                );
                await staged.assertRefusedAndLeft(
                    "RaceConditionSnapshotForkMismatch"
                );
                // no detached error: settleDetached throws on one
                await TestSession.settleDetached();
            } finally {
                await staged.restore();
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

            leaver.p2pInstance.leaveChannel();
            await h.transition.advanceState();
            await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
            await exitPromise;
            // The exit block is authored: the leaver never writes again and
            // its runtime disposes once the leave settles, so harness queries
            // stop routing through it; the others keep the slot alive while
            // the exit snapshot lands.
            h.contextApi.markAfkPeer({ afkPeerIndex: leaver.index });
            await h.transition.keepAuthoringUntil({
                until: () => leaver.eventSpies.onLeftChannel?.called === true,
                waitForPeers: remaining,
                excludePeerIndices: [leaver.index],
                maximumBlocks: 20
            });
            await h.event.waitUntilLeftChannel(leaver.index);
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
        it("a lone participant's leave that falls back to its self-removal dispute posts the reduced fork that has no participant: the channel closes and the leaver gets onLeftChannel once", async function () {
            const h = TestSession.getHarness();
            const { lone, expireWatchdog } =
                await stageLoneLeaverSelfRemoval(h);

            // its self-removal dispute is final at upload and leaves no
            // participant; only the leaver can post that reduced fork
            await expireWatchdog();
            await h.event.waitUntilLeftChannel(lone.index);

            expect(
                (await h.channelManager.isChannelOpen(h.channelId))[0]
            ).to.equal(false);
            expect(
                StateSnapshot.from(
                    await h.channelManager.getStateSnapshot(h.channelId)
                ).forkID
            ).to.equal(ethers.ZeroHash);
            expect(
                (await h.channelManager.getParticipants(h.channelId)).length
            ).to.equal(0);
            // the channel close lands after the membership drop that reports the leave
            await h.event.waitUntilPeerStatus(lone.index, Status.NOT_OPENED);
            expect(lone.eventSpies.onLeftChannel?.callCount).to.equal(1);
            expect(lone.eventSpies.onAbort?.called).to.equal(false);
        });
        it("every participant leaves and a JOIN lands before any exit snapshot is posted: the refused exit posts fall back to the leave watchdogs' self-removal disputes, whose reduction seats the joiner as the only participant and keeps the channel open; each leaver gets onLeftChannel once with no abort, the exits and the deposit are counted once, and the joiner authors the next block", async function () {
            const h = TestSession.getHarness();
            const staged = await stageEveryExitBlockedByLateJoin(h);
            const { forkId, founders, joiner } = staged;
            try {
                // no dispute before the leave watchdogs expire
                for (const recorder of staged.disputes)
                    expect(await recorder.submissions()).to.deep.equal([]);
                await staged.expireWatchdogs();

                // each leaver submits its self-removal dispute on the fork
                await waitFor(async () => {
                    for (const recorder of staged.disputes)
                        if ((await recorder.submissions()).length === 0)
                            return false;
                    return true;
                }, h.event.protocolEventTimeoutMs());
                for (const [index, recorder] of staged.disputes.entries()) {
                    const dispute = Codec.decode(
                        (await recorder.submissions())[0].encodedDispute,
                        Type.Dispute
                    );
                    expect(dispute.input.disputer).to.equal(
                        founders[index].address
                    );
                    expect(dispute.input.selfRemoval).to.equal(true);
                    expect(dispute.input.forkId).to.equal(forkId);
                }

                // the reduction applies the pending JOIN and drops the
                // leavers; its adopted fork seats the joiner alone
                for (const founder of founders)
                    await h.event.waitUntilLeftChannel(founder.index);
                await h.event.waitUntilPeerStatus(
                    joiner.index,
                    Status.PARTICIPATING
                );
                const reducedForkId = String(
                    await h.query.reducedForkOnChain(forkId)
                );
                expect(reducedForkId).to.not.equal(forkId);
                expect(
                    StateSnapshot.from(
                        await h.channelManager.getStateSnapshot(h.channelId)
                    ).forkID
                ).to.equal(reducedForkId);
                expect(
                    (await h.channelManager.isChannelOpen(h.channelId))[0]
                ).to.equal(true);
                expect(
                    await h.channelManager.getParticipants(h.channelId)
                ).to.deep.equal([joiner.address]);
                expect(
                    await h.channelManager.getPendingParticipants(h.channelId)
                ).to.deep.equal([]);
                expect(
                    await h.control(joiner).query.getForkId().request()
                ).to.equal(reducedForkId);

                // the exits are paid once and the joiner holds its deposit
                const balance = await h.channelManager.getChannelBalance(
                    h.channelId
                );
                expect(
                    BigInt(balance.totalWithdrawals.amount) -
                        staged.withdrawalsBefore
                ).to.equal(staged.foundersBalance);
                expect(
                    BigInt(balance.totalDeposits.amount) - staged.depositsBefore
                ).to.equal(staged.deposit);
                expect(await readTotalStateBalance(h, joiner)).to.equal(
                    staged.deposit
                );

                // the channel goes on: the joiner authors the next block of
                // the reduced fork alone
                for (const founder of founders)
                    h.contextApi.markAfkPeer({ afkPeerIndex: founder.index });
                await h.transition.advanceState({
                    waitForPeers: [joiner.index]
                });
                expect(
                    (
                        await h
                            .control(joiner)
                            .query.getLatestBlockInfo(reducedForkId)
                            .request()
                    )?.author
                ).to.equal(joiner.address);

                for (const founder of founders) {
                    expect(
                        founder.eventSpies.onLeftChannel?.callCount
                    ).to.equal(1);
                    expect(founder.eventSpies.onAbort?.called).to.equal(false);
                }
                expect(joiner.eventSpies.onLeftChannel?.called).to.equal(false);
                expect(joiner.eventSpies.onAbort?.called).to.equal(false);
            } finally {
                await staged.restore();
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
                async (sm) => ({ status: sm.status }),
                {}
            );
            expect(retryState.status).to.equal(Status.PENDING_PARTICIPANT);
            expect(
                await readTrackedJoin(h, h.getPeer(spectator.index))
            ).to.not.equal(null);

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
