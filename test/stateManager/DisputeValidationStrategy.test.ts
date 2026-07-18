import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("DisputeValidationStrategy", function () {
    it("returns false only for DISPUTE and throws impossible results", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const matrix = await h
            .control(h.getPeer(0))
            .stub.probeDisputeStrategyResultMatrix()
            .request();

        expect(matrix.SUCCESS).to.equal("true");
        expect(matrix.DUPLICATE).to.equal("true");
        expect(matrix.DISPUTE).to.equal("false");
        expect(matrix.NOT_READY).to.equal("throw");
        expect(matrix.DISCONNECT).to.equal("throw");
        expect(matrix.BROADCAST).to.equal("throw");
        expect(matrix.NOT_ENOUGH_TIME).to.equal("throw");
    });

    it("continues a local not-linked replay when committed structure is clean", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();
        const result = await h
            .control(h.getPeer(0))
            .stub.probeCleanCommittedDivergence()
            .request();

        expect(result.result).to.equal("SUCCESS");
        expect(result.proofStored).to.equal(false);
    });

    it("continues outsider checks when participant snapshots are unavailable", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();
        const result = await h
            .control(h.getPeer(0))
            .stub.probeMissingParticipantSnapshots()
            .request();

        expect(result.earlyAuthorResult).to.equal("SUCCESS");
        expect(result.signatureUnionResult).to.equal("SUCCESS");
        expect(result.proofStored).to.equal(false);
    });
});
