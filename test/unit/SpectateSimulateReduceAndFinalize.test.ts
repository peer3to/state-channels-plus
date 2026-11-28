import {
    appendForgedInboundSuccessor,
    redirectDisputesToChannelWithoutWindow,
    redirectDisputesToForkWithoutWindow,
    stageChainWindowReduction
} from "@test/fixtures/DisputeWindowInboundSyncStaging";
import { reduceWindowOnChain } from "@test/fixtures/PinnedSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

describe("Unit: SpectateService simulateReduceAndFinalize", function () {
    it("expired unreduced window with its served inputs → true, the chain window stays unreduced", async function () {
        const staged = await stageChainWindowReduction(
            TestSession.getHarness()
        );
        expect(await staged.reduce(staged.payload)).to.equal(true);
        // an eth_call commits nothing
        expect(await staged.chainReducedForkId()).to.equal(ethers.ZeroHash);
    });

    it("window the chain reduced to the expected fork → false", async function () {
        const h = TestSession.getHarness();
        const staged = await stageChainWindowReduction(h);
        await reduceWindowOnChain(h, 0, staged.sourceForkId);
        // premise: the chain reduced the window to the served fork
        expect(await staged.chainReducedForkId()).to.equal(
            staged.reducedForkId
        );
        expect(await staged.reduce(staged.payload)).to.equal(false);
    });

    it("window the chain reduced to another fork than expected → throws the expectation mismatch, the chain keeps its fork", async function () {
        const h = TestSession.getHarness();
        const staged = await stageChainWindowReduction(h);
        await reduceWindowOnChain(h, 0, staged.sourceForkId);
        staged.payload.disputeWindows[0].reducedForkId = ethers.id(
            "not the reduced fork"
        );
        await expect(staged.reduce(staged.payload)).to.be.rejectedWith(
            "RaceConditionReductionExpectationDoesntMatch"
        );
        expect(await staged.chainReducedForkId()).to.equal(
            staged.reducedForkId
        );
    });

    it("disputes naming a fork without a dispute window → false, the chain window stays unreduced", async function () {
        const staged = await stageChainWindowReduction(
            TestSession.getHarness()
        );
        redirectDisputesToForkWithoutWindow(staged.payload);
        expect(await staged.reduce(staged.payload)).to.equal(false);
        expect(await staged.chainReducedForkId()).to.equal(ethers.ZeroHash);
    });

    it("disputes naming a channel without a dispute window → false, the chain window stays unreduced", async function () {
        const staged = await stageChainWindowReduction(
            TestSession.getHarness()
        );
        redirectDisputesToChannelWithoutWindow(staged.payload);
        expect(await staged.reduce(staged.payload)).to.equal(false);
        expect(await staged.chainReducedForkId()).to.equal(ethers.ZeroHash);
    });

    it("inbound list with a fabricated successor → throws the inbound validation revert", async function () {
        const staged = await stageChainWindowReduction(
            TestSession.getHarness()
        );
        appendForgedInboundSuccessor(staged.payload);
        await expect(staged.reduce(staged.payload)).to.be.rejectedWith(
            "ErrorDisputeInboundMessageBlocksInvalid"
        );
    });

    it("unreduced window in its kill period → throws the kill period revert, the chain window stays unreduced", async function () {
        const h = TestSession.getHarness();
        const staged = await stageChainWindowReduction(h, {
            killPeriod: "open"
        });
        await expect(staged.reduce(staged.payload)).to.be.rejectedWith(
            "RaceConditionDisputeKillPeriodNotExpired"
        );
        // premise: the kill period was still open after the call
        expect(
            (await h.query.killPeriod(staged.sourceForkId, 2)).isExpired
        ).to.equal(false);
        expect(await staged.chainReducedForkId()).to.equal(ethers.ZeroHash);
    });
});
