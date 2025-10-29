import { ForkId, Address } from "@/types/types";
import { Logger } from "@/utils";

export class SyncCoordinator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child({ component: "SyncCoordinator" });
    }

    /**
     * Wait for all peers to have the same latest block (same hash and height)
     */
    public async waitForPeersInSync(
        peers: Array<{ stateManager: any; address: Address }>,
        forkId: ForkId,
        timeoutMs: number = 8000
    ): Promise<void> {
        const startTime = Date.now();

        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs
        });

        while (Date.now() - startTime < timeoutMs) {
            const firstBlock =
                peers[0].stateManager.storage.blocks.getLatestBlock(forkId);

            if (firstBlock) {
                let allSynced = true;

                for (let i = 1; i < peers.length; i++) {
                    const peerBlock =
                        peers[i].stateManager.storage.blocks.getLatestBlock(
                            forkId
                        );
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
                        `All ${peers.length} peers synchronized`,
                        {
                            blockHash: firstBlock.hash,
                            height: firstBlock.height
                        }
                    );
                    return;
                }
            }

            await this.sleep(50); // Check every 50ms
        }

        // Enhanced error reporting on timeout
        const peerStates = peers.map((peer, i) => {
            const block =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            return `Peer ${i}: ${block ? `hash=${block.hash} height=${block.height}` : "no_block"}`;
        });

        throw new Error(
            `Peers failed to synchronize within ${timeoutMs}ms. States: ${peerStates.join("; ")}`
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export default SyncCoordinator;
