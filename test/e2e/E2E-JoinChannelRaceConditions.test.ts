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
                peers: [0, 1, 2],
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

        // Test not passing
        it("dispute excluding pending joiner reverts", async function () {
            const h = TestSession.getHarness();
            const { joiner, confirmation } =
                await h.scenario.syncSpectatorAndPrepareJoin();

            await joiner.p2pInstance.p2pSigner.joinChannel(confirmation);
            expect(joiner.stateManager.getStatus()).to.equal(
                Status.PENDING_PARTICIPANT
            );

            let revertError: unknown;
            try {
                await h.tamper.postTamperedDispute(0, async () => {});
                expect.fail(
                    "expected dispute submission to revert: pending joiner not represented in dispute"
                );
            } catch (e) {
                revertError = e;
            }

            const customError = tryDecodeCustomError(revertError);
            expect(customError).to.not.be.null;
        });
    });
});
