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

    // ============================================================================
    // ASSERTION METHODS (Verification, not synchronization)
    // These check state and throw descriptive errors on mismatch
    // ============================================================================

    /**
     * Assert specific peers initiated disputes
     *
     * Checks the CURRENT state without waiting.
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.twoBlocks(),
     *     Byzantine.doubleSignFrom(1),
     *     Event.waitUntilDisputeInitiatedBy({ peers: [0, 2] }),
     *     Event.assertDidNotInitiateDispute({ peers: [1] })  // Byzantine didn't
     * );
     * ```
     */
    static assertDisputeInitiatedBy(options: {
        peers: number[];
        expectedCountPerPeer?: number;
    }) {
        const { peers, expectedCountPerPeer = 1 } = options;
        return new HarnessBlock(async (harness) => {
            for (const peerId of peers) {
                const actualCount = harness.eventActions.getEventCallCount(
                    peerId,
                    "onInitiatingDispute"
                );
                if (actualCount < expectedCountPerPeer) {
                    throw new Error(
                        `Expected peer ${peerId} to initiate ${expectedCountPerPeer} disputes, but only initiated ${actualCount}`
                    );
                }
            }
            return harness;
        });
    }

    /**
     * Assert specific peers did NOT initiate disputes
     *
     * @example
     * ```ts
     * Event.assertDidNotInitiateDispute({ peers: [1] })  // Byzantine peer didn't initiate
     * ```
     */
    static assertDidNotInitiateDispute(options: { peers: number[] }) {
        return new HarnessBlock(async (harness) => {
            for (const peerId of options.peers) {
                const actualCount = harness.eventActions.getEventCallCount(
                    peerId,
                    "onInitiatingDispute"
                );
                if (actualCount > 0) {
                    throw new Error(
                        `Expected peer ${peerId} to NOT initiate disputes, but initiated ${actualCount}`
                    );
                }
            }
            return harness;
        });
    }

    /**
     * Assert all peers committed the dispute
     *
     * @example
     * ```ts
     * Event.assertDisputeCommittedByAll({ expectedCountPerPeer: 2 })
     * ```
     */
    static assertDisputeCommittedByAll(options?: {
        expectedCountPerPeer?: number;
    }) {
        const { expectedCountPerPeer = 1 } = options || {};
        return new HarnessBlock(async (harness) => {
            for (const peer of harness.peers) {
                const actualCount = harness.eventActions.getEventCallCount(
                    peer.index,
                    "onDisputeCommitted"
                );
                if (actualCount < expectedCountPerPeer) {
                    throw new Error(
                        `Expected peer ${peer.index} to commit ${expectedCountPerPeer} disputes, but only committed ${actualCount}`
                    );
                }
            }
            return harness;
        });
    }

    /**
     * Assert event was called specific times total across all peers
     *
     * @example
     * ```ts
     * Event.assertTotalEventCount({
     *     event: "onBlockApplied",
     *     expectedTotal: 9
     * })  // 3 peers × 3 blocks
     * ```
     */
    static assertTotalEventCount(options: {
        event: keyof EventSpies;
        expectedTotal: number;
    }) {
        return new HarnessBlock(async (harness) => {
            harness.eventActions.assertEventHandlerCalledTotalTimes(
                options.event,
                options.expectedTotal
            );
            return harness;
        });
    }

    /**
     * Assert event count for a specific peer
     *
     * @example
     * ```ts
     * Event.assertPeerEventCount({
     *     peer: 0,
     *     event: "onBlockApplied",
     *     expectedCount: 3
     * })
     * ```
     */
    static assertPeerEventCount(options: {
        peer: number;
        event: keyof EventSpies;
        expectedCount: number;
    }) {
        return new HarnessBlock(async (harness) => {
            const actualCount = harness.eventActions.getEventCallCount(
                options.peer,
                options.event
            );
            if (actualCount !== options.expectedCount) {
                throw new Error(
                    `Expected peer ${options.peer} event ${String(options.event)} to be called ${options.expectedCount} times, but was called ${actualCount} times`
                );
            }
            return harness;
        });
    }

    /**
     * Reset event spy history (clear all counters)
     *
     * Useful for:
     * - Starting fresh before a byzantine action
     * - Isolating event counts for specific test sections
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.twoBlocks(),
     *     Event.reset(),  // Clear previous history
     *     Byzantine.doubleSignFrom(1),
     *     Event.waitForAllPeers("onInitiatingDispute", 1)
     * );
     * ```
     */
    /**
     * Reset event spy counters (clear event history)
     *
     * **When to use:**
     * Call this AFTER setup blocks and BEFORE test actions when you want to:
     * - Wait for events that happen AFTER this point (ignore setup events)
     * - Assert exact event counts from a specific point forward
     *
     * **When NOT to use:**
     * - Don't call at test start (counters start at zero)
     * - Don't call if you're testing cumulative behavior across entire test
     *
     * **Why it's needed:**
     * Event spies accumulate ALL events from channel open onwards.
     * Setup operations (channel.open(), peersWrite(), etc.) trigger many events.
     * Resetting lets you isolate events from your specific test action.
     *
     * @example
     * ```ts
     * // CORRECT: Reset after setup, before test action
     * await ScenarioRunner.execute(
     *     Scenario.timeoutChannel(3),
     *     Scenario.peersWrite(2),      // Setup: generates events
     *     Event.reset(),                // ← Clear setup events
     *     Event.waitUntilDisputeInitiatedBy({ peers: [0, 1] })  // Wait for NEW disputes only
     * );
     * ```
     *
     * @example
     * ```ts
     * // WRONG: No reset, might count stale events
     * await ScenarioRunner.execute(
     *     Scenario.threePeersTwoBlocks(),  // This triggers onSetState, etc.
     *     Byzantine.doubleSignFrom(1),
     *     Event.waitForCounts("onSetState", [{ peerId: 0, expectedCount: 1 }])  // Might match setup events!
     * );
     * ```
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
     *
     * This waits for SPECIFIC peers to initiate disputes.
     * Use this when you need to synchronize on particular peers initiating.
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.twoBlocks(),
     *     Byzantine.doubleSignFrom(1),
     *     Event.waitUntilDisputeInitiatedBy({ peers: [0, 2] }),  // Wait for honest peers
     *     Event.assertDidNotInitiateDispute({ peers: [1] })  // Byzantine didn't initiate
     * );
     * ```
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
     *
     * This ONLY waits for commitment to happen, does NOT verify counts.
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.twoBlocks(),
     *     Byzantine.invalidTransitionFrom(2),
     *     Event.waitUntilDisputeCommitted(),
     *     Assert.disputeCommitted()  // Verify all peers committed
     * );
     * ```
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
     *
     * Stores the current fork ID on the harness so that later blocks
     * can compare against it (e.g., Assert.forkChanged()).
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.twoBlocks(),
     *     Event.captureOriginalFork(),
     *     Byzantine.invalidTransitionFromNext(),
     *     Assert.forkChanged()
     * );
     * ```
     */
    static captureOriginalFork() {
        return new HarnessBlock(async (harness) => {
            (harness as any).originalForkId = harness.activeForkId;
            return harness;
        });
    }

    /**
     * Wait until honest peers (all except last malicious peer) initiate dispute
     *
     * Use this after a Byzantine attack to wait for honest peers to detect it.
     * Automatically excludes the last malicious peer that performed an attack.
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.activeChannel(3, 2),
     *     Event.reset(),
     *     Byzantine.forgedInboundMessageFromNext(),
     *     Event.waitUntilHonestPeersInitiateDispute({ timeoutMs: 5000 })
     * );
     * ```
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
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.timeoutTestChannel(3),
     *     Byzantine.skipTurn(2),
     *     Event.waitUntilCalldataPosted()
     * );
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
     *
     * @example
     * ```ts
     * Event.waitUntilEventOccurs("onBlockApplied")
     * ```
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
     * Assert no disputes occurred (neither initiated nor committed)
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.activeChannel(3, 2),
     *     Scenario.peersWrite(10),
     *     Event.assertNoDisputes()
     * );
     * ```
     */
    static assertNoDisputes() {
        return new HarnessBlock(async (harness) => {
            const totalInitiated = harness.peers.reduce((sum, peer) => {
                return (
                    sum +
                    harness.eventActions.getEventCallCount(
                        peer.index,
                        "onInitiatingDispute"
                    )
                );
            }, 0);

            const totalCommitted = harness.peers.reduce((sum, peer) => {
                return (
                    sum +
                    harness.eventActions.getEventCallCount(
                        peer.index,
                        "onDisputeCommitted"
                    )
                );
            }, 0);

            if (totalInitiated > 0) {
                throw new Error(
                    `Expected no disputes to be initiated, but ${totalInitiated} were initiated`
                );
            }

            if (totalCommitted > 0) {
                throw new Error(
                    `Expected no disputes to be committed, but ${totalCommitted} were committed`
                );
            }

            return harness;
        });
    }

    /**
     * Assert no calldata was posted
     *
     * @example
     * ```ts
     * const harness = await ScenarioRunner.execute(
     *     Scenario.threePeersTwoBlocks(),
     *     Scenario.peersWrite(1),
     *     Event.assertNoCalldataPosted()  // Happy path, no timeouts
     * );
     * ```
     */
    static assertNoCalldataPosted() {
        return new HarnessBlock(async (harness) => {
            const totalPosted = harness.peers.reduce((sum, peer) => {
                return (
                    sum +
                    harness.eventActions.getEventCallCount(
                        peer.index,
                        "onPostedCalldata"
                    )
                );
            }, 0);

            const totalBlockCalldata = harness.peers.reduce((sum, peer) => {
                return (
                    sum +
                    harness.eventActions.getEventCallCount(
                        peer.index,
                        "onBlockCalldataPosted"
                    )
                );
            }, 0);

            if (totalPosted > 0 || totalBlockCalldata > 0) {
                throw new Error(
                    `Expected no calldata to be posted, but onPostedCalldata: ${totalPosted}, onBlockCalldataPosted: ${totalBlockCalldata}`
                );
            }

            return harness;
        });
    }

    /**
     * Wait for a specific peer to initiate N disputes
     *
     * Used in scenarios where we expect a peer to detect multiple frauds
     * (e.g., one peer's invalid block AND another peer's tampered dispute).
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Byzantine.interceptDisputeConstruction({ peerIndex: 0, tamperFn: ... }),
     *     Byzantine.invalidTransitionFrom(1),
     *     Event.waitForPeerDisputes(2, 2, { timeoutMs: 25000 }), // Peer 2 files 2 disputes
     *     Assert.fraudProofStoredForTamperedDispute(2)
     * );
     * ```
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
     *
     * Used in scenarios where we don't know which peer will file a dispute first,
     * such as timeout disputes where any active peer might timeout the disconnected one.
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Network.timeout(2),
     *     Transition.validWithoutPeer(2, c => c.add(100)),
     *     Event.waitForDisputeFromAnyPeer([0, 1], { timeoutMs: 10000 })
     * );
     * ```
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
     *
     * Waits for honest peers to move to a new fork after dispute resolution.
     * Requires Event.captureOriginalFork() to be called first.
     * Uses honest peer indices from harness context if available.
     *
     * @param options.timeoutMs - How long to wait (default: 10000ms)
     * @param options.honestPeerIndices - Specific peer indices to check (uses harness context if not provided)
     *
     * @example
     * ```ts
     * await ScenarioRunner.execute(
     *     Scenario.activeChannel(4, 2),
     *     Event.captureOriginalFork(),
     *     Byzantine.invalidTransitionFrom(2),
     *     Event.waitForAllPeers("onDisputeCommitted", 3),
     *     Event.waitForForkChange({ honestPeerIndices: [0, 1, 3] })
     * );
     * ```
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
}
