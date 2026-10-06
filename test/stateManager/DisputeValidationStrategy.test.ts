import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("DisputeValidationStrategy", function () {
    it("returns false only for DISPUTE and throws impossible results", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const matrix = await h
            .control(h.getPeer(0))
            .validation.probeDisputeStrategyResultMatrix()
            .request();

        expect(matrix.SUCCESS).to.equal("true");
        expect(matrix.DUPLICATE).to.equal("true");
        expect(matrix.DISPUTE).to.equal("false");
        expect(matrix.NOT_READY).to.equal("throw");
        expect(matrix.DISCONNECT).to.equal("throw");
        expect(matrix.BROADCAST).to.equal("throw");
        expect(matrix.NOT_ENOUGH_TIME).to.equal("throw");
    });

    it("outsider author without the executed participant snapshots -> the signature-union check throws", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();
        const failure = await h
            .control(h.getPeer(0))
            .validation.probeMissingParticipantSnapshots()
            .request()
            .then(
                () => null,
                (error: unknown) =>
                    error instanceof Error ? error.message : String(error)
            );

        // the ingest pipeline always passes the snapshots it executed: their
        // absence is a bug, not a reason to skip the outsider check
        expect(failure).to.contain(
            "notAllSingersAreParticipants needs the executed participant snapshots"
        );
    });
});
