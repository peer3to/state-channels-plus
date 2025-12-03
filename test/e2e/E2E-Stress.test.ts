import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types";

describe.skip("E2E: LocalDiscoveryServer Stress", function () {
    it("should avoid LocalDiscoveryServer port collisions under rapid reuse", async function () {
        const iterations = 10;
        this.timeout(12_000);

        for (let i = 0; i < iterations; i++) {
            const harness = new PeerTestHarness<MathStateMachine>();
            try {
                await harness.setup(3);
                await harness.openChannel();

                expect(harness.peers.length).to.equal(
                    3,
                    `Iteration ${i} should bootstrap 3 peers`
                );
            } finally {
                await harness.cleanup();
            }
        }
    });
});
