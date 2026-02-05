import { ForkId, Address } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import { TestPeer } from "@test/fixtures/PeerTestHarness";

export type WaitForPeersInSyncOptions = {
    timeout?: number;
    peerIndices?: number[];
    eventBarrier?: EventBarrier;
};

/**
 * Handles synchronization operations and assertions for test peers.
 * Provides both async waiting and synchronous checking methods.
 */
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
        options: WaitForPeersInSyncOptions
    ): Promise<void> {
        const { timeout, peerIndices, eventBarrier } = options;
        const timeoutMs = timeout ?? 8000;
        const indicesToCheck =
            peerIndices ?? Array.from({ length: peers.length }, (_, i) => i);

        this.logger.verbose(
            `Waiting for ${indicesToCheck.length} peers to sync`,
            {
                forkId,
                timeout: timeoutMs,
                peerIndices: peerIndices ? indicesToCheck : "all",
                useEventBarrier: !!eventBarrier
            }
        );

        const checkSync = () => {
            if (indicesToCheck.length === 0) return true;

            const firstPeerIndex = indicesToCheck[0];
            const firstBlock =
                peers[
                    firstPeerIndex
                ].stateManager.storage.blocks.getLatestBlock(forkId);

            if (!firstBlock) return false;

            for (let i = 1; i < indicesToCheck.length; i++) {
                const peerIndex = indicesToCheck[i];
                const peerBlock =
                    peers[peerIndex].stateManager.storage.blocks.getLatestBlock(
                        forkId
                    );
                if (
                    !peerBlock ||
                    peerBlock.hash !== firstBlock.hash ||
                    peerBlock.height !== firstBlock.height
                ) {
                    return false;
                }
            }

            this.logger.verbose(`${indicesToCheck.length} peers synchronized`, {
                blockHash: firstBlock.hash,
                height: firstBlock.height,
                peerIndices: indicesToCheck
            });
            return true;
        };

        try {
            await eventBarrier!.waitFor(checkSync, {
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

    /**
     * Check if peers are currently in sync (no waiting)
     */
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

    /**
     * Assert all peers are in sync with state machine state validation
     */
    public assertAllInSync(
        peers: TestPeer<any, any>[],
        forkId: ForkId,
        options: {
            expectedState?: any;
            peerIndices?: number[];
        } = {}
    ): void {
        const { expectedState, peerIndices } = options;
        const indicesToCheck =
            peerIndices ?? Array.from({ length: peers.length }, (_, i) => i);

        if (indicesToCheck.length < 2) {
            throw new Error("Need at least 2 peers to check sync");
        }

        // Check block synchronization
        const syncStatus = this.checkPeersInSync(peers, forkId, peerIndices);

        if (!syncStatus.inSync) {
            const details = syncStatus.syncDetails
                .map(
                    (d) =>
                        `Peer ${d.peerIndex}: hash=${d.blockHash} height=${d.height}`
                )
                .join("; ");
            throw new Error(`Peers not in sync - ${details}`);
        }

        // Check state machine state synchronization
        const { expect } = require("chai");
        const firstPeerIndex = indicesToCheck[0];
        const firstPeerState = this.getStateMachineState(
            peers[firstPeerIndex],
            forkId.toString()
        );

        for (let i = 1; i < indicesToCheck.length; i++) {
            const peerIndex = indicesToCheck[i];
            const peerState = this.getStateMachineState(
                peers[peerIndex],
                forkId.toString()
            );

            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${peerIndex} state does not match Peer ${firstPeerIndex}`
            );
        }

        if (expectedState !== undefined) {
            expect(firstPeerState).to.deep.equal(
                expectedState,
                "Peer states do not match expected state"
            );
        }
    }

    /**
     * Get the current state machine state for a peer
     */
    private getStateMachineState(
        peer: TestPeer<any, any>,
        forkId: string
    ): any {
        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);

        if (!latestBlock) {
            const genesisSnapshot =
                peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    forkId
                );
            return genesisSnapshot ? "genesis" : null;
        }

        const stateSnapshot =
            peer.stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.stateSnapshotHash
            );
        return stateSnapshot ? stateSnapshot.snapshotData : null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export default SyncCoordinator;
