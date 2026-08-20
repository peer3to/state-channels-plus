import { expect } from "chai";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

// membership is driven through the real signer entry points
// (p2pSigner.joinChannel / topUpBalance) and through a real leave.

describe("Unit: MembershipService", function () {
    describe("joinChannel", function () {
        it("replayed after the joiner is already PARTICIPATING → rejected on status, membership untouched", async function () {
            const h = TestSession.getHarness();
            const joiner =
                await h.scenario.spectatorPromotedViaJoinChannelWait();

            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);

            // the same confirmation the promotion used, replayed
            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });

            let message = "no throw";
            try {
                await joiner.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain("joinChannel requires SYNCED status");
            // the guard runs before any status change or force-join bookkeeping
            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
        });
    });

    describe("topUpBalance", function () {
        it("a synced non-participant tops up → rejected on status", async function () {
            const h = TestSession.getHarness();
            const { joiner } = await h.scenario.syncSpectatorAndPrepareJoin();

            expect(
                await h.control(joiner).query.getStatus().request()
            ).to.equal(Status.SYNCED);

            const prepared = await h.join.buildJoinChannelConfirmation({
                joiner,
                channelId: h.channelId
            });

            let message = "no throw";
            try {
                await joiner.p2pInstance.p2pSigner.topUpBalance(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } catch (e) {
                message = e instanceof Error ? e.message : String(e);
            }

            expect(message).to.contain(
                "topUpBalance requires PARTICIPATING or PENDING_PARTICIPANT status"
            );
        });
    });

    describe("maybeInitiateForceJoinDispute", function () {
        it("no recorded join submission height → nothing disputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);

            // any dispute this would raise is recorded instead of submitted
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            await h.execOnHost(
                observer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(
                        args.forkId
                    )!;
                    const participants =
                        await sm.diamondStateMachine.getParticipants();
                    await sm.membershipService.maybeInitiateForceJoinDispute(
                        block,
                        participants
                    );
                    return true;
                },
                { forkId }
            );

            expect(await recorder.submissions()).to.deep.equal([]);
            h.assert.dispute.noDisputes();
            await recorder.restore();
        });

        // no test here: making it fire needs the joiner excluded for N turns,
        // which is E2E-ForceJoinDispute's "should trigger force-join dispute
        // after N turns of non-inclusion" staging.
        it.skip("fires exactly at joinSubmissionHeight + participants + 1", function () {});
    });

    describe("startMaybeExitOnChain", function () {
        it("a clean leave everyone signed → snapshot path, no force-exit flag", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);

            const leaverIndex = await h.transition.participantLeaveWait();
            const leaver = h.getPeer(leaverIndex);

            // the leave block carries every signature, so the exit takes the
            // N/N snapshot path and never marks a self-removal dispute
            const forcedExit = await h.execOnHost(leaver, async (sm) =>
                sm.storage.forceExit.getForceExit()
            );

            expect(forcedExit).to.equal(false);
            expect(
                await h.control(leaver).query.getStatus().request()
            ).to.equal(Status.SYNCED);
        });

        it("I did not leave → returns without scheduling an exit", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const observer = h.getPeer(0);

            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index
            );

            const outcome = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const block = sm.storage.blocks.getLatestBlock(
                        args.forkId
                    )!;
                    const snapshot =
                        sm.storage.stateSnapshots.getStateSnapshotByHash(
                            block.stateSnapshotHash
                        )!;
                    await sm.membershipService.startMaybeExitOnChain(
                        block,
                        snapshot,
                        { left: new Set(), joined: new Set() }
                    );
                    return sm.storage.forceExit.getForceExit();
                },
                { forkId }
            );

            expect(outcome).to.equal(false);
            expect(await recorder.submissions()).to.deep.equal([]);
            await recorder.restore();
        });
    });
});
