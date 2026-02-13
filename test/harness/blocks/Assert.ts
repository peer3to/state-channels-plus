import { HarnessBlock } from "./HarnessBlock";
import { StateSnapshot } from "@/models";
import { expect } from "chai";

/**
 * Semantic assertions for test verification
 */
export class Assert {
    /**
     * Assert all peers are in sync with same block height and hash
     */
    static allPeersInSync(options?: { timeout?: number }) {
        const { timeout = 10000 } = options || {};
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.assertAllPeersInSync({ timeout });
            return harness;
        });
    }

    /**
     * Assert all specified peers are in sync
     */
    static peersInSync(peerIndices: number[], options?: { timeout?: number }) {
        const { timeout = 10000 } = options || {};
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.assertAllPeersInSync({
                peerIndices,
                timeout
            });
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
     * Assert dispute was committed on-chain by all peers
     */
    static disputeCommitted(
        expectedCount: number = 2,
        timeoutMs: number = 5000
    ) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeCommitted(
                timeoutMs,
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

            harness.assertActions.assertTimeoutIsForced({
                participant,
                peerToCheck,
                forkId
            });

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
            await harness.assertActions.assertForkChanged({
                originalForkId: harness.context.originalForkId,
                timeoutMs,
                minHonestPeers
            });

            return harness;
        });
    }

    /**
     * Assert fork did NOT change (remains at original fork)
     */
    static forkUnchanged() {
        return new HarnessBlock(async (harness) => {
            const forkUnchanged = harness.peers.every(
                (p) => p.stateManager.forkId === harness.context.originalForkId
            );

            if (!forkUnchanged) {
                const forkIds = harness.peers.map((p) => p.stateManager.forkId);
                throw new Error(
                    `Expected fork to remain ${harness.context.originalForkId}, but found: ${JSON.stringify(forkIds)}`
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
            await harness.assertActions.assertFraudProofStored({
                dispute: harness.context.lastTamperedDispute,
                timeoutMs
            });

            return harness;
        });
    }

    /**
     * Assert all honest peers are in sync (after fork resolution)
     */
    static onlyHonestPeersInSync() {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.assertAllPeersInSync({
                peerIndices: harness.context.honestPeerIndices
            });

            return harness;
        });
    }

    /**
     * Assert the malicious peer is not the next to write
     */
    static maliciousPeerExcluded() {
        return new HarnessBlock(async (harness) => {
            const nextWriter = await harness.stateQuery.getNextPeerToWrite();

            if (nextWriter.index === harness.context.maliciousPeerIndex) {
                throw new Error(
                    `Malicious peer ${harness.context.maliciousPeerIndex} should not receive next turn, but it did`
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
     * Wait for peer's snapshot count to increase from named checkpoint
     * Uses Assert.storeSnapshotCount() to set the baseline checkpoint
     */
    static snapshotCountIncreasedSince(
        peerIndex: number,
        checkpointName: string,
        options?: { timeoutMs?: number }
    ) {
        const { timeoutMs = 5000 } = options || {};

        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            // Use named context key
            const countBefore =
                harness.context.getSnapshotCount(checkpointName);

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
                throw new Error(
                    `Peer ${peerIndex} snapshot count did not increase from baseline ${countBefore} within ${timeoutMs}ms (checkpoint: "${checkpointName}"). ` +
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
    static participantCount({
        expectedCount,
        peerIndex = 0,
        timeoutMs = 10000
    }: {
        expectedCount: number;
        peerIndex?: number;
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            let participants =
                await peer.stateManager.diamondStateMachine.getParticipants();

            if (participants.length === expectedCount) {
                expect(participants.length).to.equal(expectedCount);
                return harness;
            }

            const condition = async () => {
                const currentParticipants =
                    await peer.stateManager.diamondStateMachine.getParticipants();
                return currentParticipants.length === expectedCount;
            };

            await harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Participant count did not reach ${expectedCount} within ${timeoutMs}ms for peer ${peerIndex}`
            });

            participants =
                await peer.stateManager.diamondStateMachine.getParticipants();
            expect(participants.length).to.equal(expectedCount);

            return harness;
        });
    }

    /**
     * Assert that channel totalWithdrawals matches snapshot totalWithdrawals.
     */
    static channelWithdrawalsMatchSnapshot(options?: { peerIndex?: number }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            const channelBalance =
                await harness.channelManager.getChannelBalance(
                    harness.channelId
                );

            const stateMachine = peer.stateManager.diamondStateMachine;
            const balancesMatch = await stateMachine.areBalancesEqual(
                channelBalance.totalWithdrawals,
                onChainSnapshot.snapshotData.totalWithdrawals
            );

            if (!balancesMatch) {
                throw new Error(
                    "Channel totalWithdrawals does not match on-chain snapshot totalWithdrawals"
                );
            }

            return harness;
        });
    }

    /**
     * Assert that withdrawal delta matches expected from prepared snapshot data
     * Requires Context.captureContextForSnapshotSameFork(), Context.storeChannelBalance(), and
     * Context.storeExpectedWithdrawalsDelta() to be called before posting the snapshot.
     */
    static withdrawalDeltaMatchesExpected(options?: { peerIndex?: number }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const stateMachine = peer.stateManager.diamondStateMachine;

            // Get channel balance before (from context) and after

            const channelBalanceAfter =
                await harness.channelManager.getChannelBalance(
                    harness.channelId
                );

            // Calculate actual delta
            const actualDelta = await stateMachine.subtractBalance(
                channelBalanceAfter.totalWithdrawals,
                harness.context.channelBalanceBefore.totalWithdrawals
            );

            // Compare
            const deltaMatches = await stateMachine.areBalancesEqual(
                actualDelta,
                harness.context.expectedWithdrawalsDelta
            );

            if (!deltaMatches) {
                throw new Error(
                    "Actual withdrawal delta does not match expected delta from outbound messages"
                );
            }

            return harness;
        });
    }

    static onChainBalanceMatchesSnapshot(options?: { peerIndex?: number }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            const stateMachine = peer.stateManager.diamondStateMachine;
            const withdrawalsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalWithdrawals,
                harness.context.lastMilestoneSnapshot.snapshotData
                    .totalWithdrawals
            );
            if (!withdrawalsMatch) {
                throw new Error(
                    "On-chain totalWithdrawals does not match last milestone snapshot totalWithdrawals"
                );
            }

            const depositsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalDeposits,
                harness.context.lastMilestoneSnapshot.snapshotData.totalDeposits
            );
            if (!depositsMatch) {
                throw new Error(
                    "On-chain totalDeposits does not match last milestone snapshot totalDeposits"
                );
            }

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
            // Wait for the tampered dispute to be constructed
            const tamperedDispute =
                await harness.context.tamperedDisputePromise;

            // Restore the interception (cleanup)
            harness.context.restoreDisputeConstruction();

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

            harness.context.setSnapshotCount(contextKey, count);

            return harness;
        });
    }

    /**
     * Assert specific peers initiated disputes
     */
    static disputeInitiatedBy(options: {
        peers: number[];
        timeoutMs?: number;
    }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.disputeInitiatedBy(options);
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
}
