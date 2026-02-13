import { HarnessBlock } from "./HarnessBlock";
import { EventSpies } from "../core/types";

/**
 * Event-driven synchronization blocks
 */
export class Event {
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
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Scenario.disputeWithReduction() or Byzantine.createAndResolveFork() first"
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

    /**
     * Capture the current fork ID for later comparison
     */
    static captureOriginalFork() {
        return new HarnessBlock(async (harness) => {
            harness.context.originalForkId = harness.activeForkId;
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
            const originalForkId = harness.context.originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before waiting for fork change."
                );
            }

            // Use provided honest peers or get from harness context
            const honest =
                honestPeerIndices || harness.context.honestPeerIndices;
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
}
