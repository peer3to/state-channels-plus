import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger, sleep } from "@/utils";
import { MathStateMachine } from "@typechain-types/index";
import { StateSnapshot } from "@/models";

export type TransitionContract = MathStateMachine;

export type TransitionOptions = {
    waitForSync?: boolean;
    /**
     * Only wait for tip agreement on these harness peer indices. Used when some peers are
     * disconnected or out of scope for the scenario; they are not treated as part of this sync wait.
     * When omitted, {@link waitForFinalization} defaults to true; when set, it defaults to false unless
     * you pass {@link waitForFinalization}: true (e.g. remaining participants should still show full union signatures).
     */
    waitForPeers?: number[];
    waitForTurn?: boolean;
    delayMs?: number;
    /**
     * Require `didEveryoneSignBlock` (full participant union on each waited peer’s view) after tip
     * agreement. Omitted: false if {@link waitForPeers} is set, otherwise true.
     */
    waitForFinalization?: boolean;
};

export function effectiveWaitForFinalization(
    options: Pick<TransitionOptions, "waitForFinalization" | "waitForPeers">
): boolean {
    if (options.waitForFinalization !== undefined) {
        return options.waitForFinalization;
    }
    if (options.waitForPeers !== undefined) {
        return false;
    }
    return true;
}

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
            waitForTurn: false, // already waited above
            waitForFinalization: options.waitForFinalization
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
        waitForFinalization?: boolean;
    }): Promise<void> {
        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peers.length
            : count;

        if (options?.txFn) {
            for (let i = 0; i < total; i++) {
                await this.submitNext(options.txFn, {
                    ...options,
                    waitForFinalization:
                        i === total - 1 ? options?.waitForFinalization : false
                });
            }
            return;
        }

        for (let i = 0; i < total; i++) {
            await this.increment(1, {
                ...options,
                waitForFinalization:
                    i === total - 1 ? options?.waitForFinalization : false
            });
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

        // waitForPeers limits who we barrier on, but we still want union finalization on those peers.
        await this.submitNext(txFn, {
            waitForTurn: true,
            waitForPeers: honestIndices,
            waitForSync: options?.waitForSync ?? true,
            waitForFinalization: true
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
                waitForSync: true,
                // Same as fromHonestPeersOnly: filtered barrier, full finalization on waited peers.
                waitForFinalization: true
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
            waitForSync: true,
            // Exclude one peer from the sync barrier only; still require finalized tips on included peers.
            waitForFinalization: true
        });
    }

    /**
     * Submit a transaction from a specific peer
     */
    async submit(
        peer: TestPeer,
        txFn: (contract: TransitionContract) => Promise<any>,
        options: TransitionOptions = {}
    ): Promise<any> {
        const waitForSync = options.waitForSync ?? true;

        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }

        if (options.delayMs) await sleep(options.delayMs);

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const authorLatestBlock =
                peer.stateManager.storage.blocks.getLatestBlock(forkId);
            const minHeight = authorLatestBlock?.height;

            const peers = this.harness.getFilteredOrHonestPeers(
                options.waitForPeers
            );
            const waitForFinalization = effectiveWaitForFinalization(options);
            await this.harness.syncCoordinator.waitForPeersToSync(
                peers,
                forkId,
                { minHeight, waitForFinalization }
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
