import { HarnessBlock, composeBlocks } from "./HarnessBlock";
import { Lifecycle } from "./LifecycleBlocks";
import { HarnessOptions } from "../core/types";
import { Assert } from "./AssertBlocks";
import { Byzantine } from "./ByzantineBlocks";
import { Transition } from "./TransitionBlocks";
import { Event } from "./EventBlocks";
import { Time } from "./TimeBlocks";
import { Sync } from "./SyncBlocks";

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

    static timeoutChannel(peerCount: number = 3) {
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
            Scenario.peersWrite(transitionCount)
        );
    }

    // ========================================
    // STATE BUILDING - Operations
    // ========================================

    /**
     * N peers write blocks in sequence
     */
    static peersWrite(count: number) {
        return new HarnessBlock(async (harness) => {
            for (let i = 0; i < count; i++) {
                await harness.transitionActions.submitNext((contract) =>
                    contract.add(1)
                );
            }

            return harness;
        });
    }

    /**
     * Add a specific value to the state
     */
    static addValue(value: number) {
        return new HarnessBlock(async (harness) => {
            await harness.transitionActions.submitNext((contract) =>
                contract.add(value)
            );
            return harness;
        });
    }

    /**
     * Specific peer writes a block (out-of-order authoring)
     */
    static peerWrites(options: {
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
                await harness.transitionActions.submitNext((contract) =>
                    contract.add(1)
                );
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
                    await harness.transitionActions.submitNext((contract) =>
                        contract.add(1)
                    );
                }
            }

            return harness;
        });
    }

    // ========================================
    // PRE-COMPOSED SCENARIOS - Common patterns
    // ========================================

    /**
     * Channel with one full round completed (all peers wrote once)
     */

    static oneRound(peerCount: number = 3, options?: HarnessOptions) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, options),
            Lifecycle.openChannel(),
            Scenario.fullRound()
        );
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
            Byzantine.createAndResolveFork({ maliciousPeerIndex: 2 })
        );
    }

    /**
     * Fork resolution with snapshot moved to reduced fork
     */
    static forkResolutionWithSnapshotMoved(options?: {
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
            Transition.valid((c) => c.add(value), { waitForSync: false }),
            Time.wait(1000)
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
            Assert.participantCount(3),
            Scenario.peersWrite(initialTransitions),
            Lifecycle.addPeer(),
            Event.waitUntilEventOccurs("onConnection", 5000),
            Sync.wait({ timeout: 5000 })
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
}
