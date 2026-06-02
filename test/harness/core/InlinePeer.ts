import type { Address, BlockHeight, ForkId, Hash } from "@/types/types";
import type { Logger, EventBarrier } from "@/utils";
import { ZeroHash, type Signer } from "ethers";
import type { BlockHeight as _BH, Bytes, Status, Timestamp } from "@/types";
import type {
    BlockConfirmationStruct,
    BlockStruct,
    BlockStructOutput,
    MessageBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeWindowStructOutput,
    StateProofStruct
} from "@typechain-types/contracts/V1/StateChannelDiamondProxy/LocalDiamond";
import type {
    DisputeAuditingDataStruct,
    DisputeConfirmationStruct,
    DisputeStruct,
    MilestoneProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

import type {
    ByzantineInterface,
    StubInterface,
    LifecycleInterface,
    NetworkInterface,
    P2pInternalsInterface,
    PeerHandle,
    RpcStubInterface,
    TransitionInterface
} from "./PeerHandle";
import type { EventSpies, TestPeer } from "./types";

import { InlineByzantineHandle } from "./inline/byzantineHandle";
import { InlineRpcStubHandle } from "./inline/rpcStubHandle";
import { InlineP2pInternalsHandle } from "./inline/queryInternalsHandle";
import { InlineTransitionHandle } from "./inline/transitionHandle";
import { InlineLifecycleHandle } from "./inline/lifecycleHandle";
import { InlineNetworkHandle } from "./inline/networkHandle";
import { InlineStubHandle } from "./inline/stubHandle";
import { BlockCoordinates } from "@/models";

export class InlinePeer implements PeerHandle {
    readonly byzantine: ByzantineInterface;
    readonly rpcStub: RpcStubInterface;
    readonly queryInternals: P2pInternalsInterface;
    readonly network: NetworkInterface;
    readonly transition: TransitionInterface;
    readonly lifecycle: LifecycleInterface;
    readonly stub: StubInterface;

    constructor(public readonly peer: TestPeer) {
        this.byzantine = new InlineByzantineHandle(peer);
        this.rpcStub = new InlineRpcStubHandle(peer);
        this.queryInternals = new InlineP2pInternalsHandle(peer);
        this.network = new InlineNetworkHandle(peer);
        this.transition = new InlineTransitionHandle(peer);
        this.lifecycle = new InlineLifecycleHandle(peer);
        this.stub = new InlineStubHandle(peer);
    }

    get index(): number {
        return this.peer.index;
    }
    get address(): string {
        return this.peer.address;
    }
    get signer(): Signer {
        return this.peer.signer;
    }
    get logger(): Logger {
        return this.peer.logger;
    }
    get eventSpies(): EventSpies {
        return this.peer.eventSpies;
    }
    get turnBarrier(): EventBarrier {
        return this.peer.turnBarrier;
    }
    get forkId(): ForkId | undefined {
        return this.peer.stateManager.forkId;
    }

    async queryStatus(): Promise<Status> {
        return this.peer.stateManager.getStatus();
    }

    async queryLatestBlock(
        forkId: ForkId
    ): Promise<{ hash: Hash; height: BlockHeight } | undefined> {
        const block =
            this.peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!block) return undefined;
        return { hash: block.hash, height: block.height };
    }

    async queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            req.forkId,
            req.height
        );
        if (!block) return undefined;
        return { hash: block.hash, height: block.height, author: block.author };
    }

    async queryNextToWrite(): Promise<Address> {
        return await this.peer.stateManager.diamondStateMachine.getNextToWrite();
    }

    async queryParticipants(): Promise<Address[]> {
        return await this.peer.stateManager.diamondStateMachine.getParticipants();
    }

    async queryLatestStateMachineStateHash(
        forkId: ForkId
    ): Promise<Hash | null> {
        const storage = this.peer.stateManager.storage;
        const latestBlock = storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) return null;
        const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );
        if (!snapshot) return null;
        if (
            !storage.stateMachineStates.getStateMachineState(
                snapshot.stateMachineStateHash
            )
        )
            return null;
        return snapshot.stateMachineStateHash;
    }

    async queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean> {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            blockHash as string
        );
        if (!block) return false;
        return this.peer.stateManager.agreementManager.didEveryoneSignBlock(
            block
        );
    }

    async queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight> {
        return this.peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
    }

    async queryStateSnapshotAt(req: BlockCoordinates): Promise<{
        hash: Hash;
        stateMachineStateHash: Hash;
        blockHeight: BlockHeight;
    } | null> {
        return this.peer.stateManager.storage.getStateSnapshot(req) ?? null;
    }

    async queryStateMachineState(hash: Hash): Promise<Bytes | null> {
        return (
            this.peer.stateManager.storage.stateMachineStates.getStateMachineState(
                hash
            ) ?? null
        );
    }

    async queryStateSnapshotCount(): Promise<number> {
        const snaps = this.peer.stateManager.storage
            .stateSnapshots as unknown as {
            snapshotsByHash: Map<unknown, unknown>;
        };
        return snaps.snapshotsByHash.size;
    }

    async queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash> {
        const storage = this.peer.stateManager.storage;
        if (req.height !== undefined) {
            const prev = storage.getPreviousBlockOrSnapshot({
                forkId: req.forkId,
                height: req.height
            }) as unknown as {
                block?: { hash: Hash };
                stateSnapshot?: { hash: Hash };
            };
            return prev.block?.hash ?? prev.stateSnapshot!.hash;
        }
        const previousBlock = storage.blocks.getLatestBlock(req.forkId) as
            | { hash: Hash }
            | undefined;
        if (previousBlock?.hash) return previousBlock.hash;
        const genesis = (
            storage.stateSnapshots as unknown as {
                getGenesisSnapshotByForkId: (
                    f: unknown
                ) => { hash: Hash } | undefined;
            }
        ).getGenesisSnapshotByForkId(req.forkId);
        return genesis?.hash ?? ZeroHash;
    }

    async queryStateSnapshotHashForFork(req: {
        forkId: ForkId;
        previousBlockHash?: Hash;
    }): Promise<Hash> {
        const storage = this.peer.stateManager.storage;
        if (req.previousBlockHash) {
            const block = (
                storage.blocks as unknown as {
                    getBlock: (
                        h: Hash
                    ) => { stateSnapshotHash: Hash } | undefined;
                }
            ).getBlock(req.previousBlockHash);
            if (block?.stateSnapshotHash) return block.stateSnapshotHash;
        }
        const genesis = (
            storage.stateSnapshots as unknown as {
                getGenesisSnapshotByForkId: (
                    f: unknown
                ) => { hash: Hash } | undefined;
            }
        ).getGenesisSnapshotByForkId(req.forkId);
        return genesis?.hash ?? ZeroHash;
    }

    async queryFraudProofForParticipant(
        addr: Address
    ): Promise<{ proofType: number; participant: Address } | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            fraudProofs: {
                getFraudProofForParticipant: (
                    a: Address
                ) => { proofType: number; participant: Address } | undefined;
            };
        };
        const fp = storage.fraudProofs.getFraudProofForParticipant(addr);
        if (!fp) return null;
        return { proofType: Number(fp.proofType), participant: fp.participant };
    }

    async queryDisputeFraudProofs(): Promise<Array<{ proofType: number }>> {
        const storage = this.peer.stateManager.storage as unknown as {
            disputeFraudProofs: {
                getDisputeFraudProofs: () => Array<{ proofType: number }>;
            };
        };
        return storage.disputeFraudProofs
            .getDisputeFraudProofs()
            .map((p) => ({ proofType: Number(p.proofType) }));
    }

    async queryInboundLatestBlockHash(): Promise<Hash | undefined> {
        return this.peer.stateManager.storage.inboundMessages.getLatestBlockHash();
    }

    async queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined> {
        const result =
            this.peer.stateManager.storage.inboundMessages.getLatestBlockHeight();
        return result === undefined ? undefined : Number(result);
    }

    async storeTimeout(req: {
        forkId: ForkId;
        timeout: TimeoutStruct;
    }): Promise<void> {
        const storage = this.peer.stateManager.storage as unknown as {
            timeout: {
                storeTimeout: (forkId: ForkId, t: TimeoutStruct) => void;
            };
        };
        storage.timeout.storeTimeout(req.forkId, req.timeout);
    }

    async setForceExit(value: boolean): Promise<void> {
        const storage = this.peer.stateManager.storage as unknown as {
            forceExit: { setForceExit: (v: boolean) => void };
        };
        storage.forceExit.setForceExit(value);
    }

    async queryTimeoutForFork(forkId: ForkId): Promise<TimeoutStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            timeout: { getTimeout: (f: ForkId) => TimeoutStruct | undefined };
        };
        return storage.timeout.getTimeout(forkId) ?? null;
    }

    async queryDisputeConfirmation(
        disputeHash: Hash
    ): Promise<DisputeConfirmationStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            disputes: {
                getDisputeConfirmation: (
                    h: Hash
                ) => DisputeConfirmationStruct | undefined;
            };
        };
        return storage.disputes.getDisputeConfirmation(disputeHash) ?? null;
    }

    async computeExpectedWithdrawalsDelta(req: {
        upperBlockHash: Hash;
        lowerBlockHash?: Hash;
    }): Promise<{ amount: string; data: string }> {
        const sm = this.peer.stateManager as unknown as {
            storage: {
                outboundMessages: {
                    getMessageBlocksInRange: (r: {
                        upperBlockHash: Hash;
                        lowerBlockHash?: Hash;
                    }) => Array<{
                        messages: Array<{
                            balance: { amount: bigint | number; data: string };
                        }>;
                    }>;
                };
            };
            diamondStateMachine: {
                getZeroBalance: () => Promise<{ amount: bigint; data: string }>;
                addBalance: (
                    a: { amount: bigint; data: string },
                    b: { amount: bigint | number; data: string }
                ) => Promise<{ amount: bigint; data: string }>;
            };
        };
        const blocks = sm.storage.outboundMessages.getMessageBlocksInRange(req);
        let total = await sm.diamondStateMachine.getZeroBalance();
        for (const block of blocks)
            for (const message of block.messages)
                total = await sm.diamondStateMachine.addBalance(
                    total,
                    message.balance
                );
        return { amount: String(total.amount), data: String(total.data) };
    }

    async subtractBalance(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<{ amount: string; data: string }> {
        const sm = this.peer.stateManager as unknown as {
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
    }

    async areBalancesEqual(req: {
        a: { amount: string; data: string };
        b: { amount: string; data: string };
    }): Promise<boolean> {
        const sm = this.peer.stateManager as unknown as {
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
    }

    async queryLastMilestoneSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        const result =
            await this.peer.stateManager.prepareUpdateSnapshotSameFork(forkId);
        return result?.milestoneSnapshots.at(-1)?.toStruct();
    }

    async queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined> {
        const block = this.peer.stateManager.storage.blocks.getLatestBlock(
            forkId
        ) as { blockConfirmationStruct: BlockConfirmationStruct } | undefined;
        return block?.blockConfirmationStruct;
    }

    async queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            req.forkId,
            req.height
        ) as
            | {
                  blockConfirmationStruct: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
              }
            | undefined;
        if (!block) return undefined;
        return {
            blockConfirmation: block.blockConfirmationStruct,
            onChainTimestamp: block.onChainTimestamp
        };
    }

    async queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: string[];
          }
        | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            hash as string
        ) as
            | {
                  blockConfirmationStruct: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
                  confirmationSignatures: Set<string> | Iterable<string>;
              }
            | undefined;
        if (!block) return undefined;
        return {
            blockConfirmation: block.blockConfirmationStruct,
            onChainTimestamp: block.onChainTimestamp,
            confirmationSignatures: Array.from(
                block.confirmationSignatures ?? []
            ).map((s) => String(s))
        };
    }

    async queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void> {
        const Block = (await import("@/models")).Block;
        const block = Block.fromBlockConfirmation(
            req.blockConfirmation,
            req.onChainTimestamp
        );
        const storage = this.peer.stateManager.storage as unknown as {
            queues: { queueBlock: (b: unknown) => unknown };
        };
        storage.queues.queueBlock(block);
    }

    async isBlacklisted(addr: Address): Promise<boolean> {
        return this.peer.stateManager.p2pManager.isBlacklisted(addr);
    }

    async postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void> {
        const sm = this.peer.stateManager as unknown as {
            stateChannelManagerContract: {
                postBlockCalldata: (
                    s: SignedBlockStruct,
                    t: Timestamp
                ) => Promise<{ wait: () => Promise<unknown> }>;
            };
        };
        const tx = await sm.stateChannelManagerContract.postBlockCalldata(
            req.signedBlock,
            req.maxTimestamp
        );
        await tx.wait();
    }

    async queryIsMyTurn(): Promise<boolean> {
        return (
            (
                this.peer.stateManager as unknown as {
                    isMyTurn?: () => boolean;
                }
            ).isMyTurn?.() ?? false
        );
    }

    async postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | undefined> {
        const result = await this.peer.stateManager.postStateSnapshot(forkId);
        return result?.toStruct();
    }

    async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshotStruct;
              milestoneSnapshots: StateSnapshotStruct[];
              milestoneProofs: MilestoneProofStruct[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        const result =
            await this.peer.stateManager.prepareUpdateSnapshotSameFork(forkId);
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

    async constructDispute(forkId: ForkId): Promise<{
        dispute: DisputeStruct;
        disputeConfirmation: DisputeConfirmationStruct;
        auditingData: DisputeAuditingDataStruct;
        fraudProofsToApply: FraudProofStruct[];
    }> {
        return await this.peer.stateManager.disputeManager.constructDispute(
            forkId
        );
    }

    async queryGenesisSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshotStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            stateSnapshots: {
                getGenesisSnapshotByForkId: (
                    f: ForkId
                ) => { toStruct: () => StateSnapshotStruct } | undefined;
            };
        };
        return (
            storage.stateSnapshots
                .getGenesisSnapshotByForkId(forkId)
                ?.toStruct() ?? null
        );
    }

    async queryStateSnapshotByHash(
        hash: Hash
    ): Promise<StateSnapshotStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            stateSnapshots: {
                getStateSnapshotByHash: (
                    h: Hash
                ) => { toStruct: () => StateSnapshotStruct } | undefined;
            };
        };
        return (
            storage.stateSnapshots.getStateSnapshotByHash(hash)?.toStruct() ??
            null
        );
    }

    async queryOutboundMessageBlock(
        hash: Hash
    ): Promise<MessageBlockStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            outboundMessages: {
                getMessageBlock: (h: Hash) => MessageBlockStruct | undefined;
            };
        };
        return storage.outboundMessages.getMessageBlock(hash) ?? null;
    }

    async queryLatestBlockFromStateProof(
        stateProof: StateProofStruct
    ): Promise<{
        hasBlock: boolean;
        latestBlock: BlockStruct;
    }> {
        const [hasBlock, latestBlock] =
            await this.peer.stateManager.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                stateProof
            );
        return { hasBlock: Boolean(hasBlock), latestBlock };
    }

    async queryDisputeWindows(req: {
        channelId: string;
        forkIds: ForkId[];
    }): Promise<DisputeWindowStructOutput[]> {
        const sm = this.peer.stateManager as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getDisputeWindows: (
                        c: unknown,
                        f: unknown[]
                    ) => Promise<DisputeWindowStructOutput[]>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getDisputeWindows(
            req.channelId,
            req.forkIds
        );
    }

    async queryLocalStateSnapshot(
        channelId: string
    ): Promise<StateSnapshotStruct> {
        const sm = this.peer.stateManager as unknown as {
            diamondStateMachine: {
                localDiamondContract: {
                    getStateSnapshot: (
                        c: string
                    ) => Promise<StateSnapshotStruct>;
                };
            };
        };
        return await sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
            channelId
        );
    }

    async queryDisputeAuditingData(req: {
        forkId: ForkId;
        args?: unknown[];
    }): Promise<DisputeAuditingDataStruct> {
        const dm = this.peer.stateManager.disputeManager as unknown as {
            getAuditingData: (
                f: ForkId,
                ...args: unknown[]
            ) => Promise<DisputeAuditingDataStruct>;
        };
        return await dm.getAuditingData(req.forkId, ...(req.args ?? []));
    }

    async queryPreviousStateSnapshot(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<StateSnapshotStruct | null> {
        const storage = this.peer.stateManager.storage as unknown as {
            getPreviousStateSnapshot: (req: {
                forkId: ForkId;
                height: BlockHeight;
            }) => { toStruct: () => StateSnapshotStruct } | undefined;
        };
        return storage.getPreviousStateSnapshot(req)?.toStruct() ?? null;
    }

    async applyTransaction(
        req: TransactionStruct
    ): Promise<{ success: boolean; encodedState: Bytes }> {
        return (await this.peer.stateManager.applyTransaction(req)) as {
            success: boolean;
            encodedState: Bytes;
        };
    }

    async ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean> {
        return await this.peer.stateManager.ingestBlockConfirmation(
            req.blockConfirmation,
            req.ingestOptions
        );
    }

    async dispose(): Promise<void> {
        await this.peer.p2pInstance.dispose();
    }
}
