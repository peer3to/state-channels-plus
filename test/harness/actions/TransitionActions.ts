import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { TestPeer } from "@test/harness/core/types";
import { Logger, sleep } from "@/utils";
import { AStateMachine as AStateMachineContract } from "@typechain-types/index";
import { MainRpcService } from "@/rpc";
import { Block, StateSnapshot } from "@/models";
import type { IngestBlockConfirmationOptions } from "@/stateManager/BlockQueueManager";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { rejectClosureInWorkerMode } from "@test/harness/core/namedOpGuards";

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
        txFn:
            | ((contract: TContract) => Promise<any>)
            | { op: string; args?: unknown },
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

        // step 1 - named-op shape -> route through submitOp (worker safe).
        // lambda shape -> legacy submit path (inline only).
        if (typeof txFn !== "function") {
            return this.submitOp(nextPeer, txFn, {
                waitForSync: options.waitForSync ?? true,
                waitForPeers: options.waitForPeers,
                waitForTurn: false,
                waitForFinalization: options.waitForFinalization
            });
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

    async fromHonestPeersOnly(
        txFn: (contract: TContract) => Promise<any>,
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

    async sequenceFromHonestPeers(
        txFns: Array<(contract: TContract) => Promise<any>>
    ): Promise<void> {
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

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        return await peer.stateManager.postStateSnapshot(forkId);
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

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const sameForkData =
            await peer.stateManager.prepareUpdateSnapshotSameFork(forkId);
        if (!sameForkData || sameForkData.callData.length === 0)
            return undefined;

        const channelManager = this.harness.channelManager.connect(peer.signer);
        const tx = await channelManager.multicall(sameForkData.callData);
        await tx.wait();
        return sameForkData.expectedSnapshot;
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
        // step 1 - lambda over the in-peer contract instance cannot cross the
        // worker boundary (W0 D-11/D-22). worker mode -> migrate test source
        // to a named-op shape; runtime guard for fast failure.
        rejectClosureInWorkerMode(
            "TransitionActions.submit(txFn)",
            this.harness.getPeerHandle(peer.index)
        );
        return this.submitInner(
            peer,
            () => txFn(peer.p2pInstance.p2pContractInstance),
            options
        );
    }

    // step 1 - named-op equivalent. worker-safe. inline path goes through
    // PeerHandle.transition.submitNext which dispatches against the shared
    // ops registry (worker-ops/<domain>.ts) - same body both backends.
    async submitOp(
        peer: TestPeer<TFactories, TContract>,
        opRequest: { op: string; args?: unknown },
        options: TransitionOptions = {}
    ): Promise<any> {
        const handle = this.harness.getPeerHandle(peer.index);
        return this.submitInner(
            peer,
            () => handle.transition.submitNext(opRequest),
            options
        );
    }

    // step 1 - shared body. txExec runs the actual on-chain submission;
    // surrounds it with the same waitForTurn / waitForSync semantics.
    private async submitInner(
        peer: TestPeer<TFactories, TContract>,
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

            // step 1 - height read needs the live peer.stateManager. worker
            // mode -> query via handle; inline keeps the sync read.
            let minHeight: number | undefined;
            if (this.harness.options.dedicatedPeerThread) {
                const latest = (await this.harness
                    .getPeerHandle(peer.index)
                    .queryLatestBlock(forkId)) as
                    | { height?: number }
                    | undefined;
                minHeight = latest?.height;
            } else {
                const latest =
                    peer.stateManager.storage.blocks.getLatestBlock(forkId);
                minHeight = latest?.height;
            }

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
        const peer = this.harness.getPeer(peerIndex);
        const block = Block.fromBlockConfirmation(
            blockConfirmation,
            ingestOptions?.onChainTimestamp
        );
        const keepConnection = await peer.stateManager.ingestBlockConfirmation(
            blockConfirmation,
            ingestOptions
        );

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
        timeoutMs = 3000
    ): Promise<void> {
        try {
            await peer.turnBarrier.waitFor(
                () => peer.stateManager.isMyTurn?.() ?? false,
                {
                    timeoutMs,
                    timeoutMessage: `Turn not received within ${timeoutMs}ms`
                }
            );
            this.logger.debug(`Peer ${peer.index} turn`);
        } catch (e) {
            this.logger.error(`Peer ${peer.index} turn wait timed out`);
            throw e;
        }
    }
}
