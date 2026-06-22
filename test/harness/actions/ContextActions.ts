import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import type StateManager from "@/stateManager";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

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

        const onChainSnapshotBefore = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );

        const lastSnapshot =
            onChainSnapshotBefore.forkID === forkId
                ? await this.getLastSnapshotForSameFork(peer, forkId)
                : this.getLatestMilestoneSnapshot(peer);

        if (!lastSnapshot) {
            throw new Error("No milestone snapshot available");
        }
        this.harness.logger.debug(
            "CapturePrePostSnapshotContext - Calculating expected withdrawals delta",
            {
                currentOnChainSnapshot: LoggerUtils.getSnapshotMetadata(
                    onChainSnapshotBefore
                ),
                newSnapshot: LoggerUtils.getSnapshotMetadata(lastSnapshot)
            }
        );
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

    private getLatestMilestoneSnapshot(peer: {
        stateManager: StateManager;
    }): StateSnapshot | undefined {
        const snapshotStorage = peer.stateManager.storage.stateSnapshots as any;
        const snapshots = Array.from(snapshotStorage.snapshotsByHash.values());
        return snapshots[snapshots.length - 1] as StateSnapshot | undefined;
    }

    private async getLastSnapshotForSameFork(
        peer: {
            stateManager: StateManager;
        },
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        try {
            return (
                await peer.stateManager.prepareUpdateSnapshotSameFork(forkId)
            )?.milestoneSnapshots.at(-1);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes("Fork mismatch")
            ) {
                return this.getLatestMilestoneSnapshot(peer);
            }

            throw error;
        }
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
            peer.stateManager.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    lastSnapshot.snapshotData.latestOutboundMessageBlockHash,
                lowerBlockHash:
                    onChainSnapshotBefore.snapshotData
                        .latestOutboundMessageBlockHash
            });

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
