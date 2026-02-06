import { PeerTestHarness, TestPeer } from "@test/fixtures/PeerTestHarness";
import { Logger, Codec, Type } from "@/utils";
import { ForkId, Bytes, Hash, BlockHeight } from "@/types/types";
import Block from "@/models/Block";
import {
    BlockStruct,
    TransactionStruct,
    MessageBlockStruct,
    MessageStruct,
    BalanceStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, ZeroHash } from "ethers";
import Clock from "@/Clock";
import { hash } from "@/utils";
import { AStateMachine } from "@typechain-types";

export class ByzantineActions {
    constructor(
        private harness: PeerTestHarness<any, any>,
        private logger: Logger
    ) {}

    /**
     * Submit a double-signed block (two blocks at same height with different content)
     */
    async submitDoubleSignBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
        }
    ): Promise<{
        conflictingBlock: Block;
        originalBlock: Block;
    }> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating double-sign block for fork ${forkId}`
        );

        const originalBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!originalBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        this.logger.debug(
            `Original block found: height=${originalBlock.height}, hash=${originalBlock.hash}`
        );

        // Create conflicting block with same coordinates but different content
        const conflictingTransactionData: Bytes =
            options?.transactionData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const conflictingStateSnapshotHash: Hash = hash(
            ethers.randomBytes(32)
        ) as Hash;

        const conflictingBlockStruct: BlockStruct = {
            transaction: {
                header: {
                    channelId: originalBlock.channelId,
                    participant: originalBlock.author,
                    forkId: originalBlock.forkId,
                    transactionCnt: BigInt(originalBlock.height),
                    timestamp: originalBlock.timestamp
                },
                body: {
                    encodedData: conflictingTransactionData,
                    data: conflictingTransactionData
                }
            },
            stateSnapshotHash: conflictingStateSnapshotHash,
            previousBlockHash: originalBlock.previousBlockHash,
            messageBlocks: []
        };

        const conflictingBlock = await Block.fromBlockStruct(
            conflictingBlockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting double-sign block: height=${conflictingBlock.height}, hash=${conflictingBlock.hash}`
        );

        // Broadcast
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(conflictingBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(`Double-sign block broadcasted by peer ${peerIndex}`);

        return {
            conflictingBlock,
            originalBlock
        };
    }

    /**
     * Submit an invalid state transition block (wrong state snapshot hash)
     */
    async submitInvalidStateTransitionBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
            wrongStateSnapshotHash?: Hash;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating invalid state transition block for fork ${forkId}`
        );

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create a valid transaction
        let transactionData: Bytes;
        if (options?.transactionData) {
            transactionData = options.transactionData;
        } else {
            const contractInterface = (peer.contractInstance as any).interface;
            transactionData = contractInterface.encodeFunctionData("add", [
                1
            ]) as Bytes;
        }

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const wrongStateSnapshotHash: Hash =
            options?.wrongStateSnapshotHash || (ZeroHash as Hash);

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: wrongStateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid state transition block: height=${invalidBlock.height}, hash=${invalidBlock.hash}, wrongStateSnapshotHash=${wrongStateSnapshotHash}`
        );

        // Broadcast the invalid block from the specified peer
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(
            `Invalid state transition block broadcasted by peer ${peerIndex}`
        );

        return invalidBlock;
    }

    /**
     * Submit a forged inbound message block
     */
    async submitForgedInboundMessageBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = options?.forkId || this.harness.activeForkId!;

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );
        const stateSnapshotHash = this.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const previousStateSnapshot =
            peer.stateManager.storage.getPreviousStateSnapshot({
                forkId,
                height: nextBlockHeight
            });
        if (!previousStateSnapshot) {
            throw new Error(
                `Unable to compute previous snapshot for fork ${forkId}`
            );
        }

        const latestInboundHash = (previousStateSnapshot.snapshotData
            .latestInboundMessageBlockHash ?? ZeroHash) as Hash;
        const latestInboundHeightValue =
            previousStateSnapshot.snapshotData
                .latestInboundMessageBlockHeight ?? 0n;
        const latestInboundHeight =
            typeof latestInboundHeightValue === "bigint"
                ? latestInboundHeightValue
                : BigInt(latestInboundHeightValue);
        const forgedInboundHeight = latestInboundHeight + 1n;

        const forgedMessage: MessageStruct = {
            messageType: ethers.hexlify(ethers.randomBytes(32)) as Bytes,
            participant: peer.address,
            balance: {
                amount: 1n,
                data: "0x"
            },
            data: ethers.hexlify(ethers.randomBytes(32)) as Bytes
        };

        const totalBalance: BalanceStruct = {
            amount: forgedMessage.balance.amount,
            data: "0x"
        };

        const forgedMessageBlock: MessageBlockStruct = {
            previousBlockHash: latestInboundHash || (ZeroHash as Hash),
            blockHeight: forgedInboundHeight,
            messages: [forgedMessage],
            totalBalance,
            timestamp: BigInt(Clock.getTimeInSeconds())
        };

        const contractInterface = (peer.contractInstance as any).interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const blockTimestampBase = previousBlock
            ? previousBlock.timestamp + 1
            : Clock.getTimeInSeconds();

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(blockTimestampBase)
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash,
            previousBlockHash,
            messageBlocks: [forgedMessageBlock]
        };

        const forgedBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting forged inbound message block at height ${forgedBlock.height}`,
            { forkId }
        );

        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(forgedBlock.blockConfirmationStruct)
            .broadcast();

        return forgedBlock;
    }

    /**
     * Post junk calldata on-chain with an invalid signature
     */
    async postJunkCalldataOnChain(
        peerIndex: number,
        options: {
            height: BlockHeight;
            forkId?: ForkId;
            encodedData?: Bytes;
        }
    ): Promise<BlockStruct> {
        const peer = this.harness.getPeer(peerIndex);
        const forkId = options.forkId || this.harness.activeForkId!;
        const height = options.height;

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.getPreviousBlockHash(peer, forkId);
        const stateSnapshotHash = this.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const encodedData: Bytes =
            options.encodedData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(height),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: encodedData,
                data: encodedData
            }
        };

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        // Create invalid signature by corrupting the hash
        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const blockHash = hash(encodedBlock);
        const corruptedBlockHash = hash(blockHash);
        const invalidSignature = await peer.signer.signMessage(
            ethers.getBytes(corruptedBlockHash)
        );

        const signedBlock: SignedBlockStruct = {
            encodedBlock: encodedBlock,
            signature: invalidSignature
        };

        const maxTimestamp = Clock.getTimeInSeconds() + 1000;

        this.logger.debug(
            `Peer ${peerIndex} posting junk calldata with invalid signature for height ${height}`,
            { forkId }
        );

        const tx =
            await peer.stateManager.stateChannelManagerContract.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );
        await tx.wait();

        this.logger.info(`Junk calldata posted on-chain by peer ${peerIndex}`);

        return blockStruct;
    }

    // Private helper methods
    private getPreviousBlockHash(
        peer: TestPeer<AStateMachine>,
        forkId: ForkId,
        height?: BlockHeight
    ): Hash {
        if (height !== undefined) {
            const previousBlockOrSnapshot =
                peer.stateManager.storage.getPreviousBlockOrSnapshot({
                    forkId,
                    height
                });
            return previousBlockOrSnapshot.block
                ? previousBlockOrSnapshot.block.hash
                : previousBlockOrSnapshot.stateSnapshot!.hash;
        }

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        return (
            previousBlock?.hash ||
            peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            )?.hash ||
            ethers.ZeroHash
        );
    }

    private getStateSnapshotHash(
        peer: TestPeer<AStateMachine>,
        forkId: ForkId,
        previousBlock?: Block
    ): Hash {
        return previousBlock
            ? previousBlock.stateSnapshotHash
            : peer.stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                  forkId
              )?.hash || ethers.ZeroHash;
    }
}
