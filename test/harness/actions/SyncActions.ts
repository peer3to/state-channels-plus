import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import SyncCoordinator, {
    WaitForPeersInSyncOptions
} from "@test/utils/SyncCoordinator";

/**
 * Handles synchronization operations between peers
 */
export class SyncActions {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Wait for all peers (or a subset) to synchronize to the current fork state
     */
    async waitForSync(options?: WaitForPeersInSyncOptions): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - cannot wait for sync");
        }

        const syncCoordinator = new SyncCoordinator(this.logger);
        await syncCoordinator.waitForPeersInSync(this.harness.peers, forkId, {
            ...options,
            eventBarrier: this.harness.eventCountsBarrier // Use event barrier for signal-based waiting
        });
    }
}
