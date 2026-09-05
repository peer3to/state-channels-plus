// @spec-test-coverage-ignore: shared transition actions exercised by owning mapped test declarations
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Codec, Logger, sleep, Type } from "@/utils";
import { AStateMachine as AStateMachineContract } from "@typechain-types/index";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Block, StateSnapshot } from "@/models";
import type { IngestBlockConfirmationOptions } from "@/stateManager/ingest/BlockQueueManager";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { ForkId } from "@/types/types";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { Status } from "@/types";

export type TransitionOptions = {
    waitForSync?: boolean;
    /**
     * Only wait for tip agreement on these harness peer indices. Used when some peers are
     * disconnected or out of scope for the scenario; they are not treated as part of this sync wait.
     * When omitted, {@link waitForFinalization} defaults to true; when set, it defaults to false unless
     * you pass {@link waitForFinalization}: true (e.g. remaining participants should still show full union signatures).
     */
    waitForPeers?: number[];
    waitForTurn?: boolean;
    delayMs?: number;
    /**
     * Require `didEveryoneSignBlock` (full participant union on each waited peer’s view) after tip
     * agreement. Omitted: false if {@link waitForPeers} is set, otherwise true.
     */
    waitForFinalization?: boolean;
};

export type AdvanceStateBaseOptions = {
    count?: number;
    rounds?: number;
    waitForSync?: boolean;
    waitForPeers?: number[];
    waitForTurn?: boolean;
    waitForFinalization?: boolean;
};

export type AdvanceStateOptions<
    TContract extends AStateMachineContract = AStateMachineContract
> = AdvanceStateBaseOptions & {
    txFn: (contract: TContract) => Promise<any>;
};

export type KeepAuthoringOptions = {
    until: () => Promise<boolean> | boolean;
    waitForPeers: number[];
    excludePeerIndices?: number[];
    maximumBlocks: number;
};

export function effectiveWaitForFinalization(
    options: Pick<TransitionOptions, "waitForFinalization" | "waitForPeers">
): boolean {
    if (options.waitForFinalization !== undefined) {
        return options.waitForFinalization;
    }
    if (options.waitForPeers !== undefined) {
        return false;
    }
    return true;
}

/**
 * Handles state transition operations on the state machine
 */
export class TransitionActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc,
    TContract extends AStateMachineContract = AStateMachineContract
