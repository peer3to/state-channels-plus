import { MathTestSession as TestSession } from "@test/harness";
import { DetachedPromises, hash, tryDecodeCustomError } from "@/utils";
import { Status } from "@/types";
import {
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { expect } from "chai";

describe("E2E: Join channel race conditions", function () {
    describe("Snapshot vs join race", function () {
        it("new on-chain snapshot causes join confirmation to revert with RaceConditionJoinChannelSnapshotMismatch", async function () {
            const h = TestSession.getHarness();
            const {
                joiner,
                stateSnapshot: stateSnapshot_a,
                confirmation
            } = await h.scenario.syncSpectatorAndPrepareJoin();

            await h.byzantine.postFraudulentSnapshot({
                mutate: ({ originalSnapshotData }) => {
                    const fraudulentEncoded = encodeMathState({
                        number: 999_999n,
                        participants: h.peerHandles.map((p) => p.address),
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

            let revertError: unknown;
            try {
                // step 1 - route via handle so worker mode goes through rpc
                await h
                    .getPeerHandle(joiner.index)
                    .lifecycle.joinChannel(confirmation);
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
                await h.getPeerHandle(joiner.index).channel.queryStatus()
            ).to.equal(Status.SYNCED);

            const onChainParticipants = await h
                .getPeerHandle(joiner.index)
                .channel.queryParticipants();
            expect(
                onChainParticipants.map((a) => String(a).toLowerCase())
            ).to.not.include(joiner.address.toLowerCase());

            // existing PARTICIPATING peers observe the byzantine snapshot and
            // throw via EventHandler's unknown-snapshot fraud detection.
            await TestSession.expectFirstDetachedError({
                includes: "unknown snapshot",
                timeoutMs: 3000
            });
        });

        it("pending inbound unconsumed → postStateSnapshot throws RaceConditionPendingInboundNotConsumed (fatal); on-chain snapshot unchanged", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers ignore the join's inbound message.
            for (const i of [0, 1, 2])
                await h.byzantine.stubPendingInboundInclusion(i);

            await h
                .getPeerHandle(joiner.index)
                .lifecycle.joinChannel(confirmation);
            expect(
                await h.getPeerHandle(joiner.index).channel.queryStatus()
            ).to.equal(Status.PENDING_PARTICIPANT);

            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });

            const snapshotBefore = await h.channelManager.getStateSnapshot(
                h.channelId
            );

            // postSnapshotWait times out -> chain rejects with
            // RaceConditionPendingInboundNotConsumed
            let waitError: unknown;
            try {
                await h.transition.postSnapshotWait({
                    peerIndex: 0,
                    timeoutMs: 5000
                });
                expect.fail(
                    "expected postSnapshotWait to time out: chain should reject the snapshot"
                );
            } catch (e) {
                waitError = e;
            }
            expect((waitError as Error).message).to.include(
                "honest peers did not observe expected snapshot"
            );

            await DetachedPromises.awaitAllAndClear();
            await TestSession.expectFirstDetachedError({
                includes: "pending inbound not consumed",
                timeoutMs: 2000
            });

            const snapshotAfter = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            expect(snapshotAfter).to.deep.equal(snapshotBefore);
        });
    });

    describe("Dispute vs join race", function () {
        it("join on disputed fork reverts", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers open a dispute on the latest fork
            await h.tamper.postTamperedDispute(0, async () => {});

            let revertError: unknown;
            try {
                // step 1 - route via handle so worker mode goes through rpc
                await h
                    .getPeerHandle(joiner.index)
                    .lifecycle.joinChannel(confirmation);
                expect.fail(
                    "expected joinChannel to revert: spectator built confirmation against a fork that is now disputed"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal(
                "RaceConditionJoinChannelForkDisputed"
            );

            expect(
                await h.getPeerHandle(joiner.index).channel.queryStatus()
            ).to.equal(Status.SYNCED);

            const onChainParticipants = await h
                .getPeerHandle(joiner.index)
                .channel.queryParticipants();
            expect(
                onChainParticipants.map((a: unknown) => String(a).toLowerCase())
            ).to.not.include(joiner.address.toLowerCase());
        });

        // Fails: Race condition guard was removed from appendInboundMessages in commit 029c6a82b6f76e233af191b9b88c2e22dfef595f
        it("forceInboundJoin on disputed fork reverts", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);

            // Existing peers open a dispute on the latest fork
            await h.tamper.postTamperedDispute(0, async () => {});

            let revertError: unknown = null;
            try {
                await h.join.forceInboundJoinWait({
                    waitForHonestPeersObserve: false
                });
            } catch (e) {
                revertError = e;
            }

            if (revertError === null) {
                expect.fail(
                    "forceInboundJoin succeeded mid-dispute — expected RaceConditionForceInboundJoinForkDisputed guard in StateChannelCommon.appendInboundMessages"
                );
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal(
                "RaceConditionForceInboundJoinForkDisputed"
            );
        });

        it("pending joiner participates after dispute reduction", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            await h
                .getPeerHandle(joiner.index)
                .lifecycle.joinChannel(confirmation);
            expect(
                await h.getPeerHandle(joiner.index).channel.queryStatus()
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
            const leaverAddress = h.getPeerHandle(leaverIndex).address;
            await h.getPeerHandle(leaverIndex).dispute.setForceExit(true);
            h.context.leftChannelPeerIndices = [
                ...h.context.leftChannelPeerIndices,
                leaverIndex
            ];
            await h.tamper.postTamperedDispute(leaverIndex, () => {}, {
                markMalicious: false
            });

            const remainingPeerIndices = h
                .getPeersExcludingMaliciousAndLeavers()
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

            const originalForkId = h.activeForkId!;
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 15000,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });

            await h.assert.snapshot.onChainSnapshotChangedWait({
                previousForkId: originalForkId,
                timeoutMs: 15000
            });

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
        });
    });
});
