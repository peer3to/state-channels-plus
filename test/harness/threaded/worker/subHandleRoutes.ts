// W1 §6 / D-23 - worker-side sub-handle route registration. one rpc handler
// per existing inline action surface; bodies mirror the inline impl, running
// against the worker's in-thread `stateManager`.
//
// stateManager is constructed during the `p2pSetup` phase (W5-blocked).
// until then, getStateManager() throws -> handlers surface a clear W5 marker
// rather than NPE'ing on undefined. inline bodies are byte-for-byte moves
// from the action classes the audit cites (W1 appendix A bucket (ii)).

import type { RpcServer } from "../rpc/rpc-server";
import type { SpyRegistry } from "./SpyRegistry";
import {
    getRpcStubHandler,
    type RpcStubHandler
} from "../../worker-handlers/rpc-stub-handlers";
import {
    getDisconnectFilter,
    type DisconnectFilter
} from "../../worker-handlers/disconnect-filters";

// step 1 - structural stand-in. real type lives in src/stateManager. handlers
// only touch fields the action audit lists; keeping this loose avoids dragging
// the full state-machine type-graph into the worker bootstrap surface.
type WorkerStateManager = {
    eventHandler: {
        onBlockCalldataPosted: (...args: unknown[]) => Promise<void>;
    };
    storage: {
        blocks: {
            getLatestBlock: (forkId: unknown) => unknown;
        };
        inboundMessages: {
            getLatestBlockHash: () => unknown;
        };
    };
    p2pManager: {
        openConnections: Array<{
            connectionId?: string;
            peerAddress?: string;
            kind?: string;
        }>;
        self: { address: string };
        profileManager?: {
            getProfileByEvmAddress?: (
                addr: string
            ) =>
                | { evmAddress?: string; transport?: { connectionId?: string } }
                | undefined;
            getProfileByTransport?: (
                t: unknown
            ) => { evmAddress?: string } | undefined;
        };
        remoteRpc: {
            stateTransitionService: {
                onBlockConfirmation: (...args: unknown[]) => {
                    broadcast: () => void;
                    sendOne: () => void;
                    sendMultiple: () => void;
                };
            };
        };
        localRpc: Record<string, unknown>;
        disconnectConnection: (c: unknown) => void;
        tryOpenConnectionToChannel: (channelId: string) => Promise<void>;
        disconnectAndBlacklistPeerByEvmAddress: (addr: string) => unknown;
        // step 1 - p2pSigner exposes connectToChannel + joinChannel. used by
        // lifecycle.connectToChannel / lifecycle.joinChannel routes.
        p2pSigner: {
            connectToChannel: (channelId: string) => Promise<void>;
            joinChannel: (
                confirmation: unknown,
                expectedSnapshotHash: string
            ) => Promise<void>;
        };
    };
    stateChannelManagerContract: unknown;
    getStatus: () => unknown;
    getChannelId: () => unknown;
    forkId: unknown;
};

export type SubHandleCtx = {
    // step 1 - lazy accessor. throws W5BlockedError if p2pSetup hasn't completed.
    // every handler dereferences via this so the failure mode is uniform.
    getStateManager: () => WorkerStateManager;
    // step 2 - W5 saved refs. per-peer restore registry for byzantine stubs.
    saved: {
        calldataHandler?: (...args: unknown[]) => Promise<void>;
        broadcast?: (...args: unknown[]) => unknown;
        inboundGetLatestBlockHash?: () => unknown;
    };
    // step 3 - spy registry (for handlers that need to install spy proxies
    // post-p2pSetup; currently unused at the route layer, retained so the
    // ctx is the single seam handlers consume).
    spyRegistry: SpyRegistry;
    // step 4 - per-worker restore registry for rpc-stub installs +
    // disconnect-filter installs. keyed by "<serviceName>:<methodName>" for
    // rpc stubs and "disconnectFilter" for the single-slot filter.
    rpcStubRestores: Map<string, () => void>;
    disconnectFilterRestore?: () => void;
};

export class W5BlockedError extends Error {
    constructor(route: string) {
        super(
            `sub-handle route '${route}': stateManager not initialized; ` +
                `worker is in 'boot' phase (W5-blocked). when boss's evm-in-thread ` +
                `PR lands, this becomes the live handler against the in-thread ` +
                `stateManager. inline bodies cited in W1 appendix A bucket (ii).`
        );
        this.name = "W5BlockedError";
    }
}

