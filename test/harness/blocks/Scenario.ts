import { HarnessBlock } from "./HarnessBlock";
import { Lifecycle } from "./Lifecycle";
import { HarnessOptions } from "../core/types";
import { Assert } from "./Assert";
import { Byzantine } from "./Byzantine";
import { Transition } from "./Transition";
import { Event } from "./Event";
import { Context } from "./Context";

/**
 * Scenario building blocks for common test patterns
 */
export class Scenario {
    // ========================================
    // CHANNEL SETUP - Starting states
    // ========================================

    /**
     * Empty channel with peers but no transitions (genesis only)
     */
    static emptyChannel(peerCount: number, options?: HarnessOptions) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, options),
            Lifecycle.openChannel()
        );
    }

    /**
     * Channel configured for timeout testing (short timeouts)
     */

    static timeoutSetup(peerCount: number = 3) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            }),
            Lifecycle.openChannel()
        );
    }

    /**
     * Active channel with N peers and M transitions
     */
    static activeChannel(
        peerCount: number,
        transitionCount: number,
        options?: HarnessOptions
    ) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, options),
            Lifecycle.openChannel(),
            Scenario.advanceState(transitionCount)
        );
    }

    // ========================================
    // STATE BUILDING - Operations
    // ========================================

    /**
     * Advance state by N sequential writes (next peers in turn)
     * Simple state progression without control over specific peers or values
     */
    static advanceState(count: number) {
        return new HarnessBlock(async (harness) => {
            for (let i = 0; i < count; i++) {
                await harness.transitionActions.increment();
            }

            return harness;
        });
    }

    /**
     * Specific peer writes a block (out-of-order authoring with control)
     * Use this when you need to specify peer, value, or waitForPeers options
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
     * One full round (all peers write once in order)
     */
    static fullRound() {
        return new HarnessBlock(async (harness) => {
            const peerCount = harness.peers.length;

            for (let i = 0; i < peerCount; i++) {
                await harness.transitionActions.increment();
            }

            return harness;
        });
    }

    /**
     * N complete rounds (all peers write N times each)
     */
    static multipleRounds(rounds: number) {
        return new HarnessBlock(async (harness) => {
            const peerCount = harness.peers.length;

            for (let round = 0; round < rounds; round++) {
                for (let peer = 0; peer < peerCount; peer++) {
                    await harness.transitionActions.increment();
                }
            }

            return harness;
        });
    }

    // ========================================
    // COMPOSED SCENARIOS - Reusable test patterns
    // ========================================

    /**
     * Four peers with fork resolution (peer 2 removed)
     */
    static fourPeerForkResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        return HarnessBlock.compose(
            Scenario.activeChannel(4, 2, options),
            Assert.allPeersInSync(),
            Scenario.disputeResolution({ maliciousPeerIndex: 2 })
        );
    }

    /**
     * Fork resolution with snapshot moved to reduced fork
     */
    static disputeResolutionWithSnapshotMovedtoNewFork(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        return HarnessBlock.compose(
            Scenario.fourPeerForkResolution(options),
            Transition.postSnapshot({ peerIndex: 0 }),
            Assert.snapshotOnFork()
        );
    }

    /**
     * Channel ready for tampered dispute testing
     */
    static readyForTamperedDispute(
        peerCount: number = 3,
        options?: HarnessOptions
    ) {
        return HarnessBlock.compose(
            Scenario.activeChannel(peerCount, 2, options),
            Assert.allPeersInSync(),
            Event.reset(),
            Event.captureOriginalFork()
        );
    }

    /**
     * Peer has unbroadcasted block (partial sync scenario)
     */
    static peerWithUnbroadcastedBlock(
        peerIndex: number = 1,
        value: number = 10
    ) {
        return HarnessBlock.compose(
            Scenario.activeChannel(3, 1),
            Assert.allPeersInSync(),
            Event.reset(),
            Byzantine.stubBroadcast(peerIndex),
            Transition.valid((c) => c.add(value), { waitForSync: false })
        );
    }

    /**
     * Spectator joined and synced
     */
    static spectatorJoinedAndSynced(
        initialTransitions: number = 3,
        options?: HarnessOptions
    ) {
        return HarnessBlock.compose(
            Scenario.emptyChannel(3, options),
            Assert.participantCount({ expectedCount: 3 }),
            Scenario.advanceState(initialTransitions),
            Lifecycle.addPeer(), // Adds spectator at index 3
            // Wait for all peers (including newly added spectator at index 3) to sync
            Assert.peersInSync([0, 1, 2, 3])
        );
    }

    /**
     * Four peers ready for re-dispute testing (3 synced, 1 disconnected)
     */
    static readyForRedispute() {
        return HarnessBlock.compose(
            Scenario.emptyChannel(4, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 1,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            }),
            Byzantine.disconnect(3),
            // Do 1 transaction to build up signedBlocks for state proofs
            Transition.valid((c) => c.add(1)),
            Assert.peersInSync([0, 1, 2]),
            Event.reset()
        );
    }

    /**
     * Three peers, one peer (peer 2) isolated from P2P and chain sync
     */
    static peerMissingSnapshot() {
        return HarnessBlock.compose(
            Scenario.emptyChannel(3, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            }),
            Byzantine.stubCalldataHandler(2),
            Assert.storeSnapshotCount(2, "before_isolation"),
            Byzantine.timeout(2),
            Event.reset()
        );
    }

    /**
     * Active channel with committed dispute from a byzantine peer
     * Common setup for dispute-related RPC tests
     */
    static activeChannelWithDispute(options: {
        numPeers: number;
        numBlocks: number;
        byzantinePeer: number;
    }) {
        const { numPeers, numBlocks, byzantinePeer } = options;

        return HarnessBlock.compose(
            Scenario.activeChannel(numPeers, numBlocks),
            Byzantine.doubleSignFrom(byzantinePeer),
            Assert.disputeCommitted(),
            Event.reset()
        );
    }

    // ========================================
    // FORK RESOLUTION SCENARIOS
    // ========================================

    static disputeResolution(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
        forkSettleTimeoutMs?: number;
        disputesCommittedTimeoutMs?: number;
        disputesCommittedMode?: "atLeast" | "exact";
    }) {
        const {
            maliciousPeerIndex,
            honestPeerIndices,
            forkSettleTimeoutMs = 10000,
            disputesCommittedTimeoutMs = 5000,
            disputesCommittedMode = "atLeast"
        } = options;

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const totalPeers = harness.peers.length;
            const honest =
                honestPeerIndices ||
                Array.from({ length: totalPeers }, (_, i) => i).filter(
                    (i) => i !== maliciousPeerIndex
                );

            return HarnessBlock.compose(
                Context.markMaliciousPeer({
                    maliciousPeerIndex,
                    honestPeerIndices: honest
                }),

                Event.captureOriginalFork(),
                Event.reset(),

                Byzantine.invalidTransitionFrom(maliciousPeerIndex),

                Event.waitForAllPeers("onDisputeCommitted", honest.length, {
                    timeoutMs: disputesCommittedTimeoutMs,
                    mode: disputesCommittedMode
                }),

                Event.waitForForkChange({
                    timeoutMs: forkSettleTimeoutMs,
                    honestPeerIndices: honest
                }),

                Context.updateActiveFork()
            ).run(harness);
        });
    }
}
