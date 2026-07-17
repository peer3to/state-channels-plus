import { MathTestSession as TestSession } from "@test/harness";
import { hash, tryDecodeCustomError } from "@/utils";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import {
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { waitFor } from "@test/utils/waitFor";
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
                    expectedSnapshotHash
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
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers ignore the join's inbound message.
            for (const i of [0, 1, 2])
                await h.byzantine.stubPendingInboundInclusion(i);

            await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
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

        it("pending inbound lands after preparation → raw same-fork calldata reverts with RaceConditionPendingInboundNotConsumed", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

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
            await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);

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
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers open a dispute on the latest fork
            await h.tamper.postTamperedDispute(0, async () => {});

            let revertError: unknown;
            try {
                await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
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
                await h
                    .control(h.getPeer(joiner.index))
                    .query.getStatus()
                    .request()
            ).to.equal(Status.OPENED);

            const onChainParticipants = await h
                .control(h.getPeer(joiner.index))
                .query.getParticipants()
                .request();
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

            await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
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

            const originalForkId = h.activeForkId!;
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 15000,
                honestPeerIndices: remainingPeerIndices,
                assertMaliciousRemoved: false
            });

            await waitFor(async () => {
                const snapshot = await h.channelManager.getStateSnapshot(
                    h.channelId
                );
                return snapshot.forkId !== originalForkId;
            }, 15000);

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
