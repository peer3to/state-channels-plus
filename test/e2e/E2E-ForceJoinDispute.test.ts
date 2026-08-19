import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";

describe("E2E: Force Join Dispute", function () {
    it("should force an omitted join into the reduced fork and schedule the joiner as an author", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(2, 2);

        const joiner = await h.join.addSpectatorWait({
            statusTimeoutMs: 5000,
            statusTimeoutMessage: "Joiner did not reach SYNCED"
        });
        await h.assert.sync.peersInSyncWait();

        const restoreInboundInclusion0 =
            await h.byzantine.stubPendingInboundInclusion(0);
        const restoreInboundInclusion1 =
            await h.byzantine.stubPendingInboundInclusion(1);

        await h.join.joinChannelWait({ joiner });
        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(
            Status.PENDING_PARTICIPANT,
            "Joiner should be PENDING_PARTICIPANT after joinChannel"
        );

        // Advance N=3 blocks (peers 0/1 produce blocks without the join message)
        //  on the 3rd block, the force-join dispute is triggered

        const forkId = h.activeForkId!;
        await h.transition.advanceState({ count: 3 });

        // Block assembly can include pending inbound messages again. Dispute
        // construction always reads the real inbound head while this stub is
        // active.
        await restoreInboundInclusion0();
        await restoreInboundInclusion1();

        const { newForkId } = await h.dispute.resolveDisputeWait({
            forkId,
            forkSettleTimeoutMs: 15000
        });

        expect(
            await h.control(h.getPeer(joiner.index)).query.getStatus().request()
        ).to.equal(
            Status.PARTICIPATING,
            "Joiner should be PARTICIPATING after force-join dispute resolves via reduction"
        );

        const expected = new Set([
            h.peers[0].address,
            h.peers[1].address,
            joiner.address
        ]);
        for (const peer of h.peers) {
            const actual = await h
                .control(peer)
                .query.getParticipants()
                .request();
            expect(new Set(actual)).to.deep.equal(
                expected,
                `Peer ${peer.index} on-chain participants should match 3-player fork after reduction`
            );
        }

        let joinerAuthored = false;
        for (let i = 0; i < expected.size; i++) {
            const nextToWrite = await h
                .control(h.getPeer(0))
                .query.getNextToWrite()
                .request();
            await h.transition.advanceState({ count: 1 });
            if (nextToWrite.toLowerCase() !== joiner.address.toLowerCase()) {
                continue;
            }

            const latestBlock = await h
                .control(h.getPeer(0))
                .query.getLatestBlockInfo(newForkId)
                .request();
            expect(latestBlock).to.not.equal(null);
            expect(latestBlock!.author.toLowerCase()).to.equal(
                joiner.address.toLowerCase()
            );
            joinerAuthored = true;
        }
        expect(joinerAuthored).to.equal(
            true,
            "the reduced joiner must receive and complete an authoring turn"
        );
    });
});
