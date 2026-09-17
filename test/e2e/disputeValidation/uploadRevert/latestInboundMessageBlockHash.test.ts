import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / latestInboundMessageBlockHash", function () {
    it("dispute.input.latestInboundMessageBlockHash below the chain inbound head → RaceConditionDisputeInboundNotLatest", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const forkId = h.activeForkId!;
        const disputer = h.getPeer(0);

        const { dispute, disputeConfirmation } =
            await h.dispute.fetchConstructedDispute(disputer.index, forkId);
        // the genesis anchor sits below the open's inbound block, the chain's inbound head
        dispute.input.latestInboundMessageBlockHash = ethers.ZeroHash;
        dispute.input.lastInboundMessageBlockHeight = 0n;
        dispute.postedAuditingData = false;
        await h.tamper.resignDispute(
            disputer.signer,
            dispute,
            disputeConfirmation
        );

        const inboundHead = await h.channelManager.getChannelBalance(
            h.channelId
        );
        expect(
            inboundHead.latestInboundMessageBlockHeight > 0n,
            "the open appended an inbound block"
        ).to.equal(true);

        const contract = disputer.p2pInstance.stateChannelManagerContract;
        await expect(contract.uploadDispute(disputeConfirmation))
            .to.be.revertedWithCustomError(
                contract,
                "RaceConditionDisputeInboundNotLatest"
            )
            .withArgs(
                inboundHead.latestInboundMessageBlockHash,
                ethers.ZeroHash
            );
        expect(
            await h.channelManager.getDisputeWindowCreationTimestamp(
                h.channelId,
                forkId
            )
        ).to.equal(0n);
    });

    // junk anchors (random hash, genesis hash with height > 0) hit this same gate
});
