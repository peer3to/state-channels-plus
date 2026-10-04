import { assertHistoricalProofAfterSlash } from "@test/fixtures/QueueProofOriginsFixture";

describe("E2E: Queue proof origins", () => {
    it("historical dispute replay retains its full participant union after a signer is slashed", async () => {
        await assertHistoricalProofAfterSlash();
    });
});
