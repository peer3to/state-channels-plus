import { HarnessBlock } from "./HarnessBlock";

/**
 * Transition namespace containing blocks for state transitions
 */
export class Transition {
    /**
     * Execute a valid state transition from the next peer to write
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Setup.peers(3),
     *     Channel.open(),
     *     Transition.valid(c => c.add(1)),
     *     Transition.valid(c => c.add(2))
     * );
     * ```
     */
    static valid(
        txFn: (contract: any) => Promise<any>,
        options?: {
            waitForSync?: boolean;
            waitForPeers?: number[];
            waitForTurn?: boolean;
        }
    ) {
        return new HarnessBlock(async (harness) => {
            await harness.transitionActions.submitNext(txFn, options);
            return harness;
        });
    }

    /**
     * Execute a specific peer's transaction
     */
    static fromPeer(
        peerIndex: number,
        txFn: (contract: any) => Promise<any>,
        options?: {
            waitForSync?: boolean;
            waitForPeers?: number[];
            waitForTurn?: boolean;
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) throw new Error(`Peer ${peerIndex} not found`);

            await harness.transitionActions.submit(peer, txFn, options);
            return harness;
        });
    }

    /**
     * Execute multiple transitions in sequence
     */
    static sequence(
        count: number,
        txFn: (contract: any, iteration: number) => Promise<any>
    ) {
        return new HarnessBlock(async (harness) => {
            for (let i = 0; i < count; i++) {
                await harness.transitionActions.submitNext((contract) =>
                    txFn(contract, i)
                );
            }

            return harness;
        });
    }

    /**
     * Execute a transition from the next honest peer to write
     *
     * This is used after fork resolution to continue state transitions
     * only among honest peers (excluding the malicious peer).
     *
     * Requires harness.honestPeerIndices to be set (typically by Byzantine.createAndResolveFork)
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.activeChannel(4, 2),
     *     Byzantine.createAndResolveFork({ maliciousPeerIndex: 2 }),
     *     Transition.fromHonestPeersOnly(c => c.add(1)),
     *     Transition.fromHonestPeersOnly(c => c.add(2)),
     *     Assert.onlyHonestPeersInSync()
     * );
     * ```
     */
    static fromHonestPeersOnly(
        txFn: (contract: any) => Promise<any>,
        options?: {
            waitForSync?: boolean;
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Byzantine.createAndResolveFork first"
                );
            }

            await harness.transitionActions.submitNext(txFn, {
                waitForTurn: true,
                waitForPeers: honestIndices,
                waitForSync: options?.waitForSync ?? true
            });

            return harness;
        });
    }

    /**
     * Execute multiple transitions from honest peers in sequence
     */
    static sequenceFromHonestPeers(
        txFns: Array<(contract: any) => Promise<any>>
    ) {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Byzantine.createAndResolveFork first"
                );
            }

            for (const txFn of txFns) {
                await harness.transitionActions.submitNext(txFn, {
                    waitForTurn: true,
                    waitForPeers: honestIndices,
                    waitForSync: true
                });
            }

            return harness;
        });
    }

    /**
     * Post a state snapshot to the chain for the current fork
     *
     * This updates the on-chain state snapshot to reflect the current off-chain state.
     * Typically used after fork resolution or after significant state changes.
     *
     * @param options.peerIndex - Which peer posts the snapshot (default: 0)
     * @param options.forkId - Fork ID to post snapshot for (default: harness.activeForkId)
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Byzantine.createAndResolveFork({ maliciousPeerIndex: 2 }),
     *     Transition.postSnapshot(), // Move on-chain snapshot to reduced fork
     *     Transition.fromHonestPeersOnly(c => c.add(1)),
     *     Transition.postSnapshot() // Update snapshot after new transitions
     * );
     * ```
     */
    static postSnapshot(options?: { peerIndex?: number; forkId?: string }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = options?.forkId || harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            await peer.stateManager.postStateSnapshot(forkId);

            return harness;
        });
    }

    /**
     * Execute a valid state transition, excluding specific peers from sync
     *
     * This simulates a transaction where certain peers are offline/disconnected
     * and don't receive the block.
     *
     * @param excludePeer - Peer index to exclude from sync
     * @param txFn - Transaction function
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.twoBlocks(3),
     *     Network.disconnect(2),
     *     Transition.validWithoutPeer(2, c => c.add(100)),  // Peer 2 won't receive block
     *     // Peer 2 is now out of sync
     * );
     * ```
     */
    static validWithoutPeer(
        excludePeer: number,
        txFn: (contract: any) => Promise<any>
    ) {
        return new HarnessBlock(async (harness) => {
            // Get all peer indices except the excluded one
            const includedPeers = harness.peers
                .map((_, i) => i)
                .filter((i) => i !== excludePeer);

            await harness.transitionActions.submitNext(txFn, {
                waitForPeers: includedPeers,
                waitForSync: true
            });

            return harness;
        });
    }

    /**
     * Execute a transition from a specific peer without broadcasting
     *
     * The peer authors the block but doesn't broadcast it to other peers.
     * Requires Network.stubBroadcast() to be called first on that peer.
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.twoBlocks(3),
     *     Network.stubBroadcast(1),
     *     Transition.fromPeerWithoutBroadcast(1, c => c.add(10)),
     *     // Peer 1 has the block, peers 0 and 2 don't
     * );
     * ```
     */
    static fromPeerWithoutBroadcast(
        peerIndex: number,
        txFn: (contract: any) => Promise<any>
    ) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) throw new Error(`Peer ${peerIndex} not found`);

            // Wait for this peer's turn
            await harness.transitionActions.waitForTurn(peer);

            // Submit without waiting for sync (since it won't broadcast)
            await harness.transitionActions.submit(peer, txFn, {
                waitForSync: false
            });

            return harness;
        });
    }
}
