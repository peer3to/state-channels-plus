import { HarnessBlock } from "./HarnessBlock";

/**
 * Context namespace - Blocks for storing and managing test context
 *
 * These blocks store information on the harness for use by later blocks
 * in the composition chain.
 */
export class Context {
    /**
     * Mark specific peers as honest (excluding a malicious peer)
     */
    static markMaliciousPeer(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
    }) {
        const { maliciousPeerIndex, honestPeerIndices } = options;

        return new HarnessBlock(async (harness) => {
            const totalPeers = harness.peers.length;
            const honest =
                honestPeerIndices ||
                Array.from({ length: totalPeers }, (_, i) => i).filter(
                    (i) => i !== maliciousPeerIndex
                );

            // Store for later use in assertions/transitions
            harness.context.honestPeerIndices = honest;
            harness.context.maliciousPeerIndex = maliciousPeerIndex;

            return harness;
        });
    }

    /**
     * Update the active fork ID after fork resolution
     */
    static updateActiveFork() {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices || honestIndices.length === 0) {
                throw new Error(
                    "honestPeerIndices not set - use Context.markMaliciousPeer first"
                );
            }

            const newForkId =
                harness.peers[honestIndices[0]].stateManager.forkId;
            harness.context.newForkId = newForkId;
            harness.activeForkId = newForkId;

            return harness;
        });
    }

    /**
     * Capture the current snapshot count for a specific peer
     */
    static captureSnapshotCount(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const snapshotStorage = peer.stateManager.storage
                .stateSnapshots as any;
            const count = Array.from(
                snapshotStorage.snapshotsByHash.keys()
            ).length;

            (harness.context as any)[`peer${peerIndex}SnapshotCountBefore`] =
                count;

            return harness;
        });
    }
}
