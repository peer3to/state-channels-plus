import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger } from "@/utils";
import { TransitionContract } from "../blocks/Transition";

export type TransitionOptions = {
    waitForSync?: boolean;
    waitForPeers?: number[];
    waitForTurn?: boolean;
};

/**
 * Handles state transition operations on the state machine
 */
export class TransitionActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Submit a valid transaction from the next peer to write
     */
    async submitNext(
        txFn: (contract: TransitionContract) => Promise<any>,
        options: TransitionOptions = { waitForTurn: true, waitForSync: true }
    ): Promise<any> {
        const nextPeer = await this.getNextPeerToWrite();

        if (options.waitForTurn) {
            await this.waitForTurn(nextPeer);
        }

        return this.submit(nextPeer, txFn, {
            waitForSync: options.waitForSync ?? true,
            waitForPeers: options.waitForPeers,
            waitForTurn: false // already waited above
        });
    }

    async increment(value: number = 1, options?: TransitionOptions) {
        return this.submitNext((contract) => contract.add(value), options);
    }

    /**
     * Submit a transaction from a specific peer
     */
    async submit(
        peer: TestPeer,
        txFn: (contract: TransitionContract) => Promise<any>,
        options: TransitionOptions = { waitForSync: true }
    ): Promise<any> {
        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (options.waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const peers = this.harness.getFilteredPeers(options.waitForPeers);
            await this.harness.syncCoordinator.waitForPeersToSync(
                peers,
                forkId
            );
        }

        return result;
    }

    private async getNextPeerToWrite(): Promise<TestPeer> {
        return this.harness.stateQuery.getNextPeerToWrite();
    }

    /**
     * Wait for a peer to receive their turn
     */
    private async waitForTurn(peer: TestPeer, timeoutMs = 3000): Promise<void> {
        try {
            await peer.turnBarrier.waitFor(
                () => peer.stateManager.isMyTurn?.() ?? false,
                {
                    timeoutMs,
                    timeoutMessage: `Turn not received within ${timeoutMs}ms`
                }
            );
            this.logger.debug(`Peer ${peer.index} turn`);
        } catch (e) {
            this.logger.error(`Peer ${peer.index} turn wait timed out`);
            throw e;
        }
    }
}
