import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PeerHandle, NamedOpRequest } from "@test/harness/core/PeerHandle";
import { Logger, sleep } from "@/utils";
import { AStateMachine as AStateMachineContract } from "@typechain-types/index";
import { MainRpcService } from "@/rpc";
import { Block, StateSnapshot } from "@/models";
import type { IngestBlockConfirmationOptions } from "@/stateManager/BlockQueueManager";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

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

export type AdvanceStateOptions = AdvanceStateBaseOptions & {
    txFn: NamedOpRequest;
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
    TCustomRpc extends MainRpcService = MainRpcService,
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
        opRequest: NamedOpRequest,
        options: TransitionOptions = { waitForTurn: true, waitForSync: true }
    ): Promise<any> {
        const nextPeer = await this.harness.query.getNextPeerToWrite();

        if (options.waitForTurn) {
            await this.waitForTurn(nextPeer);
        }

        return this.submitOp(nextPeer, opRequest, {
            waitForSync: options.waitForSync ?? true,
            waitForPeers: options.waitForPeers,
            waitForTurn: false, // already waited above
            waitForFinalization: options.waitForFinalization
        });
    }

    async advanceState(options: AdvanceStateOptions): Promise<void> {
        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peerCount
            : count;

        for (let i = 0; i < total; i++) {
            await this.submitNext(options.txFn, {
                ...options,
                waitForFinalization:
                    i === total - 1 ? options?.waitForFinalization : false
            });
        }
    }

    async fromHonestPeersOnly(
        txFn: NamedOpRequest,
        options?: { waitForSync?: boolean }
    ): Promise<void> {
        const syncIndices = this.harness
            .getPeersExcludingMaliciousAndLeavers()
            .map((p) => p.index);

        // waitForPeers limits who we barrier on, but we still want union finalization on those peers.
        await this.submitNext(txFn, {
            waitForTurn: true,
            waitForPeers: syncIndices,
            waitForSync: options?.waitForSync ?? true,
            waitForFinalization: true
        });
    }

    async sequenceFromHonestPeers(txFns: NamedOpRequest[]): Promise<void> {
        const syncIndices = this.harness
            .getPeersExcludingMaliciousAndLeavers()
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
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const struct = await this.harness
            .getPeerHandle(peerIndex)
            .snapshots.postStateSnapshot(forkId);
        return struct ? StateSnapshot.from(struct) : undefined;
    }

    async postSnapshotWait(options?: {
        peerIndex?: number;
        forkId?: string;
        timeoutMs?: number;
    }): Promise<StateSnapshot | undefined> {
        const expectedSnapshot = await this.postSnapshot(options);
        if (!expectedSnapshot) return undefined;

        const timeoutMs = options?.timeoutMs ?? 8000;
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

    async postSameForkSnapshotOnlyWait(options?: {
        peerIndex?: number;
        forkId?: string;
    }): Promise<StateSnapshot | undefined> {
        const { peerIndex = 0 } = options || {};
        const forkId = options?.forkId || this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const handle = this.harness.getPeerHandle(peerIndex);
        const sameForkData =
            await handle.snapshots.prepareUpdateSnapshotSameFork(forkId);
        if (!sameForkData || sameForkData.callData.length === 0)
            return undefined;

        const channelManager = this.harness.channelManager.connect(
            handle.signer
        );
        const tx = await channelManager.multicall(sameForkData.callData);
        await tx.wait();
        const expected = sameForkData.expectedSnapshot;
        if (expected && expected instanceof StateSnapshot) {
            return expected;
        }
        return expected
            ? StateSnapshot.from(
                  expected as Parameters<typeof StateSnapshot.from>[0]
              )
            : undefined;
    }

    // Submit a named transition op from a specific peer. Polymorphic: inline
    // runs the op via the injected handler table, worker via the rpc route.
    async submitOp(
        peer: PeerHandle,
        opRequest: NamedOpRequest,
        options: TransitionOptions = {}
    ): Promise<any> {
        return this.submitInner(
            peer,
            () => peer.transition.submitNext(opRequest),
            options
        );
    }

    private async submitInner(
        peer: PeerHandle,
        txExec: () => Promise<unknown>,
        options: TransitionOptions
    ): Promise<unknown> {
        const waitForSync = options.waitForSync ?? true;

        if (options.waitForTurn) {
            await this.waitForTurn(peer);
        }

        if (options.delayMs) await sleep(options.delayMs);

        const result = await txExec();

        if (waitForSync) {
            const forkId = this.harness.activeForkId;
            if (!forkId) {
                throw new Error("No active fork ID - cannot wait for sync");
            }

            const latest = await peer.blocks.queryLatestBlock(forkId);
            const minHeight = latest?.height;

            const peers =
                options.waitForPeers !== undefined
                    ? this.harness.getFilteredPeers(options.waitForPeers)
                    : this.harness.getPeersExcludingMaliciousAndLeavers();
            const waitForFinalization = effectiveWaitForFinalization(options);
            await this.harness.syncCoordinator.waitForPeersToSync(
                peers,
                forkId,
                { minHeight, waitForFinalization }
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
        const block = Block.fromBlockConfirmation(
            blockConfirmation,
            ingestOptions?.onChainTimestamp
        );
        const keepConnection = (await this.harness
            .getPeerHandle(peerIndex)
            .blocks.ingestBlockConfirmation({
                blockConfirmation,
                ingestOptions
            })) as boolean;

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
        peer: PeerHandle,
        timeoutMs = 3000
    ): Promise<void> {
        try {
            await peer.turnBarrier.waitFor(() => peer.channel.queryIsMyTurn(), {
                timeoutMs,
                timeoutMessage: `Turn not received within ${timeoutMs}ms`
            });
            this.logger.debug(`Peer ${peer.index} turn`);
        } catch (e) {
            this.logger.error(`Peer ${peer.index} turn wait timed out`);
            throw e;
        }
    }
}
