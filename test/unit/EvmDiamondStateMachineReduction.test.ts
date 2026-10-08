import {
    appendForgedInboundSuccessor,
    redirectDisputesToForkWithoutWindow,
    stageLocalWindowReduction
} from "@test/fixtures/DisputeWindowInboundSyncStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

describe("Unit: EvmDiamondStateMachine reduceAndFinalizeLocally", function () {
    it("expired unreduced window with its served inputs → true, the local window records the expected fork", async function () {
        const staged = await stageLocalWindowReduction(
            TestSession.getHarness()
        );
        expect(await staged.reduce(staged.payload)).to.equal(true);
        expect(await staged.localReducedForkId()).to.equal(
            staged.reducedForkId
        );
    });

    it("window already reduced to the expected fork → false, the local window keeps that fork", async function () {
        const staged = await stageLocalWindowReduction(
            TestSession.getHarness()
        );
        expect(await staged.reduce(staged.payload)).to.equal(true);
        expect(await staged.reduce(staged.payload)).to.equal(false);
        expect(await staged.localReducedForkId()).to.equal(
            staged.reducedForkId
        );
    });

    it("window already reduced to another fork than expected → throws the expectation mismatch, the local window keeps its fork", async function () {
        const staged = await stageLocalWindowReduction(
            TestSession.getHarness()
        );
        expect(await staged.reduce(staged.payload)).to.equal(true);
        staged.payload.disputeWindows[0].reducedForkId = ethers.id(
            "not the reduced fork"
        );
        await expect(staged.reduce(staged.payload)).to.be.rejectedWith(
            "RaceConditionReductionExpectationDoesntMatch"
        );
        expect(await staged.localReducedForkId()).to.equal(
            staged.reducedForkId
        );
    });

    it("disputes naming a fork without a dispute window → false, the local window stays unreduced", async function () {
        const staged = await stageLocalWindowReduction(
            TestSession.getHarness()
        );
        redirectDisputesToForkWithoutWindow(staged.payload);
        expect(await staged.reduce(staged.payload)).to.equal(false);
        expect(await staged.localReducedForkId()).to.equal(ethers.ZeroHash);
    });

    it("inbound list with a fabricated successor → throws the inbound validation revert, the local window stays unreduced", async function () {
        const staged = await stageLocalWindowReduction(
            TestSession.getHarness()
        );
        appendForgedInboundSuccessor(staged.payload);
        await expect(staged.reduce(staged.payload)).to.be.rejectedWith(
            "ErrorDisputeInboundMessageBlocksInvalid"
        );
        expect(await staged.localReducedForkId()).to.equal(ethers.ZeroHash);
    });
});
