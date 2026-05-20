import { MathTestSession as TestSession } from "@test/harness";
import { hash, tryDecodeCustomError } from "@/utils";
import { Status } from "@/types";
import {
    encodeMathState,
    type MathStateDecoded
} from "@test/utils/mathHarnessAbi";
import { expect } from "chai";

describe("E2E: Join channel race conditions", function () {
    describe("Snapshot vs join race", function () {
        it("stale snapshot join reverts", async function () {
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
                "on-chain snapshot S' must differ from S before submitting the stale join"
            );

            let revertError: unknown;
            try {
                await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
                expect.fail(
                    "expected joinChannel to revert: spectator built confirmation against stale snapshot S, on-chain is now S'"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal(
                "RaceConditionJoinChannelStaleSnapshot"
            );

            expect(joiner.stateManager.getStatus()).to.equal(Status.SYNCED);

            const onChainParticipants =
                await joiner.stateManager.diamondStateMachine.getParticipants();
            expect(
                onChainParticipants.map((a) => String(a).toLowerCase())
            ).to.not.include(joiner.address.toLowerCase());
        });

        it("snapshot update reverts if pending inbound unconsumed", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            // Existing peers ignore the join's inbound message.
            for (const i of [0, 1, 2])
                h.byzantine.stubPendingInboundInclusion(i);

            await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
            expect(joiner.stateManager.getStatus()).to.equal(
                Status.PENDING_PARTICIPANT
            );

            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2]
            });

            let revertError: unknown;
            try {
                await h.transition.postSnapshotWait({ peerIndex: 0 });
                expect.fail(
                    "expected updateStateSnapshotSameFork to revert: pending inbound (joiner) was not consumed"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
            expect(customError!.errorDescription.name).to.equal(
                "RaceConditionPendingInboundNotConsumed"
            );
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

            expect(joiner.stateManager.getStatus()).to.equal(Status.SYNCED);

            const onChainParticipants =
                await joiner.stateManager.diamondStateMachine.getParticipants();
            expect(
                onChainParticipants.map((a: unknown) => String(a).toLowerCase())
            ).to.not.include(joiner.address.toLowerCase());
        });

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
                    "forceInboundJoin succeeded mid-dispute — protocol GAP: no symmetric guard like RaceConditionJoinChannelForkDisputed exists for the inbound-join path (_appendInboundMessages has no dispute-active check)"
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
            expect(joiner.stateManager.getStatus()).to.equal(
                Status.PENDING_PARTICIPANT
            );

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
            h.getPeer(leaverIndex).stateManager.storage.forceExit.setForceExit(
                true
            );
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
