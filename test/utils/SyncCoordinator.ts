import { ForkId } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { TestPeer } from "@test/harness/core/types";

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
    public async waitForPeersToSync(
        peers: TestPeer[],
        forkId: ForkId,
        timeoutMs = 8000
    ): Promise<void> {
        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs,
            peerIndices: peers.map((p) => p.index),
            useEventBarrier: !!this.eventBarrier
        });

        const checkSync = () => {
            if (peers.length === 0) return true;

            const blocks = peers.map((peer) =>
                peer.stateManager.storage.blocks.getLatestBlock(forkId)
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
        const peerStates = peers.map((peer) => {
            const block =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            return `Peer ${peer.index}: ${block ? `hash=${block.hash} height=${block.height}` : "no_block"}`;
        });

        throw new Error(
            `Peers at indices [${peers.map((p) => p.index).join(", ")}] failed to synchronize within ${timeoutMs}ms. States: ${peerStates.join("; ")}`
        );
    }
}

export default SyncCoordinator;
