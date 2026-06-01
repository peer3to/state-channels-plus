import type { PeerHandler } from "../../rpc/rpc-server";
import { ROUTES } from "../routeNames";
import type StateManager from "@/stateManager";

export class StateRoutes {
    private stateManager?: StateManager;

    constructor(server: PeerHandler) {
        this.register(server);
    }

    setStateManager(sm: StateManager): void {
        this.stateManager = sm;
    }

    private get sm(): StateManager {
        if (!this.stateManager)
            throw new Error(
                "stateManager not initialized: p2pSetup has not completed"
            );
        return this.stateManager;
    }

    private register(server: PeerHandler): void {
        server.register(ROUTES.query.status, async () => this.sm.getStatus());

        server.register(ROUTES.query.latestBlock, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: string };
            const block = this.sm.storage.blocks.getLatestBlock(
                forkId ?? ""
            ) as { hash: string; height: number | bigint } | undefined;
            if (!block) return undefined;
            return { hash: String(block.hash), height: Number(block.height) };
        });

        server.register(ROUTES.query.blockAt, async (args) => {
            const { forkId, height } = (args ?? {}) as {
                forkId?: unknown;
                height?: number;
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.query.nextToWrite, async () => {
            const sm = this.sm as unknown as {
                diamondStateMachine: { getNextToWrite: () => Promise<string> };
            };
            return await sm.diamondStateMachine.getNextToWrite();
        });

        server.register(ROUTES.query.participants, async () => {
            const sm = this.sm as unknown as {
                diamondStateMachine: {
                    getParticipants: () => Promise<string[]>;
                };
            };
            return await sm.diamondStateMachine.getParticipants();
        });

        server.register(
            ROUTES.query.latestStateMachineStateHash,
            async (args) => {
                const { forkId } = (args ?? {}) as { forkId?: unknown };
                const sm = this.sm as unknown as {
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
                const snapshot =
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        latestBlock.stateSnapshotHash
                    );
                if (!snapshot) return null;
                if (
                    !sm.storage.stateMachineStates.getStateMachineState(
                        snapshot.stateMachineStateHash
                    )
                )
                    return null;
                return String(snapshot.stateMachineStateHash);
            }
        );

        server.register(ROUTES.query.nextBlockHeight, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    blocks: {
                        getNextBlockHeight: (f: unknown) => number | bigint;
                    };
                };
            };
            return Number(sm.storage.blocks.getNextBlockHeight(forkId));
        });

        server.register(ROUTES.query.stateSnapshotAt, async (args) => {
            const { forkId, height } = (args ?? {}) as {
                forkId?: unknown;
                height?: number;
            };
            const sm = this.sm as unknown as {
                storage: {
                    getStateSnapshot: (req: {
                        forkId: unknown;
                        height: number;
                    }) =>
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

        server.register(ROUTES.query.stateMachineState, async (args) => {
            const { hash } = (args ?? {}) as { hash?: string };
            if (!hash)
                throw new Error("query.stateMachineState: missing 'hash'");
            const sm = this.sm as unknown as {
                storage: {
                    stateMachineStates: {
                        getStateMachineState: (h: string) => string | undefined;
                    };
                };
            };
            return (
                sm.storage.stateMachineStates.getStateMachineState(hash) ?? null
            );
        });

        server.register(ROUTES.query.stateSnapshotCount, async () => {
            const sm = this.sm as unknown as {
                storage: {
                    stateSnapshots: { snapshotsByHash: Map<unknown, unknown> };
                };
            };
            return sm.storage.stateSnapshots.snapshotsByHash.size;
        });

        server.register(ROUTES.ingest.blockConfirmation, async (args) => {
            const { blockConfirmation, ingestOptions } = (args ?? {}) as {
                blockConfirmation: unknown;
                ingestOptions?: unknown;
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.query.isMyTurn, async () => {
            return (
                (
                    this.sm as unknown as { isMyTurn?: () => boolean }
                ).isMyTurn?.() ?? false
            );
        });

        server.register(ROUTES.query.previousBlockHash, async (args) => {
            const { ethers } = await import("ethers");
            const { forkId, height } = (args ?? {}) as {
                forkId?: unknown;
                height?: number;
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.query.stateSnapshotHashForFork, async (args) => {
            const { ethers } = await import("ethers");
            const { forkId, previousBlockHash } = (args ?? {}) as {
                forkId?: unknown;
                previousBlockHash?: string;
            };
            const sm = this.sm as unknown as {
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
                if (block?.stateSnapshotHash)
                    return String(block.stateSnapshotHash);
            }
            const genesis =
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
            return String(genesis?.hash ?? ethers.ZeroHash);
        });

        server.register(ROUTES.query.fraudProofForParticipant, async (args) => {
            const { addr } = (args ?? {}) as { addr?: string };
            if (!addr)
                throw new Error(
                    "query.fraudProofForParticipant: missing 'addr'"
                );
            const sm = this.sm as unknown as {
                storage: {
                    fraudProofs: {
                        getFraudProofForParticipant: (
                            a: string
                        ) =>
                            | { proofType: number; participant: string }
                            | undefined;
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

        server.register(ROUTES.query.disputeFraudProofs, async () => {
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.query.inboundLatestBlockHash, async () => {
            const sm = this.sm as unknown as {
                storage: {
                    inboundMessages: { getLatestBlockHash: () => unknown };
                };
            };
            const result = sm.storage.inboundMessages.getLatestBlockHash();
            return result ? String(result) : undefined;
        });

        server.register(ROUTES.query.inboundLatestBlockHeight, async () => {
            const sm = this.sm as unknown as {
                storage: {
                    inboundMessages: {
                        getLatestBlockHeight: () => number | bigint | undefined;
                    };
                };
            };
            const result = sm.storage.inboundMessages.getLatestBlockHeight();
            return result === undefined ? undefined : Number(result);
        });

        server.register(ROUTES.timeout.store, async (args) => {
            const { forkId, timeout } = (args ?? {}) as {
                forkId: unknown;
                timeout: unknown;
            };
            const sm = this.sm as unknown as {
                storage: {
                    timeout: { storeTimeout: (f: unknown, t: unknown) => void };
                };
            };
            sm.storage.timeout.storeTimeout(forkId, timeout);
        });

        server.register(ROUTES.forceExit.set, async (args) => {
            const { value } = (args ?? {}) as { value?: boolean };
            const sm = this.sm as unknown as {
                storage: {
                    forceExit: { setForceExit: (v: boolean) => void };
                };
            };
            sm.storage.forceExit.setForceExit(Boolean(value));
        });

        server.register(ROUTES.query.timeoutForFork, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
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
                    t.blockHeight !== undefined
                        ? String(t.blockHeight)
                        : undefined
            };
        });

        server.register(ROUTES.query.disputeConfirmation, async (args) => {
            const { disputeHash } = (args ?? {}) as { disputeHash?: string };
            if (!disputeHash)
                throw new Error(
                    "query.disputeConfirmation: missing 'disputeHash'"
                );
            const sm = this.sm as unknown as {
                storage: {
                    disputes: {
                        getDisputeConfirmation: (
                            h: string
                        ) => unknown | undefined;
                    };
                };
            };
            return (
                sm.storage.disputes.getDisputeConfirmation(disputeHash) ?? null
            );
        });

        server.register(
            ROUTES.context.computeExpectedWithdrawalsDelta,
            async (args) => {
                const req = (args ?? {}) as {
                    upperBlockHash: string;
                    lowerBlockHash?: string;
                };
                const sm = this.sm as unknown as {
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
                const blocks =
                    sm.storage.outboundMessages.getMessageBlocksInRange(req);
                let total = await sm.diamondStateMachine.getZeroBalance();
                for (const block of blocks)
                    for (const message of block.messages)
                        total = await sm.diamondStateMachine.addBalance(
                            total,
                            message.balance
                        );
                return {
                    amount: String(total.amount),
                    data: String(total.data)
                };
            }
        );

        server.register(ROUTES.balance.subtract, async (args) => {
            const req = (args ?? {}) as {
                a: { amount: string; data: string };
                b: { amount: string; data: string };
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.balance.areEqual, async (args) => {
            const req = (args ?? {}) as {
                a: { amount: string; data: string };
                b: { amount: string; data: string };
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.dispute.construct, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                disputeManager: {
                    constructDispute: (f: unknown) => Promise<unknown>;
                };
            };
            return await sm.disputeManager.constructDispute(forkId);
        });

        server.register(ROUTES.query.genesisSnapshot, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    stateSnapshots: {
                        getGenesisSnapshotByForkId: (
                            f: unknown
                        ) => { toStruct: () => unknown } | undefined;
                    };
                };
            };
            return (
                sm.storage.stateSnapshots
                    .getGenesisSnapshotByForkId(forkId)
                    ?.toStruct() ?? null
            );
        });

        server.register(ROUTES.query.stateSnapshotByHash, async (args) => {
            const { hash } = (args ?? {}) as { hash?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    stateSnapshots: {
                        getStateSnapshotByHash: (
                            h: unknown
                        ) => { toStruct: () => unknown } | undefined;
                    };
                };
            };
            return (
                sm.storage.stateSnapshots
                    .getStateSnapshotByHash(hash)
                    ?.toStruct() ?? null
            );
        });

        server.register(ROUTES.query.outboundMessageBlock, async (args) => {
            const { hash } = (args ?? {}) as { hash?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    outboundMessages: {
                        getMessageBlock: (h: unknown) => unknown | undefined;
                    };
                };
            };
            return sm.storage.outboundMessages.getMessageBlock(hash) ?? null;
        });

        server.register(
            ROUTES.dispute.latestBlockFromStateProof,
            async (args) => {
                const { stateProof } = (args ?? {}) as { stateProof?: unknown };
                const sm = this.sm as unknown as {
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
                return { hasBlock: Boolean(hasBlock), latestBlock };
            }
        );

        server.register(ROUTES.dispute.windows, async (args) => {
            const { channelId, forkIds } = (args ?? {}) as {
                channelId?: unknown;
                forkIds?: unknown[];
            };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.dispute.localStateSnapshot, async (args) => {
            const { channelId } = (args ?? {}) as { channelId?: unknown };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.dispute.getAuditingData, async (args) => {
            const req = (args ?? {}) as { forkId: unknown; args?: unknown[] };
            const sm = this.sm as unknown as {
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

        server.register(ROUTES.query.previousStateSnapshot, async (args) => {
            const req = (args ?? {}) as { forkId: unknown; height: number };
            const sm = this.sm as unknown as {
                storage: {
                    getPreviousStateSnapshot: (req: {
                        forkId: unknown;
                        height: number;
                    }) => { toStruct: () => unknown } | undefined;
                };
            };
            return sm.storage.getPreviousStateSnapshot(req)?.toStruct() ?? null;
        });

        server.register(ROUTES.tx.apply, async (args) => {
            const sm = this.sm as unknown as {
                applyTransaction: (
                    tx: unknown
                ) => Promise<{ success: boolean; encodedState: string }>;
            };
            return await sm.applyTransaction(args);
        });

        server.register(ROUTES.query.lastMilestoneSnapshot, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                prepareUpdateSnapshotSameFork: (f: unknown) => Promise<
                    | {
                          milestoneSnapshots: Array<{
                              toStruct: () => unknown;
                          }>;
                      }
                    | undefined
                >;
            };
            const result = await sm.prepareUpdateSnapshotSameFork(forkId);
            return result?.milestoneSnapshots.at(-1)?.toStruct();
        });

        server.register(ROUTES.query.openDisputeForkIds, async () => {
            const sm = this.sm as unknown as {
                storage: {
                    disputes: { getOpenDisputeForkIds?: () => string[] };
                };
            };
            return sm.storage.disputes.getOpenDisputeForkIds?.() ?? [];
        });

        server.register(ROUTES.query.timeoutsForFork, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    timeout: {
                        getTimeoutsForFork: (f: unknown) => unknown[];
                    };
                };
            };
            return sm.storage.timeout.getTimeoutsForFork(forkId);
        });

        server.register(ROUTES.query.blockConfirmationAt, async (args) => {
            const { forkId, height } = (args ?? {}) as {
                forkId?: unknown;
                height?: number;
            };
            const sm = this.sm as unknown as {
                storage: {
                    blocks: {
                        getBlock: (
                            f: unknown,
                            h: number
                        ) =>
                            | {
                                  blockConfirmationStruct: unknown;
                                  onChainTimestamp?: number;
                              }
                            | undefined;
                    };
                };
            };
            const block = sm.storage.blocks.getBlock(forkId, Number(height));
            if (!block) return undefined;
            return {
                blockConfirmation: block.blockConfirmationStruct,
                onChainTimestamp: block.onChainTimestamp
            };
        });

        server.register(ROUTES.query.blockByHash, async (args) => {
            const { hash } = (args ?? {}) as { hash?: string };
            if (!hash) throw new Error("query.blockByHash: missing 'hash'");
            const sm = this.sm as unknown as {
                storage: {
                    blocks: {
                        getBlock: (h: string) =>
                            | {
                                  blockConfirmationStruct: unknown;
                                  onChainTimestamp?: number;
                                  confirmationSignatures:
                                      | Set<string>
                                      | Iterable<string>;
                              }
                            | undefined;
                    };
                };
            };
            const block = sm.storage.blocks.getBlock(hash);
            if (!block) return undefined;
            return {
                blockConfirmation: block.blockConfirmationStruct,
                onChainTimestamp: block.onChainTimestamp,
                confirmationSignatures: Array.from(
                    block.confirmationSignatures ?? []
                ).map((s) => String(s))
            };
        });

        server.register(ROUTES.queue.block, async (args) => {
            const { blockConfirmation, onChainTimestamp } = (args ?? {}) as {
                blockConfirmation?: unknown;
                onChainTimestamp?: number;
            };
            if (!blockConfirmation)
                throw new Error("queue.block: missing 'blockConfirmation'");
            const Block = (await import("@/models")).Block;
            const block = Block.fromBlockConfirmation(
                blockConfirmation as Parameters<
                    typeof Block.fromBlockConfirmation
                >[0],
                onChainTimestamp
            );
            const sm = this.sm as unknown as {
                storage: { queues: { queueBlock: (b: unknown) => unknown } };
            };
            sm.storage.queues.queueBlock(block);
        });

        server.register(ROUTES.p2p.isBlacklisted, async (args) => {
            const { addr } = (args ?? {}) as { addr?: string };
            if (!addr) throw new Error("p2p.isBlacklisted: missing 'addr'");
            const sm = this.sm as unknown as {
                p2pManager: { isBlacklisted: (a: string) => boolean };
            };
            return sm.p2pManager.isBlacklisted(addr);
        });

        server.register(ROUTES.contract.postBlockCalldata, async (args) => {
            const { signedBlock, maxTimestamp } = (args ?? {}) as {
                signedBlock?: unknown;
                maxTimestamp?: number;
            };
            if (!signedBlock)
                throw new Error(
                    "contract.postBlockCalldata: missing 'signedBlock'"
                );
            const sm = this.sm as unknown as {
                stateChannelManagerContract: {
                    postBlockCalldata: (
                        s: unknown,
                        t: number
                    ) => Promise<{ wait: () => Promise<unknown> }>;
                };
            };
            const tx = await sm.stateChannelManagerContract.postBlockCalldata(
                signedBlock,
                Number(maxTimestamp)
            );
            await tx.wait();
        });

        server.register(ROUTES.query.latestBlockConfirmation, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                storage: {
                    blocks: {
                        getLatestBlock: (
                            f: unknown
                        ) => { blockConfirmationStruct: unknown } | undefined;
                    };
                };
            };
            return (
                sm.storage.blocks.getLatestBlock(forkId)
                    ?.blockConfirmationStruct ?? undefined
            );
        });

        server.register(ROUTES.snapshot.post, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                postStateSnapshot: (
                    f: unknown
                ) => Promise<{ toStruct: () => unknown } | undefined>;
            };
            return (await sm.postStateSnapshot(forkId))?.toStruct();
        });

        server.register(ROUTES.snapshot.prepareSameFork, async (args) => {
            const { forkId } = (args ?? {}) as { forkId?: unknown };
            const sm = this.sm as unknown as {
                prepareUpdateSnapshotSameFork: (f: unknown) => Promise<
                    | {
                          callData: string[];
                          expectedSnapshot: { toStruct: () => unknown };
                          milestoneSnapshots: Array<{
                              toStruct: () => unknown;
                          }>;
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

        server.register(ROUTES.query.didEveryoneSignBlock, async (args) => {
            const { blockHash } = (args ?? {}) as { blockHash?: string };
            if (!blockHash)
                throw new Error(
                    "query.didEveryoneSignBlock: missing 'blockHash'"
                );
            const sm = this.sm as unknown as {
                storage: { blocks: { getBlock: (h: string) => unknown } };
                agreementManager: {
                    didEveryoneSignBlock: (b: unknown) => boolean;
                };
            };
            const block = sm.storage.blocks.getBlock(blockHash);
            if (!block) return false;
            return sm.agreementManager.didEveryoneSignBlock(block);
        });
    }
}
