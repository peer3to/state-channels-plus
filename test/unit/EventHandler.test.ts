import { assertLostEvidenceRaceTolerated } from "@test/fixtures/LostEvidenceRaceStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("Unit: EventHandler", function () {
    describe("replacement evidence races", function () {
        it("a chain slash whose replacement evidence loses the race leaves the handler successful", async function () {
            await assertLostEvidenceRaceTolerated(
                TestSession.getHarness(),
                "onChainSlashed"
            );
        });

        it("a killed dispute whose replacement evidence loses the race leaves the handler successful", async function () {
            await assertLostEvidenceRaceTolerated(
                TestSession.getHarness(),
                "onDisputeKilled"
            );
        });
    });
});
