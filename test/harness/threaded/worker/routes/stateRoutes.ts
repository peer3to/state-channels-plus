import { ethers } from "ethers";
import type { PeerHandler } from "../../rpc/PeerHandler";
import { ROUTES } from "../routeNames";
import type StateManager from "@/stateManager";
import Block from "@/models/Block";
import type {
    Address,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import type { StateProofStruct } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    BlockConfirmationStruct,
    SignedBlockStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { BalanceStruct } from "@typechain-types/contracts/V1/types/FraudProofTypes";

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

        server.register(
            ROUTES.query.blockAt,
            async ({ forkId, height }: { forkId: ForkId; height: number }) => {
                const block = this.sm.storage.blocks.getBlock(forkId, height);
                if (!block) return undefined;
                return {
                    hash: String(block.hash),
                    height: Number(block.height),
                    author: String(block.author)
                };
            }
        );

        server.register(ROUTES.query.nextToWrite, async () => {
            return await this.sm.diamondStateMachine.getNextToWrite();
        });

        server.register(ROUTES.query.participants, async () => {
            return await this.sm.diamondStateMachine.getParticipants();
        });

        server.register(
            ROUTES.query.latestStateMachineStateHash,
            async ({ forkId }: { forkId: ForkId }) => {
                const latestBlock =
                    this.sm.storage.blocks.getLatestBlock(forkId);
                if (!latestBlock) return null;
                const snapshot =
                    this.sm.storage.stateSnapshots.getStateSnapshotByHash(
                        latestBlock.stateSnapshotHash
                    );
                if (!snapshot) return null;
                if (
                    !this.sm.storage.stateMachineStates.getStateMachineState(
                        snapshot.stateMachineStateHash
                    )
                )
                    return null;
                return String(snapshot.stateMachineStateHash);
            }
        );

        server.register(
            ROUTES.query.nextBlockHeight,
            async ({ forkId }: { forkId: ForkId }) => {
                return Number(
                    this.sm.storage.blocks.getNextBlockHeight(forkId)
                );
            }
        );

        server.register(
            ROUTES.query.stateSnapshotAt,
            async ({ forkId, height }: { forkId: ForkId; height: number }) => {
                const snap = this.sm.storage.getStateSnapshot({
                    forkId,
                    height
                });
                if (!snap) return null;
                return {
                    hash: String(snap.hash),
                    stateMachineStateHash: String(snap.stateMachineStateHash),
                    blockHeight: Number(snap.blockHeight)
                };
            }
        );

        server.register(
            ROUTES.query.stateMachineState,
            async ({ hash }: { hash: Hash }) => {
                return (
                    this.sm.storage.stateMachineStates.getStateMachineState(
                        hash
                    ) ?? null
                );
            }
        );

        server.register(ROUTES.query.stateSnapshotCount, async () => {
            // snapshotsByHash is private — no public count API on StateSnapshotStorage
            return this.sm.storage.stateSnapshots["snapshotsByHash"].size;
        });

        server.register(
            ROUTES.ingest.blockConfirmation,
            async ({
                blockConfirmation,
                ingestOptions
            }: {
                blockConfirmation: BlockConfirmationStruct;
                ingestOptions?: { onChainTimestamp?: Timestamp };
            }) => {
                return await this.sm.ingestBlockConfirmation(
                    blockConfirmation,
                    ingestOptions
                );
            }
        );

        server.register(ROUTES.query.isMyTurn, async () => {
            return await this.sm.isMyTurn();
        });

        server.register(
            ROUTES.query.previousBlockHash,
            async ({ forkId, height }: { forkId: ForkId; height?: number }) => {
                if (height !== undefined) {
                    const prev = this.sm.storage.getPreviousBlockOrSnapshot({
                        forkId,
                        height
                    });
                    return prev.block?.hash ?? prev.stateSnapshot!.hash;
                }
                const previousBlock =
                    this.sm.storage.blocks.getLatestBlock(forkId);
                if (previousBlock?.hash) return String(previousBlock.hash);
                const genesis =
                    this.sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        forkId
                    );
                return String(genesis?.hash ?? ethers.ZeroHash);
            }
        );

        server.register(
            ROUTES.query.stateSnapshotHashForFork,
            async ({
                forkId,
                previousBlockHash
            }: {
                forkId: ForkId;
                previousBlockHash?: Hash;
            }) => {
                if (previousBlockHash) {
                    const block =
                        this.sm.storage.blocks.getBlock(previousBlockHash);
                    if (block?.stateSnapshotHash)
                        return String(block.stateSnapshotHash);
                }
                const genesis =
                    this.sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        forkId
                    );
                return String(genesis?.hash ?? ethers.ZeroHash);
            }
        );

        server.register(
            ROUTES.query.fraudProofForParticipant,
            async ({ addr }: { addr: Address }) => {
                const fp =
                    this.sm.storage.fraudProofs.getFraudProofForParticipant(
                        addr
                    );
                if (!fp) return null;
                return {
                    proofType: Number(fp.proofType),
                    participant: String(fp.participant)
                };
            }
        );

        server.register(ROUTES.query.disputeFraudProofs, async () => {
            return this.sm.storage.disputeFraudProofs
                .getDisputeFraudProofs()
                .map((p) => ({ proofType: Number(p.proofType) }));
        });

        server.register(ROUTES.query.inboundLatestBlockHash, async () => {
            const result = this.sm.storage.inboundMessages.getLatestBlockHash();
            return result ? String(result) : undefined;
        });

        server.register(ROUTES.query.inboundLatestBlockHeight, async () => {
            const result =
                this.sm.storage.inboundMessages.getLatestBlockHeight();
            return result === undefined ? undefined : Number(result);
        });

        server.register(
            ROUTES.timeout.store,
            async ({
                forkId,
                timeout
            }: {
                forkId: ForkId;
                timeout: TimeoutStruct;
            }) => {
                this.sm.storage.timeout.storeTimeout(forkId, timeout);
            }
        );

        server.register(
            ROUTES.forceExit.set,
            async ({ value }: { value: boolean }) => {
                this.sm.storage.forceExit.setForceExit(value);
            }
        );

        server.register(
            ROUTES.query.timeoutForFork,
            async ({ forkId }: { forkId: ForkId }) => {
                const t = this.sm.storage.timeout.getTimeout(forkId);
                if (!t) return null;
                return {
                    participant: String(t.participant),
                    isForced: Boolean(t.isForced),
                    blockHeight:
                        t.blockHeight !== undefined
                            ? String(t.blockHeight)
                            : undefined
                };
            }
        );

        server.register(
            ROUTES.query.disputeConfirmation,
            async ({ disputeHash }: { disputeHash: Hash }) => {
                return (
                    this.sm.storage.disputes.getDisputeConfirmation(
                        disputeHash
                    ) ?? null
                );
            }
        );

        server.register(
            ROUTES.context.computeExpectedWithdrawalsDelta,
            async ({
                upperBlockHash,
                lowerBlockHash
            }: {
                upperBlockHash: Hash;
                lowerBlockHash?: Hash;
            }) => {
                const blocks =
                    this.sm.storage.outboundMessages.getMessageBlocksInRange({
                        upperBlockHash,
                        lowerBlockHash
                    });
                let total = await this.sm.diamondStateMachine.getZeroBalance();
                for (const block of blocks)
                    for (const message of block.messages)
                        total = await this.sm.diamondStateMachine.addBalance(
                            total,
                            message.balance
                        );
                return {
                    amount: String(total.amount),
                    data: String(total.data)
                };
            }
        );

        server.register(
            ROUTES.balance.subtract,
            async ({ a, b }: { a: BalanceStruct; b: BalanceStruct }) => {
                const r = await this.sm.diamondStateMachine.subtractBalance(
                    a,
                    b
                );
                return { amount: String(r.amount), data: String(r.data) };
            }
        );

        server.register(
            ROUTES.balance.areEqual,
            async ({ a, b }: { a: BalanceStruct; b: BalanceStruct }) => {
                return this.sm.diamondStateMachine.areBalancesEqual(a, b);
            }
        );

        server.register(
            ROUTES.balance.verifyInvariant,
            async ({
                channelId,
                encodedStateMachineState
            }: {
                channelId: ChannelId;
                encodedStateMachineState?: Bytes;
            }) => {
                const cm = this.sm.stateChannelManagerContract;
                const rawSnapshot = await cm.getStateSnapshot(channelId);
                const stateHash =
                    rawSnapshot.snapshotData.stateMachineStateHash;
                const encodedState =
                    encodedStateMachineState ??
                    this.sm.storage.stateMachineStates.getStateMachineState(
                        stateHash
                    );
                if (!encodedState) {
                    throw new Error(
                        `No encoded state machine state found for snapshot hash ${stateHash}`
                    );
                }
                return cm.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    rawSnapshot.snapshotData,
                    encodedState
                );
            }
        );

        server.register(
            ROUTES.dispute.construct,
            async ({ forkId }: { forkId: ForkId }) => {
                return await this.sm.disputeManager.constructDispute(forkId);
            }
        );

        server.register(
            ROUTES.query.genesisSnapshot,
            async ({ forkId }: { forkId: ForkId }) => {
                return (
                    this.sm.storage.stateSnapshots
                        .getGenesisSnapshotByForkId(forkId)
                        ?.toStruct() ?? null
                );
            }
        );

        server.register(
            ROUTES.query.stateSnapshotByHash,
            async ({ hash }: { hash: Hash }) => {
                return (
                    this.sm.storage.stateSnapshots
                        .getStateSnapshotByHash(hash)
                        ?.toStruct() ?? null
                );
            }
        );

        server.register(
            ROUTES.query.outboundMessageBlock,
            async ({ hash }: { hash: Hash }) => {
                return (
                    this.sm.storage.outboundMessages.getMessageBlock(hash) ??
                    null
                );
            }
        );

        server.register(
            ROUTES.dispute.latestBlockFromStateProof,
            async ({ stateProof }: { stateProof: StateProofStruct }) => {
                const [hasBlock, latestBlock] =
                    await this.sm.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                        stateProof
                    );
                return { hasBlock: Boolean(hasBlock), latestBlock };
            }
        );

        server.register(
            ROUTES.dispute.disputeWindows,
            async ({
                channelId,
                forkIds
            }: {
                channelId: ChannelId;
                forkIds: ForkId[];
            }) => {
                return await this.sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
                    channelId,
                    forkIds
                );
            }
        );

        server.register(
            ROUTES.dispute.localStateSnapshot,
            async ({ channelId }: { channelId: ChannelId }) => {
                return await this.sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
                    channelId
                );
            }
        );

        server.register(
            ROUTES.dispute.getAuditingData,
            async ({
                forkId,
                stateProof,
                options
            }: {
                forkId: ForkId;
                stateProof: StateProofStruct;
                options?: { disputeLatestInboundMessageBlockHash?: Hash };
            }) => {
                return this.sm.disputeManager.getAuditingData(
                    forkId,
                    stateProof,
                    options
                ).auditingData;
            }
        );

        server.register(
            ROUTES.query.previousStateSnapshot,
            async ({ forkId, height }: { forkId: ForkId; height: number }) => {
                return (
                    this.sm.storage
                        .getPreviousStateSnapshot({ forkId, height })
                        ?.toStruct() ?? null
                );
            }
        );

        server.register(ROUTES.tx.apply, async (tx: TransactionStruct) => {
            return await this.sm.applyTransaction(tx);
        });

        server.register(
            ROUTES.query.lastMilestoneSnapshot,
            async ({ forkId }: { forkId: ForkId }) => {
                const result =
                    await this.sm.prepareUpdateSnapshotSameFork(forkId);
                return result?.milestoneSnapshots.at(-1)?.toStruct();
            }
        );

        server.register(
            ROUTES.query.blockConfirmationAt,
            async ({ forkId, height }: { forkId: ForkId; height: number }) => {
                const block = this.sm.storage.blocks.getBlock(forkId, height);
                if (!block) return undefined;
                return {
                    blockConfirmation: block.blockConfirmationStruct,
                    onChainTimestamp: block.onChainTimestamp
                };
            }
        );

        server.register(
            ROUTES.query.blockByHash,
            async ({ hash }: { hash: Hash }) => {
                const block = this.sm.storage.blocks.getBlock(hash);
                if (!block) return undefined;
                return {
                    blockConfirmation: block.blockConfirmationStruct,
                    onChainTimestamp: block.onChainTimestamp,
                    confirmationSignatures: Array.from(
                        block.confirmationSignatures ?? []
                    ).map(String)
                };
            }
        );

        server.register(
            ROUTES.queue.block,
            async ({
                blockConfirmation,
                onChainTimestamp
            }: {
                blockConfirmation: BlockConfirmationStruct;
                onChainTimestamp?: number;
            }) => {
                this.sm.storage.queues.queueBlock(
                    Block.fromBlockConfirmation(
                        blockConfirmation,
                        onChainTimestamp
                    )
                );
            }
        );

        server.register(
            ROUTES.p2p.isBlacklisted,
            async ({ addr }: { addr: Address }) => {
                return this.sm.p2pManager.isBlacklisted(addr);
            }
        );

        server.register(
            ROUTES.contract.postBlockCalldata,
            async ({
                signedBlock,
                maxTimestamp
            }: {
                signedBlock: SignedBlockStruct;
                maxTimestamp: number;
            }) => {
                const tx =
                    await this.sm.stateChannelManagerContract.postBlockCalldata(
                        signedBlock,
                        maxTimestamp
                    );
                await tx.wait();
            }
        );

        server.register(
            ROUTES.query.latestBlockConfirmation,
            async ({ forkId }: { forkId: ForkId }) => {
                return (
                    this.sm.storage.blocks.getLatestBlock(forkId)
                        ?.blockConfirmationStruct ?? undefined
                );
            }
        );

        server.register(
            ROUTES.snapshot.post,
            async ({ forkId }: { forkId: ForkId }) => {
                return (await this.sm.postStateSnapshot(forkId))?.toStruct();
            }
        );

        server.register(
            ROUTES.snapshot.prepareSameFork,
            async ({ forkId }: { forkId: ForkId }) => {
                const result =
                    await this.sm.prepareUpdateSnapshotSameFork(forkId);
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
            }
        );

        server.register(
            ROUTES.query.didEveryoneSignBlock,
            async ({ blockHash }: { blockHash: Hash }) => {
                const block = this.sm.storage.blocks.getBlock(blockHash);
                if (!block) return false;
                return this.sm.agreementManager.didEveryoneSignBlock(block);
            }
        );
    }
}
