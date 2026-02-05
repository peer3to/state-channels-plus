import { HarnessBlock } from "./HarnessBlock";
import { HarnessOptions } from "@test/fixtures/PeerTestHarness";

/**
 * Setup namespace containing blocks for harness initialization
 */
export class Setup {
    /**
     * Initialize the harness with N peers
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Setup.peers(3)
     * );
     * ```
     */
    static peers(numPeers: number, options?: HarnessOptions<any>) {
        return new HarnessBlock(async (harness) => {
            await harness.setup(numPeers, options);
            return harness;
        });
    }
}
