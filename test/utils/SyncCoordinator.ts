import { ForkId } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { TestPeer } from "@test/harness/core/types";

export type WaitForPeersInSyncOptions = {
    timeout?: number;
    peerIndices?: number[];
};

/**
 * Handles synchronization operations and assertions for test peers.
 * Provides both async waiting and synchronous checking methods.
 */
export class SyncCoordinator {
    private logger: Logger;
    private eventBarrier: EventBarrier;

    constructor(logger: Logger, eventBarrier: EventBarrier) {
        this.logger = logger.child({ component: "SyncCoordinator" });
        this.eventBarrier = eventBarrier;
    }

    /**
     * Wait for all peers (or specific peer indices) to have the same latest block (same hash and height)
     */
    public async waitForPeersInSync(
        peers: TestPeer[],
        forkId: ForkId,
        options: WaitForPeersInSyncOptions
    ): Promise<void> {
        const { timeout, peerIndices } = options;
        const timeoutMs = timeout ?? 8000;
        const indicesToCheck =
            peerIndices ?? Array.from({ length: peers.length }, (_, i) => i);

        this.logger.verbose(
            `Waiting for ${indicesToCheck.length} peers to sync`,
            {
                forkId,
                timeout: timeoutMs,
                peerIndices: peerIndices ? indicesToCheck : "all",
                useEventBarrier: !!this.eventBarrier
            }
        );

        const checkSync = () => {
            if (indicesToCheck.length === 0) return true;

            const blocks = indicesToCheck.map((i) =>
                peers[i].stateManager.storage.blocks.getLatestBlock(forkId)
            );

            if (blocks.some((b) => !b)) {
                if (blocks.every((b) => b === null)) return true; // All peers have no blocks yet ->
                return false;
            }

            const firstHash = blocks[0]!.hash;
            const firstHeight = blocks[0]!.height;

            return blocks.every(
                (b) => b!.hash === firstHash && b!.height === firstHeight
            );
        };

        try {
            await this.eventBarrier.waitFor(checkSync, {
                timeoutMs,
                timeoutMessage: `Peers failed to sync within ${timeoutMs}ms`
            });
            return;
        } catch (error) {
            // Fall through to error reporting
        }

        // Enhanced error reporting on timeout
        const peerStates = indicesToCheck.map((peerIndex) => {
            const block =
                peers[peerIndex].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            return `Peer ${peerIndex}: ${block ? `hash=${block.hash} height=${block.height}` : "no_block"}`;
        });

        throw new Error(
            `Peers at indices [${indicesToCheck.join(", ")}] failed to synchronize within ${timeoutMs}ms. States: ${peerStates.join("; ")}`
        );
    }
}

export default SyncCoordinator;
