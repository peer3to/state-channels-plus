import {
    assertHistoricalProofAfterSlash,
    assertMalformedRequiredProofRejected
} from "@test/fixtures/QueueProofOriginsFixture";

describe("E2E: Queue proof origins", () => {
    it("historical dispute replay retains its full participant union after a signer is slashed", async () => {
        await assertHistoricalProofAfterSlash();
    });
    it("malformed required evidence reaches the objective verifier and kills the dispute", async () => {
        await assertMalformedRequiredProofRejected();
    });
});
