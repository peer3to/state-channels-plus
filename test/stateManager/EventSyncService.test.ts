import { expect } from "chai";

import type { Address } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";

// Wide enough that posting the block on-chain and probing its recovery stays
// clear of the participant timeout.
const RECOVERY_TIME_CONFIG = {
    p2pTime: 2,
    agreementTime: 8,
    chainFallbackTime: 10,
    evidenceTime: 20
};

/**
 * Author a block off the wire, post its calldata on-chain, and keep the observer
 * from receiving the subscribed event - so the only way it can learn the block
 * was posted is the on-chain scan under test.
 */
async function postBlockOnChainBehindObserver(
    h: ReturnType<typeof TestSession.getHarness>
) {
    await h.lifecycle.start(3, 1, { timeConfig: RECOVERY_TIME_CONFIG });
    const { leader, observer, authored, forkId } =
        await h.transition.authorNextBlockOffWireWait();

    await h.control(observer).stub.stubHoldCalldataPostedEvents().request();
    await h
        .control(leader)
        .stub.postBlockCalldataOnChain(authored.encodedSignedBlock)
        .request();
    await h.control(observer).stub.waitForHeldCalldataPostedEvent().request();

    const parent = await h
        .control(observer)
        .query.getBlockByHeight(forkId, authored.height - 1)
        .request();
    expect(parent, "the block's validity window is anchored on its parent").to
        .not.be.null;

    return {
        observer,
        forkId,
        height: authored.height,
        author: authored.author as Address,
        // the anchor the real callers pass: the previous block's timestamp
        anchorTimestamp: parent!.timestamp
    };
}

describe("EventSyncService", function () {
    it("treats a failed log as fatal - never re-dispatched, cursor holds", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeRejectedEventSyncLog()
            .request();

        expect(result.samePromise).to.equal(true);
        expect(result.handlerCallCount).to.equal(1);
        expect(result.firstError).to.equal("Expected event-sync rejection");
        expect(result.secondError).to.equal("Expected event-sync rejection");
        // the failure bubbles out of the detached promise
        expect(result.detachedError).to.equal("Expected event-sync rejection");
        // rescheduling after the failure replays the rejection, it does not retry
        expect(result.rescheduledError).to.equal(
            "Expected event-sync rejection"
        );
        expect(result.cursorAfter).to.equal(result.cursorBefore);
    });

    it("joins concurrent calldata recovery onto one chain query", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeConcurrentCalldataRecovery()
            .request();

        expect(result.queryCount).to.equal(2);
        expect(result.firstFound).to.equal(false);
        expect(result.secondFound).to.equal(false);
        expect(result.retryFound).to.equal(false);
    });

    it("recovers an on-chain commitment through a scan bounded to the block's validity window", async function () {
        const h = TestSession.getHarness();
        const staged = await postBlockOnChainBehindObserver(h);

        const probe = await h
            .control(staged.observer)
            .stub.probeBlockCalldataRecovery(
                staged.forkId,
                staged.height,
                staged.author,
                staged.anchorTimestamp,
                false
            )
            .request();

        expect(probe.commitmentFound).to.equal(true);
        expect(probe.calldataRecovered).to.equal(true);
        // a closed range, never "genesis to latest"
        expect(probe.toBlock).to.be.at.most(probe.latestBlockNumber);
        expect(probe.fromBlock).to.be.at.most(probe.toBlock);
    });

    it("keeps a commitment the log scan missed classified as posted, not as never posted", async function () {
        const h = TestSession.getHarness();
        const staged = await postBlockOnChainBehindObserver(h);

        // the commitment really is on-chain; only the log scan comes back empty
        const probe = await h
            .control(staged.observer)
            .stub.probeBlockCalldataRecovery(
                staged.forkId,
                staged.height,
                staged.author,
                staged.anchorTimestamp,
                true
            )
            .request();

        // deferrable: the caller retries instead of timing the author out
        expect(probe.commitmentFound).to.equal(true);
        expect(probe.calldataRecovered).to.equal(false);
    });

    it("reports a slot nobody ever posted as not committed", async function () {
        const h = TestSession.getHarness();
        const staged = await postBlockOnChainBehindObserver(h);

        const probe = await h
            .control(staged.observer)
            .stub.probeBlockCalldataRecovery(
                staged.forkId,
                staged.height + 5,
                staged.author,
                staged.anchorTimestamp,
                false
            )
            .request();

        expect(probe.commitmentFound).to.equal(false);
        expect(probe.calldataRecovered).to.equal(false);
    });
});
