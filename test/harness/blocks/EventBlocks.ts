import { HarnessBlock } from "./HarnessBlock";
import { EventSpies } from "@test/fixtures/PeerTestHarness";

/**
 * Event-driven synchronization blocks
 */
export class Event {
    /**
     * Wait for specific event counts across multiple peers
     */
    static waitForCounts(
        eventName: keyof EventSpies,
        expectedCounts: Array<{ peerId: number; expectedCount: number }>,
        options?: {
            timeoutMs?: number;
            mode?: "exact" | "atLeast";
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const success = await harness.eventActions.waitForEventCounts(
                eventName,
                expectedCounts,
                options?.timeoutMs,
                { mode: options?.mode }
            );

            if (!success) {
                throw new Error(
                    `Event ${String(eventName)} counts not reached: expected ${JSON.stringify(expectedCounts)}`
                );
            }

            return harness;
        });
    }

    /**
     * Wait for a single event count on one peer
     */
    static waitForCount(
        eventName: keyof EventSpies,
        peerId: number,
        expectedCount: number,
        options?: {
            timeoutMs?: number;
            mode?: "exact" | "atLeast";
        }
    ) {
        return Event.waitForCounts(
            eventName,
            [{ peerId, expectedCount }],
            options
        );
    }

    /**
     * Wait for event count across all peers
     */
    static waitForAllPeers(
        eventName: keyof EventSpies,
        expectedCountPerPeer: number,
        options?: {
            timeoutMs?: number;
            mode?: "exact" | "atLeast";
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const expectedCounts = harness.peers.map((peer) => ({
                peerId: peer.index,
                expectedCount: expectedCountPerPeer
            }));

            const success = await harness.eventActions.waitForEventCounts(
                eventName,
                expectedCounts,
                options?.timeoutMs,
                { mode: options?.mode }
            );

            if (!success) {
                throw new Error(
                    `Event ${String(eventName)} not reached for all peers: expected ${expectedCountPerPeer} per peer`
                );
            }

            return harness;
        });
    }

    /**
     * Wait for event count on specific peers (subset)
     */
    static waitForPeers(
        eventName: keyof EventSpies,
        peerIds: number[],
        expectedCountPerPeer: number,
        options?: {
            timeoutMs?: number;
            mode?: "exact" | "atLeast";
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const expectedCounts = peerIds.map((peerId) => ({
                peerId,
                expectedCount: expectedCountPerPeer
            }));

            const success = await harness.eventActions.waitForEventCounts(
                eventName,
                expectedCounts,
                options?.timeoutMs,
                { mode: options?.mode }
            );

            if (!success) {
                throw new Error(
                    `Event ${String(eventName)} not reached for peers ${peerIds}: expected ${expectedCountPerPeer} per peer`
                );
            }

            return harness;
        });
    }

    /**
     * Wait for event count on honest peers only (after fork resolution)
     */
    static waitForHonestPeers(
        eventName: keyof EventSpies,
        expectedCountPerPeer: number,
        options?: {
            timeoutMs?: number;
            mode?: "exact" | "atLeast";
        }
    ) {
        return new HarnessBlock(async (harness) => {
            const honestIndices = (harness as any)
                .honestPeerIndices as number[];
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Byzantine.createAndResolveFork first"
                );
            }

            const expectedCounts = honestIndices.map((peerId) => ({
                peerId,
                expectedCount: expectedCountPerPeer
            }));

            const success = await harness.eventActions.waitForEventCounts(
                eventName,
                expectedCounts,
                options?.timeoutMs,
                { mode: options?.mode }
            );

            if (!success) {
                throw new Error(
                    `Event ${String(eventName)} not reached for honest peers: expected ${expectedCountPerPeer} per peer`
                );
            }

            return harness;
        });
    }

    /**
     * Reset event spy counters (clear event history)
     
     */
    static reset(peerIndex?: number) {
        return new HarnessBlock(async (harness) => {
            harness.eventActions.resetEventSpies(peerIndex);
            return harness;
        });
    }

    // ============================================================================
    // HIGH-LEVEL SEMANTIC SYNCHRONIZATION METHODS
    // These should be preferred in tests for clarity and readability
    // ============================================================================

    /**
     * Wait until disputes have been initiated by specific peers (synchronization point)
     */
    static waitUntilDisputeInitiatedBy(options: {
        peers: number[];
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }) {
        const { peers, expectedCountPerPeer = 1, timeoutMs = 5000 } = options;
        return new HarnessBlock(async (harness) => {
            const condition = () => {
                return peers.every(
                    (peerId) =>
                        harness.eventActions.getEventCallCount(
                            peerId,
                            "onInitiatingDispute"
                        ) >= expectedCountPerPeer
                );
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Peers ${peers.join(", ")} did not initiate ${expectedCountPerPeer} disputes within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait until dispute is committed on-chain (synchronization point)
     */
    static waitUntilDisputeCommitted(timeoutMs: number = 5000) {
        return new HarnessBlock(async (harness) => {
            // Wait for all peers to commit the dispute
            const condition = () => {
                return harness.peers.every(
                    (peer) =>
                        harness.eventActions.getEventCallCount(
                            peer.index,
                            "onDisputeCommitted"
                        ) > 0
                );
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Dispute was not committed by all peers within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Capture the current fork ID for later comparison
     */
    static captureOriginalFork() {
        return new HarnessBlock(async (harness) => {
            (harness as any).originalForkId = harness.activeForkId;
            return harness;
        });
    }

    /**
     * Wait until honest peers (all except last malicious peer) initiate dispute
     */
    static waitUntilHonestPeersInitiateDispute(options?: {
        timeoutMs?: number;
        expectedCountPerPeer?: number;
    }) {
        const { timeoutMs = 5000, expectedCountPerPeer = 1 } = options || {};

        return new HarnessBlock(async (harness) => {
            // Get malicious peer index (set by Byzantine blocks)
            const maliciousPeerIndex = (harness as any).lastMaliciousPeerIndex;
            if (maliciousPeerIndex === undefined) {
                throw new Error(
                    "No malicious peer index found. This block should be used after a Byzantine attack block."
                );
            }

            // Get honest peers (all except malicious)
            const honestPeers = harness.peers
                .filter((peer) => peer.index !== maliciousPeerIndex)
                .map((peer) => peer.index);

            const condition = () => {
                return honestPeers.every(
                    (peerId) =>
                        harness.eventActions.getEventCallCount(
                            peerId,
                            "onInitiatingDispute"
                        ) >= expectedCountPerPeer
                );
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Honest peers ${honestPeers.join(", ")} did not initiate ${expectedCountPerPeer} disputes within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait until calldata is posted by any peer (synchronization point)
     * ```
     */
    static waitUntilCalldataPosted(timeoutMs: number = 5000) {
        return new HarnessBlock(async (harness) => {
            const condition = () => {
                return harness.peers.some(
                    (peer) =>
                        harness.eventActions.getEventCallCount(
                            peer.index,
                            "onPostedCalldata"
                        ) > 0 ||
                        harness.eventActions.getEventCallCount(
                            peer.index,
                            "onBlockCalldataPosted"
                        ) > 0
                );
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `No calldata was posted within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait for a generic event to occur on any peer (synchronization point)
     */
    static waitUntilEventOccurs(
        eventName: keyof EventSpies,
        timeoutMs: number = 5000
    ) {
        return new HarnessBlock(async (harness) => {
            const condition = () => {
                return harness.peers.some(
                    (peer) =>
                        harness.eventActions.getEventCallCount(
                            peer.index,
                            eventName
                        ) > 0
                );
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Event ${String(eventName)} did not occur within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait for fork to change from original fork for specific honest peers
     
     */
    static waitForPeerDisputes(
        peerIndex: number,
        minCount: number,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 10000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const condition = () => {
                const count = harness.eventActions.getEventCallCount(
                    peerIndex,
                    "onInitiatingDispute"
                );
                return count >= minCount;
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Peer ${peerIndex} did not initiate ${minCount} disputes within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait for at least one peer from a list to initiate a dispute
     */
    static waitForDisputeFromAnyPeer(
        peerIndices: number[],
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 10000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const condition = () => {
                for (const peerIndex of peerIndices) {
                    const count = harness.eventActions.getEventCallCount(
                        peerIndex,
                        "onInitiatingDispute"
                    );
                    if (count > 0) {
                        return true;
                    }
                }
                return false;
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `None of peers ${peerIndices.join(", ")} initiated a dispute within ${timeoutMs}ms`
            });

            return harness;
        });
    }

    /**
     * Wait for fork to change from original fork for specific honest peers
     */
    static waitForForkChange(options?: {
        timeoutMs?: number;
        honestPeerIndices?: number[];
    }) {
        const { timeoutMs = 10000, honestPeerIndices } = options || {};

        return new HarnessBlock(async (harness) => {
            const originalForkId = (harness as any).originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before waiting for fork change."
                );
            }

            // Use provided honest peers or get from harness context
            const honest =
                honestPeerIndices || (harness as any).honestPeerIndices;
            if (!honest || honest.length === 0) {
                throw new Error(
                    "No honest peer indices provided and none found in harness context"
                );
            }

            // Use event-driven fork change detection
            const { ZeroHash } = await import("ethers");
            const forkChanged = await harness.waitForForkChange({
                excludeForkIds: [originalForkId, ZeroHash],
                peerIndices: honest,
                timeoutMs
            });

            if (!forkChanged) {
                throw new Error(
                    `Fork did not change within ${timeoutMs}ms. Expected ${honest.length} honest peers on new fork.`
                );
            }

            return harness;
        });
    }

    // ============================================================================
    // LOW-LEVEL EVENT METHODS (for advanced usage and debugging)
    // Prefer high-level semantic methods above when possible
    // ============================================================================

    /**
     * Wait for connection/disconnection events
     */
    static waitForConnectionChange(options: {
        peerIndex: number;
        expectedChange: number;
        timeoutMs?: number;
    }) {
        const { peerIndex, expectedChange, timeoutMs = 5000 } = options;

        return new HarnessBlock(async (harness) => {
            const initialCount =
                harness.stateQuery.getConnectionCount(peerIndex);
            const expectedCount = initialCount + expectedChange;

            const success = await harness.waitForCondition(() => {
                const currentCount =
                    harness.stateQuery.getConnectionCount(peerIndex);
                return currentCount === expectedCount;
            }, timeoutMs);

            if (!success) {
                const finalCount =
                    harness.stateQuery.getConnectionCount(peerIndex);
                throw new Error(
                    `Expected peer ${peerIndex} to have ${expectedCount} connections ` +
                        `(change of ${expectedChange} from ${initialCount}), ` +
                        `but has ${finalCount} after ${timeoutMs}ms`
                );
            }

            return harness;
        });
    }
}
