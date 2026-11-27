import { Codec, Type } from "@/utils";
import {
    syncFromResponder,
    syncFromServedPayload
} from "@test/fixtures/MilestoneSyncStaging";
import { localFinalizedView } from "@test/fixtures/ProofOwnerStaging";
import {
    servingConflictAt,
    stageAnchoredHistory,
    stageOwnFinalPointBehindMissedTopUp,
    syncEvidenceView
} from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: Sync install decision", function () {
    it("a participant asks a peer that serves a side chain conflicting with its own final point → the sync request fails, nothing is installed, the side chain is kept as sync evidence and the relaying peer stays connected and unblacklisted", async function () {
        const h = TestSession.getHarness();
        const { forkId, anchor, payload, latestHeight, responder } =
            await stageAnchoredHistory(h, { blocksAfter: 2 });
        const requester = h.getPeer(2);
        const localFinalized = await localFinalizedView(h, requester.index);
        const conflicting = await servingConflictAt(
            h,
            payload,
            anchor,
            localFinalized!.height
        );

        const sync = await syncFromServedPayload(
            h,
            requester,
            responder,
            Codec.encode(conflicting, Type.SyncPayload) as string,
            forkId,
            latestHeight
        );

        expect(sync).to.deep.equal({
            synced: false,
            rejections: [],
            blacklisted: false,
            latestHeight
        });
        expect(
            (await localFinalizedView(h, requester.index))!.hash
        ).to.equal(localFinalized!.hash);
        expect(
            (await syncEvidenceView(h, requester, anchor))?.finalizedHash
        ).to.equal(String(anchor.hash));
        expect(
            await h
                .control(requester)
                .query.isConnectedTo(responder.address)
                .request()
        ).to.equal(true);
    });

    it("an observer asks for an honest continuation it cannot check from its own final point (its local diamond missed a consumed top-up) → the first request installs nothing and blames nobody; once its local diamond holds the run the next request to the same peer installs the served head", async function () {
        const h = TestSession.getHarness();
        const staged = await stageOwnFinalPointBehindMissedTopUp(h);
        const responder = h.getPeer(0);
        try {
            const responderHead = (await h
                .control(responder)
                .query.getLatestBlockHeight(staged.forkId)
                .request())!;
            const requesterHead = await h
                .control(staged.requester)
                .query.getLatestBlockHeight(staged.forkId)
                .request();

            const first = await syncFromResponder(
                h,
                staged.requester,
                responder,
                staged.forkId,
                responderHead
            );
            expect(first).to.deep.equal({
                synced: false,
                rejections: [],
                blacklisted: false,
                latestHeight: requesterHead
            });

            expect(await staged.hold.release()).to.be.greaterThan(0);
            const second = await syncFromResponder(
                h,
                staged.requester,
                responder,
                staged.forkId,
                responderHead
            );
            expect(second).to.deep.equal({
                synced: true,
                rejections: [],
                blacklisted: false,
                latestHeight: responderHead
            });
        } finally {
            await staged.restoreGossip();
        }
    });
});
