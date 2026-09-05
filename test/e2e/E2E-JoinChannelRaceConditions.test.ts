import { MathTestSession as TestSession } from "@test/harness";
import { Codec, hash, tryDecodeCustomError, Type } from "@/utils";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import {
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import Clock from "@/Clock";

describe("E2E: Join channel race conditions", function () {
    describe("Snapshot vs join race", function () {
        it("new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                stateSnapshot: stateSnapshot_a,
                confirmation,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            const expectedSnapshotHash =
                StateSnapshot.from(stateSnapshot_a).hash;

            await h.byzantine.postFraudulentSnapshot({
                mutate: ({ originalSnapshotData }) => {
                    const fraudulentEncoded = encodeMathState({
                        number: 999_999n,
                        participants: h.peers.map((p) => p.address),
                        balances: [0n, 0n, 0n],
                        currentTurnIndex: 7n
                    } satisfies MathStateDecoded);
                    return {
                        snapshotData: {
                            ...originalSnapshotData,
                            stateMachineStateHash: hash(fraudulentEncoded)
                        },
                        encodedStateMachineStateOverride: fraudulentEncoded
                    };
                }
            });

            const stateSnapshot_b = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            expect(stateSnapshot_b).to.not.deep.equal(
                stateSnapshot_a,
                "on-chain snapshot S' must differ from S before submitting the join confirmation built against S"
            );

            const channelManager = h.channelManager.connect(joiner.signer);
            let revertError: unknown;
            try {
                const tx = await channelManager.joinChannel(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                );
                await tx.wait();
                expect.fail(
                    "expected joinChannel to revert: spectator built confirmation against snapshot S, but on-chain snapshot is now the mismatched S'"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal(
                "RaceConditionJoinChannelSnapshotMismatch"
            );

            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.SYNCED);

            const onChainParticipants = await h
                .control(h.getPeer(joiner.index))
                .query.getParticipants()
                .request();
            expect(
                onChainParticipants.map((a) => String(a).toLowerCase())
            ).to.not.include(joiner.address.toLowerCase());

            // postFraudulentSnapshot marks every signer of the forged balance
            // invariant as malicious, so their resulting host errors are
            // intentionally excluded from detached-error attribution.
        });

        it("pending inbound unconsumed → postStateSnapshot stands down; on-chain snapshot unchanged", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers ignore the join's inbound message.
            for (const i of [0, 1, 2])
                await h.byzantine.stubPendingInboundInclusion(i);

            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });

            const snapshotBefore = await h.channelManager.getStateSnapshot(
                h.channelId
            );

            const postedSnapshot = await h.transition.postSnapshotWait({
                peerIndex: 0
            });
            expect(postedSnapshot).to.equal(undefined);

            const snapshotAfter = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            expect(snapshotAfter).to.deep.equal(snapshotBefore);
        });

        it("consumed pending join lets the same-fork snapshot advance", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    initialPeers: 3
                }
            );
            const snapshotBefore = StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            );
            const inboundHead = await h
                .control(h.getPeer(0))
                .query.getLatestInboundMessageHash()
                .request();

            const postedSnapshot = await h.transition.postSnapshotWait({
                peerIndex: 0
            });
            expect(postedSnapshot).to.not.equal(undefined);
            expect(postedSnapshot!.latestInboundMessageBlockHash).to.equal(
                inboundHead
            );

            const snapshotAfter = StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            );
            expect(snapshotAfter.hash).to.equal(postedSnapshot!.hash);
            expect(snapshotAfter.hash).to.not.equal(snapshotBefore.hash);
            expect(
                snapshotAfter.snapshotData.participants.map((address) =>
                    String(address).toLowerCase()
                )
            ).to.include(joiner.address.toLowerCase());
        });

        it("pending inbound lands after preparation → raw same-fork calldata reverts with RaceConditionPendingInboundNotConsumed", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });
            const prepared = await h
                .control(h.getPeer(0))
                .transition.prepareUpdateSnapshotSameFork(h.activeForkId!)
                .request();
            expect(prepared.canPost).to.equal(true);
            expect(prepared.callData.length).to.be.greaterThan(0);

            for (const peerIndex of [0, 1, 2]) {
                await h.byzantine.stubPendingInboundInclusion(peerIndex);
            }
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );

            let revertError: unknown;
            try {
                const transaction = await h
                    .getPeer(0)
                    .p2pInstance.stateChannelManagerContract.multicall(
                        prepared.callData
                    );
                await transaction.wait();
                expect.fail(
                    "expected stale same-fork calldata to reject the newer inbound head"
                );
            } catch (error) {
                revertError = error;
            }
            expect(
                tryDecodeCustomError(revertError)?.errorDescription.name
            ).to.equal("RaceConditionPendingInboundNotConsumed");
        });
    });

    describe("Dispute vs join race", function () {
        it("join on disputed fork reverts", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers open a dispute on the latest fork
            await h.tamper.postTamperedDispute(0, async () => {});

            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                )
            ).to.equal(false);

            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.OPENED);

            const onChainParticipantUnion = await h
                .control(h.getPeer(0))
                .query.getOnChainParticipantUnion()
                .request();
            expect(
                onChainParticipantUnion.map((a: unknown) =>
                    String(a).toLowerCase()
                )
            ).to.not.include(joiner.address.toLowerCase());
        });

        it("pending joiner participates after dispute reduction", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            expect(
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            const pendingBefore = await h.channelManager.getPendingParticipants(
                h.channelId
            );
            expect(
                pendingBefore.map((a: unknown) => String(a).toLowerCase())
            ).to.include(joiner.address.toLowerCase());

            // Peer 0 voluntarily self-removes by setting forceExit and filing a
            // dispute. The dispute is valid (selfRemoval=true) and not slashed.
            const leaverIndex = 0;
            const leaverAddress = h.getPeer(leaverIndex).address;
            const originalForkId = h.activeForkId!;
            await h
                .control(h.getPeer(leaverIndex))
                .dispute.setForceExit(true)
                .request();
            h.context.leftChannelPeerIndices = [
                ...h.context.leftChannelPeerIndices,
                leaverIndex
            ];
            await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
                markMalicious: false
            });

            const remainingPeerIndices = h
                .getActiveHonestPeers()
                .map((p) => p.index);
            await h.assert.dispute.committedWait({
                peersIndices: remainingPeerIndices,
                expectedCount: 1
            });

            // While the window is open, joiner remains in on-chain pending set
            const pendingDuring = await h.channelManager.getPendingParticipants(
                h.channelId
            );
            expect(
                pendingDuring.map((a: unknown) => String(a).toLowerCase()),
                "joiner must remain in on-chain pendingParticipants during the dispute window"
            ).to.include(joiner.address.toLowerCase());

            await h.dispute.resolveDisputeWait({
                forkId: originalForkId,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });

            await waitFor(async () => {
                const snapshot = await h.channelManager.getStateSnapshot(
                    h.channelId
                );
                return snapshot.forkId !== originalForkId;
            }, h.event.protocolEventTimeoutMs());

            const onChainParticipants = await h.channelManager.getParticipants(
                h.channelId
            );
            const lowered = onChainParticipants.map((a: unknown) =>
                String(a).toLowerCase()
            );
            expect(
                lowered,
                "self-removed peer must be dropped on the reduced fork"
            ).to.not.include(leaverAddress.toLowerCase());
            expect(
                lowered,
                "joiner's MESSAGE_TYPE_JOIN was applied during reduction → joiner must be in on-chain getParticipants on the reduced fork"
            ).to.include(joiner.address.toLowerCase());

            // Reduction processing is detached from the on-chain fork change.
            // Drain it before teardown so block production has promoted the
            // pending joiner and all remaining peers have reached that fork.
            await h.event.waitUntilPeerStatus(
                joiner.index,
                Status.PARTICIPATING
            );
            await h.assert.sync.peersInSyncWait({
                peerIndices: remainingPeerIndices
            });
        });

        it("one dispute replays a pending join before self-removing that joiner", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                )
            ).to.equal(true);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PENDING_PARTICIPANT);

            const originalForkId = h.activeForkId!;
            await h.control(joiner).dispute.setForceExit(true).request();
            h.context.leftChannelPeerIndices = [
                ...h.context.leftChannelPeerIndices,
                joiner.index
            ];
            const { dispute } = await h.tamper.postTamperedDispute(
                joiner.index,
                () => {},
                { markMalicious: false }
            );

            expect(dispute.input.selfRemoval).to.equal(true);
            expect(
                Number(dispute.input.lastInboundMessageBlockHeight)
            ).to.be.greaterThan(0);
            await h.assert.dispute.committedWait({
                peersIndices: [0, 1, 2],
                expectedCount: 1
            });
            await h.dispute.resolveDisputeWait({
                forkId: originalForkId,
                honestPeerIndices: [0, 1, 2],
                assertMaliciousRemoved: false
            });
            await waitFor(async () => {
                const snapshot = await h.channelManager.getStateSnapshot(
                    h.channelId
                );
                return snapshot.forkId !== originalForkId;
            }, h.event.protocolEventTimeoutMs());

            const participants = await h.channelManager.getParticipants(
                h.channelId
            );
            expect(
                participants.map((address: unknown) =>
                    String(address).toLowerCase()
                )
            ).to.not.include(joiner.address.toLowerCase());
        });

        it("omitting the newest pending join from a self-removal dispute is killed", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            expect(
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                )
            ).to.equal(true);
            await h.control(joiner).dispute.setForceExit(true).request();

            await h.tamper.postTamperedDispute(
                joiner.index,
                (dispute, _confirmation, auditingData) => {
                    const newestInbound =
                        auditingData!.inboundMessageBlocks.at(-1)!;
                    auditingData!.inboundMessageBlocks =
                        auditingData!.inboundMessageBlocks.slice(0, -1);
                    dispute.input.latestInboundMessageBlockHash =
                        newestInbound.previousBlockHash;
                    dispute.input.lastInboundMessageBlockHeight =
                        BigInt(newestInbound.blockHeight) - 1n;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                }
            );

            await h.assert.dispute.committedWait({
                peersIndices: [0, 1, 2],
                expectedCount: 1
            });
            await h.event.waitForPeers("onDisputeKilled", [0, 1, 2], 1, {
                mode: "atLeast"
            });
        });

        it("allows existing and pending participants to top up during a dispute and converge after reduction", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            } = await h.scenario.syncSpectatorAndPrepareJoin();
            await joiner.p2pInstance.p2pSigner.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await h.assert.storage.honestPeersObserveInboundMessageWait();

            const depositsBefore = BigInt(
                (await h.channelManager.getChannelBalance(h.channelId))
                    .totalDeposits.amount
            );
            const leaverIndex = 0;
            const originalForkId = h.activeForkId!;
            await h
                .control(h.getPeer(leaverIndex))
                .dispute.setForceExit(true)
                .request();
            h.context.leftChannelPeerIndices = [leaverIndex];
            await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
                markMalicious: false
            });
            const remainingPeerIndices = h
                .getActiveHonestPeers()
                .map((peer) => peer.index);
            await h.assert.dispute.committedWait({
                peersIndices: remainingPeerIndices,
                expectedCount: 1
            });

            const existingTopUpAmount = 111n;
            const existingParticipant = h.getPeer(1);
            const existingPrepared =
                await existingParticipant.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                    {
                        participant: existingParticipant.address,
                        channelId: h.channelId,
                        balance: {
                            amount: existingTopUpAmount,
                            data: "0x00"
                        },
                        deadlineTimestamp: BigInt(
                            Clock.getTimeInSeconds() + 120
                        )
                    }
                );
            await existingParticipant.p2pInstance.p2pSigner.topUpBalance(
                existingPrepared.confirmation,
                existingPrepared.expectedSnapshotHash,
                existingPrepared.expectedForkId
            );

            const pendingTopUpAmount = 222n;
            const pendingPrepared =
                await joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                    {
                        participant: joiner.address,
                        channelId: h.channelId,
                        balance: { amount: pendingTopUpAmount, data: "0x00" },
                        deadlineTimestamp: BigInt(
                            Clock.getTimeInSeconds() + 120
                        )
                    }
                );
            await joiner.p2pInstance.p2pSigner.topUpBalance(
                pendingPrepared.confirmation,
                pendingPrepared.expectedSnapshotHash,
                pendingPrepared.expectedForkId
            );

            await h.dispute.resolveDisputeWait({
                forkId: originalForkId,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });
            await waitFor(async () => {
                const snapshot = await h.channelManager.getStateSnapshot(
                    h.channelId
                );
                return snapshot.forkId !== originalForkId;
            }, h.event.protocolEventTimeoutMs());

            const union = await h
                .control(h.getPeer(1))
                .query.getOnChainParticipantUnion()
                .request();
            const loweredUnion = union.map((address) => address.toLowerCase());
            expect(new Set(loweredUnion).size).to.equal(loweredUnion.length);
            expect(loweredUnion).to.include(joiner.address.toLowerCase());
            expect(loweredUnion).to.include(
                existingParticipant.address.toLowerCase()
            );
            expect(
                BigInt(
                    (await h.channelManager.getChannelBalance(h.channelId))
                        .totalDeposits.amount
                )
            ).to.equal(
                depositsBefore + existingTopUpAmount + pendingTopUpAmount
            );
            expect(
                await h.control(existingParticipant).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
        });

        it("returns false for a stale top-up guard without aborting participation", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(2, 1);
            const participant = h.getPeer(0);
            const prepared =
                await participant.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                    {
                        participant: participant.address,
                        channelId: h.channelId,
                        balance: { amount: 50n, data: "0x00" },
                        deadlineTimestamp: BigInt(
                            Clock.getTimeInSeconds() + 120
                        )
                    }
                );

            expect(
                await participant.p2pInstance.p2pSigner.topUpBalance(
                    prepared.confirmation,
                    `0x${"77".repeat(32)}`,
                    prepared.expectedForkId
                )
            ).to.equal(false);
            const state = await h.execOnHost(
                participant,
                async (sm) => ({
                    status: sm.status,
                    isDisposed: sm.isDisposed,
                    joinSubmissionHeight:
                        sm.storage.forceJoin.getJoinSubmissionBlockHeight()
                }),
                {}
            );
            expect(state.status).to.equal(Status.PARTICIPATING);
            expect(state.isDisposed).to.equal(false);
            expect(state.joinSubmissionHeight).to.equal(undefined);
        });
    });
});
