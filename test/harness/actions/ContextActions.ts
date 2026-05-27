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

        const handle = this.harness.getPeerHandle(peerIndex);
        // step 1 - W1 - milestone read via sub-handle. worker mode ships a
        // plain struct (lost class getters); rehydrate via StateSnapshot.from
        // so downstream LoggerUtils.getSnapshotMetadata + accessors work.
        const lastSnapshotRaw = await handle.queryLastMilestoneSnapshot(forkId);
        const lastSnapshot = lastSnapshotRaw
            ? lastSnapshotRaw instanceof StateSnapshot
                ? lastSnapshotRaw
                : StateSnapshot.from(
                      lastSnapshotRaw as Parameters<
                          typeof StateSnapshot.from
                      >[0]
                  )
            : undefined;

        const onChainSnapshotBefore = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );

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
        // step 2 - W1 - withdrawals delta computed by the sub-handle (one
        // round-trip; the outboundMessages walk + diamondStateMachine math
        // runs in the peer's process). returned struct is { amount, data }.
        const expectedWithdrawalsDeltaBalance =
            await handle.computeExpectedWithdrawalsDelta({
                upperBlockHash: String(
                    lastSnapshot.snapshotData.latestOutboundMessageBlockHash
                ),
                lowerBlockHash: onChainSnapshotBefore.snapshotData
                    .latestOutboundMessageBlockHash
                    ? String(
                          onChainSnapshotBefore.snapshotData
                              .latestOutboundMessageBlockHash
                      )
                    : undefined
            });

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
