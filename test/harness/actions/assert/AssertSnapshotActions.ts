import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import { Codec, DetachedPromises, Type } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

export class AssertSnapshotActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private readonly harness: PeerTestHarness<TCustomRpc>) {}

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
    async onChainSnapshotChangedWait(options?: {
        expectedForkId?: ForkId;
        previousForkId?: ForkId;
        expectedSnapshot?: StateSnapshot;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            expectedForkId,
            previousForkId,
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
                if (previousForkId && localSnapshot.forkID === previousForkId)
                    return false;
            }

            return true; // all honest peers observed a snapshot update event
        };

        const promise = this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: timeoutMs,
            timeoutMessage: `On-chain snapshot did not change within ${timeoutMs}ms`,
            timeoutMeta: {
                expectedForkId,
                previousForkId,
                expectedSnapshot: expectedSnapshot
                    ? LoggerUtils.getSnapshotMetadata(expectedSnapshot)
                    : undefined,
                localSnapshots: localSnapshots.map((s) =>
                    LoggerUtils.getSnapshotMetadata(s)
                )
            }
        });
        return promise;
    }

    onChainSnapshotChangedDetached(options?: {
        expectedForkId?: string;
        expectedSnapshot?: StateSnapshot;
        timeoutMs?: number;
    }): void {
        const detachedPromise = this.onChainSnapshotChangedWait(options);
        DetachedPromises.collect(detachedPromise);
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
            (await this.harness
                .control(peer)
                .query.getNextBlockHeight(forkId)
                .request()) - 1;

        const localResult = await this.harness
            .control(peer)
            .query.getStateSnapshotStructAt(forkId, blockHeight)
            .request();
        const localSnapshot = localResult
            ? StateSnapshot.from(
                  Codec.decode(localResult.encodedSnapshot, Type.StateSnapshot)
              )
            : undefined;

        if (!localSnapshot) {
            throw new Error(
                `No local snapshot found at height ${blockHeight} on fork ${forkId}`
            );
        }
        //  at genesis, onChainSnapshot.blockHeight is 0, but blockHeight is -1
        //  normalize blockHeight to 0 at genesis
        const normalizedBlockHeight = Math.max(blockHeight, 0);

        if (onChainSnapshot.blockHeight !== normalizedBlockHeight) {
            throw new Error(
                `Expected on-chain snapshot height ${normalizedBlockHeight}, but found ${onChainSnapshot.blockHeight}`
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

        const balanceRpc = this.harness.control(peer).balance;
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

        const { encodedBalance: encodedActualDelta } = await balanceRpc
            .subtractBalance(
                Codec.encode(
                    channelBalanceAfter.totalWithdrawals,
                    Type.Balance
                ) as string,
                Codec.encode(
                    channelBalanceBefore.totalWithdrawals,
                    Type.Balance
                ) as string
            )
            .request();
        const encodedExpectedWithdrawalsDelta =
            this.harness.context.encodedExpectedWithdrawalsDelta;
        if (!encodedExpectedWithdrawalsDelta) {
            throw new Error(
                "No expectedWithdrawalsDelta in context. Call context capture first."
            );
        }

        const deltaMatches = await balanceRpc
            .areBalancesEqual(
                encodedActualDelta,
                encodedExpectedWithdrawalsDelta
            )
            .request();

        if (!deltaMatches) {
            const expected = Codec.decode(
                encodedExpectedWithdrawalsDelta,
                Type.Balance
            );
            const actual = Codec.decode(encodedActualDelta, Type.Balance);
            throw new Error(
                `Actual withdrawal delta does not match expected delta from outbound messages. Expected: ${expected.amount.toString()}, Actual: ${actual.amount.toString()}`
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
            (await this.harness
                .control(peer)
                .query.getStateMachineState(
                    onChainSnapshot.stateMachineStateHash
                )
                .request()) ??
            undefined;

        if (!encodedState) {
            throw new Error(
                `No encoded state machine state found for on-chain snapshot state hash ${onChainSnapshot.stateMachineStateHash}`
            );
        }

        const isValidBalanceInvariant =
            await this.harness.channelManager.verifyBalanceInvariantCheckSnapshot.staticCall(
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

        const condition = async () =>
            (await this.harness
                .control(peer)
                .query.getSnapshotCount()
                .request()) > countBefore;

        if (!(await condition())) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Snapshot count did not increase within ${timeoutMs}ms`
            });
        }
    }
}
