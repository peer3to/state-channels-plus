import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { Status } from "@/types";

describe("E2E: Force Join Dispute", function () {
    it("should trigger force-join dispute after N turns of non-inclusion, then resolve with joiner PARTICIPATING", async function () {
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

        await h.join.joinChannelWait({
            joiner,
            existingParticipantSigners: [h.peers[0].signer, h.peers[1].signer]
        });
        expect(await h.getPeerHandle(joiner.index).queryStatus()).to.equal(
            Status.PENDING_PARTICIPANT,
            "Joiner should be PENDING_PARTICIPANT after joinChannel"
        );

        // Advance N=3 blocks (peers 0/1 produce blocks without the join message)
        //  on the 3rd block, the force-join dispute is triggered

        await h.transition.advanceState({ count: 3 });

        // Restore stubs before canConstructMoreEvidence runs: peers 0/1 now read
        // the real getLatestBlockHash() (join message hash) so their constructDispute
        // matches the joiner's committed dispute → canConstructMoreEvidence = false
        await restoreInboundInclusion0();
        await restoreInboundInclusion1();

        await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });

        expect(await h.getPeerHandle(joiner.index).queryStatus()).to.equal(
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
                .getPeerHandle(peer.index)
                .queryParticipants();
            expect(new Set(actual)).to.deep.equal(
                expected,
                `Peer ${peer.index} on-chain participants should match 3-player fork after reduction`
            );
        }
    });
});
