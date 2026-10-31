import { RPC_GUARD_REJECTION_ERROR } from "@/rpc/Rpc";
import { Status } from "@/types";
import { isEngagedStatus } from "@/types/flags";
import type { RecordedLiveBlockDelivery } from "@test/fixtures/customRpc/harnessControl/services/stub/node/LiveBlockRetentionRecorder";
import {
    addObserverWithHeldInitialSync,
    openWithHeldFounderGenesis,
    readLiveBlockRetention,
    wrongForkBlock
} from "@test/fixtures/LiveBlockRetentionStaging";
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

    it("a retained block sent as a request gets no failure response while held and exactly one response after SYNCED", async function () {
        const h = MathTestSession.getHarness();
        const { observer, forkId, heldHeight, release } =
            await addObserverWithHeldInitialSync(h, "install");
        const sender = h.getPeer(1);
        const stale = await h
            .control(sender)
            .query.getLatestBlockBundle(forkId)
            .request();
        if (!stale) throw new Error("Expected the participant's latest block");
        expect(stale.height).to.equal(heldHeight);
        const requested = (deliveries: RecordedLiveBlockDelivery[]) =>
            deliveries.filter(
                (delivery) =>
                    delivery.request && delivery.blockHash === stale.hash
            );
        const outcome = h
            .control(sender)
            .byzantine.requestBlockConfirmation(
                stale.encodedBlockConfirmation,
                observer.address
            )
            .request();
        let settled = false;
        const markSettled = () => {
            settled = true;
        };
        void outcome.then(markSettled, markSettled);
        try {
            await waitFor(
                async () =>
                    requested(
                        (await readLiveBlockRetention(h, observer)).deliveries
                    ).length > 0
            );
            const held = await readLiveBlockRetention(h, observer);
            expect(held.retainedCount).to.be.greaterThan(0);
            const [delivery] = requested(held.deliveries);
            expect(delivery.runs).to.equal(1);
            expect(delivery.intakes).to.deep.equal([]);
            // the guard failed the request and retained it: no failure
            // response went back and the sender still waits
            expect(delivery.responses).to.deep.equal([]);
            expect(settled).to.equal(false);
            expect(
                isEngagedStatus(
                    await h.control(observer).query.getStatus().request()
                )
            ).to.equal(false);
        } finally {
            await release();
        }

        await h.event.waitUntilPeerStatus(observer.index, Status.SYNCED);
        // the sender's request settles with the response of the re-run
        expect(await outcome).to.deep.equal({ ok: true });
        const after = await readLiveBlockRetention(h, observer);
        const [delivery] = requested(after.deliveries);
        expect(requested(after.deliveries)).to.have.length(1);
        expect(delivery.runs).to.equal(2);
        expect(delivery.intakes.map((intake) => intake.run)).to.deep.equal([2]);
        expect(delivery.responses).to.deep.equal([{ ok: true }]);
        expect(
            after.deliveries
                .flatMap((recorded) => recorded.responses)
                .some(
                    (response) => response.error === RPC_GUARD_REJECTION_ERROR
                )
        ).to.equal(false);
        expect(after.retainedCount).to.equal(0);
        await MathTestSession.settleDetached();
    });

    it("a live block retained while a founder's genesis install is held is released by the direct move to PARTICIPATING and applied", async function () {
        const h = MathTestSession.getHarness();
        const { founder, forkId, release } =
            await openWithHeldFounderGenesis(h);
        const participant = h.control(h.getPeer(0)).query;
        const founderQuery = h.control(founder).query;
        let live = 0;
        try {
            await h.transition.advanceState({ count: 1, waitForPeers: [0, 1] });
            live = Number(
                await participant.getLatestBlockHeight(forkId).request()
            );
            // the first block of the channel
            expect(live).to.equal(0);
            await waitFor(async () =>
                (await readLiveBlockRetention(h, founder)).deliveries.some(
                    (delivery) =>
                        delivery.forkId === forkId && delivery.height === live
                )
            );
            const held = await readLiveBlockRetention(h, founder);
            expect(held.retainedCount).to.be.greaterThan(0);
            expect(
                held.deliveries.flatMap((delivery) => delivery.intakes)
            ).to.deep.equal([]);
            expect(
                isEngagedStatus(await founderQuery.getStatus().request())
            ).to.equal(false);
        } finally {
            await release();
        }

        await h.event.waitUntilPeerStatus(founder.index, Status.PARTICIPATING);
        await waitFor(
            async () =>
                Number(
                    await founderQuery.getLatestBlockHeight(forkId).request()
                ) === live,
            h.event.protocolEventTimeoutMs()
        );
        const after = await readLiveBlockRetention(h, founder);
        const firstIntake = after.deliveries
            .filter(
                (delivery) =>
                    delivery.forkId === forkId && delivery.height === live
            )
            .flatMap((delivery) =>
                delivery.intakes.map((intake) => ({ delivery, intake }))
            )
            .sort((a, b) => a.intake.sequence - b.intake.sequence)[0];
        // the block first reached intake as the guard's re-run, released by
        // the genesis install moving the founder straight to PARTICIPATING
        expect(firstIntake, "live block intake").to.not.be.undefined;
        expect(isEngagedStatus(firstIntake.delivery.arrivalStatus)).to.equal(
            false
        );
        expect(firstIntake.intake.run).to.equal(2);
        expect(firstIntake.intake.status).to.equal(Status.PARTICIPATING);
        expect(after.retainedCount).to.equal(0);
        await MathTestSession.settleDetached();
    });
});
