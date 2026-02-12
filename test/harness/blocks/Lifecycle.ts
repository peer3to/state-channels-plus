import { HarnessBlock } from "./HarnessBlock";
import { HarnessOptions } from "@test/fixtures/PeerTestHarness";
import { Signer } from "ethers";

/**
 * Lifecycle namespace - Blocks for harness setup, channel lifecycle, and peer management
 *
 * This covers the full lifecycle:
 * - Setup: Initialize harness with peers
 * - Channel: Open/close channels
 * - Peer: Add/remove peers dynamically
 */
export class Lifecycle {
    /**
     * Initialize the harness with N peers
     */
    static setup(numPeers: number, options?: HarnessOptions<any>) {
        return new HarnessBlock(async (harness) => {
            await harness.setup(numPeers, options);
            return harness;
        });
    }

    /**
     * Open a channel with all current peers
     */
    static openChannel() {
        return new HarnessBlock(async (harness) => {
            const forkId = await harness.channelActions.openChannel();
            harness.activeForkId = forkId;
            return harness;
        });
    }

    /**
     * Add a new peer after the harness is already set up
     */
    static addPeer(signer?: Signer) {
        return new HarnessBlock(async (harness) => {
            await harness.addPeer(signer);
            return harness;
        });
    }

    /**
     * Manually trigger connection attempts for all peers
     *
     * Useful for tests that need precise control over connection timing,
     * especially when using autoConnect: false.
     *
     * Architecture: Block -> uses harness.peers array directly (no action needed)
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.startChannel(2, 0, { autoConnect: false }),
     *     Lifecycle.triggerConnections(),
     *     // ... test connection behavior
     * );
     * ```
     */
    static triggerConnections() {
        return new HarnessBlock(async (harness) => {
            for (const peer of harness.peers) {
                peer.stateManager.p2pManager.tryOpenConnectionToChannel(
                    harness.channelId!.toString()
                );
            }
            return harness;
        });
    }
}
