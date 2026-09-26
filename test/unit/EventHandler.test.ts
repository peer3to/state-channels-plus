import {
    assertEvidenceImprovementLostRaceTolerated,
    assertLostEvidenceRaceTolerated
} from "@test/fixtures/LostEvidenceRaceStaging";
import { MathTestSession as TestSession } from "@test/harness";

describe("Unit: EventHandler", function () {
    describe("replacement evidence races", function () {
        it("a real slash on an undisputed fork whose replacement evidence loses the race completes its event", async function () {
            await assertLostEvidenceRaceTolerated(
                TestSession.getHarness(),
                "onChainSlashed"
            );
        });

        it("a real kill that empties the window whose replacement evidence loses the race completes its event", async function () {
            await assertLostEvidenceRaceTolerated(
                TestSession.getHarness(),
                "onDisputeKilled"
            );
        });

        it("a committed dispute whose evidence-improvement upload loses the race still schedules the reduction", async function () {
            await assertEvidenceImprovementLostRaceTolerated(
                TestSession.getHarness()
            );
        });
    });
});
