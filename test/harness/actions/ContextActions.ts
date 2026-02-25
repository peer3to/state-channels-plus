import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import type StateManager from "@/stateManager";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";

export class ContextActions {
    constructor(
        private harness: PeerTestHarness,
        private _logger: Logger
    ) {}

    markMaliciousPeer(options: {
        maliciousPeerIndex: number;
        honestPeerIndices?: number[];
    }): void {
        const { maliciousPeerIndex, honestPeerIndices } = options;
        const totalPeers = this.harness.peers.length;
        const honest =
            honestPeerIndices ||
            Array.from({ length: totalPeers }, (_, i) => i).filter(
                (i) => i !== maliciousPeerIndex
            );

        this.harness.context.maliciousPeerIndices.push(maliciousPeerIndex);
    }

    async capturePrePostSnapshotContext(options?: {
        peerIndex?: number;
    }): Promise<void> {
        const { peerIndex = 0 } = options || {};
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const lastSnapshot = (
            await peer.stateManager.prepareUpdateSnapshotSameFork(forkId)
        )?.milestoneSnapshots.at(-1);

        const onChainSnapshotBefore = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );

        if (!lastSnapshot) {
            throw new Error("No milestone snapshot available");
        }

        const expectedWithdrawalsDeltaBalance =
            await this.computeExpectedWithdrawalsDelta(
                peer,
                lastSnapshot,
                onChainSnapshotBefore
            );

        const channelBalance =
            await this.harness.channelManager.getChannelBalance(
                this.harness.channelId
            );

        this.harness.context.lastMilestoneSnapshot = lastSnapshot;
        this.harness.context.expectedWithdrawalsDelta =
            expectedWithdrawalsDeltaBalance;
        this.harness.context.channelBalanceBefore = channelBalance;
    }

    storeSnapshotCount(peerIndex: number, contextKey: string): void {
        const snapshotStorage = this.harness.peers[peerIndex].stateManager
            .storage.stateSnapshots as any;
        const count = Array.from(snapshotStorage.snapshotsByHash.keys()).length;
        this.harness.context[`snapshotCount_${contextKey}`] = count;
    }

    captureOriginalFork(): void {
        this.harness.context.originalForkId = this.harness.activeForkId;
    }

    private async computeExpectedWithdrawalsDelta(
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