// step 1 - register every route the orchestrator-side WorkerPeer expects.
// route ids follow `<sub-handle>.<method>` (W1 §5).
export function registerSubHandleRoutes(
    server: RpcServer,
    ctx: SubHandleCtx
): void {
    // step 1 - query.* (mirrors hot-path data reads on PeerHandle)

    server.register("query.status", async () => {
        // W?: mirrors PeerHandle.queryStatus / stateManager.getStatus()
        const sm = ctx.getStateManager();
        return sm.getStatus();
    });

    server.register("query.latestBlock", async (args) => {
        // W?: mirrors PeerHandle.queryLatestBlock / storage.blocks.getLatestBlock.
        // serialise to a plain object -> Block getters (hash, height) don't
        // survive structured-clone otherwise.
        const sm = ctx.getStateManager();
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const block = sm.storage.blocks.getLatestBlock(forkId) as
            | { hash: string; height: number | bigint }
            | undefined;
        if (!block) return undefined;
        return {
            hash: String(block.hash),
            height: Number(block.height)
        };
    });

    // step 1 - diamondStateMachine reads. mirror StateQueryActions.ts:140 +
    // StateQueryActions.ts:163 (participants).
    server.register("query.nextToWrite", async () => {
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: { getNextToWrite: () => Promise<string> };
        };
        return await sm.diamondStateMachine.getNextToWrite();
    });

    server.register("query.participants", async () => {
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: { getParticipants: () => Promise<string[]> };
        };
        return await sm.diamondStateMachine.getParticipants();
    });

    server.register("query.latestStateMachineStateHash", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: {
                    getLatestBlock: (
                        f: unknown
                    ) => { stateSnapshotHash: string } | undefined;
                };
                stateSnapshots: {
                    getStateSnapshotByHash: (
                        h: string
                    ) => { stateMachineStateHash: string } | undefined;
                };
                stateMachineStates: {
                    getStateMachineState: (h: string) => unknown;
                };
            };
        };
        const latestBlock = sm.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) return null;
        const snapshot = sm.storage.stateSnapshots.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );
        if (!snapshot) return null;
        const machineState = sm.storage.stateMachineStates.getStateMachineState(
            snapshot.stateMachineStateHash
        );
        if (!machineState) return null;
        return String(snapshot.stateMachineStateHash);
    });

    // step 4d - mirrors storage.blocks.getNextBlockHeight(forkId)
    server.register("query.nextBlockHeight", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: { getNextBlockHeight: (f: unknown) => number | bigint };
            };
        };
        return Number(sm.storage.blocks.getNextBlockHeight(forkId));
    });

    // step 4e - mirrors storage.getStateSnapshot({forkId, height})
    server.register("query.stateSnapshotAt", async (args) => {
        const { forkId, height } = (args ?? {}) as {
            forkId?: unknown;
            height?: number;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                getStateSnapshot: (req: { forkId: unknown; height: number }) =>
                    | {
                          hash: string;
                          stateMachineStateHash: string;
                          blockHeight: number | bigint;
                      }
                    | undefined;
            };
        };
        const snap = sm.storage.getStateSnapshot({
            forkId,
            height: Number(height)
        });
        if (!snap) return null;
        return {
            hash: String(snap.hash),
            stateMachineStateHash: String(snap.stateMachineStateHash),
            blockHeight: Number(snap.blockHeight)
        };
    });

    // step 4f - mirrors storage.stateMachineStates.getStateMachineState
    server.register("query.stateMachineState", async (args) => {
        const { hash } = (args ?? {}) as { hash?: string };
        if (!hash) throw new Error("query.stateMachineState: missing 'hash'");
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                stateMachineStates: {
                    getStateMachineState: (h: string) => string | undefined;
                };
            };
        };
        const state = sm.storage.stateMachineStates.getStateMachineState(hash);
        return state ?? null;
    });

    // step 4g - mirrors stateSnapshots.snapshotsByHash.size
    server.register("query.stateSnapshotCount", async () => {
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                stateSnapshots: { snapshotsByHash: Map<unknown, unknown> };
            };
        };
        return sm.storage.stateSnapshots.snapshotsByHash.size;
    });

    // step 1 - mirrors stateManager.ingestBlockConfirmation(bc, opts).
    // payload shape matches InlinePeer.ingestBlockConfirmation.
    server.register("ingest.blockConfirmation", async (args) => {
        const { blockConfirmation, ingestOptions } = (args ?? {}) as {
            blockConfirmation: unknown;
            ingestOptions?: unknown;
        };
        const sm = ctx.getStateManager() as unknown as {
            ingestBlockConfirmation: (
                bc: unknown,
                opts?: unknown
            ) => Promise<boolean>;
        };
        return await sm.ingestBlockConfirmation(
            blockConfirmation,
            ingestOptions
        );
    });

    // step 4j - mirrors stateManager.isMyTurn?.().
    server.register("query.isMyTurn", async () => {
        const sm = ctx.getStateManager() as unknown as {
            isMyTurn?: () => boolean;
        };
        return sm.isMyTurn?.() ?? false;
    });

    // step 4l - mirrors StateQueryActions.getPreviousBlockHash body.
    server.register("query.previousBlockHash", async (args) => {
        const { ethers } = await import("ethers");
        const { forkId, height } = (args ?? {}) as {
            forkId?: unknown;
            height?: number;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: {
                    getLatestBlock: (
                        f: unknown
                    ) => { hash: string } | undefined;
                };
                stateSnapshots: {
                    getGenesisSnapshotByForkId: (
                        f: unknown
                    ) => { hash: string } | undefined;
                };
                getPreviousBlockOrSnapshot: (req: {
                    forkId: unknown;
                    height: number;
                }) => {
                    block?: { hash: string };
                    stateSnapshot?: { hash: string };
                };
            };
        };
        if (height !== undefined) {
            const prev = sm.storage.getPreviousBlockOrSnapshot({
                forkId,
                height: Number(height)
            });
            return prev.block?.hash ?? prev.stateSnapshot!.hash;
        }
        const previousBlock = sm.storage.blocks.getLatestBlock(forkId);
        if (previousBlock?.hash) return String(previousBlock.hash);
        const genesis =
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        return String(genesis?.hash ?? ethers.ZeroHash);
    });

    // step 4m - mirrors StateQueryActions.getStateSnapshotHash body.
    server.register("query.stateSnapshotHashForFork", async (args) => {
        const { ethers } = await import("ethers");
        const { forkId, previousBlockHash } = (args ?? {}) as {
            forkId?: unknown;
            previousBlockHash?: string;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: {
                    getBlock: (
                        h: string
                    ) => { stateSnapshotHash: string } | undefined;
                };
                stateSnapshots: {
                    getGenesisSnapshotByForkId: (
                        f: unknown
                    ) => { hash: string } | undefined;
                };
            };
        };
        if (previousBlockHash) {
            const block = sm.storage.blocks.getBlock(previousBlockHash);
            if (block?.stateSnapshotHash) {
                return String(block.stateSnapshotHash);
            }
        }
        const genesis =
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        return String(genesis?.hash ?? ethers.ZeroHash);
    });

    // step 4n - mirrors storage.fraudProofs.getFraudProofForParticipant.
    server.register("query.fraudProofForParticipant", async (args) => {
        const { addr } = (args ?? {}) as { addr?: string };
        if (!addr)
            throw new Error("query.fraudProofForParticipant: missing 'addr'");
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                fraudProofs: {
                    getFraudProofForParticipant: (
                        a: string
                    ) => { proofType: number; participant: string } | undefined;
                };
            };
        };
        const fp = sm.storage.fraudProofs.getFraudProofForParticipant(addr);
        if (!fp) return null;
        return {
            proofType: Number(fp.proofType),
            participant: String(fp.participant)
        };
    });

    // step 4o - mirrors storage.disputeFraudProofs.getDisputeFraudProofs.
    server.register("query.disputeFraudProofs", async () => {
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                disputeFraudProofs: {
                    getDisputeFraudProofs: () => Array<{
                        proofType: number;
                    }>;
                };
            };
        };
        return sm.storage.disputeFraudProofs
            .getDisputeFraudProofs()
            .map((p) => ({ proofType: Number(p.proofType) }));
    });

    // step 4p - mirrors storage.inboundMessages.{getLatestBlockHash,getLatestBlockHeight}.
    server.register("query.inboundLatestBlockHash", async () => {
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                inboundMessages: { getLatestBlockHash: () => unknown };
            };
        };
        const result = sm.storage.inboundMessages.getLatestBlockHash();
        return result ? String(result) : undefined;
    });

    server.register("query.inboundLatestBlockHeight", async () => {
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                inboundMessages: {
                    getLatestBlockHeight: () => number | bigint | undefined;
                };
            };
        };
        const result = sm.storage.inboundMessages.getLatestBlockHeight();
        return result === undefined ? undefined : Number(result);
    });

    // step 4q - mirrors storage.timeout.storeTimeout(forkId, timeoutStruct).
    server.register("timeout.store", async (args) => {
        const { forkId, timeout } = (args ?? {}) as {
            forkId: unknown;
            timeout: unknown;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                timeout: {
                    storeTimeout: (f: unknown, t: unknown) => void;
                };
            };
        };
        sm.storage.timeout.storeTimeout(forkId, timeout);
    });

    // step 4s - mirrors storage.timeout.getTimeout(forkId).
    server.register("query.timeoutForFork", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                timeout: {
                    getTimeout: (f: unknown) =>
                        | {
                              participant: string;
                              isForced: boolean;
                              blockHeight?: bigint | number;
                          }
                        | undefined;
                };
            };
        };
        const t = sm.storage.timeout.getTimeout(forkId);
        if (!t) return null;
        return {
            participant: String(t.participant),
            isForced: Boolean(t.isForced),
            blockHeight:
                t.blockHeight !== undefined ? String(t.blockHeight) : undefined
        };
    });

    // step 4t - mirrors storage.disputes.getDisputeConfirmation(hash).
    server.register("query.disputeConfirmation", async (args) => {
        const { disputeHash } = (args ?? {}) as { disputeHash?: string };
        if (!disputeHash)
            throw new Error("query.disputeConfirmation: missing 'disputeHash'");
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                disputes: {
                    getDisputeConfirmation: (h: string) => unknown | undefined;
                };
            };
        };
        return sm.storage.disputes.getDisputeConfirmation(disputeHash) ?? null;
    });

    // step 4v - compute expected withdrawals delta. mirrors the
    // ContextActions.computeExpectedWithdrawalsDelta body running in the
    // worker so live storage + diamondStateMachine never cross the boundary.
    server.register("context.computeExpectedWithdrawalsDelta", async (args) => {
        const req = (args ?? {}) as {
            upperBlockHash: string;
            lowerBlockHash?: string;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                outboundMessages: {
                    getMessageBlocksInRange: (range: {
                        upperBlockHash: string;
                        lowerBlockHash?: string;
                    }) => Array<{
                        messages: Array<{
                            balance: {
                                amount: bigint | number;
                                data: string;
                            };
                        }>;
                    }>;
                };
            };
            diamondStateMachine: {
                getZeroBalance: () => Promise<{
                    amount: bigint;
                    data: string;
                }>;
                addBalance: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint | number; data: string }
                ) => Promise<{ amount: bigint; data: string }>;
            };
        };
        const blocks = sm.storage.outboundMessages.getMessageBlocksInRange(req);
        let total = await sm.diamondStateMachine.getZeroBalance();
        for (const block of blocks) {
            for (const message of block.messages) {
                total = await sm.diamondStateMachine.addBalance(
                    total,
                    message.balance
                );
            }
        }
        return {
            amount: String(total.amount),
            data: String(total.data)
        };
    });

    // step 4x - mirrors diamondStateMachine.subtractBalance.
    server.register("balance.subtract", async (args) => {
        const req = (args ?? {}) as {
            a: { amount: string; data: string };
            b: { amount: string; data: string };
        };
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: {
                subtractBalance: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint; data: string }
                ) => Promise<{ amount: bigint; data: string }>;
            };
        };
        const r = await sm.diamondStateMachine.subtractBalance(
            { amount: BigInt(req.a.amount), data: req.a.data },
            { amount: BigInt(req.b.amount), data: req.b.data }
        );
        return { amount: String(r.amount), data: String(r.data) };
    });

    // step 4y - mirrors diamondStateMachine.areBalancesEqual.
    server.register("balance.areEqual", async (args) => {
        const req = (args ?? {}) as {
            a: { amount: string; data: string };
            b: { amount: string; data: string };
        };
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: {
                areBalancesEqual: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint; data: string }
                ) => Promise<boolean>;
            };
        };
        return await sm.diamondStateMachine.areBalancesEqual(
            { amount: BigInt(req.a.amount), data: req.a.data },
            { amount: BigInt(req.b.amount), data: req.b.data }
        );
    });

    // step 4z - mirrors storage.getPreviousStateSnapshot.
    server.register("query.previousStateSnapshot", async (args) => {
        const req = (args ?? {}) as { forkId: unknown; height: number };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                getPreviousStateSnapshot: (req: {
                    forkId: unknown;
                    height: number;
                }) => unknown | undefined;
            };
        };
        return sm.storage.getPreviousStateSnapshot(req) ?? null;
    });

    // step 1 - mirrors stateManager.applyTransaction(tx).
    server.register("tx.apply", async (args) => {
        const sm = ctx.getStateManager() as unknown as {
            applyTransaction: (
                tx: unknown
            ) => Promise<{ success: boolean; encodedState: string }>;
        };
        return await sm.applyTransaction(args);
    });

    // step 4w - mirrors lastMilestoneSnapshot from prepareUpdateSnapshotSameFork.
    server.register("query.lastMilestoneSnapshot", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            prepareUpdateSnapshotSameFork: (
                f: unknown
            ) => Promise<{ milestoneSnapshots: unknown[] } | undefined>;
        };
        const result = await sm.prepareUpdateSnapshotSameFork(forkId);
        return result?.milestoneSnapshots.at(-1);
    });

    // step 4u - mirrors storage.disputes.getOpenDisputeForkIds().
    server.register("query.openDisputeForkIds", async () => {
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                disputes: { getOpenDisputeForkIds?: () => string[] };
            };
        };
        if (typeof sm.storage.disputes.getOpenDisputeForkIds !== "function") {
            return [];
        }
        return sm.storage.disputes.getOpenDisputeForkIds() ?? [];
    });

    // step 4r - mirrors storage.timeout.getTimeoutsForFork(forkId).
    server.register("query.timeoutsForFork", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                timeout: { getTimeoutsForFork: (f: unknown) => unknown[] };
            };
        };
        return sm.storage.timeout.getTimeoutsForFork(forkId);
    });

    // step 4k - mirrors storage.blocks.getLatestBlock -> blockConfirmationStruct.
    // ship the full confirmation so the orchestrator can reconstruct a Block
    // via Block.fromBlockConfirmation and read every getter.
    server.register("query.latestBlockConfirmation", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: {
                    getLatestBlock: (
                        f: unknown
                    ) => { blockConfirmationStruct: unknown } | undefined;
                };
            };
        };
        const block = sm.storage.blocks.getLatestBlock(forkId);
        if (!block) return undefined;
        return block.blockConfirmationStruct;
    });

    // step 4h - mirrors stateManager.postStateSnapshot(forkId).
    server.register("snapshot.post", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            postStateSnapshot: (f: unknown) => Promise<unknown>;
        };
        return await sm.postStateSnapshot(forkId);
    });

    // step 4i - mirrors stateManager.prepareUpdateSnapshotSameFork(forkId).
    // ship the struct as-is via structured clone (callData is string[],
    // expectedSnapshot + milestoneSnapshots are plain models).
    server.register("snapshot.prepareSameFork", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            prepareUpdateSnapshotSameFork: (f: unknown) => Promise<
                | {
                      callData: string[];
                      expectedSnapshot: unknown;
                      milestoneSnapshots: unknown[];
                  }
                | undefined
            >;
        };
        const result = await sm.prepareUpdateSnapshotSameFork(forkId);
        if (!result) return undefined;
        return result;
    });

    server.register("query.didEveryoneSignBlock", async (args) => {
        const { blockHash } = (args ?? {}) as { blockHash?: string };
        if (!blockHash)
            throw new Error("query.didEveryoneSignBlock: missing 'blockHash'");
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: { getBlock: (h: string) => unknown };
            };
            agreementManager: {
                didEveryoneSignBlock: (b: unknown) => boolean;
            };
        };
        const block = sm.storage.blocks.getBlock(blockHash);
        if (!block) return false;
        return sm.agreementManager.didEveryoneSignBlock(block);
    });

    // step 1 - byzantine.* (mirrors ByzantineActions.ts bodies)

    server.register("byzantine.stubCalldataHandler", async () => {
        // step 1 - mirror of InlineByzantineHandle.stubCalldataHandler.
        // W?: moved from ByzantineActions.ts:263-274 (inline body)
        const sm = ctx.getStateManager();
        const eh = sm.eventHandler;
        ctx.saved.calldataHandler = eh.onBlockCalldataPosted.bind(eh);
        eh.onBlockCalldataPosted = async () => {};
        return {};
    });

    server.register("byzantine.restoreCalldataHandler", async () => {
        // W?: moved from ByzantineActions.ts:276-291 (inline body)
        const sm = ctx.getStateManager();
        const original = ctx.saved.calldataHandler;
        if (!original) {
            throw new Error(
                "byzantine.restoreCalldataHandler: no original captured"
            );
        }
        sm.eventHandler.onBlockCalldataPosted = original;
        ctx.saved.calldataHandler = undefined;
        return {};
    });

    server.register("byzantine.stubPendingInboundInclusion", async () => {
        // W?: moved from ByzantineActions.ts:293-306
        const sm = ctx.getStateManager();
        const storage = sm.storage.inboundMessages;
        ctx.saved.inboundGetLatestBlockHash =
            storage.getLatestBlockHash.bind(storage);
        storage.getLatestBlockHash = () => undefined;
        return {};
    });

    server.register("byzantine.restorePendingInboundInclusion", async () => {
        // step 1 - paired restore. mirror of InlineByzantineHandle.
        const sm = ctx.getStateManager();
        const original = ctx.saved.inboundGetLatestBlockHash;
        if (!original) {
            throw new Error(
                "byzantine.restorePendingInboundInclusion: no original captured"
            );
        }
        sm.storage.inboundMessages.getLatestBlockHash = original;
        ctx.saved.inboundGetLatestBlockHash = undefined;
        return {};
    });

    server.register("byzantine.stubBroadcast", async () => {
        // W?: moved from ByzantineActions.ts:308-328
        const sm = ctx.getStateManager();
        const remoteRpc = sm.p2pManager.remoteRpc;
        ctx.saved.broadcast = remoteRpc.stateTransitionService
            .onBlockConfirmation as never;
        remoteRpc.stateTransitionService.onBlockConfirmation = () => ({
            broadcast: () => {},
            sendOne: () => {},
            sendMultiple: () => {}
        });
        return {};
    });

    // step 3 - mirrors broadcastBlockConfirmation (the shared broadcast tail
    // used by submitInvalidStateTransitionBlock + the other byzantine action
    // variants). orchestrator constructs the BlockConfirmationStruct, worker
    // just invokes the broadcast.
    server.register("byzantine.broadcastBlockConfirmation", async (args) => {
        const { blockConfirmation } = (args ?? {}) as {
            blockConfirmation?: unknown;
        };
        if (!blockConfirmation) {
            throw new Error(
                "byzantine.broadcastBlockConfirmation: missing blockConfirmation"
            );
        }
        const sm = ctx.getStateManager();
        sm.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(blockConfirmation)
            .broadcast();
        return {};
    });

    server.register("byzantine.submitDoubleSignBlock", async (args) => {
        // step 1 - block construction is orchestrator-side (D-15); worker
        // receives a serialised SignedBlockStruct + invokes broadcast.
        // W?: moved from ByzantineActions.ts:99-101 (the broadcast call only).
        const sm = ctx.getStateManager();
        const { signedBlockConfirmation } = (args ?? {}) as {
            signedBlockConfirmation?: unknown;
        };
        if (!signedBlockConfirmation) {
            throw new Error(
                "byzantine.submitDoubleSignBlock: missing signedBlockConfirmation"
            );
        }
        sm.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(signedBlockConfirmation)
            .broadcast();
        return {};
    });

    // step 1 - byzantine.postJunkCalldataOnChain has no worker route. on-chain
    // writes are orchestrator-side per D-15; the action class calls
    // harness.channelManager.connect(peer.signer).postBlockCalldata(...) directly.
    // worker contributes nothing on this path -> no rpc method on ByzantineHandle.

    // step 1 - rpcStub.* (mirrors rpcStubActions.ts bodies). handler bodies
    // resolved against the named registry in worker-handlers/rpc-stub-handlers.ts;
    // the test source ships a stable handlerId instead of a lambda.

    server.register("rpcStub.installCreateRpcMethodStub", async (args) => {
        // step 1 - mirror of rpcStubActions.ts:69-156 inline body.
        const sm = ctx.getStateManager();
        const { serviceName, methodName, handlerId, handlerArgs } = (args ??
            {}) as {
            serviceName?: string;
            methodName?: string;
            handlerId?: string;
            handlerArgs?: unknown;
        };
        if (!serviceName)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'serviceName'"
            );
        if (!methodName)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'methodName'"
            );
        if (!handlerId)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'handlerId'"
            );

        const handler: RpcStubHandler = getRpcStubHandler(handlerId);
        const localRpc = sm.p2pManager.localRpc as Record<string, unknown>;
        const service = localRpc[serviceName] as
            | { createRPCMethods: (t: unknown) => unknown }
            | undefined;
        if (!service)
            throw new Error(
                `rpcStub: service '${serviceName}' not found on localRpc`
            );
        if (typeof service.createRPCMethods !== "function")
            throw new Error(
                `rpcStub: service '${serviceName}' has no createRPCMethods()`
            );

        const originalCreate = service.createRPCMethods.bind(service);
        const key = `${serviceName}:${methodName}`;
        // step 1 - if a previous install is live for this slot, restore it
        // first so we wrap the unmodified service (matches the inline path).
        ctx.rpcStubRestores.get(key)?.();

        service.createRPCMethods = ((transport: unknown) => {
            const methods = originalCreate(transport) as Record<
                string,
                unknown
            >;
            if (!(methodName in methods)) {
                throw new Error(
                    `rpcStub: method '${methodName}' missing on createRPCMethods() result for '${serviceName}'`
                );
            }
            methods[methodName] = async function (
                this: unknown,
                ...callArgs: unknown[]
            ) {
                return await handler({
                    thisCtx: this,
                    args: callArgs,
                    handlerArgs
                });
            };
            return methods;
        }) as never;

        const restore = () => {
            service.createRPCMethods = originalCreate as never;
            ctx.rpcStubRestores.delete(key);
        };
        ctx.rpcStubRestores.set(key, restore);
        return { id: key };
    });

    server.register("rpcStub.restoreCreateRpcMethodStub", async (args) => {
        const { serviceName, methodName } = (args ?? {}) as {
            serviceName?: string;
            methodName?: string;
        };
        if (!serviceName || !methodName) {
            throw new Error(
                "rpcStub.restoreCreateRpcMethodStub: missing 'serviceName' or 'methodName'"
            );
        }
        const key = `${serviceName}:${methodName}`;
        ctx.rpcStubRestores.get(key)?.();
        return {};
    });

    server.register("rpcStub.restoreAll", async () => {
        for (const restore of ctx.rpcStubRestores.values()) restore();
        ctx.rpcStubRestores.clear();
        return {};
    });

    // step 1 - queryInternals.* (mirrors StateQueryActions / RPCActions reads)

    server.register("queryInternals.openConnections", async () => {
        // W?: moved from StateQueryActions.ts:214 + NetworkController.ts:82
        const sm = ctx.getStateManager();
        const out: Array<{
            connectionId: string;
            peerAddress: string;
            kind: string;
        }> = [];
        for (const t of sm.p2pManager.openConnections) {
            out.push({
                connectionId: t.connectionId ?? "",
                peerAddress: t.peerAddress ?? "0x",
                kind: t.kind ?? "unknown"
            });
        }
        return out;
    });

    server.register("queryInternals.getProfileByEvmAddress", async (args) => {
        // W?: moved from StateQueryActions.ts:251
        const sm = ctx.getStateManager();
        const { addr } = (args ?? {}) as { addr?: string };
        if (!addr)
            throw new Error(
                "queryInternals.getProfileByEvmAddress: missing 'addr'"
            );
        const profile =
            sm.p2pManager.profileManager?.getProfileByEvmAddress?.(addr);
        if (!profile) return undefined;
        return {
            evmAddress: profile.evmAddress ?? addr,
            connectionId: profile.transport?.connectionId ?? ""
        };
    });

    server.register("queryInternals.getProfileByConnectionId", async (args) => {
        // W?: moved from StateQueryActions.ts:216,246
        const sm = ctx.getStateManager();
        const { connectionId } = (args ?? {}) as { connectionId?: string };
        if (!connectionId)
            throw new Error(
                "queryInternals.getProfileByConnectionId: missing 'connectionId'"
            );
        for (const t of sm.p2pManager.openConnections) {
            if (t.connectionId === connectionId) {
                const profile =
                    sm.p2pManager.profileManager?.getProfileByTransport?.(t);
                if (!profile) return undefined;
                return {
                    evmAddress: profile.evmAddress ?? "0x",
                    connectionId
                };
            }
        }
        return undefined;
    });

    server.register("queryInternals.connectionCount", async () => {
        // W?: moved from StateQueryActions.ts:228
        const sm = ctx.getStateManager();
        return sm.p2pManager.openConnections.length;
    });

    server.register("queryInternals.isHandshakeCompletedWith", async (req) => {
        // mirrors RPCActions.isHandshakeCompleted predicate body
        const { otherAddr } = (req ?? {}) as { otherAddr: string };
        const sm = ctx.getStateManager() as unknown as {
            p2pManager: {
                profileManager: {
                    getProfileByEvmAddress: (
                        a: string
                    ) => { getIsHandshakeCompleted: () => boolean } | undefined;
                };
            };
        };
        const profile =
            sm.p2pManager.profileManager.getProfileByEvmAddress(otherAddr);
        return profile?.getIsHandshakeCompleted() ?? false;
    });

    server.register("queryInternals.self", async () => {
        // W?: moved from RPCActions.ts:112 / NetworkController.ts:43 (the
        // address read). p2pManager.self IS the P2PManager (or a DebugProxy);
        // its evm address lives on the state manager.
        const sm = ctx.getStateManager() as unknown as {
            signerAddress: string;
        };
        return sm.signerAddress;
    });

    server.register("queryInternals.isForkDisputedService", async (args) => {
        // W?: dispatcher; bodies live on the worker-side service instance.
        // RPCActions.ts:42-44 + downstream call sites. needs the live
        // localRpc service map post-p2pSetup.
        const sm = ctx.getStateManager();
        const { op, args: opArgs } = (args ?? {}) as {
            op?: string;
            args?: unknown;
        };
        if (!op)
            throw new Error(
                "queryInternals.isForkDisputedService: missing 'op'"
            );
        const svc = sm.p2pManager.localRpc["isForkDisputedService"] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc)
            throw new Error("isForkDisputedService not present on localRpc");
        const fn = svc[op];
        if (typeof fn !== "function")
            throw new Error(`isForkDisputedService.${op} not a function`);
        // step 1 - bind to svc so `this` resolves; spread array, else single
        const bound = fn.bind(svc);
        if (Array.isArray(opArgs)) return await bound(...opArgs);
        return await bound(opArgs);
    });

    server.register("queryInternals.initHandshakeService", async (args) => {
        // W?: dispatcher; same shape as isForkDisputedService.
        const sm = ctx.getStateManager();
        const { op, args: opArgs } = (args ?? {}) as {
            op?: string;
            args?: unknown;
        };
        if (!op)
            throw new Error(
                "queryInternals.initHandshakeService: missing 'op'"
            );
        const svc = sm.p2pManager.localRpc["initHandshakeService"] as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
        if (!svc)
            throw new Error("initHandshakeService not present on localRpc");
        const fn = svc[op];
        if (typeof fn !== "function")
            throw new Error(`initHandshakeService.${op} not a function`);
        // step 1 - bind to svc so `this` resolves; spread array, else single
        const bound = fn.bind(svc);
        if (Array.isArray(opArgs)) return await bound(...opArgs);
        return await bound(opArgs);
    });

    // step 2 - queryInternals.callServiceWithTransport. resolves the live
    // transport by otherAddr in-thread, then calls
    // `<svc>.createRPCMethods(transport).<method>(...args)`. lets orchestrator
    // poke service endpoints (init handshake, etc.) that take an ATransport.
    server.register("queryInternals.callServiceWithTransport", async (args) => {
        const sm = ctx.getStateManager();
        const {
            serviceName,
            methodName,
            otherAddr,
            args: callArgs
        } = (args ?? {}) as {
            serviceName?: string;
            methodName?: string;
            otherAddr?: string;
            args?: unknown[];
        };
        if (!serviceName || !methodName || !otherAddr)
            throw new Error(
                "queryInternals.callServiceWithTransport: missing required args"
            );
        const pmAny = sm.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
            localRpc: Record<string, unknown>;
        };
        const target = String(otherAddr).toLowerCase();
        let resolvedTransport: unknown;
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target) {
                resolvedTransport = t;
                break;
            }
        }
        if (!resolvedTransport)
            throw new Error(
                `queryInternals.callServiceWithTransport: no transport to ${otherAddr}`
            );
        const svc = pmAny.localRpc[serviceName] as
            | {
                  createRPCMethods: (
                      t: unknown
                  ) => Record<string, (...a: unknown[]) => unknown>;
              }
            | undefined;
        if (!svc)
            throw new Error(
                `queryInternals.callServiceWithTransport: missing service '${serviceName}'`
            );
        const methods = svc.createRPCMethods(resolvedTransport);
        const fn = methods[methodName];
        if (typeof fn !== "function")
            throw new Error(
                `queryInternals.callServiceWithTransport: '${serviceName}.${methodName}' not a function`
            );
        // step 1 - bind to methods object so instance methods see `this`
        return await (fn as (...a: unknown[]) => unknown).apply(
            methods,
            callArgs ?? []
        );
    });

    // step 3 - queryInternals.callServiceMethodWithTransport. resolves the
    // live transport by otherAddr, then calls `<svc>.<method>(transport, ...args)`.
    // for service-level methods that take ATransport as first arg.
    server.register(
        "queryInternals.callServiceMethodWithTransport",
        async (args) => {
            const sm = ctx.getStateManager();
            const {
                serviceName,
                methodName,
                otherAddr,
                args: callArgs
            } = (args ?? {}) as {
                serviceName?: string;
                methodName?: string;
                otherAddr?: string;
                args?: unknown[];
            };
            if (!serviceName || !methodName || !otherAddr)
                throw new Error(
                    "queryInternals.callServiceMethodWithTransport: missing required args"
                );
            const pmAny = sm.p2pManager as unknown as {
                openConnections: Iterable<unknown>;
                profileManager: {
                    getProfileByTransport: (
                        t: unknown
                    ) => { evmAddress?: string } | undefined;
                };
                localRpc: Record<string, unknown>;
            };
            const target = String(otherAddr).toLowerCase();
            let resolvedTransport: unknown;
            for (const t of pmAny.openConnections) {
                const profile = pmAny.profileManager.getProfileByTransport(t);
                if (
                    String(profile?.evmAddress ?? "").toLowerCase() === target
                ) {
                    resolvedTransport = t;
                    break;
                }
            }
            if (!resolvedTransport)
                throw new Error(
                    `queryInternals.callServiceMethodWithTransport: no transport to ${otherAddr}`
                );
            const svc = pmAny.localRpc[serviceName] as
                | Record<string, (...a: unknown[]) => unknown>
                | undefined;
            if (!svc)
                throw new Error(
                    `queryInternals.callServiceMethodWithTransport: missing service '${serviceName}'`
                );
            const fn = svc[methodName];
            if (typeof fn !== "function")
                throw new Error(
                    `queryInternals.callServiceMethodWithTransport: '${serviceName}.${methodName}' not a function`
                );
            return await (fn as (...a: unknown[]) => unknown).apply(svc, [
                resolvedTransport,
                ...(callArgs ?? [])
            ]);
        }
    );

    server.register("queryInternals.getPreferredTransportType", async () => {
        const sm = ctx.getStateManager() as unknown as {
            p2pManager: { preferredTransport: number };
        };
        return sm.p2pManager.preferredTransport;
    });

    // step 5 - shared helper for transport resolution by peer addr
    const resolveTransport = (otherAddr: string): unknown => {
        const sm = ctx.getStateManager();
        const pmAny = sm.p2pManager as unknown as {
            openConnections: Iterable<unknown>;
            profileManager: {
                getProfileByTransport: (
                    t: unknown
                ) => { evmAddress?: string } | undefined;
            };
        };
        const target = String(otherAddr).toLowerCase();
        for (const t of pmAny.openConnections) {
            const profile = pmAny.profileManager.getProfileByTransport(t);
            if (String(profile?.evmAddress ?? "").toLowerCase() === target)
                return t;
        }
        return undefined;
    };

    server.register("queryInternals.getInitChallenge", async (args) => {
        const { otherAddr } = (args ?? {}) as { otherAddr?: string };
        if (!otherAddr)
            throw new Error(
                "queryInternals.getInitChallenge: missing otherAddr"
            );
        const t = resolveTransport(otherAddr);
        if (!t) return undefined;
        const sm = ctx.getStateManager();
        const svc = sm.p2pManager.localRpc["initHandshakeService"] as
            | {
                  getChallenge: (
                      t: unknown
                  ) =>
                      | { randomChallengeHash: string; initTime: number }
                      | undefined;
              }
            | undefined;
        const c = svc?.getChallenge(t);
        if (!c) return undefined;
        return {
            randomChallengeHash: c.randomChallengeHash,
            initTime: c.initTime
        };
    });

    server.register("queryInternals.clearInitChallenge", async (args) => {
        const { otherAddr } = (args ?? {}) as { otherAddr?: string };
        if (!otherAddr)
            throw new Error(
                "queryInternals.clearInitChallenge: missing otherAddr"
            );
        const t = resolveTransport(otherAddr);
        if (!t) return {};
        const sm = ctx.getStateManager();
        const svc = sm.p2pManager.localRpc["initHandshakeService"] as
            | { mapTransportToChallenge: Map<unknown, unknown> }
            | undefined;
        svc?.mapTransportToChallenge.delete(t);
        return {};
    });

    server.register("queryInternals.getTransportStatus", async (args) => {
        const { otherAddr } = (args ?? {}) as { otherAddr?: string };
        if (!otherAddr)
            throw new Error(
                "queryInternals.getTransportStatus: missing otherAddr"
            );
        const t = resolveTransport(otherAddr) as
            | { isClosed?: boolean }
            | undefined;
        if (!t) return { present: false };
        return { present: true, isClosed: t.isClosed };
    });

    // step 1 - network.* (mirrors NetworkController.ts + RPCActions disconnect filter)

    server.register("network.disconnectAll", async () => {
        // W?: moved from NetworkController.ts:77-90
        const sm = ctx.getStateManager();
        const pm = sm.p2pManager;
        const conns = [...pm.openConnections];
        for (const conn of conns) {
            pm.disconnectConnection(conn as unknown);
        }
        return {};
    });

    server.register("network.tryOpenConnectionToChannel", async (args) => {
        // W?: moved from NetworkController.ts:34-39 + RPCActions.ts:108
        const sm = ctx.getStateManager();
        const { channelId } = (args ?? {}) as { channelId?: string };
        if (!channelId)
            throw new Error(
                "network.tryOpenConnectionToChannel: missing 'channelId'"
            );
        await sm.p2pManager.tryOpenConnectionToChannel(channelId);
        return {};
    });

    // step 1 - lifecycle.* (mirrors P2pSigner.connectToChannel/joinChannel)

    server.register("lifecycle.connectToChannel", async (args) => {
        // W?: moved from LifecycleActions.ts:126 + JoinActions.ts:54
        const sm = ctx.getStateManager();
        const { channelId } = (args ?? {}) as { channelId?: string };
        if (!channelId)
            throw new Error("lifecycle.connectToChannel: missing 'channelId'");
        await sm.p2pManager.p2pSigner.connectToChannel(channelId);
        return {};
    });

    server.register("lifecycle.joinChannel", async (args) => {
        // W?: moved from JoinActions.ts:117
        const sm = ctx.getStateManager();
        const { confirmation, expectedSnapshotHash } = (args ?? {}) as {
            confirmation?: unknown;
            expectedSnapshotHash?: string;
        };
        if (!confirmation)
            throw new Error("lifecycle.joinChannel: missing 'confirmation'");
        if (!expectedSnapshotHash)
            throw new Error(
                "lifecycle.joinChannel: missing 'expectedSnapshotHash'"
            );
        await sm.p2pManager.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash
        );
        return {};
    });

    server.register("network.installDisconnectFilter", async (args) => {
        // step 1 - mirror of RPCActions.ts:447-463 inline body. wraps
        // disconnectAndBlacklistPeerByEvmAddress with a named filter; the
        // filter returns false to drop, true to delegate to the original.
        const sm = ctx.getStateManager();
        const { filterId, args: filterArgs } = (args ?? {}) as {
            filterId?: string;
            args?: unknown;
        };
        if (!filterId)
            throw new Error(
                "network.installDisconnectFilter: missing 'filterId'"
            );

        const filter: DisconnectFilter = getDisconnectFilter(filterId);
        const pm = sm.p2pManager;
        const original = pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
        // step 1 - if a prior install is live, restore first so we wrap the
        // unmodified method.
        ctx.disconnectFilterRestore?.();

        pm.disconnectAndBlacklistPeerByEvmAddress = async (addr: string) => {
            const allow = await filter({ address: addr, filterArgs });
            if (!allow) return;
            return original(addr);
        };
        const restore = () => {
            pm.disconnectAndBlacklistPeerByEvmAddress = original;
            ctx.disconnectFilterRestore = undefined;
        };
        ctx.disconnectFilterRestore = restore;
        return { id: "disconnectFilter" };
    });

    server.register("network.restoreDisconnectFilter", async () => {
        ctx.disconnectFilterRestore?.();
        return {};
    });
}
