import { MathStateMachine } from "@typechain-types/index";
import { HarnessBlock } from "./HarnessBlock";

export type TransitionContract = MathStateMachine;

/**
 * Transition namespace containing blocks for state transitions
 */
export class Transition {
    /**
     * Advance state by N sequential writes or M full rounds.
     *
     * By default this uses `increment()`. Provide `txFn` to run a custom
     * transition per step.
     */
    static advanceState(options?: {
        count?: number;
        rounds?: number;
        txFn?: (contract: TransitionContract) => Promise<any>;
        waitForSync?: boolean;
        waitForPeers?: number[];
        waitForTurn?: boolean;
    }) {
        return new HarnessBlock(async (harness) => {
            const count = options?.count ?? 1;
            const total = options?.rounds
                ? options.rounds * harness.peers.length
                : count;
            const transitionOptions = {
                waitForSync: options?.waitForSync,
                waitForPeers: options?.waitForPeers,
                waitForTurn: options?.waitForTurn
            };

            if (options?.txFn) {
                for (let i = 0; i < total; i++) {
                    await harness.transitionActions.submitNext(
                        options.txFn,
                        transitionOptions
                    );
                }
                return harness;
            }

            for (let i = 0; i < total; i++) {
                await harness.transitionActions.increment(1, transitionOptions);
            }

            return harness;
        });
    }

    /**
     * Specific peer writes a block (out-of-order authoring with control)
     */
    static peerWrite(options: {
        peer: number;
        value?: number;
        waitForPeers?: number[];
    }) {
        const { peer, value = 1, waitForPeers } = options;
        return new HarnessBlock(async (harness) => {
            const peerObj = harness.peers[peer];
            if (!peerObj) {
                throw new Error(`Peer ${peer} not found`);
            }

            await harness.transitionActions.submit(
                peerObj,
                (contract) => contract.add(value),
                { waitForPeers }
            );

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
        txFn: (contract: TransitionContract) => Promise<any>,
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
                    "honestPeerIndices not set - use Scenario.disputeWithReduction() first"
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
        txFns: Array<(contract: TransitionContract) => Promise<any>>
    ) {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Scenario.disputeWithReduction() first"
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
        txFn: (contract: TransitionContract) => Promise<any>
    ) {
        return new HarnessBlock(async (harness) => {
            // Get all peer indices except the excluded one
            const includedPeers = harness.peers
                .map((_: unknown, i: number) => i)
                .filter((i: number) => i !== excludePeer);

            await harness.transitionActions.submitNext(txFn, {
                waitForPeers: includedPeers,
                waitForSync: true
            });

            return harness;
        });
    }
}
