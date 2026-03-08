import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger, sleep } from "@/utils";
import { MathStateMachine } from "@typechain-types/index";
import { StateSnapshot } from "@/models";

export type TransitionContract = MathStateMachine;

export type TransitionOptions = {
    waitForSync?: boolean;
    waitForPeers?: number[];
    waitForTurn?: boolean;
    delayMs?: number;
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
        const nextPeer = await this.harness.query.getNextPeerToWrite();

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

    async advanceState(options?: {
        count?: number;
        rounds?: number;
        txFn?: (contract: TransitionContract) => Promise<any>;
        waitForSync?: boolean;
        waitForPeers?: number[];
        waitForTurn?: boolean;
    }): Promise<void> {
        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peers.length
            : count;

        const transitionOptions = {
            waitForSync: options?.waitForSync,
            waitForPeers: options?.waitForPeers,
            waitForTurn: options?.waitForTurn
        };

        if (options?.txFn) {
            for (let i = 0; i < total; i++) {
                await this.submitNext(options.txFn, transitionOptions);
            }
            return;
        }

        for (let i = 0; i < total; i++) {
            await this.increment(1, transitionOptions);
        }
    }

    async peerWrite(options: {
        peer: number;
        value?: number;
        waitForPeers?: number[];
    }): Promise<void> {
        const { peer, value = 1, waitForPeers } = options;
        const peerObj = this.harness.peers[peer];
        if (!peerObj) {
            throw new Error(`Peer ${peer} not found`);
        }

        await this.submit(peerObj, (contract) => contract.add(value), {
            waitForPeers
        });
    }

    async fromHonestPeersOnly(
        txFn: (contract: TransitionContract) => Promise<any>,
        options?: { waitForSync?: boolean }
    ): Promise<void> {
        const honestIndices = this.harness.getHonestPeers().map((p) => p.index);

        await this.submitNext(txFn, {
            waitForTurn: true,
            waitForPeers: honestIndices,
            waitForSync: options?.waitForSync ?? true
        });
    }

    async sequenceFromHonestPeers(
        txFns: Array<(contract: TransitionContract) => Promise<any>>
    ): Promise<void> {
        const honestIndices = this.harness.getHonestPeers().map((p) => p.index);
        if (!honestIndices) {
            throw new Error(
                "honestPeerIndices not set - resolve dispute context first"
            );
        }

        for (const txFn of txFns) {
            await this.submitNext(txFn, {
                waitForTurn: true,
                waitForPeers: honestIndices,
                waitForSync: true
            });
        }
    }

    async postSnapshot(options?: {
        peerIndex?: number;
        forkId?: string;
    }): Promise<StateSnapshot | undefined> {
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        return await peer.stateManager.postStateSnapshot(forkId);
    }

    async validWithoutPeer(
        excludePeer: number,
        txFn: (contract: TransitionContract) => Promise<any>
    ): Promise<void> {
        const includedPeers = this.harness.peers
            .map((_: unknown, i: number) => i)
            .filter((i: number) => i !== excludePeer);

        await this.submitNext(txFn, {
            waitForPeers: includedPeers,
            waitForSync: true
        });
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

        if (options.delayMs) await sleep(options.delayMs);

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (options.waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const authorLatestBlock =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            const expectedHeight = authorLatestBlock?.height;

            const peers = this.harness.getFilteredOrHonestPeers(
                options.waitForPeers
            );
            await this.harness.syncCoordinator.waitForPeersToSync(
                peers,
                forkId,
                { expectedHeight }
            );
        }

        return result;
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
