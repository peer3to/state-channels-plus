import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

export class ContextActions {
    constructor(
        private harness: PeerTestHarness,
        private _logger: Logger
    ) {}

    markMaliciousPeer(options: { maliciousPeerIndex: number }): void {
        const { maliciousPeerIndex } = options;

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

        const peerHandle = this.harness.getPeerHandle(peerIndex);
        const lastSnapshotStruct =
            await peerHandle.snapshots.queryLastMilestoneSnapshot(forkId);
        const lastSnapshot = lastSnapshotStruct
            ? StateSnapshot.from(lastSnapshotStruct)
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
        const expectedWithdrawalsDeltaBalance =
            await peerHandle.balance.computeExpectedWithdrawalsDelta({
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

    async storeSnapshotCount(
        peerIndex: number,
        contextKey: string
    ): Promise<void> {
        const count = await this.harness
            .getPeerHandle(peerIndex)
            .snapshots.queryStateSnapshotCount();
        this.harness.context[`snapshotCount_${contextKey}`] = count;
    }

    captureOriginalFork(): void {
        this.harness.context.originalForkId = this.harness.activeForkId;
    }
}
