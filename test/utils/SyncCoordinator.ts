import { ForkId, Address } from "@/types/types";
import { Logger } from "@/utils";

export type WaitForPeersInSyncOptions = {
    timeout?: number;
    peerIndices?: number[];
};

export class SyncCoordinator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child({ component: "SyncCoordinator" });
    }

    /**
     * Wait for all peers (or specific peer indices) to have the same latest block (same hash and height)
     */
    public async waitForPeersInSync(
        peers: Array<{ stateManager: any; address: Address }>,
        forkId: ForkId,
        options: WaitForPeersInSyncOptions = {}
    ): Promise<void> {
        const { timeout, peerIndices } = options;
        const timeoutMs = timeout ?? 8000;
        const indicesToCheck =
            peerIndices ?? Array.from({ length: peers.length }, (_, i) => i);
        const startTime = Date.now();

        this.logger.verbose(
            `Waiting for ${indicesToCheck.length} peers to sync`,
            {
                forkId,
                timeout: timeoutMs,
                peerIndices: peerIndices ? indicesToCheck : "all"
            }
        );

        while (Date.now() - startTime < timeoutMs) {
            if (indicesToCheck.length === 0) return;

            const firstPeerIndex = indicesToCheck[0];
            const firstBlock =
                peers[
                    firstPeerIndex
                ].stateManager.storage.blocks.getLatestBlock(forkId);

            if (firstBlock) {
                let allSynced = true;

                for (let i = 1; i < indicesToCheck.length; i++) {
                    const peerIndex = indicesToCheck[i];
                    const peerBlock =
                        peers[
                            peerIndex
                        ].stateManager.storage.blocks.getLatestBlock(forkId);
                    if (
                        !peerBlock ||
                        peerBlock.hash !== firstBlock.hash ||
                        peerBlock.height !== firstBlock.height
                    ) {
                        allSynced = false;
                        break;
                    }
                }

                if (allSynced) {
                    this.logger.verbose(
                        `${indicesToCheck.length} peers synchronized`,
                        {
                            blockHash: firstBlock.hash,
                            height: firstBlock.height,
                            peerIndices: indicesToCheck
                        }
                    );
                    return;
                }
            }

            await this.sleep(50); // Check every 50ms
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

    public checkPeersInSync(
        peers: Array<{ stateManager: any; address: Address }>,
        forkId: ForkId,
        peerIndices?: number[]
    ): {
        inSync: boolean;
        syncDetails: { peerIndex: number; blockHash: string; height: number }[];
    } {
        const indicesToCheck =
            peerIndices ?? Array.from({ length: peers.length }, (_, i) => i);

        if (indicesToCheck.length < 2) {
            return { inSync: true, syncDetails: [] }; // Less than 2 peers is considered "in sync"
        }

        const syncDetails = indicesToCheck.map((peerIndex) => {
            const block =
                peers[peerIndex].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            return {
                peerIndex,
                blockHash: block?.hash || "no_block",
                height: block?.height || -1
            };
        });

        const firstBlock =
            peers[indicesToCheck[0]].stateManager.storage.blocks.getLatestBlock(
                forkId
            );

        if (!firstBlock) {
            return { inSync: false, syncDetails };
        }

        const allInSync = indicesToCheck.every((peerIndex) => {
            const peerBlock =
                peers[peerIndex].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            return (
                peerBlock &&
                peerBlock.hash === firstBlock.hash &&
                peerBlock.height === firstBlock.height
            );
        });

        return { inSync: allInSync, syncDetails };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export default SyncCoordinator;
