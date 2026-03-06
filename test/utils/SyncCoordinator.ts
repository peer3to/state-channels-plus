import { ForkId, Hash } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
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
     * Optionally wait for N/N signatures (finalization) as well
     */
    public async waitForPeersToSync(
        peers: TestPeer[],
        forkId: ForkId,
        options?: {
            timeoutMs?: number;
            blockHashInStorage?: Hash;
            waitForFinalization?: boolean;
        }
    ): Promise<void> {
        const { timeoutMs = 8000, blockHashInStorage, waitForFinalization = false } = options || {};
        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs,
            peerIndices: peers.map((p) => p.index),
            useEventBarrier: !!this.eventBarrier
        });

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const blocks = peers.map((peer) =>
                blockHashInStorage
                    ? peer.stateManager.storage.blocks.getBlock(
                          blockHashInStorage
                      )
                    : peer.stateManager.storage.blocks.getLatestBlock(forkId)
            );

            if (blocks.some((b) => !b)) {
                if (blocks.every((b) => b === undefined)) return true; // All peers have no blocks yet ->
                return false;
            }

            const firstHash = blocks[0]!.hash;
            const firstHeight = blocks[0]!.height;

            // Check block sync (same hash and height)
            const blocksInSync = blocks.every(
                (b) => b!.hash === firstHash && b!.height === firstHeight
            );

            if (!blocksInSync) return false;

            if (waitForFinalization) {
                // First check N/N signatures
                let totalParticipants: number;
                try {
                    const participants =
                        await peers[0].stateManager.diamondStateMachine.getParticipants();
                    totalParticipants = participants.length;
                } catch (error) {
                    this.logger.error(`Failed to get participants`, { error });
                    return false;
                }

                for (const block of blocks) {
                    const actualSignatures = block!.allSignatures.size;

                    if (actualSignatures < totalParticipants) return false;
                }
            }

            return true;
        };

        let barrierError: EventBarrierCapturedError | undefined;
        try {
            await this.eventBarrier.waitFor(checkSync, {
                timeoutMs,
                timeoutMessage: waitForFinalization
                    ? `Peers failed to sync and finalize within ${timeoutMs}ms`
                    : `Peers failed to sync within ${timeoutMs}ms`
            });
            return;
        } catch (error) {
            barrierError = error as EventBarrierCapturedError;
        }

        // Enhanced error reporting on timeout
        const peerStates = peers.map((peer) => {
            const block =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            return `Peer ${peer.index}: ${block ? `hash=${block.hash} height=${block.height}` : "no_block"}`;
        });

        const syncError = new Error(
            `Peers at indices [${peers.map((p) => p.index).join(", ")}] failed to synchronize within ${timeoutMs}ms. States: ${peerStates.join("; ")}`
        ) as EventBarrierCapturedError;
        syncError.capturedBarrierStack = barrierError?.capturedBarrierStack;
        throw syncError;
    }
}

export default SyncCoordinator;
