import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";

describe("Unit: SpectateService", function () {
    describe("generateSyncPayload", function () {
        // a dispute commitment can land on-chain before our
        // onDisputeCommitted handler stores the struct locally.
        // generateSyncPayload used to hit the throwing local lookup
        // directly and abort the sync; it now recovers via the same
        // EventSyncService.ensureDisputesProcessed owner reduction uses.
        it("committed dispute missing locally → recovers before generating the payload", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const maliciousPeerIndex = 2;

            await h.lifecycle.start(4, 2);
            const forkId = h.activeForkId!;

            // hold the observer's own scheduled reduction so it can't
            // recover the missing dispute in the background before this
            // test's generateSyncPayload call gets to observe the gap
            const race = await h.rpcStub.holdReductionRace(observerIndex);

            // the observer's own dispute against the fault is created
            // locally (flips isForkDisputed regardless of event delivery),
            // but only the FIRST externally-arriving dispute event is let
            // through - a later honest disputer's commitment stays
            // genuinely missing from local storage
            const restoreEvents = await h.rpcStub.holdDisputeCommittedEvents(
                observerIndex,
                { passFirst: true }
            );

            await h.byzantine.submitInvalidStateTransitionBlock(
                maliciousPeerIndex
            );
            await h.assert.dispute.initiatedWait();
            // exclude the observer - its own onDisputeCommitted delivery is
            // deliberately held back except for the first event
            await h.assert.dispute.committedWait({ peersIndices: [1, 3] });

            const staged = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    const isDisputed =
                        await sm.diamondStateMachine.localDiamondContract.isForkDisputed(
                            sm.channelId,
                            args.forkId
                        );
                    const commitments =
                        await sm.stateChannelManagerContract.getWindowCommitments(
                            sm.channelId,
                            args.forkId
                        );
                    const missingBefore = commitments.filter(
                        (c) => !sm.storage.disputes.getDispute(c)
                    );
                    return {
                        isDisputed,
                        commitmentCount: commitments.length,
                        missingBeforeCount: missingBefore.length
                    };
                },
                { forkId }
            );

            // sanity: the fork is genuinely disputed and a commitment is
            // genuinely missing locally
            expect(
                staged.isDisputed,
                "observer must see the fork as disputed"
            ).to.equal(true);
            expect(
                staged.commitmentCount,
                "window must hold commitments"
            ).to.be.greaterThan(0);
            expect(
                staged.missingBeforeCount,
                "at least one commitment must be missing locally"
            ).to.be.greaterThan(0);

            // RO1 turns a throw (missing dispute confirmation) into a
            // recovered read - a null/undefined return is a separate,
            // legitimate outcome (the requested fork isn't the tip derived
            // from the observer's own in-progress reduction), so the throw
            // is what this test pins, not the exact return value
            let threw = "";
            try {
                await h
                    .control(h.getPeer(observerIndex))
                    .spectate.generateSyncPayload(h.channelId!, forkId, 0)
                    .request();
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }

            expect(
                threw,
                "generateSyncPayload must recover, not throw"
            ).to.equal("");

            await race.release({ replayEvents: false, runHeldTasks: false });
            await restoreEvents(false);
        });
    });
});
