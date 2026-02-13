import { StateSnapshot } from "@/models";
import type StateManager from "@/stateManager";
import { HarnessBlock } from "./HarnessBlock";

/**
 * Context namespace - Blocks for storing and managing test context
 *
 * These blocks store information on the harness for use by later blocks
 * in the composition chain.
 */
export class Context {
    /**
     * Mark specific peers as honest (excluding a malicious peer)
     */
    static markMaliciousPeer(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
    }) {
        const { maliciousPeerIndex, honestPeerIndices } = options;

        return new HarnessBlock(async (harness) => {
            const totalPeers = harness.peers.length;
            const honest =
                honestPeerIndices ||
                Array.from({ length: totalPeers }, (_, i) => i).filter(
                    (i) => i !== maliciousPeerIndex
                );

            // Store for later use in assertions/transitions
            harness.context.honestPeerIndices = honest;
            harness.context.maliciousPeerIndex = maliciousPeerIndex;

            return harness;
        });
    }

    /**
     * Update the active fork ID after fork resolution
     */
    static updateActiveFork() {
        return new HarnessBlock(async (harness) => {
            const honestIndices = harness.context.honestPeerIndices;
            if (!honestIndices || honestIndices.length === 0) {
                throw new Error(
                    "honestPeerIndices not set - use Context.markMaliciousPeer first"
                );
            }

            const newForkId =
                harness.peers[honestIndices[0]].stateManager.forkId;
            harness.context.newForkId = newForkId;
            harness.activeForkId = newForkId;

            return harness;
        });
    }

    static capturePrePostSnapshotContext(options?: { peerIndex?: number }) {
        const { peerIndex = 0 } = options || {};

        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID");
            }

            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const lastSnapshot = (
                await peer.stateManager.prepareUpdateSnapshotSameFork(forkId)
            )?.milestoneSnapshots.at(-1);

            const onChainSnapshotBefore = StateSnapshot.from(
                await harness!.channelManager.getStateSnapshot(
                    harness!.channelId
                )
            );

            const expectedWithdrawalsDeltaBalance =
                await Context.computeExpectedWithdrawalsDelta(
                    peer,
                    lastSnapshot!,
                    onChainSnapshotBefore
                );
            const channelBalance =
                await harness.channelManager.getChannelBalance(
                    harness.channelId
                )!;

            harness.context.lastMilestoneSnapshot = lastSnapshot;
            harness.context.expectedWithdrawalsDelta =
                expectedWithdrawalsDeltaBalance;
            harness.context.channelBalanceBefore = channelBalance;

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

            harness.context[`snapshotCount_${contextKey}`] = count;

            return harness;
        });
    }

    private static async computeExpectedWithdrawalsDelta(
        peer: { stateManager: StateManager },
        lastSnapshot: StateSnapshot,
        onChainSnapshotBefore: StateSnapshot
    ) {
        const outboundMessageBlocksForDelta =
            peer.stateManager.storage.outboundMessages.getMessageBlocksInRange(
                lastSnapshot.snapshotData.latestOutboundMessageBlockHash,
                onChainSnapshotBefore.snapshotData
                    .latestOutboundMessageBlockHash
            );

        const stateMachine = peer.stateManager.diamondStateMachine;
        const zeroBalance = await stateMachine.getZeroBalance();
        let expectedWithdrawalsDeltaBalance = zeroBalance;
        for (const outboundBlock of outboundMessageBlocksForDelta) {
            for (const message of outboundBlock.messages) {
                expectedWithdrawalsDeltaBalance = await stateMachine.addBalance(
                    expectedWithdrawalsDeltaBalance,
                    message.balance
                );
            }
        }
        return expectedWithdrawalsDeltaBalance;
    }
}
