import { ethers, ZeroHash } from "ethers";

import type { Logger } from "@/utils";
import { ByzantineActions } from "@test/harness/actions/ByzantineActions";
import type { ForgeSubmitterSnapshotMutate } from "@test/harness/actions/DisputeTamperingActions";
import type { TestPeer } from "@test/harness/core/types";
import type MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";
import { ForkId, Bytes, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { MathStateMachine } from "@typechain-types";
import {
    BlockStruct,
    TransactionStruct,
    MessageBlockStruct,
    MessageStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

/** Serializable result of a relocated, host-signed Byzantine block submission. */
export type SubmittedBlock = { hash: string; height: number };

export class MathByzantineActions extends ByzantineActions {
    protected override harness!: MathPeerTestHarness;

    constructor(harness: MathPeerTestHarness, logger: Logger) {
        super(harness, logger);
    }

    private encodeMathAdd(peer: TestPeer, value: number = 1): Bytes {
        return (
            peer.contractInstance as MathStateMachine
        ).interface.encodeFunctionData("add", [value]) as Bytes;
    }

    /** Sign + broadcast a harness-assembled block on the peer's host. */
    private submit(
        peer: ReturnType<MathPeerTestHarness["getPeer"]>,
        blockStruct: BlockStruct
    ): Promise<SubmittedBlock> {
        return this.harness
            .control(peer)
            .byzantine.signAndBroadcastBlock(
                Codec.encode(blockStruct, Type.Block) as string
            )
            .request();
    }

    async submitInvalidStateTransitionBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
            wrongStateSnapshotHash?: Hash;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();
        if (ctx.latestBlockTimestamp === null) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const transactionData =
            options?.transactionData ?? this.encodeMathAdd(peer);

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: BigInt(ctx.latestBlockTimestamp) + 1n
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash:
                options?.wrongStateSnapshotHash || (ZeroHash as Hash),
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: []
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Invalid state transition block broadcasted by peer ${peerIndex} (height=${result.height})`
        );
        return result;
    }

    async submitForgedInboundMessageBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();

        const latestInboundHeight = BigInt(ctx.latestInboundMessageBlockHeight);
        const forgedInboundHeight = latestInboundHeight + 1n;

        const forgedMessage: MessageStruct = {
            messageType: ethers.hexlify(ethers.randomBytes(32)) as Bytes,
            participant: peer.address,
            balance: { amount: 1n, data: "0x" },
            data: ethers.hexlify(ethers.randomBytes(32)) as Bytes
        };

        const totalBalance: BalanceStruct = {
            amount: forgedMessage.balance.amount,
            data: "0x"
        };

        const forgedMessageBlock: MessageBlockStruct = {
            previousBlockHash:
                ctx.latestInboundMessageBlockHash || (ZeroHash as Hash),
            blockHeight: forgedInboundHeight,
            messages: [forgedMessage],
            totalBalance,
            timestamp: BigInt(ctx.currentTimestamp)
        };

        const transactionData = this.encodeMathAdd(peer);
        const blockTimestampBase =
            ctx.latestBlockTimestamp !== null
                ? ctx.latestBlockTimestamp + 1
                : ctx.currentTimestamp;

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: BigInt(blockTimestampBase)
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ctx.stateSnapshotHash,
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: [forgedMessageBlock]
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} broadcasting forged inbound message block at height ${result.height}`,
            { forkId }
        );
        return result;
    }

    async invalidTransitionFromNext(): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const maliciousPeer = await this.harness.query.getNextPeerToWrite();
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: maliciousPeer.index
        });
        await this.submitInvalidStateTransitionBlock(maliciousPeer.index, {
            forkId
        });
    }

    async forgedInboundMessageFromNext(): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const maliciousPeer = await this.harness.query.getNextPeerToWrite();
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: maliciousPeer.index
        });
        await this.submitForgedInboundMessageBlock(maliciousPeer.index, {
            forkId
        });
    }

    async submitInvalidTransactionDataBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();
        if (ctx.latestBlockTimestamp === null) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const malformedData = "0x1234567890abcdef";
        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: BigInt(ctx.latestBlockTimestamp) + 1n
            },
            body: {
                encodedData: malformedData as Bytes,
                data: malformedData as Bytes
            }
        };

        // Declared snapshot hash is a real (valid) state computed host-side, but
        // the block body carries malformed calldata.
        const validEncodedData = this.encodeMathAdd(peer);
        const { success, stateSnapshotHash } = await this.harness
            .control(peer)
            .byzantine.applyTransactionStateHash(
                Codec.encode(
                    {
                        ...transaction,
                        body: {
                            encodedData: validEncodedData,
                            data: validEncodedData
                        }
                    },
                    Type.Transaction
                ) as string
            )
            .request();
        if (!success) {
            throw new Error("Failed to compute valid state for fraud block");
        }

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash,
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: []
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} creating invalid transaction data block: height=${result.height}`
        );
        return result;
    }

    async submitBrokenInboundChainBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();
        if (ctx.latestBlockTimestamp === null) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const transactionData = this.encodeMathAdd(peer);
        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: BigInt(ctx.latestBlockTimestamp) + 1n
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const brokenMessageBlock: MessageBlockStruct = {
            previousBlockHash: ethers.keccak256(
                ethers.toUtf8Bytes("fake_hash")
            ),
            blockHeight: ctx.nextBlockHeight,
            messages: [],
            totalBalance: { amount: 0n, data: "0x" } as BalanceStruct,
            timestamp: BigInt(ctx.currentTimestamp)
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash,
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: [brokenMessageBlock]
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} creating broken inbound chain block: height=${result.height}`
        );
        return result;
    }

    async submitWrongGenesisBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();

        const wrongPreviousBlockHash = hash(
            ethers.toUtf8Bytes("wrong_genesis_hash")
        ) as Hash;
        const transactionData = this.encodeMathAdd(peer);

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: 0n,
                timestamp: BigInt(ctx.currentTimestamp)
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ZeroHash as Hash,
            previousBlockHash: wrongPreviousBlockHash,
            messageBlocks: []
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} broadcasting wrong genesis block: height=${result.height}`,
            { forkId }
        );
        return result;
    }

    async submitUnexpectedNextLeaderBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();
        if (ctx.latestBlockTimestamp === null) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const transactionData = this.encodeMathAdd(peer);
        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: BigInt(ctx.latestBlockTimestamp) + 1n
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ZeroHash as Hash,
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: []
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} submitting unexpected-next-leader block: height=${result.height}`,
            { forkId }
        );
        return result;
    }

    async submitInvalidTimestampBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<SubmittedBlock> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const ctx = await this.harness
            .control(peer)
            .query.getBlockBuildingContext(forkId)
            .request();
        if (ctx.latestBlockTimestamp === null) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const transactionData = this.encodeMathAdd(peer);
        const invalidTimestamp = BigInt(ctx.latestBlockTimestamp) - 1000n;

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId!,
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(ctx.nextBlockHeight),
                timestamp: invalidTimestamp
            },
            body: { encodedData: transactionData, data: transactionData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash,
            previousBlockHash: ctx.previousBlockHash,
            messageBlocks: []
        };

        const result = await this.submit(peer, blockStruct);
        this.logger.info(
            `Peer ${peerIndex} creating invalid timestamp block: height=${result.height}, timestamp=${invalidTimestamp}`
        );
        return result;
    }

    async postFraudulentSnapshot(options: {
        mutate: ForgeSubmitterSnapshotMutate;
        poster?: number;
    }): Promise<void> {
        const poster = options.poster ?? 0;

        const forgedSnapshot = await this.harness.tamper.buildForgedSnapshot(
            poster,
            options.mutate
        );

        const outboundBlocks: MessageBlockStruct[] = forgedSnapshot.mutated
            .outboundMessageBlock
            ? [forgedSnapshot.mutated.outboundMessageBlock]
            : [];

        const submitter = this.harness.getPeer(poster);
        const channelManager = this.harness.channelManager.connect(
            submitter.signer
        );
        const callData = channelManager.interface.encodeFunctionData(
            "updateStateSnapshotSameFork",
            [
                this.harness.channelId,
                [
                    {
                        blockConfirmations: [
                            forgedSnapshot.forgedBlock.blockConfirmationStruct
                        ]
                    }
                ],
                [forgedSnapshot.forgedSnapshot.toStruct()],
                outboundBlocks
            ]
        );
        const tx = await channelManager.multicall([callData]);
        await tx.wait();
    }
}
