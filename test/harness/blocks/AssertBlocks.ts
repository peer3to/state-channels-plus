import { HarnessBlock } from "./HarnessBlock";

/**
 * Semantic assertions for test verification
 */
export class Assert {
    /**
     * Assert all peers are in sync with same block height and hash
     */
    static allPeersInSync() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.assertAllPeersInSync();
            return harness;
        });
    }

    /**
     * Assert all specified peers are in sync
     */
    static peersInSync(peerIndices: number[]) {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.assertAllPeersInSync({ peerIndices });
            return harness;
        });
    }

    /**
     * Assert block height matches expected value
     */
    static blockHeight(expectedHeight: number) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.blockHeight(expectedHeight);
            return harness;
        });
    }

    /**
     * Assert a specific peer is out of sync with others
     */
    static peerOutOfSync(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.peerOutOfSync(peerIndex);
            return harness;
        });
    }

    /**
     * Assert dispute was committed on-chain by all peers
     */
    static disputeCommitted(timeout: number = 5000, expectedCount: number = 2) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommitted(
                timeout,
                expectedCount
            );
            return harness;
        });
    }

    /**
     * Assert timeout is a forced timeout (caused by invalid calldata)
     */
    static timeoutIsForced(options: {
        participant: number;
        peerToCheck?: number;
    }) {
        const { participant, peerToCheck = 0 } = options;
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const timeout =
                harness.peers[
                    peerToCheck
                ].stateManager.storage.timeout.getTimeout(forkId);

            if (!timeout) {
                throw new Error(`No timeout found for fork ${forkId}`);
            }

            if (!timeout.isForced) {
                throw new Error(
                    `Expected timeout to be forced, but it was not`
                );
            }

            if (timeout.participant !== harness.peers[participant].address) {
                throw new Error(
                    `Expected timeout participant to be peer ${participant} (${harness.peers[participant].address}), ` +
                        `but was ${timeout.participant}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert timeout exists for a specific participant
     */
    static timeoutExists(options: {
        participant: number;
        peerToCheck?: number;
    }) {
        const { participant, peerToCheck = 0 } = options;
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const timeout =
                harness.peers[
                    peerToCheck
                ].stateManager.storage.timeout.getTimeout(forkId);

            if (!timeout) {
                throw new Error(`No timeout found for fork ${forkId}`);
            }

            if (timeout.participant !== harness.peers[participant].address) {
                throw new Error(
                    `Expected timeout participant to be peer ${participant} (${harness.peers[participant].address}), ` +
                        `but was ${timeout.participant}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert fork changed to a new fork after dispute reduction
     */
    static forkChanged(options?: {
        timeoutMs?: number;
        minHonestPeers?: number;
    }) {
        const { timeoutMs = 10000, minHonestPeers = 3 } = options || {};

        return new HarnessBlock(async (harness) => {
            const originalForkId = (harness as any).originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before this assertion."
                );
            }

            const { ZeroHash } = await import("ethers");
            const forkChanged = await harness.waitForForkChange({
                excludeForkIds: [originalForkId, ZeroHash],
                timeoutMs
            });

            if (!forkChanged) {
                // Additional check to provide better error message
                const peerForks = harness.peers
                    .map((p) => p.stateManager.forkId)
                    .filter(
                        (forkId) =>
                            forkId !== ZeroHash && forkId !== originalForkId
                    );
                const peersOnNewFork = peerForks.length;
                throw new Error(
                    `Fork did not change within ${timeoutMs}ms. Expected at least ${minHonestPeers} peers on new fork, got ${peersOnNewFork}.`
                );
            }

            return harness;
        });
    }

    /**
     * Assert fork did NOT change (remains at original fork)
     */
    static forkUnchanged() {
        return new HarnessBlock(async (harness) => {
            const originalForkId = (harness as any).originalForkId;
            if (!originalForkId) {
                throw new Error(
                    "No original fork ID captured. Use Event.captureOriginalFork() before this assertion."
                );
            }

            const forkUnchanged = harness.peers.every(
                (p) => p.stateManager.forkId === originalForkId
            );

            if (!forkUnchanged) {
                const forkIds = harness.peers.map((p) => p.stateManager.forkId);
                throw new Error(
                    `Expected fork to remain ${originalForkId}, but found: ${JSON.stringify(forkIds)}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert fraud proof was stored for the last tampered dispute
     * Uses event barrier instead of polling
     */
    static fraudProofStored(options?: { timeoutMs?: number }) {
        const { timeoutMs = 2000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const dispute = (harness as any).lastTamperedDispute;
            if (!dispute) {
                throw new Error(
                    "No tampered dispute found. Use Byzantine.tamperedDispute* blocks before this assertion."
                );
            }

            const condition = () => {
                return harness.peers.every((peer) => {
                    const proof =
                        peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                            dispute
                        );
                    return !!proof;
                });
            };

            // Check immediately first
            if (condition()) {
                return harness;
            }

            // Use event barrier (fires on dispute/state events)
            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Fraud proof was not stored on all peers within ${timeoutMs}ms`
                });
            } catch (error) {
                throw new Error(
                    `Fraud proof was not stored on all peers within ${timeoutMs}ms`
                );
            }

            return harness;
        });
    }

    /**
     * Assert all honest peers are in sync (after fork resolution)
     */
    static onlyHonestPeersInSync() {
        return new HarnessBlock(async (harness) => {
            const honestIndices = (harness as any)
                .honestPeerIndices as number[];
            if (!honestIndices) {
                throw new Error(
                    "honestPeerIndices not set - use Byzantine.createAndResolveFork first"
                );
            }

            harness.assertActions.assertAllPeersInSync({
                peerIndices: honestIndices
            });

            return harness;
        });
    }

    /**
     * Assert the malicious peer is not the next to write
     */
    static maliciousPeerExcluded() {
        return new HarnessBlock(async (harness) => {
            const maliciousIndex = (harness as any)
                .maliciousPeerIndex as number;
            if (maliciousIndex === undefined) {
                throw new Error(
                    "maliciousPeerIndex not set - use Byzantine.createAndResolveFork first"
                );
            }

            const nextWriter = await harness.stateQuery.getNextPeerToWrite();

            if (nextWriter.index === maliciousIndex) {
                throw new Error(
                    `Malicious peer ${maliciousIndex} should not receive next turn, but it did`
                );
            }

            return harness;
        });
    }

    /**
     * Assert on-chain snapshot is on the expected fork
     */
    static snapshotOnFork(options?: { expectedForkId?: string }) {
        return new HarnessBlock(async (harness) => {
            const expectedForkId =
                options?.expectedForkId || harness.activeForkId;
            if (!expectedForkId) {
                throw new Error("No fork ID specified and no active fork ID");
            }

            const { default: StateSnapshot } = await import(
                "@/models/StateSnapshot"
            );
            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            if (onChainSnapshot.forkID !== expectedForkId) {
                throw new Error(
                    `Expected on-chain snapshot to be on fork ${expectedForkId}, ` +
                        `but found ${onChainSnapshot.forkID}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert on-chain snapshot matches local snapshot at specified height
     */
    static snapshotMatchesLocal(options?: {
        peerIndex?: number;
        forkId?: string;
        blockHeight?: number;
    }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = options?.forkId || harness.activeForkId;
            if (!forkId) {
                throw new Error("No fork ID specified and no active fork ID");
            }

            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const { default: StateSnapshot } = await import(
                "@/models/StateSnapshot"
            );

            // Get on-chain snapshot
            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            // Determine block height to check
            const blockHeight =
                options?.blockHeight ||
                peer.stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

            // Get local snapshot at that height
            const localSnapshot = peer.stateManager.storage.getStateSnapshot({
                forkId,
                height: blockHeight
            });

            if (!localSnapshot) {
                throw new Error(
                    `No local snapshot found at height ${blockHeight} on fork ${forkId}`
                );
            }

            // Verify height
            if (onChainSnapshot.blockHeight !== blockHeight) {
                throw new Error(
                    `Expected on-chain snapshot height ${blockHeight}, ` +
                        `but found ${onChainSnapshot.blockHeight}`
                );
            }

            // Verify hash
            if (onChainSnapshot.hash !== localSnapshot.hash) {
                throw new Error(
                    `Expected on-chain snapshot hash ${localSnapshot.hash}, ` +
                        `but found ${onChainSnapshot.hash}`
                );
            }

            // Verify deposits and withdrawals
            const stateMachine = peer.stateManager.diamondStateMachine;

            const depositsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalDeposits,
                localSnapshot.snapshotData.totalDeposits
            );
            if (!depositsMatch) {
                throw new Error(
                    "On-chain totalDeposits does not match local snapshot"
                );
            }

            const withdrawalsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalWithdrawals,
                localSnapshot.snapshotData.totalWithdrawals
            );
            if (!withdrawalsMatch) {
                throw new Error(
                    "On-chain totalWithdrawals does not match local snapshot"
                );
            }

            return harness;
        });
    }

    /**
     * Wait for peer's snapshot count to increase from captured baseline
     */
    static snapshotCountIncreased(
        peerIndex: number,
        contextKeyOrOptions?: string | { timeoutMs?: number },
        options?: { timeoutMs?: number }
    ) {
        // Handle overloaded parameters
        let contextKey: string | undefined;
        let timeoutMs: number;

        if (typeof contextKeyOrOptions === "string") {
            contextKey = contextKeyOrOptions;
            timeoutMs = options?.timeoutMs || 5000;
        } else {
            contextKey = undefined;
            timeoutMs = contextKeyOrOptions?.timeoutMs || 5000;
        }

        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            // Determine which baseline to use
            let countBefore: number;
            if (contextKey) {
                // Use named context key
                countBefore = (harness as any)[`snapshotCount_${contextKey}`];
                if (countBefore === undefined) {
                    throw new Error(
                        `No baseline snapshot count found for key "${contextKey}". Use Assert.storeSnapshotCount() first.`
                    );
                }
            } else {
                // Use default peer-based key
                countBefore = (harness as any)[
                    `peer${peerIndex}SnapshotCountBefore`
                ];
                if (countBefore === undefined) {
                    throw new Error(
                        `No snapshot count captured for peer ${peerIndex}. Use Context.captureSnapshotCount() first.`
                    );
                }
            }

            const snapshotStorage = peer.stateManager.storage
                .stateSnapshots as any;

            const condition = () => {
                const countAfter = Array.from(
                    snapshotStorage.snapshotsByHash.keys()
                ).length;
                return countAfter > countBefore;
            };

            // Check immediately
            if (condition()) {
                return harness;
            }

            // Use event barrier (fires on state snapshot updates)
            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Snapshot count did not increase within ${timeoutMs}ms`
                });
            } catch {
                const countAfter = Array.from(
                    snapshotStorage.snapshotsByHash.keys()
                ).length;
                const contextInfo = contextKey
                    ? ` (context: "${contextKey}")`
                    : "";
                throw new Error(
                    `Peer ${peerIndex} snapshot count did not increase from baseline ${countBefore} within ${timeoutMs}ms${contextInfo}. ` +
                        `Current count: ${countAfter}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert that a peer's block height is greater than another peer's
     */
    static peerBlockHeightGreaterThan(
        peerIndex: number,
        otherPeerIndex: number,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 5000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const condition = () => {
                const peerHeight =
                    harness.peers[
                        peerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                const otherHeight =
                    harness.peers[
                        otherPeerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                return peerHeight > otherHeight;
            };

            // Check immediately
            if (condition()) {
                return harness;
            }

            // Use event barrier (fires on block state changes)
            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Peer ${peerIndex} height did not exceed peer ${otherPeerIndex} within ${timeoutMs}ms`
                });
            } catch {
                const peerHeight =
                    harness.peers[
                        peerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                const otherHeight =
                    harness.peers[
                        otherPeerIndex
                    ].stateManager.storage.blocks.getNextBlockHeight(forkId);
                throw new Error(
                    `Peer ${peerIndex} block height (${peerHeight}) is not greater than peer ${otherPeerIndex} (${otherHeight})`
                );
            }

            return harness;
        });
    }

    /**
     * Assert that peers have the same latest block (hash and height)
     */
    static peersHaveSameLatestBlock(
        peerIndices: number[],
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 5000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const condition = () => {
                const blocks = peerIndices.map((i) =>
                    harness.peers[i].stateManager.storage.blocks.getLatestBlock(
                        forkId
                    )
                );

                if (blocks.some((b) => !b)) return false;

                const firstHash = blocks[0]!.hash;
                const firstHeight = blocks[0]!.height;

                return blocks.every(
                    (b) => b!.hash === firstHash && b!.height === firstHeight
                );
            };

            // Check immediately
            if (condition()) {
                return harness;
            }

            // Use event barrier (fires on block state changes)
            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Peers did not have same latest block within ${timeoutMs}ms`
                });
            } catch {
                const blocks = peerIndices.map((i) => ({
                    peer: i,
                    hash: harness.peers[
                        i
                    ].stateManager.storage.blocks.getLatestBlock(forkId)?.hash,
                    height: harness.peers[
                        i
                    ].stateManager.storage.blocks.getLatestBlock(forkId)?.height
                }));
                throw new Error(
                    `Peers ${peerIndices.join(", ")} do not have the same latest block: ${JSON.stringify(blocks)}`
                );
            }

            return harness;
        });
    }

    /**
     * Assert participant count matches expected value
     */
    static participantCount(expectedCount: number, peerIndex: number = 0) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const participants =
                await peer.stateManager.diamondStateMachine.getParticipants();

            const { expect } = await import("chai");
            expect(participants.length).to.equal(expectedCount);

            return harness;
        });
    }

    /**
     * Assert fraud proof stored for the tampered dispute from interception
     */
    static fraudProofStoredForTamperedDispute(
        detectingPeerIndex: number,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 2000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const tamperedDisputePromise = (harness as any)
                .tamperedDisputePromise;
            if (!tamperedDisputePromise) {
                throw new Error(
                    "No tampered dispute promise found. Use Byzantine.interceptDisputeConstruction() first."
                );
            }

            // Wait for the tampered dispute to be constructed
            const tamperedDispute = await tamperedDisputePromise;

            // Restore the interception (cleanup)
            const restore = (harness as any).restoreDisputeConstruction;
            if (restore) {
                restore();
            }

            // Wait for fraud proof to be stored using event barrier
            const condition = () => {
                const peer = harness.peers[detectingPeerIndex];
                const proof =
                    peer.stateManager.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                        tamperedDispute
                    );
                return !!proof;
            };

            // Check immediately
            if (condition()) {
                return harness;
            }

            // Use event barrier (fires on dispute events)
            try {
                await harness.eventCountsBarrier.waitFor(condition, {
                    timeoutMs,
                    timeoutMessage: `Fraud proof not stored within ${timeoutMs}ms`
                });
            } catch {
                throw new Error(
                    `Fraud proof for tampered dispute was not stored by peer ${detectingPeerIndex} within ${timeoutMs}ms`
                );
            }

            return harness;
        });
    }

    /**
     * Store the current snapshot count for a peer in the harness context
     */
    static storeSnapshotCount(peerIndex: number, contextKey: string) {
        return new HarnessBlock(async (harness) => {
            const snapshotStorage = harness.peers[peerIndex].stateManager
                .storage.stateSnapshots as any;
            const count = Array.from(
                snapshotStorage.snapshotsByHash.keys()
            ).length;

            (harness as any)[`snapshotCount_${contextKey}`] = count;

            return harness;
        });
    }

    /**
     * Assert specific peers initiated disputes
     */
    static disputeInitiatedBy(options: {
        peers: number[];
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeInitiatedByPeers(options);
            return harness;
        });
    }

    /**
     * Assert specific peers did NOT initiate disputes
     */
    static didNotInitiateDispute(options: { peers: number[] }) {
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
     */
    static disputeCommittedByAll(options?: {
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommittedByAll(options);
            return harness;
        });
    }

    /**
     * Assert event was called specific times total across all peers
     */
    static totalEventCount(options: {
        event: keyof import("@test/fixtures/PeerTestHarness").EventSpies;
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
     */
    static peerEventCount(options: {
        peer: number;
        event: keyof import("@test/fixtures/PeerTestHarness").EventSpies;
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
     * Assert no disputes occurred (neither initiated nor committed)
     */
    static noDisputes() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.assertNoDisputes();
            return harness;
        });
    }

    /**
     * Assert no calldata was posted
     */
    static noCalldataPosted() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.assertNoCalldataPosted();
            return harness;
        });
    }

    /**
     * Assert calldata was posted by any peer
     *
     * ```
     */
    static calldataPosted(options?: { timeoutMs?: number }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.calldataPostedByAny(options);
            return harness;
        });
    }

    /**
     * Assert honest peers initiated disputes
     *
     */
    static honestPeersInitiateDispute(options?: {
        timeoutMs?: number;
        expectedCountPerPeer?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.honestPeersInitiateDispute(options);
            return harness;
        });
    }

    /**
     * Assert all peers committed disputes
     *
     */
    static disputeCommittedByAllPeers(options?: {
        expectedCountPerPeer?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommittedByAll(options);
            return harness;
        });
    }
}
