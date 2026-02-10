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
     * Execute a transition from the next honest peer to write
     *
     * This is used after fork resolution to continue state transitions
     * only among honest peers (excluding the malicious peer).

     */
    static fromHonestPeersOnly(
        txFn: (contract: any) => Promise<any>,
        options?: {
            waitForSync?: boolean;
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const honestIndices =
                harness.context.honestPeerIndices ||
                Array.from({ length: harness.peers.length }, (_, i) => i);
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Scenario.forkResolution() or Byzantine.createAndResolveFork() first"
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
                    "honestPeerIndices not set - use Scenario.forkResolution() or Byzantine.createAndResolveFork() first"
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
}
