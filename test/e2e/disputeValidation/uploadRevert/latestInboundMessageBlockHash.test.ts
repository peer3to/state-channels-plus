import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / latestInboundMessageBlockHash", function () {
    it("dispute.input.lastInboundMessageBlockHeight below the consumed inbound → RaceConditionDisputeInboundNotLatest", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);
        const forkId = h.activeForkId!;
        const disputer = h.getPeer(0);

        const { dispute, disputeConfirmation } =
            await h.dispute.fetchConstructedDispute(disputer.index, forkId);
        // the genesis anchor sits below the open's inbound block, which the
        // chain snapshot already consumed
        dispute.input.latestInboundMessageBlockHash = ethers.ZeroHash;
        dispute.input.lastInboundMessageBlockHeight = 0n;
        dispute.postedAuditingData = false;
        await h.tamper.resignDispute(
            disputer.signer,
            dispute,
            disputeConfirmation
        );

        const consumedHeight = (
            await h.channelManager.getStateSnapshot(h.channelId)
        ).snapshotData.latestInboundMessageBlockHeight;
        expect(
            consumedHeight > 0n,
            "the open consumed an inbound block"
        ).to.equal(true);

        const contract = disputer.p2pInstance.stateChannelManagerContract;
        await expect(contract.uploadDispute(disputeConfirmation))
            .to.be.revertedWithCustomError(
                contract,
                "RaceConditionDisputeInboundNotLatest"
            )
            .withArgs(consumedHeight, 0n);
        expect(
            await h.channelManager.getDisputeWindowCreationTimestamp(
                h.channelId,
                forkId
            )
        ).to.equal(0n);
    });

    // dispute.input.latestInboundMessageBlockHash junk variants (non-genesis hash, or
    // genesis hash with height>0) are exercised in disputeInputFields/inboundHash.test.ts —
    // they trigger DisputeInboundHashNotInChain via the fraud-proof pipeline, not via
    // upload revert, so they live under the field-level coverage tree.
});
