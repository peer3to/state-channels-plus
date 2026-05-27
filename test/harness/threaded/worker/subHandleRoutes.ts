// W1 §6 / D-23 - worker-side sub-handle route registration. one rpc handler
// per existing inline action surface; bodies mirror the inline impl, running
// against the worker's in-thread `stateManager`.
//
// stateManager is constructed during the `p2pSetup` phase (W5-blocked).
// until then, getStateManager() throws -> handlers surface a clear W5 marker
// rather than NPE'ing on undefined. inline bodies are byte-for-byte moves
// from the action classes the audit cites (W1 appendix A bucket (ii)).

import type { RpcServer } from "../rpc/rpc-server";
import type { RpcClient } from "../rpc/rpc-client";
import type { SpyRegistry } from "./SpyRegistry";
import type StateManager from "@/stateManager";

// step 1 - typed against the live SDK StateManager. routes touch real fields;
// per-route narrow casts compose on top of this where private members or
// looser-shape access is needed. type-only import -> zero runtime weight.
type WorkerStateManager = StateManager;

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
    // step 4a - per-worker restore registry for debug.stubMethod installs.
    // keyed by monotonic token id ("debugStub#N"); orchestrator drives by token.
    debugMethodRestores: Map<string, () => void>;
    // step 5 - worker rpc client. used by closure-bearing routes (rpc-stub
    // install + disconnect filter install) to call back into the orchestrator
    // via "harness.invokeStubCallback" / "harness.invokeFilterCallback".
    // populated in entry.ts at boot alongside the rpc server.
    workerRpcClient: RpcClient;
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
        const { forkId } = (args ?? {}) as { forkId?: string };
        const block = sm.storage.blocks.getLatestBlock(forkId ?? "") as
            | { hash: string; height: number | bigint }
            | undefined;
        if (!block) return undefined;
        return {
            hash: String(block.hash),
            height: Number(block.height)
        };
    });

    // step 4a2 - mirrors PeerHandle.queryBlockAt / storage.blocks.getBlock(forkId, height).
    // serialise to {hash, height, author} -> Block getters don't survive structured-clone.
    server.register("query.blockAt", async (args) => {
        const { forkId, height } = (args ?? {}) as {
            forkId?: unknown;
            height?: number;
        };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                blocks: {
                    getBlock: (
                        f: unknown,
                        h: number
                    ) =>
                        | {
                              hash: string;
                              height: number | bigint;
                              author: string;
                          }
                        | undefined;
                };
            };
        };
        const block = sm.storage.blocks.getBlock(forkId, Number(height));
        if (!block) return undefined;
        return {
            hash: String(block.hash),
            height: Number(block.height),
            author: String(block.author)
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

    // step 4q2 - mirrors storage.forceExit.setForceExit(value).
    server.register("forceExit.set", async (args) => {
        const { value } = (args ?? {}) as { value?: boolean };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                forceExit: { setForceExit: (v: boolean) => void };
            };
        };
        sm.storage.forceExit.setForceExit(Boolean(value));
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

    // step 4aa - mirrors disputeManager.constructDispute(forkId).
    server.register("dispute.construct", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            disputeManager: {
                constructDispute: (f: unknown) => Promise<unknown>;
            };
        };
        return await sm.disputeManager.constructDispute(forkId);
    });

    // step 4ab - mirrors storage.stateSnapshots.getGenesisSnapshotByForkId.
    // ship .toStruct() so structured clone preserves snapshotData (callers
    // rehydrate via StateSnapshot.from on the orchestrator side).
    server.register("query.genesisSnapshot", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                stateSnapshots: {
                    getGenesisSnapshotByForkId: (
                        f: unknown
                    ) => { toStruct: () => unknown } | undefined;
                };
            };
        };
        const snapshot =
            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
        return snapshot?.toStruct() ?? null;
    });

    // step 4ad - mirrors localDiamondContract.getLatestBlockFromStateProof.
    // localDiamondContract is wrapped by createEthersResultProxy so the result
    // is already a plain mutable object; structured clone ships the full block
    // struct so the orchestrator can read every field + re-encode if needed.
    server.register("dispute.latestBlockFromStateProof", async (args) => {
        const { stateProof } = (args ?? {}) as { stateProof?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getLatestBlockFromStateProof: (
                        sp: unknown
                    ) => Promise<[boolean, unknown]>;
                };
            };
        };
        const [hasBlock, latestBlock] =
            await sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                stateProof
            );
        return {
            hasBlock: Boolean(hasBlock),
            latestBlock
        };
    });

    // step 4ae - mirrors localDiamondContract.getDisputeWindows(channelId, [forkId]).
    // returns the raw array result; ethers result proxy converts to plain.
    server.register("dispute.windows", async (args) => {
        const { channelId, forkIds } = (args ?? {}) as {
            channelId?: unknown;
            forkIds?: unknown[];
        };
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getDisputeWindows: (
                        c: unknown,
                        f: unknown[]
                    ) => Promise<unknown[]>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
            channelId,
            forkIds ?? []
        );
    });

    // step 4af - mirrors localDiamondContract.getStateSnapshot(channelId).
    server.register("dispute.localStateSnapshot", async (args) => {
        const { channelId } = (args ?? {}) as { channelId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getStateSnapshot: (c: unknown) => Promise<unknown>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
            channelId
        );
    });

    // step 4ac - mirrors disputeManager.getAuditingData(forkId, ...).
    server.register("dispute.getAuditingData", async (args) => {
        const req = (args ?? {}) as { forkId: unknown; args?: unknown[] };
        const sm = ctx.getStateManager() as unknown as {
            disputeManager: {
                getAuditingData: (
                    f: unknown,
                    ...a: unknown[]
                ) => Promise<unknown>;
            };
        };
        return await sm.disputeManager.getAuditingData(
            req.forkId,
            ...(req.args ?? [])
        );
    });

    // step 4z - mirrors storage.getPreviousStateSnapshot. ship .toStruct() so
    // structured clone preserves snapshotData (StateSnapshot class wraps the
    // struct in a private field + getters that don't survive clone).
    server.register("query.previousStateSnapshot", async (args) => {
        const req = (args ?? {}) as { forkId: unknown; height: number };
        const sm = ctx.getStateManager() as unknown as {
            storage: {
                getPreviousStateSnapshot: (req: {
                    forkId: unknown;
                    height: number;
                }) => { toStruct: () => unknown } | undefined;
            };
        };
        const snapshot = sm.storage.getPreviousStateSnapshot(req);
        return snapshot?.toStruct() ?? null;
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
    // ship .toStruct() so the orchestrator can rehydrate via StateSnapshot.from
    // (class instances don't survive structured clone).
    server.register("query.lastMilestoneSnapshot", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            prepareUpdateSnapshotSameFork: (f: unknown) => Promise<
                | {
                      milestoneSnapshots: Array<{ toStruct: () => unknown }>;
                  }
                | undefined
            >;
        };
        const result = await sm.prepareUpdateSnapshotSameFork(forkId);
        return result?.milestoneSnapshots.at(-1)?.toStruct();
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

    // step 4h - mirrors stateManager.postStateSnapshot(forkId). serialise
    // StateSnapshot via .toStruct() so structured clone preserves data.
    server.register("snapshot.post", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            postStateSnapshot: (
                f: unknown
            ) => Promise<{ toStruct: () => unknown } | undefined>;
        };
        const result = await sm.postStateSnapshot(forkId);
        return result?.toStruct();
    });

    // step 4i - mirrors stateManager.prepareUpdateSnapshotSameFork(forkId).
    // serialise StateSnapshot class instances via toStruct() before shipping
    // (structured clone strips class wrappers + private fields).
    server.register("snapshot.prepareSameFork", async (args) => {
        const { forkId } = (args ?? {}) as { forkId?: unknown };
        const sm = ctx.getStateManager() as unknown as {
            prepareUpdateSnapshotSameFork: (f: unknown) => Promise<
                | {
                      callData: string[];
                      expectedSnapshot: { toStruct: () => unknown };
                      milestoneSnapshots: Array<{ toStruct: () => unknown }>;
                      milestoneProofs?: unknown[];
                      outboundMessageBlocks?: unknown[];
                  }
                | undefined
            >;
        };
        const result = await sm.prepareUpdateSnapshotSameFork(forkId);
        if (!result) return undefined;
        return {
            callData: result.callData,
            expectedSnapshot: result.expectedSnapshot.toStruct(),
            milestoneSnapshots: result.milestoneSnapshots.map((s) =>
                s.toStruct()
            ),
            milestoneProofs: result.milestoneProofs,
            outboundMessageBlocks: result.outboundMessageBlocks
        };
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
        ctx.saved.calldataHandler = eh.onBlockCalldataPosted.bind(eh) as never;
        eh.onBlockCalldataPosted = (async () => {}) as never;
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
        sm.storage.inboundMessages.getLatestBlockHash = original as never;
        ctx.saved.inboundGetLatestBlockHash = undefined;
        return {};
    });

    server.register("byzantine.stubBroadcast", async () => {
        // W?: moved from ByzantineActions.ts:308-328
        const sm = ctx.getStateManager();
        const remoteRpc = sm.p2pManager.remoteRpc;
        ctx.saved.broadcast = remoteRpc.stateTransitionService
            .onBlockConfirmation as never;
        remoteRpc.stateTransitionService.onBlockConfirmation = (() => ({
            broadcast: () => {},
            sendOne: () => {},
            sendMultiple: () => {}
        })) as never;
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
            .onBlockConfirmation(blockConfirmation as never)
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
            .onBlockConfirmation(signedBlockConfirmation as never)
            .broadcast();
        return {};
    });

    // step 1 - byzantine.postJunkCalldataOnChain has no worker route. on-chain
    // writes are orchestrator-side per D-15; the action class calls
    // harness.channelManager.connect(peer.signer).postBlockCalldata(...) directly.
    // worker contributes nothing on this path -> no rpc method on ByzantineHandle.

    // step 1 - corruptValidatorSnapshotForBalanceInvariant. mirrors the whole
    // body of DisputeTamperingActions.corruptValidatorSnapshotForBalanceInvariant
    // since the storage read + write + StateSnapshot.from rebuild are entirely
    // in-worker. orchestrator-side caller just markMaliciousPeer; ship the
    // serialised snapshot back for any future asserts.
    server.register(
        "byzantine.corruptValidatorSnapshotForBalanceInvariant",
        async (args) => {
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
                        ) =>
                            | { toStruct: () => unknown; hash: string }
                            | undefined;
                        storeStateSnapshot: (
                            snapshot: unknown,
                            options: { hash: string }
                        ) => unknown;
                    };
                };
            };
            const latestBlock = sm.storage.blocks.getLatestBlock(forkId);
            if (!latestBlock) {
                throw new Error(
                    `byzantine.corruptValidatorSnapshotForBalanceInvariant: no latest block for fork ${forkId}`
                );
            }
            const originalSnapshot =
                sm.storage.stateSnapshots.getStateSnapshotByHash(
                    latestBlock.stateSnapshotHash
                );
            if (!originalSnapshot) {
                throw new Error(
                    `byzantine.corruptValidatorSnapshotForBalanceInvariant: no snapshot for hash ${latestBlock.stateSnapshotHash}`
                );
            }
            // step 1 - rebuild via StateSnapshot.from in-worker so the class
            // wrapper round-trips correctly back into storage.
            const StateSnapshotMod = (await import("@/models/StateSnapshot"))
                .default as unknown as {
                from: (s: unknown) => unknown;
            };
            const originalStruct = originalSnapshot.toStruct() as {
                snapshotData: {
                    totalDeposits: { amount: bigint | string | number };
                };
            };
            const corruptedSnapshotData = {
                ...originalStruct.snapshotData,
                totalDeposits: {
                    ...originalStruct.snapshotData.totalDeposits,
                    amount:
                        BigInt(
                            originalStruct.snapshotData.totalDeposits.amount
                        ) + 1n
                }
            };
            const corruptedStruct = {
                ...originalStruct,
                snapshotData: corruptedSnapshotData
            };
            const corruptedSnapshot = StateSnapshotMod.from(corruptedStruct);
            const originalHash = originalSnapshot.hash;
            sm.storage.stateSnapshots.storeStateSnapshot(corruptedSnapshot, {
                hash: originalHash
            });
            return { hash: originalHash };
        }
    );

    // step 1 - rpcStub.* (closure-bearing). orchestrator ships an opaque
    // callbackId; the worker-side wrapped method calls back via
    // "harness.invokeStubCallback" -> the orchestrator's StubCallbackRegistry
    // runs the closure with its native `this`/locals + returns the result.

    server.register("rpcStub.installCreateRpcMethodStub", async (args) => {
        const sm = ctx.getStateManager();
        const { serviceName, methodName, callbackId } = (args ?? {}) as {
            serviceName?: string;
            methodName?: string;
            callbackId?: string;
        };
        if (!serviceName)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'serviceName'"
            );
        if (!methodName)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'methodName'"
            );
        if (!callbackId)
            throw new Error(
                "rpcStub.installCreateRpcMethodStub: missing 'callbackId'"
            );

        const localRpc = sm.p2pManager.localRpc as unknown as Record<
            string,
            unknown
        >;
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

        service.createRPCMethods = (transport: unknown) => {
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
                // step 1 - callback to orchestrator. closure runs there with
                // the spread args; this binding can't survive structured
                // clone -> closures that need `this` rely on the test-local
                // capture (same pattern as the inline path's bound closures).
                return await ctx.workerRpcClient.call(
                    "harness.invokeStubCallback",
                    { id: callbackId, args: callArgs }
                );
            };
            return methods;
        };

        const restore = () => {
            service.createRPCMethods = originalCreate;
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
        // transport runtime instances carry connectionId + kind which aren't on
        // the ATransport base type. cast at the access seam.
        type TransportRuntime = {
            connectionId?: string;
            peerAddress?: string;
            kind?: string;
        };
        for (const t of sm.p2pManager
            .openConnections as unknown as TransportRuntime[]) {
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
        const profile = sm.p2pManager.profileManager?.getProfileByEvmAddress?.(
            addr
        ) as
            | { evmAddress?: string; transport?: { connectionId?: string } }
            | undefined;
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
        type TransportRuntime = { connectionId?: string };
        for (const t of sm.p2pManager
            .openConnections as unknown as TransportRuntime[]) {
            if (t.connectionId === connectionId) {
                const profile =
                    sm.p2pManager.profileManager?.getProfileByTransport?.(
                        t as never
                    ) as { evmAddress?: string } | undefined;
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
        const svc = sm.p2pManager.localRpc[
            "isForkDisputedService"
        ] as unknown as
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
        const svc = sm.p2pManager.localRpc[
            "initHandshakeService"
        ] as unknown as
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
        const svc = sm.p2pManager.localRpc[
            "initHandshakeService"
        ] as unknown as
            | { mapTransportToChallenge: { delete: (k: unknown) => void } }
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
            pm.disconnectConnection(conn as never);
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
            confirmation as never,
            expectedSnapshotHash
        );
        return {};
    });

    server.register("network.installDisconnectFilter", async (args) => {
        // step 1 - closure-bearing install. orchestrator ships an opaque
        // callbackId; the wrapped disconnectAndBlacklistPeerByEvmAddress calls
        // back via "harness.invokeFilterCallback" -> orchestrator runs the
        // closure with the addr string -> true delegates to original, false drops.
        const sm = ctx.getStateManager();
        const { callbackId } = (args ?? {}) as { callbackId?: string };
        if (!callbackId)
            throw new Error(
                "network.installDisconnectFilter: missing 'callbackId'"
            );

        const pm = sm.p2pManager;
        const original = pm.disconnectAndBlacklistPeerByEvmAddress.bind(pm);
        // step 1 - if a prior install is live, restore first so we wrap the
        // unmodified method.
        ctx.disconnectFilterRestore?.();

        pm.disconnectAndBlacklistPeerByEvmAddress = async (addr: string) => {
            const allow = (await ctx.workerRpcClient.call(
                "harness.invokeFilterCallback",
                { id: callbackId, message: addr }
            )) as boolean;
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

    // step 1 - debug.stubMethod. dotted-path monkey-patch on the live
    // stateManager. closure stays orchestrator-side; worker installs a stub
    // that calls back via "harness.invokeStubCallback" -> registry runs it.
    let nextDebugTokenId = 1;
    server.register("debug.stubMethod", async (args) => {
        const { path, callbackId } = (args ?? {}) as {
            path?: string;
            callbackId?: string;
        };
        if (!path) throw new Error("debug.stubMethod: missing 'path'");
        if (!callbackId)
            throw new Error("debug.stubMethod: missing 'callbackId'");
        const sm = ctx.getStateManager();
        const { target, leaf } = walkDottedPath(
            sm as unknown as Record<string, unknown>,
            path
        );
        const original = target[leaf];
        target[leaf] = async (...callArgs: unknown[]) => {
            return await ctx.workerRpcClient.call(
                "harness.invokeStubCallback",
                {
                    id: callbackId,
                    args: callArgs
                }
            );
        };
        const tokenId = `debugStub#${nextDebugTokenId++}`;
        ctx.debugMethodRestores.set(tokenId, () => {
            target[leaf] = original;
            ctx.debugMethodRestores.delete(tokenId);
        });
        return { id: tokenId };
    });

    server.register("debug.restoreStubbedMethod", async (args) => {
        const { tokenId } = (args ?? {}) as { tokenId?: string };
        if (!tokenId)
            throw new Error("debug.restoreStubbedMethod: missing 'tokenId'");
        ctx.debugMethodRestores.get(tokenId)?.();
        return {};
    });

    server.register("debug.restoreAllStubbedMethods", async () => {
        for (const restore of ctx.debugMethodRestores.values()) restore();
        ctx.debugMethodRestores.clear();
        return {};
    });
}

// step 1 - dotted path walker. "a.b.c" -> { target: root.a.b, leaf: "c" }.
// throws on missing intermediates so test source surfaces typos loud.
function walkDottedPath(
    root: Record<string, unknown>,
    path: string
): { target: Record<string, unknown>; leaf: string } {
    const parts = path.split(".");
    if (parts.length === 0 || parts.some((p) => p.length === 0)) {
        throw new Error(`debug.stubMethod: invalid path '${path}'`);
    }
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = cur[parts[i]];
        if (next === undefined || next === null) {
            throw new Error(
                `debug.stubMethod: path '${path}' segment '${parts[i]}' is ${String(next)}`
            );
        }
        cur = next as Record<string, unknown>;
    }
    return { target: cur, leaf: parts[parts.length - 1] };
}
