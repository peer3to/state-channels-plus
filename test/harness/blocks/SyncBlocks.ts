import { HarnessBlock } from "./HarnessBlock";
import { WaitForPeersInSyncOptions } from "@test/utils/SyncCoordinator";

/**
 * Sync namespace containing blocks for synchronization operations
 */
export class Sync {
    /**
     * Wait for all peers to synchronize
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Setup.peers(3),
     *     Channel.open(),
     *     Transition.valid(c => c.add(1)),
     *     Sync.wait()
     * );
     * ```
     */
    static wait(options?: WaitForPeersInSyncOptions) {
        return new HarnessBlock(async (harness) => {
            await harness.syncActions.waitForSync(options);
            return harness;
        });
    }

    /**
     * Wait for a specific subset of peers to synchronize
     */
    static waitForPeers(peerIndices: number[], options?: { timeout?: number }) {
        return new HarnessBlock(async (harness) => {
            await harness.syncActions.waitForSync({
                peerIndices,
                timeout: options?.timeout
            });
            return harness;
        });
    }
}
