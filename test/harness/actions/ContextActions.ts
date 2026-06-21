import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Codec, Logger, Type } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";

export class ContextActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
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

        const sameFork = await this.harness
            .control(peer)
            .transition.prepareUpdateSnapshotSameFork(forkId)
            .request();
        const encodedLastSnapshot = sameFork?.encodedMilestoneSnapshots.at(-1);
        const lastSnapshot = encodedLastSnapshot
            ? StateSnapshot.from(
                  Codec.decode(encodedLastSnapshot, Type.StateSnapshot)
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
        const encodedExpectedWithdrawalsDelta =
            await this.computeExpectedWithdrawalsDelta(
                peerIndex,
                lastSnapshot,
                onChainSnapshotBefore
            );

        const channelBalance =
            await this.harness.channelManager.getChannelBalance(
                this.harness.channelId
            );

        this.harness.context.lastMilestoneSnapshot = lastSnapshot;
        this.harness.context.encodedExpectedWithdrawalsDelta =
            encodedExpectedWithdrawalsDelta;
        this.harness.context.channelBalanceBefore = channelBalance;
    }

    async storeSnapshotCount(
        peerIndex: number,
        contextKey: string
    ): Promise<void> {
        const count = await this.harness
            .control(this.harness.getPeer(peerIndex))
            .query.getSnapshotCount()
            .request();
        this.harness.context[`snapshotCount_${contextKey}`] = count;
    }

    captureOriginalFork(): void {
        this.harness.context.originalForkId = this.harness.activeForkId;
    }

    private async computeExpectedWithdrawalsDelta(
        peerIndex: number,
        lastSnapshot: StateSnapshot,
        onChainSnapshotBefore: StateSnapshot
    ) {
        const { encodedBalanceDelta } = await this.harness
            .control(this.harness.getPeer(peerIndex))
            .balance.computeWithdrawalsDelta(
                lastSnapshot.snapshotData
                    .latestOutboundMessageBlockHash as string,
                onChainSnapshotBefore.snapshotData
                    .latestOutboundMessageBlockHash as string
            )
            .request();
        return encodedBalanceDelta;
    }
}
