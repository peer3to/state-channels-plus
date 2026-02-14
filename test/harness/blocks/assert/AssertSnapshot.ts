import { HarnessBlock } from "../HarnessBlock";
import { StateSnapshot } from "@/models";

export class AssertSnapshot {
    /**
     * Assert on-chain snapshot is on the expected fork
     */
    static onChainSnapshotOnFork(options?: { expectedForkId?: string }) {
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

            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            const blockHeight =
                options?.blockHeight ||
                peer.stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

            const localSnapshot = peer.stateManager.storage.getStateSnapshot({
                forkId,
                height: blockHeight
            });

            if (!localSnapshot) {
                throw new Error(
                    `No local snapshot found at height ${blockHeight} on fork ${forkId}`
                );
            }

            if (onChainSnapshot.blockHeight !== blockHeight) {
                throw new Error(
                    `Expected on-chain snapshot height ${blockHeight}, ` +
                        `but found ${onChainSnapshot.blockHeight}`
                );
            }

            if (onChainSnapshot.hash !== localSnapshot.hash) {
                throw new Error(
                    `Expected on-chain snapshot hash ${localSnapshot.hash}, ` +
                        `but found ${onChainSnapshot.hash}`
                );
            }

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
     * Uses Context.storeSnapshotCount() to set the baseline checkpoint
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

            const countBefore =
                harness.context[`snapshotCount_${checkpointName}`];
            if (countBefore === undefined) {
                throw new Error(
                    `No baseline snapshot count found for checkpoint "${checkpointName}". Use Context.storeSnapshotCount() first.`
                );
            }

            const snapshotStorage = peer.stateManager.storage
                .stateSnapshots as any;

            const condition = () => {
                const countAfter = Array.from(
                    snapshotStorage.snapshotsByHash.keys()
                ).length;
                return countAfter > countBefore;
            };

            if (condition()) {
                return harness;
            }

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

            const channelBalanceBefore = harness.context.channelBalanceBefore;
            if (!channelBalanceBefore) {
                throw new Error(
                    "No channelBalanceBefore in context. Call Context.storeChannelBalance() before posting snapshot."
                );
            }

            const channelBalanceAfter =
                await harness.channelManager.getChannelBalance(
                    harness.channelId
                );

            const actualDelta = await stateMachine.subtractBalance(
                channelBalanceAfter.totalWithdrawals,
                channelBalanceBefore.totalWithdrawals
            );
            const expectedWithdrawalsDelta =
                harness.context.expectedWithdrawalsDelta;
            if (!expectedWithdrawalsDelta) {
                throw new Error(
                    "No expectedWithdrawalsDelta in context. Call Context.captureContextForSnapshotSameFork() first."
                );
            }

            const deltaMatches = await stateMachine.areBalancesEqual(
                actualDelta,
                expectedWithdrawalsDelta
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

            const lastSnapshot = harness.context.lastMilestoneSnapshot;
            if (!lastSnapshot) {
                throw new Error(
                    "No last milestone snapshot found in context. Call Context.captureContextForSnapshotSameFork() first."
                );
            }

            const onChainSnapshot = StateSnapshot.from(
                await harness.channelManager.getStateSnapshot(harness.channelId)
            );

            const stateMachine = peer.stateManager.diamondStateMachine;
            const withdrawalsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalWithdrawals,
                lastSnapshot.snapshotData.totalWithdrawals
            );
            if (!withdrawalsMatch) {
                throw new Error(
                    "On-chain totalWithdrawals does not match last milestone snapshot totalWithdrawals"
                );
            }

            const depositsMatch = await stateMachine.areBalancesEqual(
                onChainSnapshot.snapshotData.totalDeposits,
                lastSnapshot.snapshotData.totalDeposits
            );
            if (!depositsMatch) {
                throw new Error(
                    "On-chain totalDeposits does not match last milestone snapshot totalDeposits"
                );
            }

            return harness;
        });
    }
}
