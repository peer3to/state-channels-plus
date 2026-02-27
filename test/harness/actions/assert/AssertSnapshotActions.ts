import { StateSnapshot } from "@/models";
import { DetachedPromises } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

export class AssertSnapshotActions {
    constructor(private readonly harness: PeerTestHarness) {}

    async onChainSnapshotOnFork(options?: {
        expectedForkId?: string;
    }): Promise<void> {
        const expectedForkId =
            options?.expectedForkId || this.harness.activeForkId;
        if (!expectedForkId) {
            throw new Error("No fork ID specified and no active fork ID");
        }

        const onChainSnapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );

        if (onChainSnapshot.forkID !== expectedForkId) {
            throw new Error(
                `Expected on-chain snapshot to be on fork ${expectedForkId}, but found ${onChainSnapshot.forkID}`
            );
        }
    }

    async onChainSnapshotChangedDetached(options?: {
        expectedForkId?: string;
        expectedSnapshot?: StateSnapshot;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            expectedForkId,
            expectedSnapshot,
            timeoutMs = 8000
        } = options || {};

        let honestPeers;
        let localSnapshots: StateSnapshot[] = [];
        const condition = async () => {
            honestPeers = this.harness.getHonestPeers();
            localSnapshots = await Promise.all(
                honestPeers.map((peer) =>
                    this.harness.query.getLocalStateSnapshot(peer)
                )
            );
            for (const localSnapshot of localSnapshots) {
                if (
                    expectedSnapshot &&
                    expectedSnapshot.hash !== localSnapshot.hash
                )
                    return false;
                if (
                    !expectedSnapshot &&
                    expectedForkId &&
                    localSnapshot.forkID !== expectedForkId
                )
                    return false;
            }

            return true; // all honest peers observed a snapshot update event
        };

        const promise = this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: timeoutMs,
            timeoutMessage: `On-chain snapshot did not change within ${timeoutMs}ms`,
            timeoutMeta: {
                expectedForkId,
                expectedSnapshot: expectedSnapshot
                    ? LoggerUtils.getSnapshotMetadata(expectedSnapshot)
                    : undefined,
                localSnapshots: localSnapshots.map((s) =>
                    LoggerUtils.getSnapshotMetadata(s)
                )
            }
        });
        DetachedPromises.collect(promise);
    }

    async snapshotMatchesLocal(options?: {
        peerIndex?: number;
        forkId?: string;
        blockHeight?: number;
    }): Promise<void> {
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No fork ID specified and no active fork ID");
        }

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const onChainSnapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
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
                `Expected on-chain snapshot height ${blockHeight}, but found ${onChainSnapshot.blockHeight}`
            );
        }

        if (onChainSnapshot.hash !== localSnapshot.hash) {
            throw new Error(
                `Expected on-chain snapshot hash ${localSnapshot.hash}, but found ${onChainSnapshot.hash}`
            );
        }
    }

    async withdrawalDeltaMatchesExpected(options?: {
        peerIndex?: number;
    }): Promise<void> {
        const { peerIndex = 0 } = options || {};
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const stateMachine = peer.stateManager.diamondStateMachine;
        const channelBalanceBefore = this.harness.context.channelBalanceBefore;
        if (!channelBalanceBefore) {
            throw new Error(
                "No channelBalanceBefore in context. Call context capture first."
            );
        }

        const channelBalanceAfter =
            await this.harness.channelManager.getChannelBalance(
                this.harness.channelId
            );

        const actualDelta = await stateMachine.subtractBalance(
            channelBalanceAfter.totalWithdrawals,
            channelBalanceBefore.totalWithdrawals
        );
        const expectedWithdrawalsDelta =
            this.harness.context.expectedWithdrawalsDelta;
        if (!expectedWithdrawalsDelta) {
            throw new Error(
                "No expectedWithdrawalsDelta in context. Call context capture first."
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
    }

    async verifyOnChainChannelBalanceInvariant(options?: {
        peerIndex?: number;
        encodedStateMachineState?: string;
    }): Promise<void> {
        const { peerIndex = 0, encodedStateMachineState } = options || {};
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const onChainSnapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );

        const encodedState =
            encodedStateMachineState ??
            peer.stateManager.storage.stateMachineStates.getStateMachineState(
                onChainSnapshot.stateMachineStateHash
            );

        if (!encodedState) {
            throw new Error(
                `No encoded state machine state found for on-chain snapshot state hash ${onChainSnapshot.stateMachineStateHash}`
            );
        }

        const isValidBalanceInvariant =
            await peer.stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                this.harness.channelId,
                onChainSnapshot.snapshotData,
                encodedState
            );

        if (!isValidBalanceInvariant) {
            throw new Error("On-chain snapshot balance invariant check failed");
        }
    }

    async snapshotCountIncreasedSince(
        peerIndex: number,
        checkpointName: string,
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const { timeoutMs = 5000 } = options || {};
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const countBefore =
            this.harness.context[`snapshotCount_${checkpointName}`];
        if (countBefore === undefined) {
            throw new Error(
                `No baseline snapshot count found for checkpoint "${checkpointName}"`
            );
        }

        const snapshotStorage = peer.stateManager.storage.stateSnapshots as any;
        const condition = () =>
            Array.from(snapshotStorage.snapshotsByHash.keys()).length >
            countBefore;

        if (!condition()) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Snapshot count did not increase within ${timeoutMs}ms`
            });
        }
    }
}
