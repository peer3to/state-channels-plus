import { Status } from "@/types";
import { isEngagedStatus } from "@/types/flags";
import type { RecordedLiveBlockDelivery } from "@test/fixtures/customRpc/harnessControl/services/stub/node/LiveBlockRetentionRecorder";
import {
    addObserverWithHeldInitialSync,
    readLiveBlockRetention,
    wrongForkBlock
} from "@test/fixtures/LiveBlockRetentionStaging";
import {
    runtimeEndpointFor,
    runtimeIsClosed
} from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("WaitForSyncStatusGuard", function () {
    it("a live block received during the initial sync is retained, starts no second sync, and is applied after SYNCED without a resend", async function () {
        const h = MathTestSession.getHarness();
        const { observer, forkId, heldHeight, release, spectateRequests } =
            await addObserverWithHeldInitialSync(h, "install");
        const participant = h.control(h.getPeer(0)).query;
        const query = h.control(observer).query;
        let live = heldHeight + 1;
        try {
            // the payload is fixed at heldHeight or below: this block reaches
            // the observer only as live gossip from the participants
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            live = Number(
                await participant.getLatestBlockHeight(forkId).request()
            );
            expect(live).to.equal(heldHeight + 1);
            await waitFor(async () =>
                (await readLiveBlockRetention(h, observer)).deliveries.some(
                    (delivery) => delivery.height === live
                )
            );
            const held = await readLiveBlockRetention(h, observer);
            expect(held.retainedCount).to.be.greaterThan(0);
            expect(
                held.deliveries.flatMap((delivery) => delivery.intakes)
            ).to.deep.equal([]);
            expect(isEngagedStatus(await query.getStatus().request())).to.equal(
                false
            );
            expect(await spectateRequests()).to.equal(1);
        } finally {
            await release();
        }

        await h.event.waitUntilPeerStatus(observer.index, Status.SYNCED);
        await waitFor(
            async () =>
                Number(await query.getLatestBlockHeight(forkId).request()) ===
                live,
            h.event.protocolEventTimeoutMs()
        );
        // the held sync went on and set SYNCED; the observer holds the
        // participants' chain through the served head
        expect(
            await query.getBlockHashAt(forkId, heldHeight).request()
        ).to.equal(
            await participant.getBlockHashAt(forkId, heldHeight).request()
        );
        const after = await readLiveBlockRetention(h, observer);
        const liveDeliveries = after.deliveries.filter(
            (delivery) => delivery.height === live
        );
        const firstIntake = liveDeliveries
            .flatMap((delivery) =>
                delivery.intakes.map((intake) => ({ delivery, intake }))
            )
            .sort((a, b) => a.intake.sequence - b.intake.sequence)[0];
        // the block first reached intake as a retained RPC released by the
        // guard once synced, not as a copy the participants sent again
        expect(firstIntake, "live block intake").to.not.be.undefined;
        expect(isEngagedStatus(firstIntake.delivery.arrivalStatus)).to.equal(
            false
        );
        expect(firstIntake.intake.run).to.equal(2);
        expect(isEngagedStatus(firstIntake.intake.status)).to.equal(true);
        expect(after.retainedCount).to.equal(0);
        expect(await spectateRequests()).to.equal(1);
        expect(
            Number(await participant.getLatestBlockHeight(forkId).request())
        ).to.equal(live);
        await MathTestSession.settleDetached();
    });

    it("a retained stale block and a retained wrong-fork block go through normal validation after SYNCED and are not applied", async function () {
        const h = MathTestSession.getHarness();
        const { observer, forkId, heldHeight, release } =
            await addObserverWithHeldInitialSync(h, "install");
        const sender = h.getPeer(1);
        const query = h.control(observer).query;
        const stale = await h
            .control(sender)
            .query.getLatestBlockBundle(forkId)
            .request();
        if (!stale) throw new Error("Expected the participant's latest block");
        expect(stale.height).to.equal(heldHeight);
        const wrongFork = await wrongForkBlock(h, sender, heldHeight + 1);
        try {
            for (const encoded of [
                stale.encodedBlockConfirmation,
                wrongFork.encoded
            ])
                await h
                    .control(sender)
                    .byzantine.sendBlockConfirmation(encoded, observer.address)
                    .request();
            await waitFor(
                async () =>
                    (await readLiveBlockRetention(h, observer)).retainedCount >=
                    2
            );
            const held = await readLiveBlockRetention(h, observer);
            expect(
                held.deliveries.flatMap((delivery) => delivery.intakes)
            ).to.deep.equal([]);
        } finally {
            await release();
        }

        await h.event.waitUntilPeerStatus(observer.index, Status.SYNCED);
        const sent = (deliveries: RecordedLiveBlockDelivery[]) =>
            deliveries.filter(
                (delivery) =>
                    (delivery.forkId === forkId &&
                        delivery.height === heldHeight) ||
                    delivery.forkId === wrongFork.forkId
            );
        await waitFor(
            async () =>
                sent((await readLiveBlockRetention(h, observer)).deliveries)
                    .filter((delivery) => delivery.runs > 1)
                    .every((delivery) => delivery.intakes.length > 0),
            h.event.protocolEventTimeoutMs()
        );
        const after = await readLiveBlockRetention(h, observer);
        const released = sent(after.deliveries).filter(
            (delivery) => delivery.runs > 1
        );
        // both explicit copies were retained and released into intake
        expect(
            released.some((delivery) => delivery.forkId === wrongFork.forkId)
        ).to.equal(true);
        expect(
            released.some((delivery) => delivery.blockHash === stale.hash)
        ).to.equal(true);
        for (const delivery of released)
            expect(isEngagedStatus(delivery.intakes[0].status)).to.equal(true);
        // neither changed the observer's state: the stale copy is a known
        // block, the wrong-fork block is never stored or adopted
        expect(
            Number(await query.getLatestBlockHeight(forkId).request())
        ).to.equal(heldHeight);
        expect(
            await query.getLatestBlockHeight(wrongFork.forkId).request()
        ).to.equal(null);
        expect(await query.getForkId().request()).to.equal(forkId);
        await MathTestSession.settleDetached();
    });

    it("an abort during the initial sync drops the retained live blocks without running them", async function () {
        const h = MathTestSession.getHarness();
        const { observer, forkId, heldHeight, release, spectateRequests } =
            await addObserverWithHeldInitialSync(h, "failingResponse", {
                // the retention is read on the local endpoint after the
                // abort removed the observer's RPC connection
                configOverrides: { RUN_SDK_IN_THREAD: false }
            });
        const endpoint = runtimeEndpointFor(observer.p2pInstance);
        try {
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            await waitFor(async () =>
                (await readLiveBlockRetention(h, observer)).deliveries.some(
                    (delivery) =>
                        delivery.forkId === forkId &&
                        delivery.height === heldHeight + 1
                )
            );
            expect(
                (await readLiveBlockRetention(h, observer)).retainedCount
            ).to.be.greaterThan(0);
        } finally {
            // the held sync answer fails: the initial sync aborts the runtime
            await release();
        }

        await h.event.waitForPeers("onAbort", [observer.index], 1);
        await waitFor(
            () => runtimeIsClosed(observer.p2pInstance),
            h.event.protocolEventTimeoutMs()
        );
        const after = endpoint.stub.getRecordedLiveBlockRetention();
        expect(after.retainedCount).to.equal(0);
        expect(after.deliveries.length).to.be.greaterThan(0);
        for (const delivery of after.deliveries) {
            expect(delivery.runs).to.equal(1);
            expect(delivery.intakes).to.deep.equal([]);
        }
        expect(await spectateRequests()).to.equal(1);
        // the aborted runtime's connect settles false
        await MathTestSession.settleDetached({
            expectedErrorIncludes: "connectToChannel failed"
        });
    });
});
