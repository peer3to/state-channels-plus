import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";

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
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Submit a valid transaction from the next peer to write
     */
    async submitNext(
        txFn: (contract: any) => Promise<any>,
        options: TransitionOptions = { waitForTurn: true, waitForSync: true }
    ): Promise<void> {
        const nextPeer = await this.getNextPeerToWrite();

        if (options.waitForTurn) {
            await this.waitForTurn(nextPeer);
        }

        await this.submit(nextPeer, txFn, {
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
        peer: TestPeer<any, any>,
        txFn: (contract: any) => Promise<any>,
        options: TransitionOptions = { waitForSync: true }
    ): Promise<void> {
        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (options.waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            await this.harness.syncCoordinator.waitForPeersInSync(
                this.harness.peers,
                forkId,
                {
                    peerIndices: options.waitForPeers
                }
            );
        }

        return result;
    }

    private async getNextPeerToWrite(): Promise<TestPeer<any, any>> {
        return this.harness.stateQuery.getNextPeerToWrite();
    }

    /**
     * Wait for a peer to receive their turn
     */
    private async waitForTurn(
        peer: TestPeer<any, any>,
        timeoutMs = 3000
    ): Promise<void> {
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
