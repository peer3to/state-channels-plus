import { HarnessBlock } from "./HarnessBlock";
import SyncCoordinator, {
    WaitForPeersInSyncOptions
} from "@test/utils/SyncCoordinator";

export class Wait {
    /**
     * Wait until peers are in sync
     */
    static untilInSync(
        peerIndices?: number[],
        options?: WaitForPeersInSyncOptions
    ) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const syncOptions = peerIndices
                ? { ...options, peerIndices }
                : options;

            const syncCoordinator = new SyncCoordinator(harness.logger);
            await syncCoordinator.waitForPeersInSync(harness.peers, forkId, {
                ...syncOptions,
                eventBarrier: harness.eventCountsBarrier
            });

            return harness;
        });
    }
}
