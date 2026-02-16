import { HarnessBlock } from "./HarnessBlock";
import { Lifecycle } from "./Lifecycle";
import { HarnessOptions } from "../core/types";
import { Assert } from "./assert";
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
     * Channel configured for timeout testing (short timeouts)
     */
    static timeoutSetup(peerCount: number = 3, transitionCount: number = 0) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                }
            }),
            Lifecycle.openChannel()
        );
    }

    /**
     * Start channel with N peers and optional initial transitions
     */
    static startChannel(
        peerCount: number,
        transitionCount: number = 0,
        options?: HarnessOptions
    ) {
        return HarnessBlock.compose(
            Lifecycle.setup(peerCount, options),
            Lifecycle.openChannel(),
            Transition.advanceState({ count: transitionCount })
        );
    }

    // ========================================
    // COMPOSED SCENARIOS - Reusable test patterns
    // ========================================

    /**
     * Four peers with fork resolution (peer 2 removed)
     */
    static fourPeersDisputeResolution(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        return HarnessBlock.compose(
            Scenario.startChannel(4, 2, options),
            Assert.peersInSync(),
            Scenario.disputeWithReduction({ maliciousPeerIndex: 2 })
        );
    }

    /**
     * Fork resolution with snapshot moved to reduced fork
     */
    static fourPeersDisputeResolutionAndSnapshotUpdate(options?: {
        timeConfig?: {
            p2pTime?: number;
            agreementTime?: number;
            chainFallbackTime?: number;
            evidenceTime?: number;
        };
    }) {
        return HarnessBlock.compose(
            Scenario.fourPeersDisputeResolution(options),
            Transition.postSnapshot({ peerIndex: 0 }),
            Assert.onChainSnapshotOnFork()
        );
    }

    /**
     * Channel ready for tampered dispute testing
     */
    static preDisputeSetup(peerCount: number = 3) {
        return HarnessBlock.compose(
            Scenario.timeoutSetup(peerCount),
            Assert.peersInSync(),
            Event.reset(),
            Context.captureOriginalFork()
        );
    }

    /**
     * Peer has unbroadcasted block (partial sync scenario)
     */
    static peerWithUnbroadcastedBlock(peerIndex: number = 1) {
        return HarnessBlock.compose(
            Assert.peersInSync(),
            Event.reset(),
            Byzantine.stubBroadcast(peerIndex),
            Transition.advanceState({
                waitForSync: false
            })
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
            Scenario.startChannel(3, 0, options),
            Assert.participantCount({ expectedCount: 3 }),
            Transition.advanceState({ count: initialTransitions }),
            Lifecycle.addPeer(), // Adds spectator at index 3
            // Wait for all peers (including newly added spectator at index 3) to sync
            Assert.peersInSync({ peerIndices: [0, 1, 2, 3] })
        );
    }

    /**
     * Four peers ready for re-dispute testing (3 synced, 1 disconnected)
     */
    static readyForRedispute() {
        return HarnessBlock.compose(
            Scenario.startChannel(4, 0, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 1,
                    chainFallbackTime: 2,
                    evidenceTime: 4
                }
            }),
            Byzantine.disconnect(3),
            // Do 1 transaction to build up signedBlocks for state proofs
            Transition.advanceState({ txFn: (c) => c.add(1) }),
            Assert.peersInSync({ peerIndices: [0, 1, 2] }),
            Event.reset()
        );
    }

    /**
     * Three peers, one peer (peer 2) isolated from P2P and chain sync
     */
    static peer2Isolated() {
        return HarnessBlock.compose(
            Scenario.startChannel(3, 0, {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 1,
                    chainFallbackTime: 2
                }
            }),
            Byzantine.stubCalldataHandler(2),
            Context.storeSnapshotCount(2, "before_isolation"),
            Byzantine.disconnect(2),
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
            Scenario.startChannel(numPeers, numBlocks),
            Byzantine.doubleSignFrom(byzantinePeer),
            Assert.disputeCommittedByPeers(),
            Event.reset()
        );
    }

    // ========================================
    // FORK RESOLUTION SCENARIOS
    // ========================================

    /**
     * Fork resolution with full settlement control (longer timeouts)
     *
     * This is a high-level composition block that creates an invalid state transition
     * dispute and waits for fork resolution with configurable timing for dispute commits
     * and fork settlement.
     *
     * This provides:
     * - Control over dispute commit timing (disputesCommittedTimeoutMs)
     * - Control over fork settlement timing (forkSettleTimeoutMs)
     * - More lenient dispute commit requirements (some peers may be slow)
     */
    static disputeWithReduction(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
        forkSettleTimeoutMs?: number;
        disputesCommittedTimeoutMs?: number;
    }) {
        const {
            maliciousPeerIndex,
            honestPeerIndices,
            forkSettleTimeoutMs = 10000,
            disputesCommittedTimeoutMs = 5000
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

            // Mark malicious peer context for later blocks
            harness.context.maliciousPeerIndex = maliciousPeerIndex;
            harness.context.honestPeerIndices = honest;

            await harness.disputeOrchestrator.createInvalidStateTransitionDispute(
                maliciousPeerIndex,
                {
                    forkId,
                    resetEventSpies: true
                }
            );

            const result = await harness.disputeOrchestrator.resolveDispute({
                maliciousPeerIndex,
                forkId,
                honestPeerIndices: honest,
                forkSettleTimeoutMs,
                disputesCommittedTimeoutMs,
                disputesCommittedMode: "atLeast",
                assertMaliciousRemoved: false
            });

            // Update active fork context
            harness.context.originalForkId = forkId;
            harness.activeForkId = result.newForkId;

            return harness;
        });
    }
}