> {
    constructor(
        protected harness: PeerTestHarness<TCustomRpc, TContract>,
        protected logger: Logger
    ) {}

    /**
     * Submit a valid transaction from the next peer to write
     */
    async submitNext(
        txFn: (contract: TContract) => Promise<any>,
        options: TransitionOptions = { waitForTurn: true, waitForSync: true }
    ): Promise<any> {
        const nextPeer =
            (await this.harness.query.getNextPeerToWrite()) as TestPeer<
                TCustomRpc,
                TContract
            >;

        if (options.waitForTurn) {
            await this.waitForTurn(nextPeer);
        }

        return this.submit(nextPeer, txFn, {
            waitForSync: options.waitForSync ?? true,
            waitForPeers: options.waitForPeers,
            waitForTurn: false, // already waited above
            waitForFinalization: options.waitForFinalization
        });
    }

    async advanceState(options: AdvanceStateOptions<TContract>): Promise<void> {
        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peers.length
            : count;

        for (let i = 0; i < total; i++) {
            await this.submitNext(options.txFn, {
                ...options,
                waitForFinalization:
                    i === total - 1 ? options?.waitForFinalization : false
            });
        }
    }

    /**
     * Keep the writer slot alive until `until` holds: one block per p2p
     * window from the next writer, skipping `excludePeerIndices` (a leaver
     * past its exit turn, a peer that must not author). The harness authors
     * in milliseconds while a leave or promotion settles in seconds on a
     * loaded farm; an idle slot would let an honest peer post a timeout
     * dispute. The bound turns a broken settlement into a diagnosed failure.
     */
    async keepAuthoringUntil(
        options: KeepAuthoringOptions & {
            txFn: (contract: TContract) => Promise<any>;
        }
    ): Promise<number> {
        const { until, waitForPeers, excludePeerIndices = [] } = options;
        const keepAliveMs =
            resolveTestTimeConfig(this.harness.options.timeConfig).p2pTime *
            1000;
        let blocksAuthored = 0;
        // Writer windows spent waiting, on an excluded writer or on a
        // next-writer answer its own host does not confirm, count against the
        // bound too, so a slot that never moves on still ends in the
        // diagnostic below instead of the runner's global timeout.
        let waitingWindows = 0;
        // The slot may already have been idle before this call (a join or a
        // leave request takes seconds), so the first block goes out at once.
        let lastWriteAt = 0;
        while (!(await until())) {
            if (Date.now() - lastWriteAt < keepAliveMs) {
                await sleep(100);
                continue;
            }
            if (blocksAuthored + waitingWindows >= options.maximumBlocks) {
                const forkId = this.harness.activeForkId;
                const states = await Promise.all(
                    this.harness.peers.map(async (peer) => {
                        const control = this.harness.control(peer);
                        const status = await control.query
                            .getStatus()
                            .request();
                        const height = forkId
                            ? await control.query
                                  .getLatestBlockHeight(forkId)
                                  .request()
                            : null;
                        return `peer ${peer.index}: ${Status[status]} at height ${String(height)}`;
                    })
                );
                throw new Error(
                    `Condition not met within ${options.maximumBlocks} keep-alive windows (${blocksAuthored} authored, ${waitingWindows} waiting): ${states.join("; ")}`
                );
            }
            const next = await this.harness.query.getNextPeerToWrite();
            if (excludePeerIndices.includes(next.index)) {
                // The excluded writer's turn: only its own exit or removal
                // moves the slot on, so wait one window for the next poll.
                waitingWindows += 1;
                lastWriteAt = Date.now();
                continue;
            }
            // The next-writer answer comes from the peer with the highest
            // block; the writer's own host decides the turn, and a block that
            // just landed (an exit turn) can move the slot between the two.
            const myTurn = await this.harness
                .control(next)
                .query.isMyTurn()
                .request();
            if (!myTurn) {
                // A stale next-writer answer: one window of waiting, then
                // re-query. Counted, so a slot that never confirms ends in
                // the diagnostic above.
                waitingWindows += 1;
                lastWriteAt = Date.now();
                continue;
            }
            const writer = this.harness.peers[next.index];
            if (!writer) throw new Error(`Peer ${next.index} not found`);
            // The window starts when the block is stamped, not when its sync
            // settles. A stamp is capped at the previous relevant timestamp
            // plus p2pTime, so counting the sync into the gap makes every
            // keep-alive block late and the stamps fall behind the wall clock
            // until the subjective window rejects them.
            lastWriteAt = Date.now();
            await this.submit(writer, options.txFn, { waitForPeers });
            blocksAuthored += 1;
        }
        return blocksAuthored;
    }

    async fromHonestPeersOnly(
        txFn: (contract: TContract) => Promise<any>,
        options?: { waitForSync?: boolean }
    ): Promise<void> {
        const syncIndices = this.harness
            .getActiveHonestPeers()
            .map((p) => p.index);

        // waitForPeers limits who we barrier on, but we still want union finalization on those peers.
        await this.submitNext(txFn, {
            waitForTurn: true,
            waitForPeers: syncIndices,
            waitForSync: options?.waitForSync ?? true,
            waitForFinalization: true
        });
    }

    async sequenceFromHonestPeers(
        txFns: Array<(contract: TContract) => Promise<any>>
    ): Promise<void> {
        const syncIndices = this.harness
            .getActiveHonestPeers()
            .map((p) => p.index);
        if (!syncIndices) {
            throw new Error(
                "honestPeerIndices not set - resolve dispute context first"
            );
        }

        for (const txFn of txFns) {
            await this.submitNext(txFn, {
                waitForTurn: true,
                waitForPeers: syncIndices,
                waitForSync: true,
                // Same as fromHonestPeersOnly: filtered barrier, full finalization on waited peers.
                waitForFinalization: true
            });
        }
    }

    async postSnapshot(options?: {
        peerIndex?: number;
        forkId?: string;
    }): Promise<StateSnapshot | undefined> {
        return this.requestPostSnapshot(options, false);
    }

    async postSnapshotWait(options?: {
        peerIndex?: number;
        forkId?: string;
        timeoutMs?: number;
    }): Promise<StateSnapshot | undefined> {
        // Submit without holding the control RPC open for the transaction:
        // a mined transaction on a loaded farm outlasts the RPC budget. The
        // barrier below is the completion signal; a failed post surfaces as
        // a detached host error at quiesce.
        const expectedSnapshot = await this.requestPostSnapshot(options, false);
        if (!expectedSnapshot) return undefined;

        const timeoutMs =
            options?.timeoutMs ??
            this.harness.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            });
        await this.harness.eventCountsBarrier.waitFor(
            async () => {
                const honestPeers = this.harness.getHonestPeers();
                const localSnapshots = await Promise.all(
                    honestPeers.map((peer) =>
                        this.harness.query.getLocalStateSnapshot(peer)
                    )
                );
                return localSnapshots.every(
                    (s) => s.hash === expectedSnapshot.hash
                );
            },
            {
                timeoutMs,
                timeoutMessage: `postSnapshotWait: honest peers did not observe expected snapshot ${expectedSnapshot.hash} within ${timeoutMs}ms`
            }
        );
        return expectedSnapshot;
    }

    private async requestPostSnapshot(
        options: { peerIndex?: number; forkId?: string } | undefined,
        awaitCompletion: boolean
    ): Promise<StateSnapshot | undefined> {
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const transition = this.harness.control(peer).transition;
        const result = awaitCompletion
            ? await transition.postStateSnapshotWait(forkId).request()
            : await transition.postStateSnapshot(forkId).request();
        return result
            ? StateSnapshot.from(
                  Codec.decode(result.encodedSnapshot, Type.StateSnapshot)
              )
            : undefined;
    }

    async postSameForkSnapshotOnlyWait(options?: {
        peerIndex?: number;
        forkId?: string;
    }) {
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const sameForkData = await this.harness
            .control(peer)
            .transition.prepareUpdateSnapshotSameFork(forkId)
            .request();
        if (!sameForkData.canPost || sameForkData.callData.length === 0)
            return undefined;

        const transaction =
            await peer.p2pInstance.stateChannelManagerContract.multicall(
                sameForkData.callData
            );
        await transaction.wait();
        if (!sameForkData.encodedExpectedSnapshot) {
            throw new Error(
                "Admissible same-fork snapshot calldata is missing its expected snapshot"
            );
        }
        return {
            snapshot: StateSnapshot.from(
                Codec.decode(
                    sameForkData.encodedExpectedSnapshot,
                    Type.StateSnapshot
                )
            ),
            transaction
        };
    }

    async validWithoutPeer(
        excludePeer: number,
        txFn: (contract: TContract) => Promise<any>
    ): Promise<void> {
        const includedPeers = this.harness.peers
            .map((_: unknown, i: number) => i)
            .filter((i: number) => i !== excludePeer);

        await this.submitNext(txFn, {
            waitForPeers: includedPeers,
            waitForSync: true,
            // Exclude one peer from the sync barrier only; still require finalized tips on included peers.
            waitForFinalization: true
        });
    }

    /**
     * Submit a transaction from a specific peer
     */
    async submit(
        peer: TestPeer<TCustomRpc, TContract>,
        txFn: (contract: TContract) => Promise<any>,
        options: TransitionOptions = {}
    ): Promise<any> {
        const waitForSync = options.waitForSync ?? true;

        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }

        if (options.delayMs) await sleep(options.delayMs);

        const result = await txFn(peer.p2pInstance.p2pContractInstance);

        if (waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const minHeight =
                (await this.harness
                    .control(peer)
                    .query.getLatestBlockHeight(forkId)
                    .request()) ?? undefined;

            const peers =
                options.waitForPeers !== undefined
                    ? this.harness.getFilteredPeers(options.waitForPeers)
                    : this.harness.getActiveHonestPeers();
            const waitForFinalization = effectiveWaitForFinalization(options);
            await this.harness.syncCoordinator.waitForPeersToSync(
                peers,
                forkId,
                {
                    minHeight,
                    waitForFinalization,
                    timeoutMs: this.harness.event.protocolEventTimeoutMs()
                }
            );
        }

        return result;
    }

    async ingestBlockConfirmationWait(options: {
        peerIndex: number;
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: IngestBlockConfirmationOptions;
        keepConnection?: boolean;
        waitForProcessed?: boolean;
        processedKeepConnection?: boolean;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            peerIndex,
            blockConfirmation,
            ingestOptions,
            keepConnection: expectedKeepConnection,
            waitForProcessed = true,
            processedKeepConnection,
            timeoutMs
        } = options;
        const peer = this.harness.getPeer(peerIndex);
        const block = Block.fromBlockConfirmation(
            blockConfirmation,
            ingestOptions?.onChainTimestamp
        );
        const keepConnection = await this.harness
            .control(peer)
            .transition.ingestBlockConfirmation(
                Codec.encode(
                    blockConfirmation,
                    Type.BlockConfirmation
                ) as string,
                ingestOptions
            )
            .request();

        if (
            expectedKeepConnection !== undefined &&
            keepConnection !== expectedKeepConnection
        ) {
            throw new Error(
                `Expected ingestBlockConfirmation keepConnection=${expectedKeepConnection}, got ${keepConnection}`
            );
        }

        if (!keepConnection || !waitForProcessed) {
            return;
        }

        await this.harness.event.waitForBlockConfirmationProcessed({
            peerIndex,
            blockHash: block.hash,
            keepConnection: processedKeepConnection,
            timeoutMs
        });
    }

    /**
     * Wait for a peer to receive their turn
     */
    private async waitForTurn(
        peer: TestPeer<TCustomRpc, TContract>,
        timeoutMs?: number
    ): Promise<void> {
        const waitTimeoutMs =
            timeoutMs ?? this.harness.event.participantTimeoutWaitMs(1);
        try {
            await peer.turnBarrier.waitFor(
                async () =>
                    await this.harness.control(peer).query.isMyTurn().request(),
                {
                    timeoutMs: waitTimeoutMs,
                    timeoutMessage: `Turn not received within ${waitTimeoutMs}ms`
                }
            );
            this.logger.debug(`Peer ${peer.index} turn`);
        } catch (e) {
            this.logger.error(`Peer ${peer.index} turn wait timed out`);
            throw e;
        }
    }
    /**
     * White-box: run `tryMergeStoredBlockConfirmation` on the host, under the
     * peer's live, spectating, calldata, or a fabricated dispute strategy.
     * Returns the merge result and the persisted signature set.
     */
    async runStoredBlockMerge(options: {
        peerIndex: number;
        confirmation: { signedBlock: unknown; signatures: string[] };
        strategy?: "active" | "dispute" | "spectating" | "calldata";
    }): Promise<{
        result: number | null;
        persistedSignatures: string[] | null;
    }> {
        const { peerIndex, confirmation, strategy } = options;
        return await this.harness
            .control(this.harness.getPeer(peerIndex))
            .stub.runStoredBlockMerge(
                Codec.encode(
                    confirmation as BlockConfirmationStruct,
                    Type.BlockConfirmation
                ) as string,
                strategy ? { strategy } : undefined
            )
            .request();
    }

    /**
     * White-box: run `StateApplicationService.unsafeSetLatestState` with the
     * peer's own latest stored snapshot/state, optionally shifting the
     * snapshot timestamp, and return the recomputed status.
     */
    async runSetLatestState(options: {
        peerIndex: number;
        forkId: ForkId;
        timestampOverride?: number;
        timestampOffsetSeconds?: number;
    }): Promise<Status> {
        const { peerIndex, forkId, timestampOverride, timestampOffsetSeconds } =
            options;
        return await this.harness.execOnHost(
            this.harness.getPeer(peerIndex),
            async (sm, args) => {
                const next = sm.storage.blocks.getNextBlockHeight(args.forkId);
                const model =
                    sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow({
                        forkId: args.forkId,
                        height: next
                    });
                const encodedState =
                    sm.storage.stateMachineStates.getStateMachineState(
                        model.stateMachineStateHash
                    );
                if (!encodedState) throw new Error("no stored machine state");
                await sm.stateApplicationService.unsafeSetLatestState(
                    {
                        forkId: model.forkID,
                        blockHeight: model.blockHeight,
                        timestamp:
                            args.timestampOverride ??
                            Number(model.timestamp) +
                                (args.timestampOffsetSeconds ?? 0),
                        snapshotData: model.snapshotData
                    },
                    encodedState
                );
                return sm.status;
            },
            { forkId, timestampOverride, timestampOffsetSeconds }
        );
    }
}
