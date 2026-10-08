import {
    latestHeight,
    proofHeights,
    servedPayload,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import { stageSpectatorBehindUnfinalizedTail } from "@test/fixtures/SyncReplayBaseStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// persistSyncPayload keeps the requester's own state when it already holds
// the replay base's state at that height or a later one
// (localLatestHeight >= baseHeight); otherwise it installs the base.

describe("Unit: SpectateService replay base", function () {
    it("requester's latest height equals the served base height → it keeps its own state as the replay base and syncs to the tip", async function () {
        const h = TestSession.getHarness();
        const { forkId, spectator, responder, tip } =
            await stageSpectatorBehindUnfinalizedTail(h, {
                finalBlocksWhileCutOff: 0
            });
        const baseHeight = proofHeights(
            await servedPayload(h, responder, forkId)
        ).at(-1)![0];
        // premise - the requester stands exactly at the base
        expect(await latestHeight(h, spectator, forkId)).to.equal(baseHeight);
        expect(baseHeight).to.be.lessThan(tip);
        await h
            .control(spectator)
            .stub.stubRecordUnsafeSetLatestState()
            .request();

        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(spectator)
                .stub.wasUnsafeSetLatestStateCalled()
                .request(),
            "the base must not be reinstalled over the requester's own state"
        ).to.equal(false);
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });

    it("requester's latest height one below the served base height → the base is installed, then the sync reaches the tip", async function () {
        const h = TestSession.getHarness();
        const { forkId, spectator, responder, tip } =
            await stageSpectatorBehindUnfinalizedTail(h, {
                finalBlocksWhileCutOff: 1
            });
        const baseHeight = proofHeights(
            await servedPayload(h, responder, forkId)
        ).at(-1)![0];
        // premise - the requester stands one below the base
        expect(await latestHeight(h, spectator, forkId)).to.equal(
            baseHeight - 1
        );
        await h
            .control(spectator)
            .stub.stubRecordUnsafeSetLatestState()
            .request();

        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: true,
            rejections: [],
            blacklisted: false,
            latestHeight: tip
        });
        expect(
            await h
                .control(spectator)
                .stub.wasUnsafeSetLatestStateCalled()
                .request(),
            "below the base the requester installs it"
        ).to.equal(true);
        expect(
            await h
                .control(spectator)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        ).to.equal(
            await h
                .control(responder)
                .query.getLatestStateMachineStateHash(forkId)
                .request()
        );
    });
});
