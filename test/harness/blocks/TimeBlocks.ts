import { HarnessBlock } from "./HarnessBlock";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Time namespace containing blocks for time manipulation
 */
export class Time {
    /**
     * Advance blockchain time by N seconds
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Setup.peers(3),
     *     Channel.open(),
     *     Time.advance(100)
     * );
     * ```
     */
    static advance(seconds: number) {
        return new HarnessBlock(async (harness) => {
            await time.increase(seconds);
            return harness;
        });
    }

    /**
     * Advance to a specific timestamp
     */
    static advanceTo(timestamp: number) {
        return new HarnessBlock(async (harness) => {
            await time.increaseTo(timestamp);
            return harness;
        });
    }

    /**
     * Wait for N milliseconds
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Network.stubBroadcast(1),
     *     Transition.fromPeer(1, c => c.add(10), { waitForSync: false }),
     *     Time.wait(500),  // Let peer process the block
     *     Assert.peerBlockHeightGreaterThan(1, 2)
     * );
     * ```
     */
    static wait(milliseconds: number) {
        return new HarnessBlock(async (harness) => {
            await new Promise((resolve) => setTimeout(resolve, milliseconds));
            return harness;
        });
    }
}
